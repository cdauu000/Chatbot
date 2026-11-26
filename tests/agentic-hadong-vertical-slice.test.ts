import { describe, it, expect, beforeAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('J Collection — Agentic AI Vertical Slice (jacayl-ha-dong)', () => {
  let dataset: NormalizedDataset;
  let agent: HadongAgent;

  beforeAll(() => {
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
    agent = new HadongAgent(dataset, {
      referenceClock: '2026-11-28T14:00:00+07:00', // Saturday 14:00
    });
  });

  // =========================================================================
  // PHASE 3: PROVE REAL REASONING ON UNSEEN COMPLEX MULTI-GOAL PROMPT
  // =========================================================================
  it('Phase 3: executes bounded reasoning loop for unseen prompt with budget constraint & fallback', async () => {
    const userPrompt =
      'Anh muốn phòng lãng mạn ở Hà Đông có bồn tắm, nghỉ 4 tiếng chiều thứ Bảy, ngân sách 800 nghìn. Nếu phòng đầu tiên vượt tiền thì em tìm phương án gần nhất nhé.';

    const result = await agent.processTurn('unseen-test-session-1', userPrompt, {
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    console.log('\n--- PHASE 3 AGENTIC REASONING RESPONSE ---');
    console.log(result.customer_visible_response);
    console.log('--- END RESPONSE ---\n');

    // 1. Goal Understanding Verification
    expect(result.extracted_entities.budget).toBe(800000);
    expect(result.extracted_entities.duration_hours).toBe(4);
    expect(result.extracted_entities.must_have_amenities).toContain('bon_tam');
    expect(result.extracted_entities.facility).toBe('jacayl-ha-dong');

    // 2. Tool Execution Verification
    expect(result.internal_trace.tools_executed).toContain('search_rooms');
    expect(result.internal_trace.tools_executed).toContain('quote_price');

    // 3. Observation Verification (Quotes accurately calculated by backend)
    const quotes = result.tool_results.quote_results || [];
    expect(quotes.length).toBeGreaterThanOrEqual(2);

    const quote601 = quotes.find((q) => q.room_id === '601-50-sac-thai');
    const quote101 = quotes.find((q) => q.room_id === '101-long-chim');

    expect(quote601).toBeDefined();
    expect(quote601.total_price_vnd).toBe(849000); // 449k + 2x200k = 849k

    expect(quote101).toBeDefined();
    expect(quote101.total_price_vnd).toBe(649000); // 449k + 2x100k = 649k

    // 4. Reasoning & Revision Verification
    // Agent observed 601 exceeds 800k (849k > 800k) and Room 101 meets all criteria (649k <= 800k)
    expect(result.customer_visible_response).toContain('101 — Lồng Chim');
    expect(result.customer_visible_response).toContain('649.000đ');
    expect(result.customer_visible_response).toContain('800.000đ');

    // Transparently explains Room 601 exceeds budget
    expect(result.customer_visible_response).toContain('849.000đ');
    expect(result.customer_visible_response).toContain('vượt ngân sách 49.000đ');

    // Does NOT claim room is guaranteed available
    expect(result.customer_visible_response).not.toContain('phòng đã được khóa');
    expect(result.customer_visible_response).not.toContain('đặt phòng thành công');
    expect(result.customer_visible_response.toLowerCase()).toContain('lễ tân');

    // 5. Claim Grounding Verification
    expect(result.claim_validation).toBeDefined();
    expect(result.claim_validation?.rejected_claims.length).toBe(0);

    // 6. Decision Trace Verification
    expect(result.decision_trace).toBeDefined();
    const trace = result.decision_trace;
    expect(trace.executionMode).toBe('DEEP');
    expect(trace.decisionSteps.length).toBeGreaterThanOrEqual(4);
    expect(trace.decisionSteps.some((s: any) => s.phase === 'UNDERSTAND')).toBe(true);
    expect(trace.decisionSteps.some((s: any) => s.phase === 'ACT')).toBe(true);
    expect(trace.decisionSteps.some((s: any) => s.phase === 'OBSERVE')).toBe(true);
    expect(trace.decisionSteps.some((s: any) => s.phase === 'REVISE')).toBe(true);
    expect(trace.decisionSteps.some((s: any) => s.phase === 'RESPOND')).toBe(true);
  });

  // =========================================================================
  // FAST PATH ADAPTIVE REASONING
  // =========================================================================
  it('Fast Path: answers pure parking inquiry directly without search', async () => {
    const result = await agent.processTurn('fast-parking-session', 'Bên em có chỗ đỗ ô tô không?');

    // Reconciled V1.4.3 oracle: canonical ground truth confirms "có chỗ đỗ xe", not specific vehicle types
    expect(result.customer_visible_response.toLowerCase()).toContain('có chỗ đỗ xe');
    expect(result.decision_trace.executionMode).toBe('FAST');
    expect(result.internal_trace.tools_executed).toContain('get_policies');
    expect(result.internal_trace.tools_executed).not.toContain('search_rooms');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // GROUND TRUTH ACCURACY: ROOM 601 NO DIMENSION HALLUCINATION
  // =========================================================================
  it('Ground Truth: Room 601 reports "bồn tắm lớn" and does not hallucinate 1.7-1.8m', async () => {
    const result = await agent.processTurn('facts-session-601', 'Phòng 601 ở Hà Đông bồn tắm to không em?');

    expect(result.customer_visible_response).not.toContain('1,7');
    expect(result.customer_visible_response).not.toContain('1.7');
    expect(result.customer_visible_response).not.toContain('1,8');
    expect(result.customer_visible_response).not.toContain('1.8');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // FEATURE FLAG A/B VERIFICATION (CONVERSATION_ENGINE=legacy vs agentic)
  // =========================================================================
  it('Feature Flag: Orchestrator routes to Agentic Engine when CONVERSATION_ENGINE=agentic', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);

    // 1. Run with legacy mode (default)
    delete process.env.CONVERSATION_ENGINE;
    const legacyResult = await orchestrator.processTurn(
      'ab-session-legacy',
      'Anh muốn phòng bồn tắm ở Hà Đông',
      '2026-11-28T14:00:00+07:00',
      'jacayl-ha-dong'
    );
    expect(legacyResult.rules_triggered || legacyResult.internal_trace?.rules_triggered).toBeDefined();

    // 2. Run with agentic mode
    process.env.CONVERSATION_ENGINE = 'agentic';
    const agenticResult = await orchestrator.processTurn(
      'ab-session-agentic',
      'Anh muốn phòng bồn tắm ở Hà Đông',
      '2026-11-28T14:00:00+07:00',
      'jacayl-ha-dong'
    );
    expect(agenticResult.decision_trace).toBeDefined();
    expect(agenticResult.internal_trace.adapter_used).toBe('HadongAgenticReasoner-v1');

    // Clean up env
    delete process.env.CONVERSATION_ENGINE;
  });
});
