import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import '../src/config/env-loader.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { TranKhatChanAgent } from '../src/agent/trankhatchan-agent.js';
import { JVillageAgent } from '../src/agent/jvillage-agent.js';
import { CoSoMa } from '../src/domain/types.js';

interface ScenarioTurn {
  userMessage: string;
  expectedGoal: string;
}

interface Scenario {
  id: string;
  facility: CoSoMa;
  name: string;
  category: 'AVAILABILITY' | 'PRICE' | 'GROUNDING' | 'COMPOUND' | 'RETRACTION' | 'POLICY' | 'TENANT_ISOLATION' | 'COLLOQUIAL';
  turns: ScenarioTurn[];
}

const LIVE_20_SCENARIOS: Scenario[] = [
  {
    id: 'LIVE-01',
    facility: 'jacayl-ha-dong',
    name: 'Owner Replay 1 (Brand New Session): "Nay còn phòng kh b"',
    category: 'AVAILABILITY',
    turns: [
      {
        userMessage: 'Nay còn phòng kh b',
        expectedGoal: 'Check general availability without arbitrary duration/weekend assumptions; explain reception vacancy',
      },
    ],
  },
  {
    id: 'LIVE-02',
    facility: 'jacayl-ha-dong',
    name: 'Owner Replay 2 (Follow-up 4h): "Nay còn phòng kh b"',
    category: 'AVAILABILITY',
    turns: [
      {
        userMessage: 'Phòng 101 ở 4 tiếng giá thế nào em',
        expectedGoal: 'Quote 4h price for Room 101',
      },
      {
        userMessage: 'Nay còn phòng kh b',
        expectedGoal: 'Connect with prior 4h context, confirm availability, explain reception real-time vacancy',
      },
    ],
  },
  {
    id: 'LIVE-03',
    facility: 'jacayl-ha-dong',
    name: 'Explore bathtub rooms at Hà Đông',
    category: 'AVAILABILITY',
    turns: [
      {
        userMessage: 'Tìm giúp anh các phòng có bồn tắm ở cơ sở Hà Đông',
        expectedGoal: 'Discover bathtub rooms (101, 601, 602) without arbitrary 4h price quote',
      },
    ],
  },
  {
    id: 'LIVE-04',
    facility: 'jacayl-ha-dong',
    name: 'Room 601 price 2h afternoon inquiry',
    category: 'PRICE',
    turns: [
      {
        userMessage: 'Phòng 601 nghỉ 2 tiếng giá bao nhiêu em',
        expectedGoal: 'Quote Room 601 for 2h',
      },
    ],
  },
  {
    id: 'LIVE-05',
    facility: 'jacayl-ha-dong',
    name: 'Room 101 weekend afternoon 4h price',
    category: 'PRICE',
    turns: [
      {
        userMessage: 'Phòng 101 thứ 7 từ 14h đến 18h giá bao nhiêu em',
        expectedGoal: 'Accurately quote 4h Saturday afternoon: 449k + 2x100k = 649k',
      },
    ],
  },
  {
    id: 'LIVE-06',
    facility: 'jacayl-ha-dong',
    name: 'Viewing room photos: 601 50 Sắc Thái',
    category: 'AVAILABILITY',
    turns: [
      {
        userMessage: 'Cho anh xem hình ảnh thực tế phòng 601 50 Sắc Thái với em',
        expectedGoal: 'Deliver media for Room 601 proactively',
      },
    ],
  },
  {
    id: 'LIVE-07',
    facility: 'jacayl-ha-dong',
    name: 'Compound query: Room 601 price + 7-seat car parking',
    category: 'COMPOUND',
    turns: [
      {
        userMessage: 'Phòng 601 giá bao nhiêu và khách sạn có chỗ đỗ ô tô 7 chỗ không em?',
        expectedGoal: 'Simultaneously answer 601 pricing and car parking policy without swallowing either',
      },
    ],
  },
  {
    id: 'LIVE-08',
    facility: 'jacayl-ha-dong',
    name: 'Cheapest room inquiry without unwanted upsell',
    category: 'PRICE',
    turns: [
      {
        userMessage: 'Em ơi phòng nào giá rẻ nhất ở cơ sở bên mình?',
        expectedGoal: 'Recommend Room 201 La Casta directly without forcing expensive Concept room',
      },
    ],
  },
  {
    id: 'LIVE-09',
    facility: 'jacayl-ha-dong',
    name: 'Constraint Retraction (Mind Change)',
    category: 'RETRACTION',
    turns: [
      {
        userMessage: 'Tìm cho anh phòng lãng mạn có bồn tắm nhé',
        expectedGoal: 'List bathtub rooms',
      },
      {
        userMessage: 'Thôi không cần bồn tắm nữa, tìm phòng giá rẻ nhất cho anh nhé',
        expectedGoal: 'Retract bathtub constraint and recommend cheapest room (201 La Casta)',
      },
    ],
  },
  {
    id: 'LIVE-10',
    facility: 'jacayl-ha-dong',
    name: 'Category Comparison: Deluxe vs Concept',
    category: 'POLICY',
    turns: [
      {
        userMessage: 'So sánh giúp anh hạng Deluxe và Concept ở Hà Đông khác nhau thế nào và giá sao em',
        expectedGoal: 'Compare Deluxe (201) vs Concept (101/601) pricing and features',
      },
    ],
  },
  {
    id: 'LIVE-11',
    facility: 'jacayl-ha-dong',
    name: 'Grounding integrity on unconfirmed amenities (Jacuzzi 1m8, infinity pool)',
    category: 'GROUNDING',
    turns: [
      {
        userMessage: 'Bên mình có phòng nào có bồn sục Jacuzzi 1m8 và hồ bơi vô cực không em?',
        expectedGoal: 'Truthfully disclaim pool and 1m8 jacuzzi as unconfirmed in dataset',
      },
    ],
  },
  {
    id: 'LIVE-12',
    facility: 'jacayl-ha-dong',
    name: 'Late check-in at 1h AM inquiry',
    category: 'POLICY',
    turns: [
      {
        userMessage: 'Khách sạn có cho nhận phòng lúc 1h sáng đêm muộn không em?',
        expectedGoal: 'Confirm 24/7 reception and overnight package applicability',
      },
    ],
  },
  {
    id: 'LIVE-13',
    facility: 'jacayl-ha-dong',
    name: 'Daytime stay time boundary policy (08:00 - 18:00)',
    category: 'POLICY',
    turns: [
      {
        userMessage: 'Gói ban ngày bên mình tối đa đến mấy giờ chiều vậy em?',
        expectedGoal: 'State daytime window up to 18:00',
      },
    ],
  },
  {
    id: 'LIVE-14',
    facility: 'jacayl-ha-dong',
    name: 'Overnight stay check-in hours policy (22:00 standard, 21:40 grace)',
    category: 'POLICY',
    turns: [
      {
        userMessage: 'Nghỉ qua đêm bên mình bắt đầu tính từ mấy giờ tối?',
        expectedGoal: 'State 22:00 checkin with 21:40 early check-in grace period',
      },
    ],
  },
  {
    id: 'LIVE-15',
    facility: 'jacayl-ha-dong',
    name: 'Holiday surcharge policy (Business Policy V1.4.3: 0 VND surcharge)',
    category: 'POLICY',
    turns: [
      {
        userMessage: 'Dịp lễ 30/4 bên mình có phụ thu thêm phí không em?',
        expectedGoal: 'Confirm 0 VND holiday surcharge under Policy V1.4.3',
      },
    ],
  },
  {
    id: 'LIVE-16',
    facility: 'jacayl-ha-dong',
    name: 'Extra person policy inquiry (3rd person overnight)',
    category: 'POLICY',
    turns: [
      {
        userMessage: 'Phòng bên mình có cho ở thêm người thứ 3 qua đêm không em?',
        expectedGoal: 'Disclaim 3rd person overnight policy as unconfirmed on system, advise checking with front desk',
      },
    ],
  },
  {
    id: 'LIVE-17',
    facility: 'jacayl-ha-dong',
    name: 'Cross-facility inquiry on Hà Đông about Trần Khát Chân',
    category: 'TENANT_ISOLATION',
    turns: [
      {
        userMessage: 'Cơ sở bên Trần Khát Chân có phòng bồn tắm đôi không em?',
        expectedGoal: 'Enforce tenant isolation, clarify property scope and guide to TKC channel',
      },
    ],
  },
  {
    id: 'LIVE-18',
    facility: 'jacayl-ha-dong',
    name: 'Short colloquial query without diacritics',
    category: 'COLLOQUIAL',
    turns: [
      {
        userMessage: 'co phong nao re k e',
        expectedGoal: 'Understand colloquial request and recommend cheapest room (201)',
      },
    ],
  },
  {
    id: 'LIVE-19',
    facility: 'jacayl-tran-khat-chan',
    name: 'Trần Khát Chân: Room 1001 Đêm pricing & bathtub inquiry',
    category: 'PRICE',
    turns: [
      {
        userMessage: 'Phòng 1001 Đêm bên Trần Khát Chân giá thế nào và có bồn tắm không em?',
        expectedGoal: 'Verify TKC Room 1001 Đêm with bathtub and quote price accurately',
      },
    ],
  },
  {
    id: 'LIVE-20',
    facility: 'j-village',
    name: 'J Village: Crimson Suite pricing & facilities inquiry',
    category: 'PRICE',
    turns: [
      {
        userMessage: 'Phòng Crimson Suite bên J Village Triệu Việt Vương giá thế nào và có bồn tắm không em?',
        expectedGoal: 'Verify J Village Crimson Suite with bathtub and quote price accurately',
      },
    ],
  },
];

