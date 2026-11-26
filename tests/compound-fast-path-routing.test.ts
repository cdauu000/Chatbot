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
  it('Ca 1: "Cảm ơn em nhưng báo giá Deluxe cho anh nhé" -> Routes to Deluxe pricing, NOT swallowed by polite closing', async () => {
    const sessionId = 'test-c1';
    const turn = await orchestrator.processTurn(sessionId, 'Cảm ơn em nhưng báo giá Deluxe cho anh nhé', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // Reconciled V3 contract: retired turn.plan? removed; verifies actual Deluxe price response & not swallowed
    expect(turn.customer_visible_response).toMatch(/279\.000|315\.000/);
    expect(turn.customer_visible_response).toMatch(/Deluxe/i);
    expect(turn.customer_visible_response).not.toBe('Dạ rất hân hạnh được hỗ trợ anh/chị!');
  });

  // Ca 2: "Có chỗ đỗ xe và phòng Concept giá bao nhiêu?"
  it('Ca 2: "Có chỗ đỗ xe và phòng Concept giá bao nhiêu?" -> Answers parking without fabricated claims', async () => {
    const sessionId = 'test-c2';
    const turn = await orchestrator.processTurn(sessionId, 'Có chỗ đỗ xe và phòng Concept giá bao nhiêu?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    expect(turn.customer_visible_response).toMatch(/chỗ đỗ xe/i);
    expect(turn.claim_validation?.rejected_claims.length).toBe(0);
  });

  // Ca 3: "Chào em, phòng 601 còn không?"
  it('Ca 3: "Chào em, phòng 601 còn không?" -> Identifies room availability check for 601, NOT pure greeting', async () => {
    const sessionId = 'test-c3';
    const turn = await orchestrator.processTurn(sessionId, 'Chào em, phòng 601 còn không?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    expect(turn.customer_visible_response).toMatch(/PMS|thời gian thực|lễ tân/i);
    expect(turn.customer_visible_response).not.toMatch(/^Dạ em chào anh\/chị ạ! Chào mừng/);
  });

  // Ca 4: "Anh không cần ảnh, anh cần giá."
  it('Ca 4: "Anh không cần ảnh, anh cần giá." -> Gives price, does NOT trigger isImageRequest', async () => {
    const sessionId = 'test-c4';
    await orchestrator.processTurn(sessionId, 'Tư vấn phòng Deluxe cho anh ở Hà Đông', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    const turn = await orchestrator.processTurn(sessionId, 'Anh không cần ảnh, anh cần giá.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    expect(turn.images?.length ?? 0).toBe(0);
    expect(turn.customer_visible_response).toMatch(/279\.000|315\.000|399\.000|449\.000|bảng giá|nghỉ giờ/i);
  });

  // Ca 5: "Thôi không thuê phòng 601, xem phòng khác."
  it('Ca 5: "Thôi không thuê phòng 601, xem phòng khác." -> Clears focus on 601 and opens room list', async () => {
    const sessionId = 'test-c5';
    await orchestrator.processTurn(sessionId, 'Phòng 601 50 Sắc Thái có bồn tắm không em?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    const turn = await orchestrator.processTurn(sessionId, 'Thôi không thuê phòng 601, xem phòng khác.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    expect(turn.updated_state.negated_constraints).toContain('601-50-sac-thai');
    expect(turn.customer_visible_response).toMatch(/phòng/i);
  });

  // Ca 6: "Anh muốn phòng có bồn sục Jacuzzi chứ không phải bồn tắm thường."
  it('Ca 6: "Anh muốn phòng có bồn sục Jacuzzi chứ không phải bồn tắm thường." -> Clarifies bathtub/jacuzzi confirmation status truthfully', async () => {
    const sessionId = 'test-c6';
    const turn = await orchestrator.processTurn(sessionId, 'Anh muốn phòng có bồn sục Jacuzzi chứ không phải bồn tắm thường.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    // Reconciled Policy V1.4.3 Ground Truth: soaking bathtub confirmed, jacuzzi jets are UNKNOWN/not confirmed in catalog
    expect(turn.customer_visible_response.toLowerCase()).toMatch(/jacuzzi|bồn tắm|chưa được công bố|lễ tân/);
    expect(turn.claim_validation?.rejected_claims.length).toBe(0);
  });

  // Ca 7: "Anh hỏi bồn lớn thôi, không hỏi giá."
  it('Ca 7: "Anh hỏi bồn lớn thôi, không hỏi giá." -> Answers bathtub attribute factually', async () => {
    const sessionId = 'test-c7';
    await orchestrator.processTurn(sessionId, 'Phòng 101 Lồng Chim thế nào em?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    const turn = await orchestrator.processTurn(sessionId, 'Anh hỏi bồn lớn thôi, không hỏi giá.', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    expect(turn.customer_visible_response).toMatch(/bồn tắm|chưa được công bố|lễ tân/i);
    expect(turn.claim_validation?.rejected_claims.length).toBe(0);
  });

  // Ca 8: "Loại hồi nãy nếu đổi sang tối thứ Bảy thì sao?"
  it('Ca 8: "Loại hồi nãy nếu đổi sang tối thứ Bảy thì sao?" -> Inherits context & computes Saturday pricing', async () => {
    const sessionId = 'test-c8';
    await orchestrator.processTurn(sessionId, 'Giá phòng Deluxe thế nào em?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    const turn = await orchestrator.processTurn(sessionId, 'Loại hồi nãy nếu đổi sang tối thứ Bảy thì sao?', '2026-11-25T14:00:00+07:00', 'jacayl-ha-dong');

    expect(turn.customer_visible_response).toMatch(/Deluxe|phòng/i);
    expect(turn.claim_validation?.rejected_claims.length).toBe(0);
  });
});
