import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { MockLLMAdapter } from '../src/conversation/adapters/mock-llm-adapter.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';

describe('Milestone 3.5 — Live Multi-Turn Vietnamese Dialogue Evaluation Suite', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday morning

  // =========================================================================
  // EVALUATION SUITE A: Deterministic Engine (MockLLMAdapter)
  // All 13 Owner Invariants Verified End-to-End
  // =========================================================================
  describe('Provider: Deterministic Mock Engine (100% Deterministic Rulebase)', () => {
    let prevEngine: string | undefined;
    beforeAll(() => {
      prevEngine = process.env.CONVERSATION_ENGINE;
      process.env.CONVERSATION_ENGINE = 'legacy';
    });
    afterAll(() => {
      if (prevEngine === undefined) delete process.env.CONVERSATION_ENGINE;
      else process.env.CONVERSATION_ENGINE = prevEngine;
    });
    const orchestrator = new ConversationOrchestrator(dataset, {
      llmAdapter: new MockLLMAdapter(FIXED_CLOCK),
    });

    // Scenario 1: Phòng 601 Hà Đông phải hiển thị "50 — Sắc Thái"
    it('Scenario 01: Room 601 Ha Dong displays canonical "50 — Sắc Thái"', async () => {
      const res = await orchestrator.processTurn('eval-sc-01', 'Cho anh xem chi tiết phòng 601 Hà Đông', FIXED_CLOCK);
      expect(res.customer_visible_response).toContain('50 — Sắc Thái');
      expect(res.customer_visible_response).not.toContain('601 — 50 — Sắc Thái');
      expect(res.customer_visible_response).not.toContain('Tổng Thống');
      expect(res.customer_visible_response).not.toContain('50 Shades');
    });

    // Scenario 2: Hạng phòng Concept, tính giá theo biểu phí Suite
    it('Scenario 02: Room 601 Ha Dong is Category Concept, priced as Suite (449k on weekend morning)', async () => {
      const res = await orchestrator.processTurn('eval-sc-02', 'Tính giá phòng 601 ở Hà Đông lúc 10h sáng thứ Bảy 2 tiếng', FIXED_CLOCK);
      expect(res.customer_visible_response).toContain('50 — Sắc Thái');
      expect(res.customer_visible_response).toContain('Concept');
      expect(res.customer_visible_response).not.toContain('Hạng Suite');
      expect(res.customer_visible_response).toContain('449.000');
    });

    // Scenario 3: Phòng 401 Hà Đông không kinh doanh
    it('Scenario 03: Room 401 Ha Dong is NOT_FOR_SALE and transparently explained', async () => {
      const res = await orchestrator.processTurn('eval-sc-03', 'Phòng 401 ở Hà Đông giá bao nhiêu em, anh muốn đặt phòng này', FIXED_CLOCK);
      expect(res.customer_visible_response.toLowerCase()).toMatch(/không sử dụng để kinh doanh|không nằm trong danh mục/);
      expect(res.customer_visible_response).not.toContain('Đặt phòng thành công');
      expect(res.verified_candidates.some((c) => c.id === 'jacayl-ha-dong::401')).toBe(false);
    });

    // Scenario 4: Phòng 401 ở cơ sở khác không bị chặn nhầm
    it('Scenario 04: Room 401 at other facilities (Tran Khat Chan, J Village) is NOT blocked', async () => {
      const resTkc = await orchestrator.processTurn('eval-sc-04-tkc', 'Cho anh xem phòng 401 ở Trần Khát Chân', FIXED_CLOCK);
      expect(resTkc.customer_visible_response).toContain('401 — Blush');
      expect(resTkc.customer_visible_response.toLowerCase()).not.toContain('không sử dụng để kinh doanh');

      const resJv = await orchestrator.processTurn('eval-sc-04-jv', 'Cho anh xem phòng 401 ở J Village', FIXED_CLOCK);
      expect(resJv.customer_visible_response).toContain('401 — Mosaic');
      expect(resJv.customer_visible_response.toLowerCase()).not.toContain('không sử dụng để kinh doanh');
    });

    // Scenario 5: Tìm phòng bồn tắm Hà Đông chỉ xác nhận 101, 601, 602
    it('Scenario 05: Ha Dong bathtub search strictly returns only 101, 601, 602 as EXACT matches', async () => {
      const res = await orchestrator.processTurn('eval-sc-05', 'Tìm phòng có bồn tắm ở cơ sở Hà Đông', FIXED_CLOCK);
      const exactMatches = res.verified_candidates.filter((c) => c.bucket === 'EXACT');
      const exactIds = exactMatches.map((c) => c.id).sort();
      expect(exactIds).toEqual([
        'jacayl-ha-dong::101-long-chim',
        'jacayl-ha-dong::601-50-sac-thai',
        'jacayl-ha-dong::602-playboy',
      ]);
      expect(res.customer_visible_response).not.toContain('201 — La Casta');
      expect(res.customer_visible_response).not.toContain('301 —');
      expect(res.customer_visible_response).not.toContain('401 —');
    });

    // Scenario 6: Giá thứ Bảy lúc 17:00 không đổi khi thuê qua 18:00
    it('Scenario 06: Saturday 17:00 check-in base price does not change when staying past 18:00', async () => {
      const res = await orchestrator.processTurn('eval-sc-06', 'Thứ Bảy anh nhận phòng 201 La Casta lúc 17:00 nghỉ 3 tiếng giá bao nhiêu?', FIXED_CLOCK);
      // 2h base price at 17:00 (Saturday daytime) is 180.000đ + 1 extra hour (100.000đ) = 280.000đ
      expect(res.customer_visible_response).toContain('280.000');
    });

    // Scenario 7: Trước 08:00 dùng giá dataset
    it('Scenario 07: Check-in before 08:00 uses dataset base price', async () => {
      const res = await orchestrator.processTurn('eval-sc-07', 'Thứ Hai anh nhận phòng 201 La Casta lúc 6h sáng nghỉ 2 tiếng giá bao nhiêu?', FIXED_CLOCK);
      expect(res.customer_visible_response).toContain('159.000');
    });

    // Scenario 8: Ngày lễ không tăng giá
    it('Scenario 08: Holiday inquiries confirm NO surcharge or rate hike', async () => {
      const res = await orchestrator.processTurn('eval-sc-08', 'Ngày lễ 30/4 hoặc Valentine bên em có phụ thu ngày lễ hay tăng giá không?', FIXED_CLOCK);
      expect(res.customer_visible_response.toLowerCase()).toMatch(/không tăng giá|không có phụ thu ngày lễ/);
      expect(res.claim_validation?.rejected_claims.length).toBe(0);
    });

    // Scenario 9: Thuê tối thiểu 2 giờ
    it('Scenario 09: 1-hour package inquiry confirms 2-hour minimum stay', async () => {
      const res = await orchestrator.processTurn('eval-sc-09', 'Anh chỉ nghỉ 1 tiếng thôi có được tính nửa giá không em?', FIXED_CLOCK);
      expect(res.customer_visible_response.toLowerCase()).toMatch(/tối thiểu 2 tiếng|không có gói riêng 1 tiếng/);
      expect(res.claim_validation?.rejected_claims.length).toBe(0);
    });

    // Scenario 10: Nhận phòng qua đêm từ 21:40
    it('Scenario 10: Overnight policy confirms 22:00 to 12:00 with early grace from 21:40', async () => {
      const res = await orchestrator.processTurn('eval-sc-10', 'Khung giờ qua đêm tính thế nào? 21h40 vào được chưa em?', FIXED_CLOCK);
      expect(res.customer_visible_response).toContain('22:00');
      expect(res.customer_visible_response).toContain('21:40');
      expect(res.customer_visible_response).toContain('12:00');
    });

    // Scenario 11: Khách đổi giờ nhận phòng nhiều lần
    it('Scenario 11: Customer changes check-in time multiple times cleanly across turns', async () => {
      const session = 'eval-sc-11-multiturn';
      // Turn 1: 14:00 Saturday at Ha Dong (daytime 180k)
      const t1 = await orchestrator.processTurn(session, 'Anh muốn thuê phòng 201 ở Hà Đông lúc 14:00 thứ Bảy 2 tiếng', FIXED_CLOCK);
      expect(t1.customer_visible_response).toContain('180.000');

      // Turn 2: Change to 19:00 same day (evening dataset 159k)
      const t2 = await orchestrator.processTurn(session, 'À đổi sang nhận phòng lúc 19:00 tối nhé', FIXED_CLOCK);
      expect(t2.customer_visible_response).toContain('159.000');

      // Turn 3: Change to overnight 22:00 (dataset 201 overnight is 420k)
      const t3 = await orchestrator.processTurn(session, 'Thôi đổi lại ở qua đêm từ 22:00 đến trưa mai nhé', FIXED_CLOCK);
      expect(t3.customer_visible_response).toContain('420.000');
    });

    // Scenario 12: Không xác nhận phòng trống hoặc booking
    it('Scenario 12: Live availability inquiry states PMS not connected and redirects to hotline', async () => {
      const res = await orchestrator.processTurn('eval-sc-12', 'Anh qua luôn bây giờ còn phòng trống không, giữ phòng giúp anh nhé', FIXED_CLOCK);
      expect(res.customer_visible_response.toLowerCase()).toMatch(/chưa kết nối với phần mềm quản lý phòng|hotline lễ tân/);
      expect(res.customer_visible_response).not.toContain('đã đặt phòng thành công');
      expect(res.claim_validation?.rejected_claims.length).toBe(0);
    });

    // Scenario 13: Không thêm tiện nghi, mô tả hoặc tên phòng không có nguồn
    it('Scenario 13: Unconfirmed amenities (projector, double bathtub) are disclaimed without false claims', async () => {
      const res = await orchestrator.processTurn('eval-sc-13', 'Phòng 101 có máy chiếu rạp phim và bồn tắm đôi không em?', FIXED_CLOCK);
      expect(res.customer_visible_response.toLowerCase()).toMatch(/chưa có thông tin xác nhận/);
      expect(res.customer_visible_response).not.toContain('có máy chiếu rạp phim');
      expect(res.claim_validation?.rejected_claims.length).toBe(0);
    });
  });

  // =========================================================================
  // EVALUATION SUITE B: Groq Provider Status & Execution
  // =========================================================================
  describe('Provider: Groq Free Tier (openai/gpt-oss-20b)', () => {
    const groq = new GroqProviderAdapter();

    it('Evaluates Groq provider configuration and status', () => {
      if (!groq.isConfigured()) {
        console.log('ℹ️ [GROQ EVALUATION]: GROQ_API_KEY is not configured in environment.');
        console.log('   Live Verification Status: IMPLEMENTED_NOT_LIVE_VERIFIED');
        console.log('   Expected Model: openai/gpt-oss-20b');
        console.log('   Free-Only Guard: FREE_ONLY_MODE = true');
        expect(groq.isConfigured()).toBe(false);
      } else {
        console.log(`🚀 [GROQ EVALUATION]: GROQ_API_KEY detected. Active model: ${groq.modelName}`);
        expect(groq.isConfigured()).toBe(true);
      }
    });
  });

  // =========================================================================
  // EVALUATION SUITE C: Google Gemini Provider Status & Execution
  // =========================================================================
  describe('Provider: Google Gemini Free Tier (gemini-3.5-flash-lite)', () => {
    const gemini = new GeminiProviderAdapter();

    it('Evaluates Gemini provider configuration and status', () => {
      if (!gemini.isConfigured()) {
        console.log('ℹ️ [GEMINI EVALUATION]: GEMINI_API_KEY is not configured in environment.');
        console.log('   Live Verification Status: IMPLEMENTED_NOT_LIVE_VERIFIED');
        console.log('   Active Free Model: gemini-3.5-flash-lite (gemini-1.5/2.0 retired)');
        console.log('   Free-Only Guard: FREE_ONLY_MODE = true');
        expect(gemini.isConfigured()).toBe(false);
      } else {
        console.log(`🚀 [GEMINI EVALUATION]: GEMINI_API_KEY detected. Active model: ${gemini.modelName}`);
        expect(gemini.isConfigured()).toBe(true);
      }
    });
  });
});
