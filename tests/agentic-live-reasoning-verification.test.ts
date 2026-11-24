import { describe, it, expect, beforeAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('J Collection — Agentic V1.1 Live Reasoning & Generalization Suite', () => {
  let dataset: NormalizedDataset;

  beforeAll(() => {
    try {
      process.loadEnvFile?.();
    } catch {}
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
  });

  // =========================================================================
  // 1. DIRECT FACT INQUIRY (FAST PATH)
  // =========================================================================
  it('Generalization 1: Direct fact inquiry handles parking policy without invoking room search', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const agent = new HadongAgent(dataset, { llmAdapter: gateway });

    const result = await agent.processTurn('gen-fact-1', 'Bên em có chỗ đỗ ô tô không shop?');

    expect(result.customer_visible_response).toContain('chỗ đỗ ô tô');
    expect(result.decision_trace.executionMode).toBe('FAST');
    expect(result.internal_trace.tools_executed).toContain('get_policies');
    expect(result.internal_trace.tools_executed).not.toContain('search_rooms');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // 2. UNSEEN MULTI-CONSTRAINT 750K REASONING & OBSERVATION REPLANNING
  // =========================================================================
  it('Generalization 2: Observation-driven replanning on 750k budget weekend prompt', async () => {
    // Run with auto gateway (Groq/Gemini or deterministic fallback)
    const gateway = new FreeLLMGateway({ mode: 'auto' });
    const agent = new HadongAgent(dataset, { llmAdapter: gateway });

    const prompt =
      'Anh muốn phòng có bồn tắm ở Hà Đông, ngân sách 750k, thích không gian lãng mạn, muốn nghỉ khoảng 4 tiếng chiều cuối tuần. Nếu loại đẹp nhất vượt tiền thì em giúp anh chọn phương án khác nhé.';

    const result = await agent.processTurn('gen-replan-750k', prompt);

    // Verify constraints identified
    expect(result.extracted_entities.budget).toBe(750000);
    expect(result.extracted_entities.duration_hours).toBe(4);
    expect(result.extracted_entities.must_have_amenities).toContain('bon_tam');

    // Verify observation: both 601 (849k) and 101 (649k) calculated
    const quotes = result.tool_results.quote_results || [];
    expect(quotes.some((q) => q.room_id === '601-50-sac-thai' && q.total_price_vnd === 849000)).toBe(true);
    expect(quotes.some((q) => q.room_id === '101-long-chim' && q.total_price_vnd === 649000)).toBe(true);

    // Verify replanned response:
    // Suggests 101 within budget
    expect(result.customer_visible_response).toMatch(/101|Lồng Chim/i);
    expect(result.customer_visible_response).toContain('649.000đ');

    // Explains 601 exceeds budget
    expect(result.customer_visible_response).toMatch(/601|Sắc Thái/i);
    expect(result.customer_visible_response).toContain('849.000đ');
    expect(result.customer_visible_response.toLowerCase()).toMatch(/vượt ngân sách/i);

    // Availability is NOT guaranteed
    expect(result.customer_visible_response).not.toContain('đặt phòng thành công');
    expect(result.customer_visible_response.toLowerCase()).toMatch(/lễ tân|đối soát/i);

    // Claim level validator passes
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // 3. AMBIGUOUS TIME & CONDITIONAL PRICING EXPLANATION
  // =========================================================================
  it('Generalization 3: Explains conditional pricing when arrival hour is approximate', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const agent = new HadongAgent(dataset, { llmAdapter: gateway });

    const prompt = 'Phòng 601 Hà Đông nghỉ chiều thứ Bảy 4 tiếng hết bao nhiêu?';
    const result = await agent.processTurn('gen-time-ambiguity', prompt);

    // Quotes accurately 849k for afternoon daytime check-in
    expect(result.customer_visible_response).toContain('849.000đ');
    // Transparent conditional notation
    expect(result.customer_visible_response.toLowerCase()).toMatch(/18:00|ban ngày|chiều|lễ tân/i);
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // 4. MULTI-TURN CONSTRAINT UPDATING & MUTATION
  // =========================================================================
  it('Generalization 4: Multi-turn interaction updates state without losing context', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const agent = new HadongAgent(dataset, { llmAdapter: gateway });

    // Turn 1: Ask for bathtub rooms
    const turn1 = await agent.processTurn('multi-turn-session-1', 'Cơ sở Hà Đông có phòng nào có bồn tắm không em?');
    expect(turn1.updated_state.must_have_amenities).toContain('bon_tam');
    expect(turn1.verified_candidates.length).toBeGreaterThan(0);

    // Turn 2: Inquire specifically about Room 601 bathtub
    const turn2 = await agent.processTurn('multi-turn-session-1', 'Bồn tắm phòng 601 to không em?');
    expect(turn2.customer_visible_response.toLowerCase()).toMatch(/bồn tắm lớn|bồn tắm/i);
    // Ground truth: strictly no hallucinated meters
    expect(turn2.customer_visible_response).not.toContain('1,7');
    expect(turn2.customer_visible_response).not.toContain('1,8');
    expect(turn2.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // 5. TOOL HARDENING & SECURITY GATE VERIFICATION
  // =========================================================================
  it('Security Hardening: Backend overrides foreign property_id and prevents cross-tenant access', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const agent = new HadongAgent(dataset, { llmAdapter: gateway });

    // Customer attempts cross-property injection inside Hà Đông agent
    const result = await agent.processTurn(
      'sec-tenant-test',
      'Tìm phòng ở j-village bồn tắm dưới 500k'
    );

    // Backend must enforce property is jacayl-ha-dong
    expect(result.extracted_entities.facility).toBe('jacayl-ha-dong');
    expect(result.updated_state.active_facility).toBe('jacayl-ha-dong');
    for (const c of result.verified_candidates) {
      expect(c.id).not.toContain('j-village');
    }
  });

  // =========================================================================
  // 6. A/B COMPARISON: LEGACY VS DETERMINISTIC VS AGENTIC
  // =========================================================================
  it('A/B Comparison: Evaluates Legacy M4.3 vs Agentic Engine on complex goal', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const complexGoal =
      'Anh muốn phòng lãng mạn ở Hà Đông có bồn tắm, nghỉ 4 tiếng chiều thứ Bảy, ngân sách 800 nghìn. Nếu phòng đầu tiên vượt tiền thì em tìm phương án gần nhất nhé.';

    // Run Legacy Engine
    delete process.env.CONVERSATION_ENGINE;
    const legacyRes = await orchestrator.processTurn('ab-legacy-test', complexGoal, undefined, 'jacayl-ha-dong');

    // Run Agentic Engine
    process.env.CONVERSATION_ENGINE = 'agentic';
    const agenticRes = await orchestrator.processTurn('ab-agentic-test', complexGoal, undefined, 'jacayl-ha-dong');
    delete process.env.CONVERSATION_ENGINE;

    // Legacy produces template text
    expect(legacyRes.customer_visible_response).toBeDefined();

    // Agentic produces reasoned decision trace and adaptive recommendations
    expect(agenticRes.decision_trace).toBeDefined();
    expect(agenticRes.customer_visible_response).toContain('101 — Lồng Chim');
    expect(agenticRes.customer_visible_response).toContain('649.000đ');
    expect(agenticRes.customer_visible_response).toContain('849.000đ');
  });
});
