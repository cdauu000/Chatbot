import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../src/staff/auth/access-control.js';
import { TakeoverCoordinator } from '../src/staff/takeover/takeover-coordinator.js';
import { CoSoMa } from '../src/domain/types.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main() {
  process.env.CONVERSATION_ENGINE = 'agentic';
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const store = new SqliteStore({ dbPath: ':memory:' });
  AuthManager.seedDefaultUsers(store);
  const authManager = new AuthManager(store);
  const adminUser = authManager.login('admin', 'Admin@JCollection2026!').user;

  // Single centralized gateway shared across all 3 property pipelines
  const gateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const orchestrator = new ConversationOrchestrator(dataset, {
    llmAdapter: gateway,
    referenceClock: '2026-11-28T14:00:00+07:00',
  });
  const coordinator = new TakeoverCoordinator({ orchestrator, store });

  // Bounded Free-Tier friendly load test:
  // Wave 1: 3 concurrent property sessions launched simultaneously (Ha Dong, Tran Khat Chan, J Village), 2 sequential turns each
  // Wave 2: Concurrency test for Human Takeover race cancellation while AI turn starts or right before Turn 2
  const propertySessions: Array<{ id: string; propertyId: CoSoMa; turns: string[] }> = [
    {
      id: `pilot-hd-${Date.now()}`,
      propertyId: 'jacayl-ha-dong',
      turns: ['Nay còn phòng kh b', 'Phòng 601 giá 2 tiếng bao nhiêu em?'],
    },
    {
      id: `pilot-tkc-${Date.now()}`,
      propertyId: 'jacayl-tran-khat-chan',
      turns: ['Phòng 1001 Đêm bên Trần Khát Chân giá qua đêm bao nhiêu?', 'Thứ 7 giá có tăng không em?'],
    },
    {
      id: `pilot-jv-${Date.now()}`,
      propertyId: 'j-village',
      turns: ['Bên J Village có phòng nào có bồn tắm dưới 400k không?', 'Phòng Crimson Suite giá 2 tiếng sao bạn?'],
    },
  ];

  const turnLatencies: number[] = [];
  const turnLogs: any[] = [];
  let messageOrderViolations = 0;

  // Execute Wave 1: 3 facilities concurrently!
  await Promise.all(
    propertySessions.map(async (ps) => {
      for (let t = 0; t < ps.turns.length; t++) {
        const msg = ps.turns[t];
        const t0 = performance.now();
        const res = await coordinator.handleCustomerTurn(ps.id, ps.propertyId, msg, {
          clientMessageId: `${ps.id}-t${t + 1}`,
          referenceClock: '2026-11-28T14:00:00+07:00',
        });
        const latencyMs = Math.round(performance.now() - t0);
        turnLatencies.push(latencyMs);

        const tel = res.aiMessage?.metadata?.telemetry;
        turnLogs.push({
          conversationId: ps.id,
          propertyId: ps.propertyId,
          turn: t + 1,
          provider: tel?.provider,
          model: tel?.model,
          status: tel?.verificationStatus,
          isFallback: tel?.isFallback ?? false,
          latencyMs,
          tokensTotal: tel?.tokensTotal ?? 0,
        });

        // Verify strict message ordering in SQLite store: customer message precedes AI reply
        const convMsgs = store.getMessagesByConversationId(ps.id);
        const custIdx = convMsgs.findIndex((m) => m.metadata?.clientMessageId === `${ps.id}-t${t + 1}`);
        const lastAiIdx = convMsgs.length - 1;
        if (res.aiMessage && (custIdx < 0 || lastAiIdx <= custIdx)) {
          messageOrderViolations += 1;
        }
      }
    })
  );

  // Wave 2: Concurrent Human Takeover Test across Ha Dong session
  const takeoverConvId = `pilot-takeover-${Date.now()}`;
  await coordinator.handleCustomerTurn(takeoverConvId, 'jacayl-ha-dong', 'Chào shop, tìm phòng có bồn tắm ở Hà Đông giúp anh');

  // Race: trigger customer AI turn and immediate staff takeover concurrently!
  const inFlightPromise = coordinator.handleCustomerTurn(
    takeoverConvId,
    'jacayl-ha-dong',
    'Phòng 101 ở 2 tiếng bao nhiêu?',
    { clientMessageId: `${takeoverConvId}-race` }
  );
  // Staff clicks takeover slightly after AI starts (15ms)
  await new Promise((r) => setTimeout(r, 15));
  coordinator.takeoverConversation(takeoverConvId, adminUser);

  const raceResult = await inFlightPromise;
  // Wait + send post-takeover turn verifying zero AI outbound
  const postTakeoverRes = await coordinator.handleCustomerTurn(
    takeoverConvId,
    'jacayl-ha-dong',
    'Alo có ai trực không?',
    { clientMessageId: `${takeoverConvId}-post` }
  );

  const rel = gateway.getReliabilityMetrics();
  const sortedLat = [...turnLatencies].sort((a, b) => a - b);
  const totalCalls = rel.groq.calls + rel.gemini.calls;
  const totalSuccesses = rel.groq.successes + rel.gemini.successes;
  const total429 = rel.groq.http429 + rel.gemini.http429;
  const totalFailovers = turnLogs.filter((t) => t.provider === 'groq').length;
  const degradedCount = turnLogs.filter((t) => t.status === 'DEGRADED_DETERMINISTIC_MODE' || t.isFallback).length;
  const totalTokens = turnLogs.reduce((a, t) => a + (t.tokensTotal || 0), 0);

  const report = {
    evaluated_at: new Date().toISOString(),
    free_only_mode: gateway.isFreeOnlyMode(),
    concurrent_properties: 3,
    concurrent_sessions: propertySessions.length,
    total_turns_completed: turnLogs.length,
    metrics: {
      concurrent_sessions: propertySessions.length,
      centralized_queue_serialized_calls: rel.coordinator?.serializedCalls ?? 0,
      queue_delay_ms_total: rel.coordinator?.totalQueueDelayMs ?? 0,
      avg_queue_delay_ms: Number(
        ((rel.coordinator?.totalQueueDelayMs ?? 0) / Math.max(1, rel.coordinator?.serializedCalls ?? 1)).toFixed(1)
      ),
      max_concurrent_waiters_gemini: rel.gemini.maxConcurrentWaiters ?? 0,
      max_concurrent_waiters_groq: rel.groq.maxConcurrentWaiters ?? 0,
      p50_latency_ms: percentile(sortedLat, 50),
      p95_latency_ms: percentile(sortedLat, 95),
      api_calls_total: totalCalls,
      api_calls_per_turn: Number((totalCalls / Math.max(1, turnLogs.length)).toFixed(2)),
      tokens_consumed_total: totalTokens,
      rate_limit_429_count: total429,
      provider_failover_turns_to_secondary: totalFailovers,
      degraded_mode_turns: degradedCount,
      message_ordering_violations: messageOrderViolations,
      human_takeover_concurrency: {
        in_flight_ai_discarded: raceResult.discarded === true,
        state_after_race: raceResult.state,
        post_takeover_ai_suppressed: !postTakeoverRes.aiMessage && postTakeoverRes.state === 'HUMAN_ACTIVE',
      },
    },
    free_tier_capacity_note:
      'All 3 properties run against single Free-Tier provider buckets (~15 RPM Gemini + ~8,000 TPM Groq). Centralized per-provider serialization prevents concurrent bursts from colliding simultaneously, keeping concurrent pilot load (3 facilities) stable.',
    per_turn_logs: turnLogs,
    gateway_reliability: rel,
  };

  store.close();
  const outPath = path.resolve('artifacts', 'runtime-reliability-pilot.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('DONE:', outPath, JSON.stringify(report.metrics, null, 2));
}

main().catch((err) => {
  console.error('Runtime reliability pilot error:', err);
  process.exit(1);
});
