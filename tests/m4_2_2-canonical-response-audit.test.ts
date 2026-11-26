import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { TakeoverCoordinator } from '../src/staff/takeover/takeover-coordinator.js';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { PreBookingQuoteEngine } from '../src/pricing/prebooking-quote-engine.js';
import { CanonicalRoomValidator } from '../src/conversation/grounding/canonical-room-validator.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';
import { renderSafeMarkdown } from '../src/staff/server/dashboard-html.js';
import { StaffUser } from '../src/staff/staff-types.js';

describe('Milestone 4.2.2 — Canonical Response Integrity & Ground Truth Audit Suite', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday
  const CANONICAL_DATASET_SHA256 = '22df0ec50596e26fc7f7b2b889bfff0a626c15e9c3ebd773684658fed38e44b6';

  let orchestrator: ConversationOrchestrator;
  let store: SqliteStore;
  let coordinator: TakeoverCoordinator;
  let quoteEngine: PreBookingQuoteEngine;
  let roomValidator: CanonicalRoomValidator;
  let claimValidator: ClaimLevelValidator;

  const mockAdminUser: StaffUser = {
    id: 'admin_audit',
    username: 'admin',
    fullName: 'Quản trị viên Hệ thống',
    role: 'admin',
    propertyId: null,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    orchestrator = new ConversationOrchestrator(dataset, { referenceClock: FIXED_CLOCK });
    store = new SqliteStore(':memory:');
    coordinator = new TakeoverCoordinator({ orchestrator, store });
    quoteEngine = new PreBookingQuoteEngine(dataset);
    roomValidator = new CanonicalRoomValidator(dataset);
    claimValidator = new ClaimLevelValidator(dataset);
  });

  afterEach(() => {
    store.close();
  });

  // ==========================================================================
  // SECTION A: CANONICAL ROOM IDENTITY & EXACT SET VALIDATION
  // ==========================================================================
  describe('A. Canonical Room Identity & Exact Set Validation', () => {
    it('A1: Jacayl Hà Đông có chính xác đúng 3 phòng Concept trong canonical dataset', () => {
      const conceptRooms = roomValidator.getCanonicalRooms('jacayl-ha-dong', 'Concept');
      expect(conceptRooms.length).toBe(3);

      const roomCodes = conceptRooms.map((r) => r.ma_phong).sort();
      expect(roomCodes).toEqual(['101-long-chim', '601-50-sac-thai', '602-playboy']);

      const displayNames = conceptRooms.map((r) => r.ten_phong).sort();
      expect(displayNames).toEqual(['101 — Lồng Chim', '50 — Sắc Thái', '602 — Playboy']);
    });

    it('A2: Negative Assertions — Các phòng giả định trong M4.2.1 transcript không tồn tại trong dataset', () => {
      const allHdRooms = dataset.phong.filter((p) => p.co_so_ma === 'jacayl-ha-dong');
      const allNames = allHdRooms.map((r) => r.ten_phong.toLowerCase());

      // Fictitious rooms hallucinated in M4.2.1 report
      expect(allNames.some((n) => n.includes('cinema'))).toBe(false);
      expect(allNames.some((n) => n.includes('nhật bản'))).toBe(false);
      expect(allNames.some((n) => n.includes('lồng sắt'))).toBe(false);
      expect(allNames.some((n) => n.includes('gác mái cổ điển'))).toBe(false);

      // Room 401 Ha Dong must be NOT_FOR_SALE
      const room401 = allHdRooms.find((r) => r.ma_phong.includes('401'));
      expect(room401).toBeUndefined(); // Filtered from normalized commercial catalog
    });

    it('A3: Phòng 601 Hà Đông có tên chính thức là "50 — Sắc Thái", không ghép mã phòng', () => {
      const room601 = dataset.phong.find(
        (p) => p.co_so_ma === 'jacayl-ha-dong' && p.ma_phong === '601-50-sac-thai'
      );
      expect(room601).toBeDefined();
      expect(room601!.ten_phong).toBe('50 — Sắc Thái');
      expect(room601!.ten_phong).not.toBe('601 — 50 — Sắc Thái');
      expect(room601!.hang).toBe('Concept');

      // Validator test
      const validation = roomValidator.validateRoom({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '601-50-sac-thai',
        ten_phong: 'Tổng Thống', // LLM fake name
      });
      expect(validation.isValid).toBe(true);
      expect(validation.display_name).toBe('50 — Sắc Thái'); // Overrides LLM name with canonical dataset name
    });

    it('A4: Outbound Text Validator chặn đứng phòng giả mạo và mã phòng ghép', () => {
      const textWithFakes =
        'Danh sách phòng Concept gồm: 201 — Cinema, 301 — Nhật Bản, 402 — Lồng Sắt, 501 — Gác Mái Cổ Điển, 601 — 50 — Sắc Thái.';
      const res = roomValidator.validateOutboundText(textWithFakes, 'jacayl-ha-dong', 'Concept');

      expect(res.passed).toBe(false);
      expect(res.violations.length).toBeGreaterThanOrEqual(4);
      expect(res.violations.some((v) => v.includes('Cinema'))).toBe(true);
      expect(res.violations.some((v) => v.includes('Nhật Bản'))).toBe(true);
      expect(res.violations.some((v) => v.includes('Lồng Sắt'))).toBe(true);
      expect(res.violations.some((v) => v.includes('Gác Mái'))).toBe(true);
      expect(res.violations.some((v) => v.includes('PREPENDED_ROOM_CODE'))).toBe(true);
    });
  });

  // ==========================================================================
  // SECTION B: ROOM-SPECIFIC PRICING INVARIANTS & PRICING RESOLVER
  // ==========================================================================
  describe('B. Room-Specific Pricing Invariants (Saturday 17:00 4-Hour)', () => {
    it('B1: Phòng 101 — Lồng Chim có phụ thu 100.000đ/giờ -> 4 giờ thứ Bảy = 649.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '101-long-chim',
        stay_type: 'nghi_gio',
        duration_hours: 4,
        checkin_datetime: '2026-11-28T17:00:00+07:00', // Saturday 17:00
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000); // Suite weekend daytime rate
      expect(quote.extra_hours).toBe(2);
      expect(quote.extra_hour_rate).toBe(100000); // 101 dataset surcharge
      expect(quote.total_estimate).toBe(649000); // 449k + 2 * 100k
    });

    it('B2: Phòng 601 — 50 — Sắc Thái có phụ thu 200.000đ/giờ -> 4 giờ thứ Bảy = 849.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '601-50-sac-thai',
        stay_type: 'nghi_gio',
        duration_hours: 4,
        checkin_datetime: '2026-11-28T17:00:00+07:00', // Saturday 17:00
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000); // Suite weekend daytime rate
      expect(quote.extra_hours).toBe(2);
      expect(quote.extra_hour_rate).toBe(200000); // 601 dataset surcharge
      expect(quote.total_estimate).toBe(849000); // 449k + 2 * 200k
    });

    it('B3: Phòng 602 — Playboy có phụ thu 200.000đ/giờ -> 4 giờ thứ Bảy = 849.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '602-playboy',
        stay_type: 'nghi_gio',
        duration_hours: 4,
        checkin_datetime: '2026-11-28T17:00:00+07:00', // Saturday 17:00
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000);
      expect(quote.extra_hours).toBe(2);
      expect(quote.extra_hour_rate).toBe(200000); // 602 dataset surcharge
      expect(quote.total_estimate).toBe(849000); // 449k + 2 * 200k
    });

    it('B4: Khi khách hỏi giá cụ thể phòng 601, báo đúng 849.000đ, không nhầm sang phụ thu của 101', async () => {
      const res = await orchestrator.processTurn(
        'sc-b4-specific-quote',
        'Phòng 601 giá thứ Bảy từ 17h trong 4 tiếng bao nhiêu em?',
        { referenceClock: FIXED_CLOCK, boundPropertyId: 'jacayl-ha-dong' }
      );

      expect(res.customer_visible_response).toContain('50 — Sắc Thái');
      expect(res.customer_visible_response).toContain('849.000đ');
      expect(res.customer_visible_response).toContain('200.000đ'); // Surcharge for 601
      expect(res.customer_visible_response).not.toContain('649.000đ'); // Must not use 101 surcharge
    });

    it('B5: Khách vừa xem ảnh phòng 601 rồi hỏi thời gian thuê 4 tiếng thứ Bảy 17h -> dùng giá của 601 (849k)', async () => {
      const convId = 'sc-b5-consecutive-quote';
      const prop = 'jacayl-ha-dong';

      // Turn 1: Xem ảnh phòng 601
      const t1 = await coordinator.handleCustomerTurn(convId, prop, 'Cho xem ảnh phòng 601', { referenceClock: FIXED_CLOCK });
      expect(t1.aiMessage?.content).toContain('50 — Sắc Thái');

      // Turn 2: Hỏi thời gian thuê 4 tiếng thứ Bảy từ 17h
      const t2 = await coordinator.handleCustomerTurn(convId, prop, 'Anh muốn nghỉ thứ Bảy từ 17h trong 4 tiếng', { referenceClock: FIXED_CLOCK });
      const c2 = t2.aiMessage?.content ?? '';

      // Phòng 601 đứng đầu danh sách với giá 849.000đ
      expect(c2).toContain('50 — Sắc Thái');
      expect(c2).toContain('849.000đ');
    });
  });

  // ==========================================================================
  // SECTION C: STRICT AMENITY VERIFICATION
  // ==========================================================================
  describe('C. Strict Amenity Verification', () => {
    it('C1: Dữ liệu tiện nghi phòng 601 chỉ có bồn tắm lớn, ghế tình yêu; không có giường king-size', () => {
      const r601 = dataset.phong.find(
        (p) => p.co_so_ma === 'jacayl-ha-dong' && p.ma_phong === '601-50-sac-thai'
      );
      expect(r601).toBeDefined();

      // Confirmed amenities in domain
      expect(r601!.tien_nghi.bon_tam.status).toBe('CONFIRMED_TRUE');
      expect(r601!.tien_nghi.ghe_tinh_yeu.status).toBe('CONFIRMED_TRUE');

      // Check raw dataset descriptions: No king-size bed
      const rawText = JSON.stringify(r601).toLowerCase();
      expect(rawText).not.toContain('king-size');
      expect(rawText).not.toContain('king size');
      expect(rawText).not.toContain('bồn tắm đôi'); // Dataset has "Bồn tắm lớn", NOT "bồn tắm đôi"
    });

    it('C2: ClaimValidator từ chối khẳng định "giường king-size" và "bồn tắm đôi" cho phòng 601', () => {
      const invalidClaimText =
        'Phòng 601 có giường king-size sang trọng và bồn tắm đôi cao cấp.';
      const validation = claimValidator.validate(invalidClaimText, {
        facility: 'jacayl-ha-dong',
        focusedRoomKey: 'jacayl-ha-dong::601-50-sac-thai',
      });

      expect(validation.rejected_claims.length).toBeGreaterThanOrEqual(2);
      expect(validation.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_BED_TYPE'))).toBe(true);
      expect(validation.rejected_claims.some((c) => c.includes('REJECTED_UNCONFIRMED_DOUBLE_BATHTUB'))).toBe(true);
    });

    it('C3: FAQ Bồn tắm đôi vẫn ở trạng thái UNCONFIRMED', async () => {
      const res = await orchestrator.processTurn(
        'sc-c3-double-bathtub',
        'Phòng bên em có bồn tắm đôi không?',
        FIXED_CLOCK
      );

      // Disclaims unverified double bathtub size
      expect(res.customer_visible_response.toLowerCase()).toMatch(/chưa có thông tin|chưa được công bố|xác nhận|kích thước/);
    });
  });

  // ==========================================================================
  // SECTION D: IMAGE SOURCE INTEGRITY & PROVENANCE
  // ==========================================================================
  describe('D. Image Source Integrity & Provenance', () => {
    it('D1: URL ảnh trả về cho phòng 601 khớp 100% với canonical dataset', async () => {
      const res = await orchestrator.processTurn(
        'sc-d1-image-provenance',
        'Cho xem ảnh phòng 601 Hà Đông',
        FIXED_CLOCK
      );

      const r601 = dataset.phong.find(
        (p) => p.co_so_ma === 'jacayl-ha-dong' && p.ma_phong === '601-50-sac-thai'
      );
      expect(r601?.anh.length).toBe(4);

      // Verify delivered images match dataset URLs exactly (V3 exposes images cleanly on result.images)
      const deliveredImages =
        res.images && res.images.length > 0 ? res.images : (res.tool_results as any).delivered_images || [];
      expect(deliveredImages.length).toBe(4);

      for (let i = 0; i < deliveredImages.length; i++) {
        expect(deliveredImages[i].url).toBe(r601!.anh[i].url);
        expect(deliveredImages[i].url).toContain('pub-a4f6c96b880a43f8a62e2085ac1159b8.r2.dev');
        expect(deliveredImages[i].url).toContain('concept__601');
      }

      // Negative assertion: Must not use hallucinated bucket from M4.2.1 report
      expect(deliveredImages.some((img: any) => img.url.includes('pub-8b77bd5ca3fb46e18f8e0d9b4070a7bb'))).toBe(false);
    });

    it('D2: ClaimValidator từ chối các URL hình ảnh hoặc booking không có trong dataset', () => {
      const unverifiedUrlText =
        'Xem ảnh phòng 601 tại: https://pub-8b77bd5ca3fb46e18f8e0d9b4070a7bb.r2.dev/j-collection/601.webp';
      const validation = claimValidator.validate(unverifiedUrlText, {
        facility: 'jacayl-ha-dong',
      });

      expect(validation.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_URL'))).toBe(true);
    });
  });

  // ==========================================================================
  // SECTION E & F: ACTION CONFIRMATION & HANDOFF INTEGRITY
  // ==========================================================================
  describe('E & F. Action Confirmation & Handoff Integrity', () => {
    it('F1: Chatbot không hứa hẹn thời gian phản hồi unverified ("trong ít phút")', async () => {
      const res = await orchestrator.processTurn(
        'sc-f1-no-unverified-sla',
        'Cho anh gặp nhân viên lễ tân với',
        FIXED_CLOCK
      );

      // Reconciled V3 escalation oracle: verifies human_escalation & zero unverified SLA without relying on legacy res.intent enum
      expect(res.human_escalation?.needed).toBe(true);
      expect(res.customer_visible_response).not.toContain('trong ít phút');
      expect(res.customer_visible_response).not.toContain('trong vài phút');
      expect(res.customer_visible_response).not.toContain('trong 5 phút');
      expect(res.customer_visible_response.toLowerCase()).toMatch(/lễ tân|quản lý/);
    });

    it('F2: ClaimValidator từ chối các câu hứa hẹn SLA không có căn cứ', () => {
      const textWithUnverifiedSla =
        'Dạ em đã chuyển yêu cầu, nhân viên sẽ liên hệ lại với anh/chị trong ít phút nữa nhé.';
      const validation = claimValidator.validate(textWithUnverifiedSla, {});

      expect(validation.rejected_claims.some((c) => c.includes('REJECTED_UNVERIFIED_SLA_PROMISE'))).toBe(true);
    });

    it('F3: Quy trình Handoff kích hoạt chuyển đổi trạng thái chính xác sang WAITING_FOR_STAFF', async () => {
      const convId = 'sc-f3-handoff-state';
      const prop = 'jacayl-ha-dong';

      const turn = await coordinator.handleCustomerTurn(convId, prop, 'Tôi muốn khiếu nại về tiền phòng', {
        referenceClock: FIXED_CLOCK,
      });

      expect(turn.state).toBe('WAITING_FOR_STAFF');
      const conv = store.getConversationById(convId);
      expect(conv?.state).toBe('WAITING_FOR_STAFF');
    });
  });

  // ==========================================================================
  // SECTION G & H: SAFE MARKDOWN & ZERO INLINE EVENT HANDLERS
  // ==========================================================================
  describe('G & H. Security Regression & Safe Markdown Rendering', () => {
    it('H1: Loại bỏ 100% inline onclick và onerror trong HTML render', () => {
      // Test that the rendered markdown does not produce inline scripts
      const htmlOutput = renderSafeMarkdown('![Ảnh phòng](https://example.com/img.webp)');
      expect(htmlOutput).not.toContain('onerror=');
      expect(htmlOutput).not.toContain('onclick=');
      expect(htmlOutput).not.toContain('<script');
    });

    it('H2: Chống tiêm nhiễm XSS qua markdown và HTML attributes', () => {
      const xssVector1 = '<script>alert("xss")</script>';
      const xssVector2 = '<img src=x onerror=alert(1)>';
      const xssVector3 = '[Click me](javascript:alert("pwned"))';

      const out1 = renderSafeMarkdown(xssVector1);
      expect(out1).toContain('&lt;script&gt;');
      expect(out1).not.toContain('<script>');

      const out2 = renderSafeMarkdown(xssVector2);
      expect(out2).toContain('&lt;img');
      expect(out2).not.toContain('<img');

      const out3 = renderSafeMarkdown(xssVector3);
      expect(out3).not.toContain('href="javascript:');
    });
  });

  // ==========================================================================
  // CONTINUOUS 9-TURN CUSTOMER SESSION AUDIT (LIVE ON TAKEOVER COORDINATOR)
  // ==========================================================================
  describe('Continuous 9-Turn Customer Session Audit', () => {
    it('Thực hiện chuỗi 9 câu hỏi liên tục của khách hàng với 100% bằng chứng xác thực', async () => {
      const convId = 'conv-session-m4-2-2-audit';
      const prop = 'jacayl-ha-dong';

      // Turn 1: "Còn phòng không em?"
      const t1 = await coordinator.handleCustomerTurn(convId, prop, 'Còn phòng không em?', { referenceClock: FIXED_CLOCK });
      expect(t1.aiMessage).toBeDefined();
      const c1 = t1.aiMessage!.content;
      expect(c1).not.toMatch(/\d{3}\.000đ/); // Không tự ý báo giá
      expect(c1).toContain('Standard');
      expect(c1).toContain('Deluxe');
      expect(c1).toContain('Concept');
      expect(c1.toLowerCase()).toMatch(/chưa đồng bộ dữ liệu phòng trống|chưa kết nối|thời gian thực|live pms/);
      expect(c1.toLowerCase()).toMatch(/lễ tân|0522 464 646/); // Transparently directs to reception / hotline
      expect(c1).not.toContain('ít phút'); // No unverified SLA

      // Turn 2: "Có những loại phòng nào?"
      const t2 = await coordinator.handleCustomerTurn(convId, prop, 'Có những loại phòng nào?', { referenceClock: FIXED_CLOCK });
      expect(t2.aiMessage).toBeDefined();
      const c2 = t2.aiMessage!.content;
      expect(c2).toContain('Standard');
      expect(c2).toContain('Deluxe');
      expect(c2).toContain('Concept');
      expect(c2).not.toMatch(/\d{3}\.000đ/);

      // Turn 3: "Giá ba loại bao nhiêu?"
      const t3 = await coordinator.handleCustomerTurn(convId, prop, 'Giá ba loại bao nhiêu?', { referenceClock: FIXED_CLOCK });
      expect(t3.aiMessage).toBeDefined();
      const c3 = t3.aiMessage!.content;
      // Verify canonical dataset rates appear truthfully (Concept/Standard/Deluxe rates) without hallucinating
      expect(c3).toMatch(/159\.000đ|399\.000đ|449\.000đ/);

      // Turn 4: "Anh muốn xem phòng Concept"
      const t4 = await coordinator.handleCustomerTurn(convId, prop, 'Anh muốn xem phòng Concept', { referenceClock: FIXED_CLOCK });
      expect(t4.aiMessage).toBeDefined();
      const c4 = t4.aiMessage!.content;
      // Exact set of 3 concept rooms
      expect(c4).toContain('101 — Lồng Chim');
      expect(c4).toContain('50 — Sắc Thái');
      expect(c4).toContain('602 — Playboy');
      // Negative assertions
      expect(c4).not.toContain('Cinema');
      expect(c4).not.toContain('Nhật Bản');
      expect(c4).not.toContain('Lồng Sắt');
      expect(c4).not.toContain('Gác Mái');
      expect(c4).not.toContain('401');

      // Turn 5: "Cho xem ảnh phòng 601"
      const t5 = await coordinator.handleCustomerTurn(convId, prop, 'Cho xem ảnh phòng 601', { referenceClock: FIXED_CLOCK });
      expect(t5.aiMessage).toBeDefined();
      const c5 = t5.aiMessage!.content;
      expect(c5).toContain('50 — Sắc Thái');
      expect(t5.aiMessage!.metadata?.images).toBeDefined();
      expect(t5.aiMessage!.metadata!.images!.length).toBe(4);
      expect(t5.aiMessage!.metadata!.images![0].url).toContain('pub-a4f6c96b880a43f8a62e2085ac1159b8.r2.dev');
      expect(t5.aiMessage!.metadata!.images![0].url).toContain('concept__601');
      // Strict amenity: No king-size bed claim
      expect(c5).not.toContain('king-size');
      expect(c5).not.toContain('bồn tắm đôi');

      // Turn 6: "Bên em có chỗ đỗ xe không?"
      const t6 = await coordinator.handleCustomerTurn(convId, prop, 'Bên em có chỗ đỗ xe không?', { referenceClock: FIXED_CLOCK });
      expect(t6.aiMessage).toBeDefined();
      const c6 = t6.aiMessage!.content;
      expect(c6.toLowerCase()).toContain('có chỗ đỗ xe');
      expect(c6).not.toContain('50 — Sắc Thái');
      expect(c6).not.toContain('399.000đ');

      // Turn 7: "Anh muốn nghỉ thứ Bảy từ 17h trong 4 tiếng"
      const t7 = await coordinator.handleCustomerTurn(convId, prop, 'Anh muốn nghỉ thứ Bảy từ 17h trong 4 tiếng', { referenceClock: FIXED_CLOCK });
      expect(t7.aiMessage).toBeDefined();
      const c7 = t7.aiMessage!.content;
      // Room 601 was focused from Turn 5, quoted at 849.000đ (449k + 2 * 200k)
      expect(c7).toContain('50 — Sắc Thái');
      expect(c7).toContain('849.000đ');
      expect(c7).toContain('400.000đ'); // 2 * 200k extra
      // Room 101 quoted at 649.000đ (449k + 2 * 100k)
      expect(c7).toContain('101 — Lồng Chim');
      expect(c7).toContain('649.000đ');

      // Turn 8: "À đổi sang phòng Deluxe nhé"
      const t8 = await coordinator.handleCustomerTurn(convId, prop, 'À đổi sang phòng Deluxe nhé', { referenceClock: FIXED_CLOCK });
      expect(t8.aiMessage).toBeDefined();
      const c8 = t8.aiMessage!.content;
      // Deluxe on Saturday 17:00 for 4 hours: 315k + 2 * 100k = 515.000đ
      expect(c8).toContain('515.000đ');
      expect(c8).toMatch(/Grand Canyon|Red Rum|Rico Dinner/);

      // Turn 9: "Cho anh gặp nhân viên"
      const t9 = await coordinator.handleCustomerTurn(convId, prop, 'Cho anh gặp nhân viên', { referenceClock: FIXED_CLOCK });
      expect(t9.aiMessage).toBeDefined();
      const c9 = t9.aiMessage!.content;
      expect(c9.toLowerCase()).toMatch(/lễ tân|quản lý/);
      expect(c9).not.toContain('trong ít phút');

      // Verify conversation state transitioned to WAITING_FOR_STAFF
      const conv = store.getConversationById(convId);
      expect(conv?.state).toBe('WAITING_FOR_STAFF');
    });
  });

  // ==========================================================================
  // DATASET INTEGRITY & FREE ONLY MODE
  // ==========================================================================
  describe('Dataset Integrity & Cost Prevention Invariants', () => {
    it('Dataset SHA-256 nguyên vẹn 100% không bị thay đổi', () => {
      const content = readFileSync('data/j_collection_dataset.json');
      const hash = createHash('sha256').update(content).digest('hex');
      expect(hash).toBe(CANONICAL_DATASET_SHA256);
    });

    it('FREE_ONLY_MODE luôn được duy trì true', () => {
      const freeOnlyMode = process.env.FREE_ONLY_MODE ?? 'true';
      expect(freeOnlyMode).toBe('true');
    });
  });
});
