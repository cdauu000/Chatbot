import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { TranKhatChanAgent } from '../src/agent/trankhatchan-agent.js';
import { JVillageAgent } from '../src/agent/jvillage-agent.js';
import { CoSoMa } from '../src/domain/types.js';

interface BenchmarkModelSpec {
  id: string;
  provider: 'groq' | 'gemini';
  model: string;
}

const MODELS_TO_BENCHMARK: BenchmarkModelSpec[] = [
  { id: 'groq-gpt-oss-20b', provider: 'groq', model: 'openai/gpt-oss-20b' },
  { id: 'groq-qwen3.8-27b', provider: 'groq', model: 'qwen/qwen3.8-27b' },
  { id: 'groq-gpt-oss-120b', provider: 'groq', model: 'openai/gpt-oss-120b' },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini', model: 'gemini-3.5-flash-lite' },
];

interface BenchmarkScenario {
  id: string;
  facility: CoSoMa;
  title: string;
  turns: Array<{ message: string; checks: string }>;
}

const REPRESENTATIVE_CONVERSATIONS: BenchmarkScenario[] = [
  {
    id: 'BENCH-HD-01',
    facility: 'jacayl-ha-dong',
    title: 'Ha Dong: Brand-new availability -> T7 4h cheapest bathtub -> Constraint drop + negate 201',
    turns: [
      { message: 'Nay còn phòng kh b', checks: 'Calls search_rooms; states no live PMS; no fabricated 14h assumption; no fake room hold offer' },
      { message: 'Thứ 7 từ 14h đến 18h phòng có bồn tắm rẻ nhất giá bao nhiêu, với khách sạn có bể bơi không?', checks: 'Room 101 4h Sat afternoon = 649,000đ; pool = UNKNOWN (do not claim no pool)' },
      { message: 'Thôi không cần bồn tắm nữa nhưng không lấy phòng 201 đâu nhé, gợi ý phòng rẻ nhất khác giúp anh', checks: 'Drops bathtub, excludes 201, recommends cheapest other room accurately from catalog' },
    ],
  },
  {
    id: 'BENCH-TKC-02',
    facility: 'jacayl-tran-khat-chan',
    title: 'Tran Khat Chan: Conditional quote + Hold boundary (NO PMS)',
    turns: [
      { message: 'Phòng 1001 Đêm bên Trần Khát Chân giá thế nào và thứ 7 có tăng giá không em?', checks: 'Quotes TKC 1001 Đêm base rates accurately; clarifies TKC keeps same base pricing 24/7' },
      { message: 'Ok giữ giúp anh phòng 1001 Đêm tối nay lúc 22h nhé', checks: 'Does NOT claim room is held/booked; clearly guides guest to contact reception hotline' },
    ],
  },
  {
    id: 'BENCH-JV-03',
    facility: 'j-village',
    title: 'J Village: Cheapest budget search -> Crimson Suite facts + media',
    turns: [
      { message: 'Bên J Village có phòng nào dưới 300k nghỉ 2 tiếng không em?', checks: 'Calls search_rooms; names real J Village catalog rooms <=300k without inventing room IDs' },
      { message: 'Còn phòng Crimson Suite có bồn tắm không và gửi giúp mình ảnh phòng đó', checks: 'Calls get_room_facts + get_room_media; delivers real Crimson Suite facts & image URLs' },
    ],
  },
];

