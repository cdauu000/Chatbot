import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { getEffectivePolicyMetadata } from '../src/data-loader/pricing-policy-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import {
  AutonomousScenarioCatalogV22,
  DeterministicBusinessEvaluatorV22,
} from '../src/testing/lab/autonomous-customer-simulation-lab-v2-2.js';
import {
  buildStratifiedSamplingManifest,
  stripSyntheticScenarioIdSuffix,
} from '../src/testing/lab/evaluation-integrity-v3.js';

type LiveBatchStatus = 'live_completed' | 'live_blocked' | 'live_failed' | 'deterministic_offline';

async function main() {
  const args = process.argv.slice(2);
  const batchSizeArg = args.find((a) => a.startsWith('--batch='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.slice('--batch='.length), 10) : 15;
  const startIdArg = args.find((a) => a.startsWith('--start-index='));
  const startIndex = startIdArg ? parseInt(startIdArg.slice('--start-index='.length), 10) : 0;
  const strategyArg = args.find((a) => a.startsWith('--strategy='));
  const strategy = strategyArg ? strategyArg.slice('--strategy='.length) : 'sequential';
  const stripIdTags = args.includes('--strip-id-tags') || strategy === 'stratified';

  process.env.CONVERSATION_ENGINE = 'agentic';
  if (process.env.FREE_ONLY_MODE === 'false') {
    throw new Error('FREE_ONLY_MODE must stay enabled');
  }

  // Baseline read-only source: 500 scenarios & prior live-completed IDs (never overwritten)
  const baselinePath = path.resolve('artifacts', 'autonomous-evaluation-v3', 'evaluation-results.json');
  const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  const baselineLiveIds = new Set<string>(
    (baselineData.records || [])
      .filter((r: any) => r.executionSource === 'live')
      .map((r: any) => r.scenarioId)
  );

  // Separate checkpoint directory for ongoing Live batches (never overwrites baseline)
  const batchDir = path.resolve('artifacts', 'live-500-batches');
  fs.mkdirSync(batchDir, { recursive: true });
  const checkpointPath = path.join(batchDir, 'live-500-checkpoint.json');
  const tracesPath = path.join(batchDir, 'live-500-traces.jsonl');
  const summaryPath = path.join(batchDir, 'live-500-summary.json');

  const completedMap = new Map<string, any>();
  let priorRunHistory: any[] = [];
  if (fs.existsSync(checkpointPath)) {
    const prev = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    priorRunHistory = Array.isArray(prev.summary?.run_history) ? prev.summary.run_history : [];
    for (const r of prev.records || []) {
      completedMap.set(r.scenarioId, r);
    }
  } else {
    // Seed baseline live-completed records cleanly without modifying baseline files
    for (const r of baselineData.records || []) {
      if (r.executionSource === 'live') {
        completedMap.set(r.scenarioId, {
          ...r,
          status: 'live_completed' as LiveBatchStatus,
          batchTag: 'baseline_v3_0_12',
        });
      }
    }
  }

  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim() || 'unknown';
  } catch {
    gitCommit = 'unknown';
  }
  const policyMeta = getEffectivePolicyMetadata();
  const buildVersion = '3.0.0-llm-native-final';
  const startedAt = new Date().toISOString();
  const runId = `live500_${startedAt.replace(/[:.]/g, '-')}_${gitCommit}`;

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const catalog = new AutonomousScenarioCatalogV22(2026);
  const businessEval = new DeterministicBusinessEvaluatorV22(dataset);
  const all500 = catalog.generate500Scenarios();

  const gateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const orchestrator = new ConversationOrchestrator(dataset, {
    llmAdapter: gateway,
    referenceClock: '2026-11-28T14:00:00+07:00',
  });
  const fixedClock = '2026-11-28T14:00:00+07:00';

  // Pick uncompleted scenarios cleanly (supports sequential or stratified sampling without ID suffixes)
  const completedIds = new Set<string>(
    Array.from(completedMap.entries())
      .filter(([, rec]) => rec && rec.status === 'live_completed')
      .map(([id]) => id)
  );
  const scenarioClockMap = new Map<string, { clock: string; label: string }>();
  let candidates = all500
    .slice(startIndex)
    .filter((s) => !completedIds.has(s.id))
    .slice(0, batchSize);

  if (strategy === 'stratified') {
    const manifest = buildStratifiedSamplingManifest(all500, completedIds, batchSize);
    const byId = new Map(all500.map((s) => [s.id, s]));
    candidates = manifest.map((m) => {
      scenarioClockMap.set(m.scenarioId, {
        clock: m.assignedReferenceClock,
        label: m.referenceClockLabel,
      });
      return byId.get(m.scenarioId)!;
    });
  }

  const lockedConfig = {
    engine: 'agentic',
    architecture: 'V3.0-FINAL',
    build_version: buildVersion,
    git_commit: gitCommit,
    effective_policy_version: policyMeta.effectivePolicyVersion,
    base_policy_version: policyMeta.basePolicyVersion,
    provider_routing: 'Primary: gemini:gemini-3.5-flash-lite -> Secondary: groq:qwen/qwen3.8-27b -> Fallback: gemini:gemini-3.1-flash-lite',
    free_only_mode: true,
    strict_live_only: true,
    dataset_hash_scenarios: all500.length,
  };

  const batchRunRecords: any[] = [];
  const batchLatenciesMs: number[] = [];
  let batchFailoverTurns = 0;
  let batchDegradedTurns = 0;

  const percentile = (sorted: number[], p: number) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  };

  const flush = (stopReason: string | null) => {
    const allLiveRecords = all500.map((s) => completedMap.get(s.id)).filter(Boolean);
    const liveCompleted = allLiveRecords.filter((r) => r.status === 'live_completed').length;
    const liveBlocked = allLiveRecords.filter((r) => r.status === 'live_blocked').length;
    const liveFailed = allLiveRecords.filter((r) => r.status === 'live_failed').length;
    const offlineRemaining = all500.length - liveCompleted - liveBlocked - liveFailed;
    const sortedLat = [...batchLatenciesMs].sort((a, b) => a - b);
    const avgLatencyMs =
      sortedLat.length > 0 ? Math.round(sortedLat.reduce((a, b) => a + b, 0) / sortedLat.length) : 0;
    const rel = gateway.getReliabilityMetrics();

    const currentRunRecord = {
      run_id: runId,
      started_at: startedAt,
      updated_at: new Date().toISOString(),
      build_version: buildVersion,
      git_commit: gitCommit,
      effective_policy_version: policyMeta.effectivePolicyVersion,
      base_policy_version: policyMeta.basePolicyVersion,
      batch_target: candidates.length,
      batch_attempted: batchRunRecords.length,
      batch_completed: batchRunRecords.filter((r) => r.status === 'live_completed').length,
      batch_blocked: batchRunRecords.filter((r) => r.status === 'live_blocked').length,
      batch_failed: batchRunRecords.filter((r) => r.status === 'live_failed').length,
      avg_latency_ms: avgLatencyMs,
      p50_latency_ms: percentile(sortedLat, 50),
      p95_latency_ms: percentile(sortedLat, 95),
      failover_turns: batchFailoverTurns,
      degraded_mode_turns: batchDegradedTurns,
      gateway_reliability: rel,
      stop_reason: stopReason,
    };

    const updatedHistory = [
      ...priorRunHistory.filter((h) => h && h.run_id !== runId),
      currentRunRecord,
    ];

    const summary = {
      updated_at: currentRunRecord.updated_at,
      locked_config: lockedConfig,
      current_run: currentRunRecord,
      run_history: updatedHistory,
      stop_reason: stopReason,
      total_catalog: all500.length,
      counts: {
        live_completed: liveCompleted,
        live_blocked: liveBlocked,
        live_failed: liveFailed,
        deterministic_offline_unrun_in_live_batch: offlineRemaining,
      },
      live_completed_pass_business_invariants: allLiveRecords.filter(
        (r) => r.status === 'live_completed' && r.businessPassed
      ).length,
      gateway_reliability: rel,
    };

    fs.writeFileSync(checkpointPath, JSON.stringify({ summary, records: allLiveRecords }, null, 2), 'utf-8');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    fs.writeFileSync(
      tracesPath,
      allLiveRecords.flatMap((r) => r.turns || []).map((t) => JSON.stringify(t)).join('\n'),
      'utf-8'
    );
    return summary;
  };

  console.log(`========================================================================`);
  console.log(`LIVE 500 BATCH RUNNER (Baseline live=${baselineLiveIds.size}, Batch target=${candidates.length})`);
  console.log(`Policy: V${policyMeta.effectivePolicyVersion} (Base V${policyMeta.basePolicyVersion}) | Build: ${buildVersion} (${gitCommit})`);
  console.log(`Routing: ${lockedConfig.provider_routing}`);
  console.log(`========================================================================\n`);

  let stopReason: string | null = null;
  let consecutiveBlocks = 0;

  for (const sc of candidates) {
    const sid = `live500-${sc.id.toLowerCase()}-${Date.now()}`;
    const agent = orchestrator.getAgent(sc.propertyId)!;
    const turnRecords: any[] = [];
    let status: LiveBatchStatus = 'live_completed';
    let blockedReason: string | undefined;

    for (let t = 0; t < sc.turnSpecs.length; t++) {
      const rawMsg = sc.turnSpecs[t].userMessage;
      const msg = stripIdTags ? stripSyntheticScenarioIdSuffix(rawMsg) : rawMsg;
      const scenarioClock = scenarioClockMap.get(sc.id)?.clock || fixedClock;
      const t0 = performance.now();
      try {
        const res = await agent.processTurn(sid, msg, {
          referenceClock: scenarioClock,
          strictLiveOnly: true,
        });
        const vStatus = res.decision_trace?.verificationStatus;
        const tel = res.decision_trace?.llmTelemetry;
        const latencyMs = Math.round(performance.now() - t0);
        batchLatenciesMs.push(latencyMs);
        if (vStatus === 'DEGRADED_DETERMINISTIC_MODE') {
          status = 'live_failed';
          batchDegradedTurns += 1;
        }
        const providerModel = res.decision_trace?.providerModel;
        const isFailover = Boolean(
          tel?.isFallback ||
            (providerModel && providerModel !== 'gemini:gemini-3.5-flash-lite')
        );
        if (isFailover) {
          batchFailoverTurns += 1;
        }
        turnRecords.push({
          scenarioId: sc.id,
          propertyId: sc.propertyId,
          turnIndex: t + 1,
          effectivePolicyVersion: policyMeta.effectivePolicyVersion,
          basePolicyVersion: policyMeta.basePolicyVersion,
          buildVersion,
          gitCommit,
          executedAt: new Date().toISOString(),
          userMessage: msg,
          referenceClockUsed: scenarioClock,
          deliveredResponse: res.customer_visible_response,
          deliveredMedia: res.images || [],
          providerModel,
          isFallback: isFailover,
          verificationStatus: vStatus,
          groundingStatus: res.claim_validation?.grounding_status,
          toolsExecuted: res.internal_trace?.tools_executed || [],
          rejectedClaims: res.claim_validation?.rejected_claims || [],
          promptTokens: tel?.promptTokens ?? 0,
          completionTokens: tel?.completionTokens ?? 0,
          latencyMs,
        });
        // Respect Gemini 15 RPM / Groq 8k TPM smoothly
        await new Promise((r) => setTimeout(r, tel?.provider === 'groq' ? 11000 : 4500));
      } catch (err: any) {
        status = 'live_blocked';
        blockedReason = err.message;
        const latencyMs = Math.round(performance.now() - t0);
        batchLatenciesMs.push(latencyMs);
        turnRecords.push({
          scenarioId: sc.id,
          propertyId: sc.propertyId,
          turnIndex: t + 1,
          effectivePolicyVersion: policyMeta.effectivePolicyVersion,
          basePolicyVersion: policyMeta.basePolicyVersion,
          buildVersion,
          gitCommit,
          executedAt: new Date().toISOString(),
          userMessage: msg,
          verificationStatus: 'BLOCKED',
          blockedReason,
          deliveredResponse: '',
          latencyMs,
        });
        break;
      }
    }

    if (status === 'live_blocked') {
      consecutiveBlocks += 1;
      const blockedRec = {
        scenarioId: sc.id,
        propertyId: sc.propertyId,
        split: sc.split,
        category: sc.category,
        status,
        blockedReason,
        effectivePolicyVersion: policyMeta.effectivePolicyVersion,
        basePolicyVersion: policyMeta.basePolicyVersion,
        buildVersion,
        gitCommit,
        executedAt: new Date().toISOString(),
        businessPassed: false,
        rejectedClaimsTotal: 0,
        turns: turnRecords,
      };
      completedMap.set(sc.id, blockedRec);
      batchRunRecords.push(blockedRec);
      console.log(`[${sc.id} (${sc.propertyId})] -> BLOCKED: ${blockedReason}`);
      flush(null);
      if (consecutiveBlocks >= 2) {
        stopReason = `Stopped cleanly after ${consecutiveBlocks} consecutive FREE quota blocks: ${blockedReason}`;
        break;
      }
      continue;
    }

    consecutiveBlocks = 0;
    const biz = businessEval.evaluateInvariants(sc, turnRecords as any);
    const rejectedTotal = turnRecords.reduce((a, t) => a + (t.rejectedClaims?.length || 0), 0);
    if (!biz.passed || rejectedTotal > 0) status = 'live_failed';

    const doneRec = {
      scenarioId: sc.id,
      propertyId: sc.propertyId,
      split: sc.split,
      category: sc.category,
      status,
      effectivePolicyVersion: policyMeta.effectivePolicyVersion,
      basePolicyVersion: policyMeta.basePolicyVersion,
      buildVersion,
      gitCommit,
      executedAt: new Date().toISOString(),
      businessPassed: biz.passed,
      businessViolations: biz.violations || [],
      rejectedClaimsTotal: rejectedTotal,
      turns: turnRecords,
      batchTag: `v3_0_final_v${policyMeta.effectivePolicyVersion}_${gitCommit}`,
    };
    completedMap.set(sc.id, doneRec);
    batchRunRecords.push(doneRec);

    console.log(`[${sc.id} (${sc.propertyId})] -> ${status} (${turnRecords.map((t) => t.providerModel).join(', ')})`);
    flush(null);
  }

  const finalSummary = flush(stopReason);
  console.log('\nBATCH SUMMARY:', JSON.stringify(finalSummary, null, 2));
}

main().catch((err) => {
  console.error('Batch runner fatal error:', err);
  process.exit(1);
});
