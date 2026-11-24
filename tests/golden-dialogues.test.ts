import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('Golden Multi-Turn Dialogue Scenarios (A - J)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const orchestrator = new ConversationOrchestrator(dataset);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday

  it('Scenario A: Standard Hourly Consultation with Amenity Requirements (M3 A2 Evidenced Fix)', async () => {
    const sId = 'scenario-a';
    const text = 'anh cần tìm phòng ở cơ sở Trần Khát Chân vào chiều thứ Bảy tuần này khoảng 2h chiều, ở tầm 3 tiếng, có bồn tắm đôi và máy chiếu.';
    const result = await orchestrator.processTurn(sId, text, FIXED_CLOCK);

    expect(result.intent).toBe('SEARCH_ROOM');
    expect(result.chosen_action).toBe('RECOMMEND_ROOMS');
    expect(result.updated_state.active_facility).toBe('jacayl-tran-khat-chan');
    expect(result.updated_state.duration_hours).toBe(3);
    expect(result.updated_state.checkin_datetime).toContain('2026-11-28T14:00');
    expect(result.updated_state.must_have_amenities).toContain('bồn tắm');

    expect(result.customer_visible_response).toContain('Jacayl Trần Khát Chân');
    expect(result.customer_visible_response.toLowerCase()).toContain('ạ');
    expect(result.verified_candidates.length).toBeGreaterThan(0);
    expect(result.tool_results.quote_results?.length).toBeGreaterThan(0);

    // M3 A2 Evidence Grounding: Bathtub in 1001 Dem is confirmed, but double bathtub and projector are unconfirmed
    expect(result.customer_visible_response).toContain('Lưu ý về tiện nghi');
    expect(result.customer_visible_response).toContain('máy chiếu');
  });

  it('Scenario B: Budget-Constrained Search with Partial Matches (M3 A3 Insufficient Budget Fix)', async () => {
    const sId = 'scenario-b';
    const text = 'ngân sách dưới 400k, muốn ở qua đêm thứ Sáu tại Hà Đông.';
    const result = await orchestrator.processTurn(sId, text, FIXED_CLOCK);

    expect(result.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(result.updated_state.stay_type).toBe('qua_dem');
    // Invariant M3 A3: max_budget in WorkingMemory is preserved strictly as 400000, not modified
    expect(result.updated_state.max_budget).toBe(400000);
    expect(result.verified_candidates.length).toBeGreaterThan(0);
    expect(result.customer_visible_response).toContain('Jacayl Hà Đông');

    // M3 A3: No overnight room at Ha Dong is <= 400k (Standard is 420k). Assistant explains budget exceed
    expect(result.customer_visible_response).toContain('không có phòng nghỉ qua đêm với mức giá dưới');
    expect(result.customer_visible_response).toContain('420.000đ');
  });

  it('Scenario C: Multi-turn Constraint Retraction & Context Retention', async () => {
    const sId = 'scenario-c';

    // Turn 1
    const res1 = await orchestrator.processTurn(sId, 'Tìm phòng có bồn tắm và ghế tình yêu ở J Village.', FIXED_CLOCK);
    expect(res1.updated_state.active_facility).toBe('j-village');
    expect(res1.updated_state.must_have_amenities).toContain('bồn tắm');
    expect(res1.updated_state.must_have_amenities).toContain('ghế tình yêu');

    // Turn 2: Retract tantra, add balcony
    const res2 = await orchestrator.processTurn(
      sId,
      'À thôi không cần ghế tình yêu nữa, nhưng cần phòng có ban công.',
      FIXED_CLOCK
    );

    expect(res2.updated_state.active_facility).toBe('j-village');
    expect(res2.updated_state.must_have_amenities).toContain('bồn tắm');
    expect(res2.updated_state.must_have_amenities).toContain('ban công');
    expect(res2.updated_state.must_have_amenities).not.toContain('ghế tình yêu');
    // M3 A1 Semantic Fix: REMOVE_REQUIREMENT drops requirement, does NOT actively negate it
    expect(res2.updated_state.negated_constraints).not.toContain('ghế tình yêu');
  });

  it('Scenario D: Reference by Index / Pronominal Disambiguation', async () => {
    const sId = 'scenario-d';

    // Turn 1: Search at TKC
    const res1 = await orchestrator.processTurn(
      sId,
      'Tìm phòng ở Trần Khát Chân vào chiều thứ Bảy lúc 14h, ở 3 tiếng.',
      FIXED_CLOCK
    );
    expect(res1.verified_candidates.length).toBeGreaterThanOrEqual(2);
    const candidate2Name = res1.verified_candidates[1].name;

    // Turn 2: Ask for details of the second room
    const res2 = await orchestrator.processTurn(sId, 'cho anh xem chi tiết căn thứ hai', FIXED_CLOCK);

    expect(res2.updated_state.focused_room).toBeDefined();
    expect(res2.internal_trace.rules_triggered).toContain('RESOLVED_REF_ORDINAL');
    expect(res2.customer_visible_response).toContain(candidate2Name);
  });

  it('Scenario E: Facility Switch with Slot Preservation', async () => {
    const sId = 'scenario-e';

    // Turn 1: Configure slots at Trần Khát Chân
    const res1 = await orchestrator.processTurn(
      sId,
      'anh cần phòng ở cơ sở Trần Khát Chân chiều thứ Bảy lúc 14h, ở 3 tiếng, có bồn tắm.',
      FIXED_CLOCK
    );
    expect(res1.updated_state.active_facility).toBe('jacayl-tran-khat-chan');
    expect(res1.updated_state.duration_hours).toBe(3);
    expect(res1.updated_state.must_have_amenities).toContain('bồn tắm');

    // Turn 2: Switch to J Village
    const res2 = await orchestrator.processTurn(sId, 'Thôi chuyển sang xem cơ sở J Village đi em.', FIXED_CLOCK);

    expect(res2.updated_state.active_facility).toBe('j-village');
    expect(res2.updated_state.duration_hours).toBe(3);
    expect(res2.updated_state.must_have_amenities).toContain('bồn tắm');
    expect(res2.customer_visible_response).toContain('J Village');
  });

  it('Scenario F: Direct Booking Attempt Handling (M3 A4 Sourced Booking Link Fix)', async () => {
    const sId = 'scenario-f';

    // User attempts to directly finalize booking with PII
    const text = 'Tôi chốt phòng 201 này nhé, đặt cho tôi từ 14h đến 17h, tên tôi là Nguyễn Văn A, sđt 0901234567';
    const result = await orchestrator.processTurn(sId, text, FIXED_CLOCK);

    expect(result.intent).toBe('BOOKING_INTENT');
    expect(result.chosen_action).toBe('PROVIDE_BOOKING_GUIDANCE');
    // M3 A4: Must use verified link from dataset (bookphong.com), NEVER unsourced domains
    expect(result.customer_visible_response).toContain('bookphong.com');
    expect(result.customer_visible_response.toLowerCase()).toContain('hotline');
    // Invariant: Never claim booking confirmed or output fake booking code
    expect(result.customer_visible_response).not.toContain('đặt phòng thành công');
    expect(result.customer_visible_response).not.toContain('mã đặt phòng của bạn là');
  });

  it('Scenario G: In-Stay Service Requests Handling', async () => {
    const sId = 'scenario-g';
    const text = 'Cho anh xin thêm 2 chai nước suối và 1 khăn tắm lên phòng 302 với.';
    const result = await orchestrator.processTurn(sId, text, FIXED_CLOCK);

    expect(result.intent).toBe('IN_STAY_OPERATIONAL_REQUEST');
    expect(result.chosen_action).toBe('ROUTE_IN_STAY_REQUEST');
    expect(result.customer_visible_response).toContain('lễ tân');
    expect(result.customer_visible_response).toContain('hotline');
  });

  it('Scenario H: Checkout Dispute & Operations Handling', async () => {
    const sId = 'scenario-h';
    const text = 'Lễ tân tính tiền anh lố 15 phút mà bắt trả thêm 1 tiếng, sao vô lý thế em?';
    const result = await orchestrator.processTurn(sId, text, FIXED_CLOCK);

    expect(result.chosen_action).toBe('DECLINE_UNVERIFIED_CLAIM');
    expect(result.customer_visible_response).toContain('lễ tân');
    expect(result.customer_visible_response).toContain('quản lý');
  });

  it('Scenario I: AI Identity Inquiry', async () => {
    const sId = 'scenario-i';
    const text = 'Em là người thật hay robot đấy?';
    const result = await orchestrator.processTurn(sId, text, FIXED_CLOCK);

    expect(result.intent).toBe('AI_IDENTITY_INQUIRY');
    expect(result.chosen_action).toBe('ANSWER_AI_IDENTITY');
    expect(result.customer_visible_response).toContain('trợ lý ảo AI Concierge');
  });

  it('Scenario J: Concurrent Sessions Isolation', async () => {
    const session1 = 'concurrent-user-1';
    const session2 = 'concurrent-user-2';

    // User 1 searches at J Village
    await orchestrator.processTurn(session1, 'Tìm phòng có bồn tắm ở J Village', FIXED_CLOCK);

    // User 2 searches at Hà Đông with budget 300k
    await orchestrator.processTurn(session2, 'Tìm phòng dưới 300k tại Hà Đông', FIXED_CLOCK);

    const mem1 = orchestrator.getMemoryManager().getSession(session1);
    const mem2 = orchestrator.getMemoryManager().getSession(session2);

    expect(mem1.active_facility).toBe('j-village');
    expect(mem1.must_have_amenities).toContain('bồn tắm');
    expect(mem1.max_budget).toBeNull();

    expect(mem2.active_facility).toBe('jacayl-ha-dong');
    expect(mem2.max_budget).toBe(300000);
    expect(mem2.must_have_amenities).not.toContain('bồn tắm');
  });
});