async function scoreTurnSetWithJudge(
  judgeGateway: FreeLLMGateway,
  spec: BenchmarkModelSpec,
  transcripts: any[],
  judgeProviderPreference: 'groq' | 'gemini'
) {
  const prompt = [
    {
      role: 'system',
      content: `You are an impartial benchmark evaluator comparing LLM concierge models for J Collection.
Score the evaluated model strictly from 1.0 to 5.0 on these semantic dimensions based ONLY on tool observations and delivered responses:
- goal_understanding
- context_tracking
- constraint_change_handling
- epistemic_separation (clock vs guest checkin; catalog vs live PMS; no offering/claiming hold)
- hallucination_prevention (no invented rooms, prices, URLs, or claims like "không có bể bơi")
- business_accuracy (Ha Dong weekend 649k for 101 4h; TKC 24/7 rate; 1001 Dem; J Village real IDs)
- response_groundedness
- vietnamese_naturalness
Output ONLY valid JSON:
{"goal_understanding":n,"context_tracking":n,"constraint_change_handling":n,"epistemic_separation":n,"hallucination_prevention":n,"business_accuracy":n,"response_groundedness":n,"vietnamese_naturalness":n,"critical_failures":string[]}`,
    },
    {
      role: 'user',
      content: `Model Evaluated: ${spec.provider}:${spec.model}\n\nTranscripts:\n${JSON.stringify(
        transcripts.map((t) => ({
          scenario: t.scenario_id,
          turn: t.turn_index,
          user: t.user_message,
          expected: t.checks,
          status: t.verification_status,
          tools: t.tools_executed,
          observations: t.observations,
          response: t.customer_visible_response,
          rejected_claims: t.rejected_claims,
        }))
      )}`,
    },
  ];

  try {
    const res = await judgeGateway.callChatCompletion(prompt, {
      temperature: 0.1,
      maxTokens: 1200,
      allowMockFallback: false,
      preferredProvider: judgeProviderPreference,
    });
    let clean = res.raw_content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) clean = m[0];
    return { status: 'EVALUATED', judge: `${res.telemetry?.provider}:${res.telemetry?.model}`, scores: JSON.parse(clean) };
  } catch (err: any) {
    return { status: 'JUDGE_BLOCKED', error: err.message, scores: null };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isResume = args.includes('--resume');
  const artifactsDir = path.resolve('artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  const outPath = path.join(artifactsDir, 'model-quality-benchmark.json');

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const REF_CLOCK = '2026-11-28T14:00:00+07:00';

  const existingById = new Map<string, any>();
  if (isResume && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      for (const m of prev.models || []) existingById.set(m.id, m);
    } catch {
      // ignore
    }
  }

  const judgeGateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const modelResults: any[] = [];

  for (const spec of MODELS_TO_BENCHMARK) {
    const prev = existingById.get(spec.id);
    if (isResume && prev && prev.blocked_turns === 0 && prev.ai_judge?.status === 'EVALUATED') {
      console.log(`[SKIP] ${spec.id} already benchmarked cleanly.`);
      modelResults.push(prev);
      continue;
    }

    console.log(`\n========================================================================`);
    console.log(`BENCHMARKING MODEL: ${spec.provider}:${spec.model}`);
    console.log(`========================================================================`);

    const groqAdapter = new GroqProviderAdapter({ model: spec.provider === 'groq' ? spec.model : 'openai/gpt-oss-20b' });
    const geminiAdapter = new GeminiProviderAdapter({ model: spec.provider === 'gemini' ? spec.model : 'gemini-3.5-flash-lite' });
    const gateway = new FreeLLMGateway({
      mode: spec.provider,
      freeOnlyMode: true,
      groqAdapter,
      geminiAdapter,
    });

    const agents: Record<CoSoMa, any> = {
      'jacayl-ha-dong': new HadongAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true }),
      'jacayl-tran-khat-chan': new TranKhatChanAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true }),
      'j-village': new JVillageAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true }),
    };

    const transcripts: any[] = [];
    let blockedTurns = 0;

    for (const sc of REPRESENTATIVE_CONVERSATIONS) {
      const sessionId = `bench-${spec.id}-${sc.id}-${Date.now()}`;
      for (let t = 0; t < sc.turns.length; t++) {
        const turnSpec = sc.turns[t];
        const t0 = performance.now();
        let attempt = 0;
        while (true) {
          attempt++;
          try {
            const res = await agents[sc.facility].processTurn(sessionId, turnSpec.message, {
              referenceClock: REF_CLOCK,
              strictLiveOnly: true,
            });
            const latencyMs = Math.round(performance.now() - t0);
            const tel = res.decision_trace.llmTelemetry;
            const obs = (res.decision_trace.decisionSteps || [])
              .filter((ds: any) => ds.phase === 'OBSERVE')
              .map((ds: any) => ds.thoughtSummary);

            const rec = {
              scenario_id: sc.id,
              facility: sc.facility,
              turn_index: t + 1,
              user_message: turnSpec.message,
              checks: turnSpec.checks,
              verification_status: res.decision_trace.verificationStatus,
              provider_model: res.decision_trace.providerModel,
              tools_executed: res.internal_trace.tools_executed,
              observations: obs,
              customer_visible_response: res.customer_visible_response,
              rejected_claims: res.claim_validation?.rejected_claims || [],
              latency_ms: latencyMs,
              call_count: tel?.callCount ?? 0,
              prompt_tokens: tel?.promptTokens ?? 0,
              completion_tokens: tel?.completionTokens ?? 0,
              total_tokens: tel?.totalTokens ?? 0,
              protocol_metrics: tel?.protocolMetrics ?? { schemaRejections: 0, formatRepairs: 0, providerFailovers: 0 },
            };
            transcripts.push(rec);
            console.log(`  [${sc.id} T${t + 1}] ${rec.verification_status} ${latencyMs}ms tools=[${rec.tools_executed.join(',')}] tok=${rec.total_tokens}`);

            const waitMs = spec.provider === 'groq'
              ? Math.max(18000, Math.ceil(((rec.total_tokens || 3500) / 110) * 1000))
              : 3500;
            await new Promise((r) => setTimeout(r, waitMs));
            break;
          } catch (err: any) {
            const msg = String(err.message || '');
            const m = msg.match(/(?:429|rate_limited)\((\d+)s\)/);
            const waitSec = m ? parseInt(m[1], 10) : 0;
            if (attempt === 1 && waitSec > 0 && waitSec <= 120) {
              console.log(`  [${sc.id} T${t + 1}] Rate-limit wait ${waitSec + 3}s before retry...`);
              await new Promise((r) => setTimeout(r, (waitSec + 3) * 1000));
              continue;
            }
            blockedTurns += 1;
            transcripts.push({
              scenario_id: sc.id,
              facility: sc.facility,
              turn_index: t + 1,
              user_message: turnSpec.message,
              checks: turnSpec.checks,
              verification_status: 'BLOCKED',
              error: msg,
              latency_ms: Math.round(performance.now() - t0),
            });
            console.log(`  [${sc.id} T${t + 1}] BLOCKED: ${msg}`);
            break;
          }
        }
        if (blockedTurns > 0 && transcripts[transcripts.length - 1]?.verification_status === 'BLOCKED') {
          break;
        }
      }
    }

    const validTurns = transcripts.filter((t) => t.verification_status !== 'BLOCKED');
    const totalCalls = validTurns.reduce((a, t) => a + (t.call_count || 0), 0);
    const totalSchemaRejects = validTurns.reduce((a, t) => a + (t.protocol_metrics?.schemaRejections || 0), 0);
    const totalRepairs = validTurns.reduce((a, t) => a + (t.protocol_metrics?.formatRepairs || 0), 0);
    const totalTokens = validTurns.reduce((a, t) => a + (t.total_tokens || 0), 0);
    const avgLatencyMs = Math.round(validTurns.reduce((a, t) => a + (t.latency_ms || 0), 0) / Math.max(1, validTurns.length));

    const reliability = gateway.getReliabilityMetrics()[spec.provider];
    const judgePref: 'groq' | 'gemini' = spec.provider === 'groq' ? 'gemini' : 'groq';
    const aiJudge = validTurns.length > 0
      ? await scoreTurnSetWithJudge(judgeGateway, spec, validTurns, judgePref)
      : { status: 'SKIPPED_ALL_BLOCKED', scores: null };

    const entry = {
      id: spec.id,
      provider: spec.provider,
      model: spec.model,
      total_turns: transcripts.length,
      completed_turns: validTurns.length,
      blocked_turns: blockedTurns,
      dimensions_13: {
        json_schema_compliance_rate: totalCalls > 0 ? Number(((totalCalls - totalSchemaRejects) / totalCalls).toFixed(4)) : null,
        goal_understanding: aiJudge.scores?.goal_understanding ?? null,
        multi_turn_context_tracking: aiJudge.scores?.context_tracking ?? null,
        constraint_change_negation_handling: aiJudge.scores?.constraint_change_handling ?? null,
        epistemic_separation: aiJudge.scores?.epistemic_separation ?? null,
        hallucination_prevention: aiJudge.scores?.hallucination_prevention ?? null,
        business_policy_pricing_accuracy: aiJudge.scores?.business_accuracy ?? null,
        response_groundedness: aiJudge.scores?.response_groundedness ?? null,
        vietnamese_naturalness: aiJudge.scores?.vietnamese_naturalness ?? null,
        avg_latency_ms: avgLatencyMs,
        avg_tokens_per_turn: Math.round(totalTokens / Math.max(1, validTurns.length)),
        format_repair_rate: totalCalls > 0 ? Number((totalRepairs / totalCalls).toFixed(4)) : null,
        rate_limit_error_failover_rate:
          reliability.calls > 0
            ? Number(((reliability.http429 + reliability.http503 + reliability.otherErrors) / reliability.calls).toFixed(4))
            : null,
      },
      gateway_reliability: reliability,
      ai_judge: aiJudge,
      transcripts,
    };

    modelResults.push(entry);

    // Progressive save
    const ordered = MODELS_TO_BENCHMARK.map((s) => modelResults.find((m) => m.id === s.id) ?? existingById.get(s.id)).filter(Boolean);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          benchmarked_at: new Date().toISOString(),
          free_only_mode: true,
          scenarios_count: REPRESENTATIVE_CONVERSATIONS.length,
          turns_per_model: REPRESENTATIVE_CONVERSATIONS.reduce((a, s) => a + s.turns.length, 0),
          models: ordered,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  console.log(`\nDONE: Saved Model Quality Benchmark -> ${outPath}`);
}

main().catch((err) => {
  console.error('Benchmark fatal error:', err);
  process.exit(1);
});