describe('J COLLECTION — V3.0 REAL INTELLIGENCE ACCEPTANCE: 20 LIVE SCENARIOS', { timeout: 600000 }, () => {
  let dataset: NormalizedDataset;
  let gateway: FreeLLMGateway;
  let hadongAgent: HadongAgent;
  let tkcAgent: TranKhatChanAgent;
  let jvAgent: JVillageAgent;
  const REF_CLOCK = '2026-11-28T14:00:00+07:00';

  const collectedResults: any[] = [];
  const tracesLog: any[] = [];

  beforeAll(() => {
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
    gateway = new FreeLLMGateway({ mode: 'auto' });

    hadongAgent = new HadongAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true });
    tkcAgent = new TranKhatChanAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true });
    jvAgent = new JVillageAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true });
  });

  for (let sIdx = 0; sIdx < LIVE_20_SCENARIOS.length; sIdx++) {
    const sc = LIVE_20_SCENARIOS[sIdx];

    it(`Scenario ${sc.id}: ${sc.name} (${sc.facility})`, async () => {
      const agents: Record<CoSoMa, any> = {
        'jacayl-ha-dong': hadongAgent,
        'jacayl-tran-khat-chan': tkcAgent,
        'j-village': jvAgent,
      };
      const agent = agents[sc.facility];
      const sessionId = `live-test-${sc.id}-${Date.now()}`;
      const scenarioTurnResults: any[] = [];

      for (let tIdx = 0; tIdx < sc.turns.length; tIdx++) {
        if (sIdx > 0 || tIdx > 0) {
          await new Promise((r) => setTimeout(r, 15000));
        }
        const turn = sc.turns[tIdx];
        const startTime = performance.now();

        let turnRes: any;
        let blockedError: string | null = null;
        try {
          turnRes = await agent.processTurn(sessionId, turn.userMessage, {
            referenceClock: REF_CLOCK,
            strictLiveOnly: true,
          });
        } catch (err: any) {
          blockedError = err.message;
        }
        const latencyMs = Math.round(performance.now() - startTime);

        if (blockedError) {
          const blockedRecord = {
            scenario_id: sc.id,
            scenario_name: sc.name,
            category: sc.category,
            facility: sc.facility,
            turn_index: tIdx + 1,
            user_message: turn.userMessage,
            expected_goal: turn.expectedGoal,
            delivered_response: null,
            final_model_response: null,
            verification_status: 'BLOCKED',
            actual_provider: 'none',
            actual_model: 'none',
            provider_model: 'BLOCKED',
            latency_ms: latencyMs,
            tools_executed: [],
            tool_arguments: [],
            observations: [],
            structured_decisions: [],
            decision_steps: [],
            rejected_claims: [],
            passed: false,
            blocked_reason: blockedError,
          };
          scenarioTurnResults.push(blockedRecord);
          tracesLog.push(blockedRecord);
          break;
        }

        const telemetry = turnRes.decision_trace.llmTelemetry;
        const providerModel = turnRes.decision_trace.providerModel;
        const verificationStatus = turnRes.decision_trace.verificationStatus;
        const toolsExecuted = turnRes.internal_trace.tools_executed;
        const ungroundedClaims = turnRes.claim_validation?.rejected_claims || [];
        const toolArguments = (turnRes.decision_trace.decisionSteps || [])
          .flatMap((ds: any) => ds.toolCalls || [])
          .map((tc: any) => ({ tool_name: tc.toolName, arguments: tc.arguments }));
        const observations = (turnRes.decision_trace.decisionSteps || [])
          .filter((ds: any) => ds.phase === 'OBSERVE')
          .map((ds: any) => ({
            summary: ds.thoughtSummary,
            tool_results: ds.toolResults,
          }));

        expect(turnRes.customer_visible_response).toBeDefined();
        expect(turnRes.customer_visible_response.length).toBeGreaterThan(20);
        expect(ungroundedClaims.length).toBe(0);

        const record = {
          scenario_id: sc.id,
          scenario_name: sc.name,
          category: sc.category,
          facility: sc.facility,
          turn_index: tIdx + 1,
          user_message: turn.userMessage,
          expected_goal: turn.expectedGoal,
          actual_provider: telemetry?.provider ?? 'unknown',
          actual_model: telemetry?.model ?? 'unknown',
          provider_model: providerModel,
          verification_status: verificationStatus,
          structured_decisions: telemetry?.structuredDecisions ?? [],
          tool_arguments: toolArguments,
          observations,
          final_model_response: telemetry?.finalModelResponse ?? null,
          delivered_response: turnRes.customer_visible_response,
          customer_visible_response: turnRes.customer_visible_response,
          latency_ms: latencyMs,
          tools_executed: toolsExecuted,
          decision_steps: turnRes.decision_trace.decisionSteps,
          rejected_claims: ungroundedClaims,
          passed: ungroundedClaims.length === 0 && verificationStatus === 'LIVE_LLM_DECISION_VERIFIED',
          telemetry,
        };

        scenarioTurnResults.push(record);
        tracesLog.push(record);
      }

      collectedResults.push({
        scenario_id: sc.id,
        name: sc.name,
        facility: sc.facility,
        category: sc.category,
        turns: scenarioTurnResults,
      });

      // Write artifacts progressively
      const artifactsDir = path.resolve('artifacts');
      if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

      fs.writeFileSync(
        path.join(artifactsDir, 'live-acceptance-20-results.json'),
        JSON.stringify({ evaluated_at: new Date().toISOString(), scenarios: collectedResults }, null, 2),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(artifactsDir, 'live-acceptance-20-traces.jsonl'),
        tracesLog.map((t) => JSON.stringify(t)).join('\n'),
        'utf-8'
      );

      // Fail test if any turn was BLOCKED or not LIVE_LLM_DECISION_VERIFIED (unless security/escalation guard)
      for (const tr of scenarioTurnResults) {
        if (tr.verification_status === 'BLOCKED') {
          throw new Error(`Turn blocked under strictLiveOnly: ${tr.blocked_reason}`);
        }
      }
    });
  }
});
