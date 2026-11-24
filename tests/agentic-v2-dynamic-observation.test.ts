import { describe, it, expect, beforeAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';

describe('J Collection — Agentic V2.0 Dynamic Observation & Resilience Suite', () => {
  let dataset: NormalizedDataset;

  beforeAll(() => {
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
  });

  // =========================================================================
  // FIXTURE A: CANDIDATES FIT BUDGET
  // =========================================================================
  it('Fixture A: Both candidates fit generous budget (1.000.000đ) -> optimal & premium both within budget', async () => {
    const agent = new HadongAgent(dataset);
    const result = await agent.processTurn(
      'dyn-obs-fit-budget',
      'Anh muốn phòng bồn tắm ở Hà Đông 4 tiếng chiều thứ 7, ngân sách 1 triệu'
    );

    expect(result.extracted_entities.budget).toBe(1000000);
    expect(result.extracted_entities.duration_hours).toBe(4);
    expect(result.internal_trace.tools_executed).toContain('quote_price');

    const quotes = result.tool_results.quote_results || [];
    expect(quotes.some((q) => q.room_id === '101-long-chim' && q.total_price_vnd === 649000)).toBe(true);
    expect(quotes.some((q) => q.room_id === '601-50-sac-thai' && q.total_price_vnd === 849000)).toBe(true);

    // Both fit within 1.000.000đ
    expect(result.customer_visible_response).toContain('101 — Lồng Chim');
    expect(result.customer_visible_response).toContain('649.000đ');
    expect(result.customer_visible_response).toContain('849.000đ');
    expect(result.customer_visible_response).not.toContain('vượt ngân sách');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // FIXTURE B: ALL CANDIDATES EXCEED BUDGET -> REPLANNING OBSERVED
  // =========================================================================
  it('Fixture B: All candidates exceed low budget (400.000đ 4h) -> transparent nearest upgrade explanation with exact delta', async () => {
    const agent = new HadongAgent(dataset);
    const result = await agent.processTurn(
      'dyn-obs-exceed-budget',
      'Tìm phòng có bồn tắm ở Hà Đông 4 tiếng chiều thứ 7, ngân sách anh có 400 nghìn thôi'
    );

    expect(result.extracted_entities.budget).toBe(400000);
    expect(result.extracted_entities.duration_hours).toBe(4);
    expect(result.internal_trace.tools_executed).toContain('quote_price');

    // Lowest bathtub 4h is 101 at 649k (exceeds 400k by 249k)
    expect(result.customer_visible_response).toContain('649.000đ');
    expect(result.customer_visible_response).toContain('vượt ngân sách 249.000đ');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // FIXTURE C: CANDIDATE LACKS FACTS -> MODEL QUERIES FACTS & DISCLAIMS UNVERIFIED
  // =========================================================================
  it('Fixture C: Unknown amenity details (jacuzzi jets & tub length) -> query facts and disclaim unconfirmed data', async () => {
    const agent = new HadongAgent(dataset);
    const result = await agent.processTurn(
      'dyn-obs-facts',
      'Bồn tắm phòng 601 dài bao nhiêu mét, có sục Jacuzzi tạo bọt không em?'
    );

    expect(result.customer_visible_response).toContain('Bồn tắm lớn');
    expect(result.customer_visible_response).toContain('chưa được công bố chính thức');
    expect(result.customer_visible_response).not.toContain('1,8m');
    expect(result.customer_visible_response).not.toContain('1.8m');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // FIXTURE D: PRICING TOOL ERROR -> MODEL HANDLES GRACEFULLY WITHOUT CRASH
  // =========================================================================
  it('Fixture D: Pricing tool error -> agent handles gracefully with polite fallback and zero crash', async () => {
    const agent = new HadongAgent(dataset);

    // Spy/intercept tool gateway to simulate an internal pricing failure
    const originalExecute = (agent as any).toolGateway.executeTool.bind((agent as any).toolGateway);
    (agent as any).toolGateway.executeTool = async (call: any) => {
      if (call.toolName === 'quote_price') {
        return {
          toolCallId: call.toolCallId,
          toolName: 'quote_price',
          status: 'ERROR',
          data: null,
          provenance: 'pricing_engine',
          errorMessage: 'PRICING_ENGINE_UNAVAILABLE: Database lock timeout',
        };
      }
      return originalExecute(call);
    };

    const result = await agent.processTurn(
      'dyn-obs-error-handling',
      'Phòng 601 thứ 7 4 tiếng giá bao nhiêu em'
    );

    expect(result).toBeDefined();
    expect(result.customer_visible_response).toBeDefined();
    // Must gracefully advise or fallback
    expect(result.customer_visible_response.length).toBeGreaterThan(10);
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // CHOICE REINSTATEMENT (SECTION VII)
  // =========================================================================
  it('Choice Reinstatement: Customer excludes room 101 then reinstates it -> restored to consideration pool', async () => {
    const agent = new HadongAgent(dataset);
    const sessionId = 'choice-reinstatement-session';

    // Turn 1: Exclude room 101
    const res1 = await agent.processTurn(
      sessionId,
      'Tìm phòng có bồn tắm ở Hà Đông nhưng không lấy 101 nhé'
    );
    expect(res1.customer_visible_response).toContain('50 Sắc Thái');
    expect(res1.customer_visible_response).not.toContain('Phòng 101 — Lồng Chim (Lồng Chim)');
    expect(agent.getSessionState(sessionId).negatedRoomIds).toContain('101-long-chim');

    // Turn 2: Reinstate room 101
    const res2 = await agent.processTurn(
      sessionId,
      'Thôi cho anh lấy lại phòng 101 xem giá chiều thứ 7 4 tiếng thế nào'
    );
    expect(res2.customer_visible_response).toContain('101');
    expect(res2.customer_visible_response).toContain('649.000đ');
    expect(agent.getSessionState(sessionId).negatedRoomIds).not.toContain('101-long-chim');
    expect(agent.getSessionState(sessionId).reinstatedChoices).toContain('101-long-chim');
  });

  // =========================================================================
  // IN-FLIGHT TAKEOVER RACE CONDITION (GATE 2 SAFETY)
  // =========================================================================
  it('In-flight Takeover Race Condition: Staff takes over while turn is executing -> AI outbound suppressed at Gate 2', async () => {
    const agent = new HadongAgent(dataset);
    const sessionId = 'inflight-takeover-session';

    // Hook into tool gateway to trigger staff takeover mid-execution
    const originalExecute = (agent as any).toolGateway.executeTool.bind((agent as any).toolGateway);
    (agent as any).toolGateway.executeTool = async (call: any) => {
      // Simulate receptionist taking over in another thread/tab right when tool completes
      agent.takeoverSession(sessionId, 'staff_thao');
      return originalExecute(call);
    };

    const result = await agent.processTurn(
      sessionId,
      'Phòng 101 thứ 7 4 tiếng giá bao nhiêu em'
    );

    // Gate 2 must catch ownership_state === 'HUMAN_ACTIVE' && staff_took_over
    expect(result.customer_visible_response).toBe('');
    expect(result.human_escalation.needed).toBe(true);
    expect(agent.getSessionState(sessionId).ownership_state).toBe('HUMAN_ACTIVE');
  });
});
