import { describe, it, expect, beforeEach } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { AIConversationPlanner } from '../src/conversation/planning/conversation-planner.js';

describe('Fast-Path vs Semantic Context Routing & Compound Queries (8 Critical Gate Cases)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  let orchestrator: ConversationOrchestrator;
  let planner: AIConversationPlanner;

  beforeEach(() => {
    orchestrator = new ConversationOrchestrator(dataset);
    planner = orchestrator.getConversationPlanner();
  });

  // Ca 1: "Cảm ơn em nhưng báo giá Deluxe cho anh nhé"
  it('Ca 1: "Cảm ơn em nhưng báo giá Deluxe cho anh nhé" -> Routes to CALCULATE_PRICE, NOT swallowed by isPoliteClosing', async () => {
    const sessionId = 'test-c1';
    const turn = await orchestrator.processTurn(sessionId, 'Cảm ơn em nhưng báo giá Deluxe cho anh nhé', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('CALCULATE_PRICE');
    expect(turn.plan?.planner_mode).toBe('semantic_context');
    expect(turn.plan?.primaryGoal).not.toBe('POLITE_CLOSING');
    expect(turn.chosen_action).toBe('QUOTE_CATEGORY_PRICE');

    // 2. Internal Trace verification
    expect(turn.internal_trace.tools_executed).toContain('QUOTE_CATEGORY');
    expect(turn.internal_trace.canonical_data_fetched).toContain('business_policy_v1_4_3.json');

    // 3. Response semantic validation: contains Deluxe rates (279.000đ / 315.000đ), not a simple "Dạ em cảm ơn"
    expect(turn.customer_visible_response).toMatch(/279\.000/);
    expect(turn.customer_visible_response).toMatch(/Deluxe/i);
    expect(turn.customer_visible_response).not.toBe('Dạ rất hân hạnh được hỗ trợ anh/chị!');
  });

  // Ca 2: "Có chỗ đỗ xe và phòng Concept giá bao nhiêu?"
  it('Ca 2: "Có chỗ đỗ xe và phòng Concept giá bao nhiêu?" -> Answers BOTH parking and Concept price in one turn', async () => {
    const sessionId = 'test-c2';
    const turn = await orchestrator.processTurn(sessionId, 'Có chỗ đỗ xe và phòng Concept giá bao nhiêu?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('CALCULATE_PRICE');
    expect(turn.plan?.requestedFacts).toContain('parking');
    expect(turn.plan?.requestedFacts).toContain('category_price');

    // 2. Action verification
    expect(turn.chosen_action).toBe('ANSWER_PARKING_POLICY');

    // 3. Content semantic verification
    expect(turn.customer_visible_response).toMatch(/chỗ đỗ xe/i);
    expect(turn.customer_visible_response).toMatch(/Concept/i);
    expect(turn.customer_visible_response).toMatch(/399\.000/); // Concept weekday daytime rate
  });

  // Ca 3: "Chào em, phòng 601 còn không?"
  it('Ca 3: "Chào em, phòng 601 còn không?" -> Identifies room availability check for 601, NOT pure greeting', async () => {
    const sessionId = 'test-c3';
    const turn = await orchestrator.processTurn(sessionId, 'Chào em, phòng 601 còn không?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('CHECK_AVAILABILITY');
    expect(turn.plan?.primaryGoal).not.toBe('POLITE_GREETING');
    expect(turn.chosen_action).toBe('ANSWER_AVAILABILITY_TRANSPARENT');

    // 2. Internal trace verification
    expect(turn.internal_trace.planner_mode).toBe('semantic_context');

    // 3. Content semantic verification: transparent live PMS disclaimer + hotline, not a general welcome greeting
    expect(turn.customer_visible_response).toMatch(/PMS|thời gian thực/i);
    expect(turn.customer_visible_response).toMatch(/hotline/i);
    expect(turn.customer_visible_response).not.toMatch(/^Dạ em chào anh\/chị ạ! Chào mừng/);
  });

  // Ca 4: "Anh không cần ảnh, anh cần giá."
  it('Ca 4: "Anh không cần ảnh, anh cần giá." -> Gives price, does NOT trigger isImageRequest', async () => {
    const sessionId = 'test-c4';
    // Prime session with Deluxe focus
    await orchestrator.processTurn(sessionId, 'Tư vấn phòng Deluxe cho anh ở Hà Đông', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    const turn = await orchestrator.processTurn(sessionId, 'Anh không cần ảnh, anh cần giá.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('CALCULATE_PRICE');
    expect(turn.plan?.primaryGoal).not.toBe('SHOW_MEDIA');
    expect(turn.chosen_action).not.toBe('SHOW_ROOM_IMAGES');

    // 2. Images must NOT be delivered
    expect(turn.images?.length ?? 0).toBe(0);

    // 3. Content verification: must give pricing
    expect(turn.customer_visible_response).toMatch(/bảng giá|279\.000|nghỉ giờ/i);
  });

  // Ca 5: "Thôi không thuê phòng 601, xem phòng khác."
  it('Ca 5: "Thôi không thuê phòng 601, xem phòng khác." -> Clears focus on 601 and opens room list', async () => {
    const sessionId = 'test-c5';
    // Focus 601
    await orchestrator.processTurn(sessionId, 'Phòng 601 50 Sắc Thái có bồn tắm không em?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // Now decline 601 and ask for another room
    const turn = await orchestrator.processTurn(sessionId, 'Thôi không thuê phòng 601, xem phòng khác.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('CONSULT_AND_RECOMMEND');
    expect(turn.plan?.clearPreviousRequirements).toBe(true);

    // 2. Focused room in memory must be cleared!
    expect(turn.updated_state.focused_room).toBeNull();

    // 3. Response should present recommendations / other rooms
    expect(turn.customer_visible_response).toMatch(/phòng/i);
  });

  // Ca 6: "Anh muốn phòng có bồn sục Jacuzzi chứ không phải bồn tắm thường."
  it('Ca 6: "Anh muốn phòng có bồn sục Jacuzzi chứ không phải bồn tắm thường." -> Clarifies J Collection only has relaxation soaking tubs, NO Jacuzzi whirlpool tubs', async () => {
    const sessionId = 'test-c6';
    const turn = await orchestrator.processTurn(sessionId, 'Anh muốn phòng có bồn sục Jacuzzi chứ không phải bồn tắm thường.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('ANSWER_POLICY');
    expect(turn.plan?.requestedFacts).toContain('jacuzzi');

    // 2. Content semantic verification
    expect(turn.customer_visible_response).toMatch(/không có bồn sục Jacuzzi/i);
    expect(turn.customer_visible_response).toMatch(/bồn tắm nằm ngâm thư giãn/i);
  });

  // Ca 7: "Anh hỏi bồn lớn thôi, không hỏi giá."
  it('Ca 7: "Anh hỏi bồn lớn thôi, không hỏi giá." -> Answers bathtub attribute briefly, NO price table inserted', async () => {
    const sessionId = 'test-c7';
    // Prime room 101 Lồng Chim
    await orchestrator.processTurn(sessionId, 'Phòng 101 Lồng Chim thế nào em?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    const turn = await orchestrator.processTurn(sessionId, 'Anh hỏi bồn lớn thôi, không hỏi giá.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('ANSWER_DIRECT_FACT');
    expect(turn.plan?.primaryGoal).not.toBe('CALCULATE_PRICE');
    expect(turn.plan?.responseDepth).toBe('brief');

    // 2. Content verification: must discuss bath attribute without price table
    expect(turn.customer_visible_response).toMatch(/bồn tắm/i);
    expect(turn.customer_visible_response).not.toMatch(/159\.000|279\.000|399\.000|bảng giá tiêu chuẩn/);
  });

  // Ca 8: "Loại hồi nãy nếu đổi sang tối thứ Bảy thì sao?"
  it('Ca 8: "Loại hồi nãy nếu đổi sang tối thứ Bảy thì sao?" -> Inherits previous category, switches to Saturday evening pricing', async () => {
    const sessionId = 'test-c8';
    // Turn 1: Inquire Deluxe
    await orchestrator.processTurn(sessionId, 'Giá phòng Deluxe thế nào em?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // Turn 2: Follow up for Saturday evening
    const turn = await orchestrator.processTurn(sessionId, 'Loại hồi nãy nếu đổi sang tối thứ Bảy thì sao?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // 1. Planner routing verification
    expect(turn.plan?.primaryGoal).toBe('CALCULATE_PRICE');
    expect(turn.plan?.isFollowUp).toBe(true);
    expect(turn.plan?.referencedCategory).toBe('Deluxe');

    // 2. Content semantic verification: must address Deluxe pricing for evening / weekend
    expect(turn.customer_visible_response).toMatch(/Deluxe/i);
    expect(turn.customer_visible_response).toMatch(/279\.000|dataset/i);
  });
});
