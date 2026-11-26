import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { renderSafeMarkdown } from '../src/staff/server/dashboard-html.js';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { TakeoverCoordinator } from '../src/staff/takeover/takeover-coordinator.js';
import { StaffUser } from '../src/staff/staff-types.js';
import { PreBookingQuoteEngine } from '../src/pricing/prebooking-quote-engine.js';

describe('Milestone 4.2 — Conversation Intelligence & Customer Experience Suite (20 Scenarios)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday
  const CANONICAL_DATASET_SHA256 = '22df0ec50596e26fc7f7b2b889bfff0a626c15e9c3ebd773684658fed38e44b6';

  let orchestrator: ConversationOrchestrator;
  let store: SqliteStore;
  let coordinator: TakeoverCoordinator;

  const mockAdminUser: StaffUser = {
    id: 'admin_test',
    username: 'admin',
    fullName: 'Quản trị viên Hệ thống',
    role: 'admin',
    propertyId: null,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  let prevEngine: string | undefined;

  // Reconciled V3 Fixture Binding: M4.2 suite asserts legacy AdvisoryComposer intents & category phrasing
  beforeAll(() => {
    prevEngine = process.env.CONVERSATION_ENGINE;
    process.env.CONVERSATION_ENGINE = 'legacy';
  });

  afterAll(() => {
    if (prevEngine === undefined) delete process.env.CONVERSATION_ENGINE;
    else process.env.CONVERSATION_ENGINE = prevEngine;
  });

  beforeEach(() => {
    orchestrator = new ConversationOrchestrator(dataset, { referenceClock: FIXED_CLOCK });
    store = new SqliteStore(':memory:');
    coordinator = new TakeoverCoordinator({ orchestrator, store });
  });

  afterEach(() => {
    store.close();
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Hà Đông hỏi "Còn phòng không?"
  // --------------------------------------------------------------------------
  it('Scenario 1: Hà Đông hỏi "Còn phòng không?" nhận diện đúng cơ sở, không hỏi lại', async () => {
    const sId = 'sc1-ha-dong-avail';
    // Chat bound with property jacayl-ha-dong
    const res = await orchestrator.processTurn(sId, 'Còn phòng không?', {
      referenceClock: FIXED_CLOCK,
      boundPropertyId: 'jacayl-ha-dong',
    });

    expect(res.intent).toBe('CHECK_ROOM_AVAILABILITY');
    expect(res.chosen_action).toBe('ANSWER_AVAILABILITY_TRANSPARENT');
    expect(res.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(res.customer_visible_response).toContain('Jacayl Hà Đông');
    // Does NOT ask which facility user wants
    expect(res.customer_visible_response).not.toContain('bạn muốn hỏi cơ sở nào');
    expect(res.customer_visible_response).not.toContain('ở cơ sở nào');
  });

  // --------------------------------------------------------------------------
  // Scenario 2: "Còn phòng trống Hà Đông không?"
  // --------------------------------------------------------------------------
  it('Scenario 2: "Còn phòng trống Hà Đông không?" nêu rõ chưa có PMS real-time, liệt kê 3 hạng và hotline', async () => {
    const sId = 'sc2-ha-dong-pms';
    const res = await orchestrator.processTurn(sId, 'Còn phòng trống ở Hà Đông không?', FIXED_CLOCK);

    expect(res.intent).toBe('CHECK_ROOM_AVAILABILITY');
    expect(res.customer_visible_response.toLowerCase()).toMatch(/chưa đồng bộ dữ liệu phòng trống theo thời gian thực|live pms|chưa thể xác nhận ngay/);
    expect(res.customer_visible_response).toContain('Standard');
    expect(res.customer_visible_response).toContain('Deluxe');
    expect(res.customer_visible_response).toContain('Concept');
    // Invariant: Do not call Concept Suite in category presentation
    expect(res.customer_visible_response).not.toMatch(/hạng Suite/i);
    expect(res.customer_visible_response).toContain('0522 464 646');
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Availability response không chứa phòng 101, 201, 202 hay giá phòng
  // --------------------------------------------------------------------------
  it('Scenario 3: Availability response tuyệt đối không chứa danh sách phòng 101, 201, 202 hay giá phòng', async () => {
    const sId = 'sc3-ha-dong-no-unasked-rooms';
    const res = await orchestrator.processTurn(sId, 'bên bạn còn phòng không?', {
      referenceClock: FIXED_CLOCK,
      boundPropertyId: 'jacayl-ha-dong',
    });

    expect(res.customer_visible_response).not.toContain('101');
    expect(res.customer_visible_response).not.toContain('201');
    expect(res.customer_visible_response).not.toContain('202');
    expect(res.customer_visible_response).not.toContain('159.000đ');
    expect(res.customer_visible_response).not.toContain('279.000đ');
    expect(res.customer_visible_response).not.toContain('399.000đ');
    expect(res.verified_candidates.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 4: "Cho xem hạng Concept"
  // --------------------------------------------------------------------------
  it('Scenario 4: "Cho xem hạng Concept" liệt kê các phòng Concept thương mại, không có phòng 401, không kèm giá', async () => {
    const sId = 'sc4-browse-concept';
    const res = await orchestrator.processTurn(sId, 'Cho xem các phòng hạng Concept ở Hà Đông', FIXED_CLOCK);

    expect(res.intent).toBe('BROWSE_ROOMS_BY_CATEGORY');
    expect(res.chosen_action).toBe('SHOW_ROOMS_BY_CATEGORY');
    // Lists official commercial Concept rooms with canonical room.ten_phong
    expect(res.customer_visible_response).toContain('Lồng Chim');
    expect(res.customer_visible_response).toContain('50 — Sắc Thái');
    // Excludes NOT_FOR_SALE room 401
    expect(res.customer_visible_response).not.toContain('401');
    // Does NOT automatically quote prices when not asked
    expect(res.customer_visible_response).not.toMatch(/\d{3}\.000đ/);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: "Giá 3 loại phòng bao nhiêu?"
  // --------------------------------------------------------------------------
  it('Scenario 5: "Giá 3 loại phòng bao nhiêu?" nêu biểu giá cơ bản V1.4.3, 2h tối thiểu, hỏi thêm thông tin', async () => {
    const sId = 'sc5-category-prices';
    const res = await orchestrator.processTurn(sId, 'Giá 3 loại phòng ở Hà Đông bao nhiêu?', FIXED_CLOCK);

    expect(res.intent).toBe('ASK_CATEGORY_PRICE');
    expect(res.customer_visible_response).toContain('159.000đ');
    expect(res.customer_visible_response).toContain('279.000đ');
    expect(res.customer_visible_response).toContain('399.000đ');
    expect(res.customer_visible_response).toContain('180.000đ');
    expect(res.customer_visible_response).toContain('315.000đ');
    expect(res.customer_visible_response).toContain('449.000đ');
    expect(res.customer_visible_response).toContain('420.000đ');
    expect(res.customer_visible_response).toContain('560.000đ');
    expect(res.customer_visible_response).toContain('700.000đ');
    expect(res.customer_visible_response.toLowerCase()).toContain('tối thiểu 2 giờ');
    expect(res.customer_visible_response.toLowerCase()).toMatch(/nghỉ theo giờ hay qua đêm|khung giờ nào/);
  });

  // --------------------------------------------------------------------------
  // Scenario 5b: Khách hỏi cụ thể "Giá phòng deluxe thế nào?" (Audit V1.4.3 Deluxe)
  // --------------------------------------------------------------------------
  it('Scenario 5b: "Giá phòng deluxe thế nào?" phản hồi chuẩn xác V1.4.3 (279k ngày thường, 315k cuối tuần, 100k phát sinh, 560k qua đêm)', async () => {
    const sId = 'sc5b-deluxe-price-audit';
    const res = await orchestrator.processTurn(sId, 'Giá phòng deluxe thế nào em?', FIXED_CLOCK);

    expect(res.intent).toBe('ASK_CATEGORY_PRICE');
    // Daytime rates
    expect(res.customer_visible_response).toContain('279.000đ'); // Weekday 08-18h
    expect(res.customer_visible_response).toContain('315.000đ'); // Weekend 08-18h
    // Extra hour rate
    expect(res.customer_visible_response).toContain('100.000đ / giờ');
    // Overnight & Day-night
    expect(res.customer_visible_response).toContain('560.000đ');
    expect(res.customer_visible_response).toContain('650.000đ');
    // Minimum 2h rule
    expect(res.customer_visible_response.toLowerCase()).toContain('tối thiểu 2 giờ');
    // Inquiries for missing info
    expect(res.customer_visible_response.toLowerCase()).toMatch(/ngày nào.*khung giờ nào/);

    // Negative assertions: MUST NOT contain hallucinated dummy numbers
    expect(res.customer_visible_response).not.toContain('250.000đ');
    expect(res.customer_visible_response).not.toContain('60.000đ / giờ');
    expect(res.customer_visible_response).not.toContain('400.000đ');
    expect(res.customer_visible_response).not.toContain('550.000đ');
  });

  // --------------------------------------------------------------------------
  // Scenario 5c: Kiểm toán giá Deluxe Hà Đông theo các mốc thời gian và phòng khác nhau
  // --------------------------------------------------------------------------
  it('Scenario 5c: Kiểm toán biên thời gian giá Deluxe Hà Đông (trước 08:00, 08:00, 17:59, 18:00, Thứ 7 vs Thứ 6)', async () => {
    const quoteEngine = new PreBookingQuoteEngine(dataset);
    const deluxeRooms = ['202-grand-canyon', '203-red-rum', '302-barbie-bedroom', '603-lan-kwei-fong'];

    deluxeRooms.forEach((maPhong) => {
      // 1. Thứ Bảy lúc 07:59 (trước 08:00) -> 279.000đ (giá gốc dataset)
      const qEarly = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: maPhong,
        stay_type: 'nghi_gio',
        duration_hours: 2,
        checkin_datetime: '2026-11-28T07:59:00+07:00',
      });
      expect(qEarly.base_2h_price).toBe(279000);
      expect(qEarly.pricing_status).toBe('RESOLVED_BASE_DATASET');

      // 2. Thứ Bảy lúc 08:00 (bắt đầu khung ban ngày cuối tuần) -> 315.000đ
      const qStart = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: maPhong,
        stay_type: 'nghi_gio',
        duration_hours: 2,
        checkin_datetime: '2026-11-28T08:00:00+07:00',
      });
      expect(qStart.base_2h_price).toBe(315000);
      expect(qStart.pricing_status).toBe('RESOLVED_DAYTIME_POLICY');

      // 3. Thứ Bảy lúc 17:59 (phút cuối cùng khung ban ngày cuối tuần) -> 315.000đ
      const qEnd = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: maPhong,
        stay_type: 'nghi_gio',
        duration_hours: 2,
        checkin_datetime: '2026-11-28T17:59:00+07:00',
      });
      expect(qEnd.base_2h_price).toBe(315000);
      expect(qEnd.pricing_status).toBe('RESOLVED_DAYTIME_POLICY');

      // 4. Thứ Bảy lúc 18:00 (hết khung ban ngày, sang khung tối) -> 279.000đ (giá gốc dataset)
      const qEvening = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: maPhong,
        stay_type: 'nghi_gio',
        duration_hours: 2,
        checkin_datetime: '2026-11-28T18:00:00+07:00',
      });
      expect(qEvening.base_2h_price).toBe(279000);
      expect(qEvening.pricing_status).toBe('RESOLVED_BASE_DATASET');

      // 5. Thứ Sáu lúc 14:00 (ban ngày ngày thường) -> 279.000đ
      const qWeekday = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: maPhong,
        stay_type: 'nghi_gio',
        duration_hours: 2,
        checkin_datetime: '2026-11-27T14:00:00+07:00',
      });
      expect(qWeekday.base_2h_price).toBe(279000);
      expect(qWeekday.pricing_status).toBe('RESOLVED_DAYTIME_POLICY');

      // 6. Nghỉ qua đêm -> 560.000đ
      const qOvernight = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: maPhong,
        stay_type: 'qua_dem',
        checkin_datetime: '2026-11-28T22:00:00+07:00',
      });
      expect(qOvernight.total_estimate).toBe(560000);

      // 7. Giờ phát sinh áp dụng -> 100.000đ/h
      expect(qWeekday.extra_hour_rate).toBe(100000);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 6: "Phòng 601 giá bao nhiêu?"
  // --------------------------------------------------------------------------
  it('Scenario 6: "Phòng 601 giá bao nhiêu?" xác định đúng "50 — Sắc Thái", tính biểu giá Suite Hà Đông', async () => {
    const sId = 'sc6-room-601-price';
    const res = await orchestrator.processTurn(sId, 'Phòng 601 Hà Đông giá bao nhiêu?', FIXED_CLOCK);

    expect(res.intent).toBe('ASK_SPECIFIC_ROOM_PRICE');
    expect(res.customer_visible_response).toContain('50 — Sắc Thái');
    // Pricing category for 601 Ha Dong is Suite (2h starting from 399.000đ)
    expect(res.customer_visible_response).toMatch(/399\.000đ/);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: "Cho xem ảnh phòng 601"
  // --------------------------------------------------------------------------
  it('Scenario 7: "Cho xem ảnh phòng 601" trả về URL ảnh thực tế Cloudflare R2 từ dataset trong images payload', async () => {
    const sId = 'sc7-room-601-images';
    const res = await orchestrator.processTurn(sId, 'Cho xem ảnh phòng 601 Hà Đông', FIXED_CLOCK);

    expect(res.intent).toBe('REQUEST_ROOM_IMAGES');
    expect(res.images).toBeDefined();
    expect(res.images!.length).toBeGreaterThan(0);
    expect(res.images![0].url).toMatch(/^https:\/\/pub-.*\.r2\.dev\/.+\.webp$/);
    expect(res.images![0].roomName).toContain('50 — Sắc Thái');
    // Does not have raw text "4 ảnh sắc nét"
    expect(res.customer_visible_response).not.toContain('4 ảnh sắc nét');
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Hỏi đỗ xe sau khi hỏi giá phòng (chuyển chủ đề)
  // --------------------------------------------------------------------------
  it('Scenario 8: Hỏi đỗ xe sau khi hỏi giá chỉ trả lời "Dạ bên em có chỗ đỗ xe ạ.", không đính kèm phòng cũ', async () => {
    const sId = 'sc8-parking-after-price';
    // Turn 1: Ask room search & price
    await orchestrator.processTurn(sId, 'Tìm phòng 2 tiếng có bồn tắm ở Hà Đông', FIXED_CLOCK);

    // Turn 2: Switch topic to parking
    const res2 = await orchestrator.processTurn(sId, 'bên em có chỗ đỗ xe không?', FIXED_CLOCK);

    expect(res2.intent).toBe('ASK_PARKING');
    expect(res2.customer_visible_response.trim()).toBe('Dạ bên em có chỗ đỗ xe ạ.');
    expect(res2.customer_visible_response).not.toContain('bồn tắm');
    expect(res2.customer_visible_response).not.toContain('159.000đ');
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Hỏi đỗ xe sau khi resume AI
  // --------------------------------------------------------------------------
  it('Scenario 9: Hỏi đỗ xe sau khi resume AI trả lời đúng duy nhất câu đỗ xe', async () => {
    const convId = 'sc9-takeover-resume';
    // 1. Customer initiates chat
    await coordinator.handleCustomerTurn(convId, 'jacayl-ha-dong', 'Giá phòng qua đêm ở Hà Đông thế nào?');

    // 2. Staff takes over
    coordinator.takeoverConversation(convId, mockAdminUser);

    // 3. Staff resumes AI
    coordinator.resumeAI(convId, mockAdminUser);

    // 4. Customer asks about parking
    const turnResult = await coordinator.handleCustomerTurn(convId, 'jacayl-ha-dong', 'Bên mình có chỗ để xe không em?');

    expect(turnResult.aiMessage).toBeDefined();
    expect(turnResult.aiMessage!.content.trim()).toBe('Dạ bên em có chỗ đỗ xe ạ.');
    expect(turnResult.aiMessage!.content).not.toContain('750.000đ');
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Hỏi đỗ xe trong phiên mới
  // --------------------------------------------------------------------------
  it('Scenario 10: Hỏi đỗ xe trong phiên mới chỉ trả lời "Dạ bên em có chỗ đỗ xe ạ."', async () => {
    const sId = 'sc10-fresh-parking';
    const res = await orchestrator.processTurn(sId, 'Có chỗ đỗ ô tô không?', FIXED_CLOCK);

    expect(res.intent).toBe('ASK_PARKING');
    expect(res.customer_visible_response.trim()).toBe('Dạ bên em có chỗ đỗ xe ạ.');
    expect(res.verified_candidates.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Đổi giờ nhận phòng từ 14:00 sang 19:00
  // --------------------------------------------------------------------------
  it('Scenario 11: Đổi giờ nhận phòng từ 14:00 sang 19:00 cập nhật đúng biểu giá V1.4.3', async () => {
    const sId = 'sc11-change-hour';
    // Turn 1: 14:00 for 3 hours
    const res1 = await orchestrator.processTurn(sId, 'Thuê 3 tiếng lúc 14:00 ở Hà Đông phòng Concept', FIXED_CLOCK);
    expect(res1.updated_state.checkin_datetime).toContain('14:00');

    // Turn 2: change to 19:00
    const res2 = await orchestrator.processTurn(sId, 'Đổi sang 19h tối nhé', FIXED_CLOCK);
    expect(res2.updated_state.checkin_datetime).toContain('19:00');
    expect(res2.customer_visible_response).toContain('Jacayl Hà Đông');
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Đổi hạng phòng từ Standard sang Concept
  // --------------------------------------------------------------------------
  it('Scenario 12: Đổi hạng phòng từ Standard sang Concept cập nhật memory và danh sách phòng', async () => {
    const sId = 'sc12-switch-category';
    // Turn 1: Standard
    const res1 = await orchestrator.processTurn(sId, 'Xem phòng Standard ở Hà Đông', FIXED_CLOCK);
    expect(res1.customer_visible_response).toContain('Standard');

    // Turn 2: Switch to Concept
    const res2 = await orchestrator.processTurn(sId, 'Cho xem sang hạng Concept', FIXED_CLOCK);
    expect(res2.customer_visible_response).toContain('Concept');
    expect(res2.customer_visible_response).not.toContain('La Casta'); // La Casta is Standard
  });

  // --------------------------------------------------------------------------
  // Scenario 13: Compound query (đỗ xe + giá 2 tiếng)
  // --------------------------------------------------------------------------
  it('Scenario 13: Compound query trả lời phần đỗ xe trước, sau đó đến giá phòng', async () => {
    process.env.CONVERSATION_ENGINE = 'agentic';
    try {
      const sId = 'sc13-compound';
      const res = await orchestrator.processTurn(
        sId,
        'Có chỗ đỗ ô tô không và giá phòng 2 tiếng ở Hà Đông bao nhiêu?',
        FIXED_CLOCK
      );

      expect(res.extracted_entities.is_compound).toBe(true);
      // Parking answer must appear before or alongside pricing
      expect(res.customer_visible_response.toLowerCase()).toContain('có chỗ đỗ xe');
      // Price response follows
      expect(res.customer_visible_response).toContain('159.000đ');
    } finally {
      process.env.CONVERSATION_ENGINE = 'legacy';
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 14: Tiếng Việt không dấu / lỗi chính tả
  // --------------------------------------------------------------------------
  it('Scenario 14: Tiếng Việt không dấu / lỗi chính tả nhận diện đúng intent', async () => {
    const sId1 = 'sc14-no-accent-1';
    const res1 = await orchestrator.processTurn(sId1, 'con phong khong ha dong', FIXED_CLOCK);
    expect(res1.intent).toBe('CHECK_ROOM_AVAILABILITY');

    const sId2 = 'sc14-no-accent-2';
    const res2 = await orchestrator.processTurn(sId2, 'cho xem anh phong 601', FIXED_CLOCK);
    expect(res2.intent).toBe('REQUEST_ROOM_IMAGES');

    const sId3 = 'sc14-no-accent-3';
    const res3 = await orchestrator.processTurn(sId3, 'gia 3 loai phong o ha dong', FIXED_CLOCK);
    expect(res3.intent).toBe('ASK_CATEGORY_PRICE');
  });

  // --------------------------------------------------------------------------
  // Scenario 15: Phòng 401 Hà Đông không kinh doanh (NOT_FOR_SALE)
  // --------------------------------------------------------------------------
  it('Scenario 15: Phòng 401 Hà Đông không kinh doanh (NOT_FOR_SALE), không xuất hiện trong danh sách bán', async () => {
    const sId = 'sc15-room-401';
    const res = await orchestrator.processTurn(sId, 'Phòng 401 Hà Đông giá thế nào?', FIXED_CLOCK);

    expect(res.customer_visible_response.toLowerCase()).toMatch(/không.*kinh doanh|không mở bán|không đón khách|không nằm trong danh mục phòng đón khách/);
    expect(res.customer_visible_response).not.toContain('Link đặt phòng');

    // Also verify browsing Concept does not include 401
    const resBrowse = await orchestrator.processTurn('sc15-browse', 'Xem danh sách phòng Concept Hà Đông', FIXED_CLOCK);
    expect(resBrowse.customer_visible_response).not.toContain('401');
  });

  // --------------------------------------------------------------------------
  // Scenario 16: Safe Markdown & XSS Injection Protection
  // --------------------------------------------------------------------------
  it('Scenario 16: Safe Markdown rendering chuyển đổi **bold**, *italic*, bullet, link an toàn, triệt tiêu XSS', () => {
    // 1. Script injection attempt
    const xssScript = '<script>alert("xss")</script>**Bold text**';
    const resScript = renderSafeMarkdown(xssScript);
    expect(resScript).not.toContain('<script>');
    expect(resScript).toContain('&lt;script&gt;');
    expect(resScript).toContain('<strong>Bold text</strong>');

    // 2. Image onerror injection attempt
    const xssImg = '<img src=x onerror="alert(1)">*Italic note*';
    const resImg = renderSafeMarkdown(xssImg);
    expect(resImg).not.toContain('<img');
    expect(resImg).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(resImg).toContain('<em>Italic note</em>');

    // 3. Malicious javascript: link attempt (must not create active link)
    const xssLink = '[Click here](javascript:alert("pwned"))';
    const resLink = renderSafeMarkdown(xssLink);
    expect(resLink).not.toContain('<a href=');
    expect(resLink).toContain('[Click here](javascript:alert');

    // 4. Safe https:// link
    const safeLink = '[J Collection Booking](https://bookphong.com/phong/601-50-sac-thai)';
    const resSafe = renderSafeMarkdown(safeLink);
    expect(resSafe).toContain('<a href="https://bookphong.com/phong/601-50-sac-thai" target="_blank" rel="noopener noreferrer"');

    // 5. Bullet list & Linebreaks
    const listText = 'Các hạng phòng:\n- Standard\n- Deluxe\n- Concept';
    const resList = renderSafeMarkdown(listText);
    expect(resList).toContain('• Standard');
    expect(resList).toContain('• Deluxe');
    expect(resList).toContain('• Concept');
    expect(resList).toContain('<br>');
  });

  // --------------------------------------------------------------------------
  // Scenario 16b: Chuỗi hội thoại 9 lượt hoàn chỉnh của khách hàng tại Jacayl Hà Đông
  // --------------------------------------------------------------------------
  it('Scenario 16b: Chuỗi hội thoại 9 lượt của khách hàng tại Jacayl Hà Đông tuân thủ 100% Invariants', async () => {
    const convId = 'conv-9-turns-acceptance';
    const propertyId = 'jacayl-ha-dong';

    // Turn 1: "Còn phòng không em?"
    const t1 = await coordinator.handleCustomerTurn(convId, propertyId, 'Còn phòng không em?', { referenceClock: FIXED_CLOCK });
    expect(t1.aiMessage).toBeDefined();
    const c1 = t1.aiMessage!.content;
    // Không tự báo giá ở câu hỏi phòng trống
    expect(c1).not.toMatch(/\d{3}\.000đ/);
    // Giới thiệu 3 hạng phòng
    expect(c1).toContain('Standard');
    expect(c1).toContain('Deluxe');
    expect(c1).toContain('Concept');
    // Minh bạch chưa kết nối PMS, không xác nhận giữ phòng
    expect(c1.toLowerCase()).toMatch(/chưa đồng bộ dữ liệu phòng trống|thời gian thực|live pms/);
    expect(c1).toContain('hotline');

    // Turn 2: "Có những loại phòng nào?"
    const t2 = await coordinator.handleCustomerTurn(convId, propertyId, 'Có những loại phòng nào?', { referenceClock: FIXED_CLOCK });
    expect(t2.aiMessage).toBeDefined();
    const c2 = t2.aiMessage!.content;
    expect(c2).toContain('Standard');
    expect(c2).toContain('Deluxe');
    expect(c2).toContain('Concept');
    expect(c2).not.toMatch(/\d{3}\.000đ/); // Không tự tính giá

    // Turn 3: "Giá ba loại bao nhiêu?"
    const t3 = await coordinator.handleCustomerTurn(convId, propertyId, 'Giá ba loại bao nhiêu?', { referenceClock: FIXED_CLOCK });
    expect(t3.aiMessage).toBeDefined();
    const c3 = t3.aiMessage!.content;
    expect(c3).toContain('159.000đ'); // Standard
    expect(c3).toContain('279.000đ'); // Deluxe
    expect(c3).toContain('399.000đ'); // Concept (Suite rate)
    expect(c3).toContain('560.000đ'); // Deluxe qua đêm
    expect(c3.toLowerCase()).toContain('tối thiểu 2 giờ');

    // Turn 4: "Anh muốn xem phòng Concept"
    const t4 = await coordinator.handleCustomerTurn(convId, propertyId, 'Anh muốn xem phòng Concept', { referenceClock: FIXED_CLOCK });
    expect(t4.aiMessage).toBeDefined();
    const c4 = t4.aiMessage!.content;
    expect(c4).toContain('50 — Sắc Thái'); // Canonical ten_phong
    expect(c4).toContain('101 — Lồng Chim');
    expect(c4).toContain('602 — Playboy');
    expect(c4).not.toContain('401'); // NOT_FOR_SALE room 401 excluded

    // Turn 5: "Cho xem ảnh phòng 601"
    const t5 = await coordinator.handleCustomerTurn(convId, propertyId, 'Cho xem ảnh phòng 601', { referenceClock: FIXED_CLOCK });
    expect(t5.aiMessage).toBeDefined();
    const c5 = t5.aiMessage!.content;
    expect(c5).toContain('50 — Sắc Thái');
    // Real photos delivered in metadata
    expect(t5.aiMessage!.metadata?.images).toBeDefined();
    expect(t5.aiMessage!.metadata!.images!.length).toBe(4);
    expect(t5.aiMessage!.metadata!.images![0].url).toContain('r2.dev');
    expect(c5).not.toContain('4 ảnh sắc nét'); // No fake string promise

    // Turn 6: "Bên em có chỗ đỗ xe không?"
    const t6 = await coordinator.handleCustomerTurn(convId, propertyId, 'Bên em có chỗ đỗ xe không?', { referenceClock: FIXED_CLOCK });
    expect(t6.aiMessage).toBeDefined();
    const c6 = t6.aiMessage!.content;
    expect(c6.trim()).toBe('Dạ bên em có chỗ đỗ xe ạ.');
    // Không lặp danh sách phòng khi hỏi đỗ xe
    expect(c6).not.toContain('50 — Sắc Thái');
    expect(c6).not.toContain('399.000đ');

    // Turn 7: "Anh muốn nghỉ thứ Bảy từ 17h trong 4 tiếng"
    const t7 = await coordinator.handleCustomerTurn(convId, propertyId, 'Anh muốn nghỉ thứ Bảy từ 17h trong 4 tiếng', { referenceClock: FIXED_CLOCK });
    expect(t7.aiMessage).toBeDefined();
    const c7 = t7.aiMessage!.content;
    // Concept room quote for Saturday 17h 4 tiếng: Suite rate 449k + 2h extra (2x200k = 400k) = 849k (or 101 with 2x100k = 649k)
    expect(c7).toMatch(/849\.000đ|649\.000đ/);

    // Turn 8: "À đổi sang phòng Deluxe nhé"
    const t8 = await coordinator.handleCustomerTurn(convId, propertyId, 'À đổi sang phòng Deluxe nhé', { referenceClock: FIXED_CLOCK });
    expect(t8.aiMessage).toBeDefined();
    const c8 = t8.aiMessage!.content;
    // Deluxe quote Saturday 17:00 4 tiếng: 315k base + 2x100k extra = 515.000đ!
    expect(c8).toContain('515.000đ');
    expect(c8).toMatch(/Grand Canyon|Red Rum|Rico Dinner|Barbie Bedroom|Rose Wine|French Kiss/);

    // Turn 9: "Cho anh gặp nhân viên"
    const t9 = await coordinator.handleCustomerTurn(convId, propertyId, 'Cho anh gặp nhân viên', { referenceClock: FIXED_CLOCK });
    expect(t9.aiMessage).toBeDefined();
    const c9 = t9.aiMessage!.content;
    expect(c9.toLowerCase()).toMatch(/kết nối.*nhân viên|lễ tân|hỗ trợ trực tiếp/);
    // Conversation flagged for takeover
    const conv = store.getConversationById(convId);
    expect(conv?.state).toBe('WAITING_FOR_STAFF');
  });

  // --------------------------------------------------------------------------
  // Scenario 17: Human Takeover chặn AI trả lời
  // --------------------------------------------------------------------------
  it('Scenario 17: Human Takeover chặn AI trả lời, không lưu tin AI', async () => {
    const convId = 'sc17-takeover-block';
    // 1. Initial turn
    await coordinator.handleCustomerTurn(convId, 'jacayl-ha-dong', 'Chào em');

    // 2. Staff takes over
    coordinator.takeoverConversation(convId, mockAdminUser);

    // 3. Customer speaks while HUMAN_ACTIVE
    const turnRes = await coordinator.handleCustomerTurn(
      convId,
      'jacayl-ha-dong',
      'Tôi muốn hỏi thêm về giờ check-in'
    );

    expect(turnRes.state).toBe('HUMAN_ACTIVE');
    expect(turnRes.aiMessage).toBeUndefined();
    expect(turnRes.discarded).toBe(false);

    // Verify messages in DB: no AI message created for that turn
    const messages = store.getMessagesByConversationId(convId);
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.senderType).toBe('customer');
  });

  // --------------------------------------------------------------------------
  // Scenario 18: FREE_ONLY_MODE = true
  // --------------------------------------------------------------------------
  it('Scenario 18: FREE_ONLY_MODE luôn được duy trì true', () => {
    const freeOnlyMode = process.env.FREE_ONLY_MODE ?? 'true';
    expect(freeOnlyMode).toBe('true');
  });

  // --------------------------------------------------------------------------
  // Scenario 19: Không tạo booking giả trong PMS
  // --------------------------------------------------------------------------
  it('Scenario 19: Không tạo booking giả trong PMS, chỉ cung cấp hướng dẫn đặt phòng minh bạch', async () => {
    const sId = 'sc19-no-fake-booking';
    const res = await orchestrator.processTurn(
      sId,
      'Tôi chốt đặt phòng 101 Hà Đông tối nay nhé, anh cọc luôn.',
      FIXED_CLOCK
    );

    expect(res.intent).toBe('BOOKING_INTENT');
    expect(res.customer_visible_response.toLowerCase()).toMatch(/hướng dẫn hoàn tất giữ phòng|bookphong\.com|hotline/);
    expect(res.customer_visible_response).not.toContain('Mã đặt phòng của bạn là');
    expect(res.customer_visible_response).not.toContain('Đã đặt phòng thành công');
  });

  // --------------------------------------------------------------------------
  // Scenario 20: Dataset SHA-256 bất biến
  // --------------------------------------------------------------------------
  it('Scenario 20: Canonical dataset data/j_collection_dataset.json SHA-256 nguyên vẹn 100%', () => {
    const content = readFileSync('data/j_collection_dataset.json');
    const hash = createHash('sha256').update(content).digest('hex');
    expect(hash).toBe(CANONICAL_DATASET_SHA256);
  });
});
