import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import {
  AutonomousScenarioCatalogV22,
  DeterministicBusinessEvaluatorV22,
  SimulationScenario,
} from '../src/testing/lab/autonomous-customer-simulation-lab-v2-2.js';

type ExecutionSourceTag = 'live' | 'blocked' | 'mock' | 'degraded' | 'deterministic_offline';

async function runAdaptiveEvaluationV3() {
  const args = process.argv.slice(2);
  const liveCountArg = args.find((a) => a.startsWith('--live-count='));
  const liveCount = liveCountArg ? parseInt(liveCountArg.slice('--live-count='.length), 10) : 24;
  const isResume = args.includes('--resume');

  const outDir = path.resolve('artifacts', 'autonomous-evaluation-v3');
  fs.mkdirSync(outDir, { recursive: true });
  const checkpointPath = path.join(outDir, 'evaluation-results.json');
  const tracesPath = path.join(outDir, 'conversation-traces.jsonl');
  const reportPath = path.join(outDir, 'summary-report.json');

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const catalog = new AutonomousScenarioCatalogV22(2026);
  const businessEval = new DeterministicBusinessEvaluatorV22(dataset);
  const scenarios500 = catalog.generate500Scenarios();

  // Select a stratified balanced set across 3 properties & all categories for Live LLM run
  const liveSelectedIds = new Set<string>();
  const byProp: Record<string, SimulationScenario[]> = {
    'jacayl-ha-dong': [],
    'jacayl-tran-khat-chan': [],
    'j-village': [],
  };
  for (const s of scenarios500) {
    if (byProp[s.propertyId]) byProp[s.propertyId].push(s);
  }
  const perPropQuota = Math.ceil(liveCount / 3);
  for (const prop of Object.keys(byProp)) {
    // Prefer multi-turn and held-out diverse categories
    const sorted = [...byProp[prop]].sort((a, b) => (b.turnSpecs.length - a.turnSpecs.length) || (a.split === 'held_out' ? -1 : 1));
    for (const s of sorted.slice(0, perPropQuota)) {
      if (liveSelectedIds.size < liveCount) liveSelectedIds.add(s.id);
    }
  }

  const prevById = new Map<string, any>();
  if (isResume && fs.existsSync(checkpointPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      for (const r of prev.records || []) prevById.set(r.scenarioId, r);
    } catch {
      // ignore
    }
  }

  const liveGateway = new FreeLLMGateway({
    mode: 'auto',
    freeOnlyMode: true,
    groqAdapter: new GroqProviderAdapter({ model: 'qwen/qwen3.8-27b' }),
  });
  const liveOrchestrator = new ConversationOrchestrator(dataset, {
    llmAdapter: liveGateway,
    referenceClock: '2026-11-28T14:00:00+07:00',
  });
  const offlineOrchestrator = new ConversationOrchestrator(dataset, {
    referenceClock: '2026-11-28T14:00:00+07:00',
  });

  const records: any[] = [];
  const fixedClock = '2026-11-28T14:00:00+07:00';

  const flush = () => {
    const mergedRecords = scenarios500
      .map((s) => records.find((r) => r.scenarioId === s.id) ?? prevById.get(s.id))
      .filter(Boolean);
    const counts: Record<ExecutionSourceTag, number> = {
      live: 0,
      blocked: 0,
      mock: 0,
      degraded: 0,
      deterministic_offline: 0,
    };
    for (const r of mergedRecords) {
      counts[r.executionSource as ExecutionSourceTag] = (counts[r.executionSource as ExecutionSourceTag] || 0) + 1;
    }

    const liveCompleted = mergedRecords.filter((r) => r.executionSource === 'live');
    const livePassed = liveCompleted.filter((r) => r.businessPassed && r.rejectedClaimsTotal === 0).length;
    const offlineCompleted = mergedRecords.filter((r) => r.executionSource === 'deterministic_offline');
    const offlinePassed = offlineCompleted.filter((r) => r.businessPassed && r.rejectedClaimsTotal === 0).length;

    const summary = {
      evaluated_at: new Date().toISOString(),
      total_scenarios: mergedRecords.length,
      target_catalog_size: scenarios500.length,
      execution_source_breakdown: counts,
      free_tier_quota_note: `500 scenarios x ~1.5 turns x ~2 calls ≈ 1,500+ LLM calls exceeds single-key free-tier daily/minute envelope (Groq 8k TPM / 1k RPD); ${liveSelectedIds.size} stratified scenarios targeted via Live LLM, remaining executed cleanly via labeled DETERMINISTIC_OFFLINE engine.`,
      live_subset: {
        total: liveCompleted.length + counts.blocked,
        completed_live: liveCompleted.length,
        blocked: counts.blocked,
        business_passed: livePassed,
      },
      deterministic_offline_subset: {
        total: offlineCompleted.length,
        business_passed: offlinePassed,
      },
      gateway_reliability: liveGateway.getReliabilityMetrics(),
    };

    fs.writeFileSync(checkpointPath, JSON.stringify({ summary, records: mergedRecords }, null, 2), 'utf-8');
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf-8');
    fs.writeFileSync(tracesPath, mergedRecords.flatMap((r) => r.turns || []).map((t) => JSON.stringify(t)).join('\n'), 'utf-8');
  };

  console.log(`========================================================================`);
  console.log(`AUTONOMOUS EVALUATION V3.0 FINAL (500 SCENARIOS, LIVE SUBSET=${liveSelectedIds.size})`);
  console.log(`========================================================================\n`);

  for (let i = 0; i < scenarios500.length; i++) {
    const sc = scenarios500[i];
    const isLiveTarget = liveSelectedIds.has(sc.id);
    const prev = prevById.get(sc.id);

    if (isResume && prev && (!isLiveTarget || prev.executionSource === 'live')) {
      records.push(prev);
      continue;
    }

    const sessionId = `autov3-${sc.id.toLowerCase()}-${Date.now()}-${i}`;
    const turnRecords: any[] = [];
    let executionSource: ExecutionSourceTag = isLiveTarget ? 'live' : 'deterministic_offline';
    let blockedReason: string | undefined;

    for (let t = 0; t < sc.turnSpecs.length; t++) {
      // Adaptive follow-up: if Turn > 1 and prior response asked/focused a room, allow natural continuity
      const userMsg = sc.turnSpecs[t].userMessage;
      const t0 = performance.now();

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = isLiveTarget
            ? await liveOrchestrator.getAgent(sc.propertyId)!.processTurn(sessionId, userMsg, {
                referenceClock: fixedClock,
                strictLiveOnly: true,
              })
            : await offlineOrchestrator.getAgent(sc.propertyId)!.processTurn(sessionId, userMsg, {
                referenceClock: fixedClock,
                strictLiveOnly: false,
              });

          const vStatus = res.decision_trace?.verificationStatus;
          if (isLiveTarget && vStatus === 'DEGRADED_DETERMINISTIC_MODE') {
            executionSource = 'degraded';
          } else if (isLiveTarget && String(res.decision_trace?.providerModel || '').includes('mock')) {
            executionSource = 'mock';
          }

          const tel = res.decision_trace?.llmTelemetry;
          turnRecords.push({
            scenarioId: sc.id,
            turnIndex: t + 1,
            userMessage: userMsg,
            deliveredResponse: res.customer_visible_response,
            deliveredMedia: res.images || [],
            toolsExecuted: res.internal_trace?.tools_executed || [],
            providerModel: res.decision_trace?.providerModel || 'offline',
            verificationStatus: vStatus || 'DETERMINISTIC_AGENT_FLOW',
            rejectedClaims: res.claim_validation?.rejected_claims || [],
            latencyMs: Math.round(performance.now() - t0),
            promptTokens: tel?.promptTokens ?? 0,
            completionTokens: tel?.completionTokens ?? 0,
          });

          if (isLiveTarget && vStatus === 'LIVE_LLM_DECISION_VERIFIED') {
            const waitMs = tel?.provider === 'groq' ? 12000 : 8500;
            await new Promise((r) => setTimeout(r, waitMs));
          }
          break;
        } catch (err: any) {
          const msg = String(err.message || '');
          const gm = msg.match(/gemini:(?:429|rate_limited)\((\d+)s\)/);
          const gSec = gm ? parseInt(gm[1], 10) : 0;
          if (attempt === 1 && isLiveTarget && gSec > 0 && gSec <= 65) {
            await new Promise((r) => setTimeout(r, (gSec + 3) * 1000));
            continue;
          }
          executionSource = 'blocked';
          blockedReason = msg;
          turnRecords.push({
            scenarioId: sc.id,
            turnIndex: t + 1,
            userMessage: userMsg,
            verificationStatus: 'BLOCKED',
            blockedReason,
            deliveredResponse: '',
            deliveredMedia: [],
            toolsExecuted: [],
            rejectedClaims: [],
            latencyMs: Math.round(performance.now() - t0),
          });
          break;
        }
      }
      if (executionSource === 'blocked') break;
    }

    const rejectedClaimsTotal = turnRecords.reduce((acc, t) => acc + (t.rejectedClaims?.length || 0), 0);
    const biz = executionSource !== 'blocked'
      ? businessEval.evaluateInvariants(sc, turnRecords as any)
      : { passed: false, violations: ['BLOCKED'] };

    records.push({
      scenarioId: sc.id,
      propertyId: sc.propertyId,
      split: sc.split,
      category: sc.category,
      executionSource,
      blockedReason,
      businessPassed: biz.passed,
      businessViolations: biz.violations || [],
      rejectedClaimsTotal,
      turns: turnRecords,
    });

    if (isLiveTarget) {
      console.log(`[LIVE ${sc.id} (${sc.propertyId})] source=${executionSource} bizPass=${biz.passed} rejected=${rejectedClaimsTotal}`);
      flush();
    }
  }

  flush();
  console.log(`\nDONE: Saved 500-scenario V3 evaluation -> ${outDir}`);
}

runAdaptiveEvaluationV3().catch((err) => {
  console.error('Autonomous V3 fatal error:', err);
  process.exit(1);
});
