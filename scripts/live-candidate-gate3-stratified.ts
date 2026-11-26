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
  SimulationScenario,
} from '../src/testing/lab/autonomous-customer-simulation-lab-v2-2.js';
import {
  OfflineEvaluationIntegrityAuditorV3,
  StratifiedManifestItem,
} from '../src/testing/lab/evaluation-integrity-v3.js';

async function main() {
  const args = process.argv.slice(2);
  const batchArg = args.find((a) => a.startsWith('--batch='));
  const targetBatch = batchArg ? batchArg.slice('--batch='.length) : 'all';

  process.env.CONVERSATION_ENGINE = 'agentic';
  process.env.FREE_ONLY_MODE = 'true';

  const manifestPath = path.resolve('artifacts', 'eval-integrity', 'stratified-sampling-manifest-18.json');
  const outPath = path.resolve('artifacts', 'eval-integrity', 'gate3-stratified-results.json');
  const manifestBundle = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const allItems: StratifiedManifestItem[] = manifestBundle.scenarios || [];

  const targetItems = targetBatch === 'all' ? allItems : allItems.filter((s) => s.batchGroup === targetBatch);

  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    gitCommit = 'unknown';
  }
  const policyMeta = getEffectivePolicyMetadata();

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const catalog = new AutonomousScenarioCatalogV22(2026);
  const all500 = catalog.generate500Scenarios();
  const catalogMap = new Map<string, SimulationScenario>(all500.map((s) => [s.id, s]));
  const businessEval = new DeterministicBusinessEvaluatorV22(dataset);
  const auditor = new OfflineEvaluationIntegrityAuditorV3(dataset);

  // Merge prior completed records from gate3-stratified-results.json if running batch-by-batch
  const existingMap = new Map<string, any>();
  if (fs.existsSync(outPath)) {
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    for (const r of prev.records || []) {
      existingMap.set(r.scenarioId, r);
    }
  }

  const gateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const orchestrator = new ConversationOrchestrator(dataset, {
    llmAdapter: gateway,
    referenceClock: '2026-11-28T14:00:00+07:00',
  });

  console.log('========================================================================');
  console.log(`GATE 3 — STRATIFIED LIVE RUN | Batch=${targetBatch} (${targetItems.length} scenarios) | Policy V${policyMeta.effectivePolicyVersion} | Commit ${gitCommit}`);
  console.log('========================================================================');

  let consecutiveBlocks = 0;
  let stopReason: string | null = null;

  for (const item of targetItems) {
    const existing = existingMap.get(item.scenarioId);
    if (existing && existing.status === 'live_completed' && !args.includes('--force')) {
      console.log(`⏭️  Skipping already completed ${item.scenarioId}`);
      continue;
    }

    const sid = `gate3-${item.scenarioId.toLowerCase()}-${Date.now()}`;
    const agent = orchestrator.getAgent(item.propertyId)!;
    const turnRecords: any[] = [];
    let status: 'live_completed' | 'live_blocked' | 'live_failed' = 'live_completed';
    let blockedReason: string | undefined;

    console.log(`\n▶ ${item.scenarioId} [${item.batchGroup} | ${item.propertyId} | ${item.category} | ${item.split} | clock=${item.referenceClockLabel}]`);

    for (let t = 0; t < item.cleanTurnMessages.length; t++) {
      const msg = item.cleanTurnMessages[t];
      const t0 = performance.now();
      try {
        const res = await agent.processTurn(sid, msg, {
          referenceClock: item.assignedReferenceClock,
          strictLiveOnly: true,
        });
        const latencyMs = Math.round(performance.now() - t0);
        const tel = res.decision_trace?.llmTelemetry;
        const vStatus = res.decision_trace?.verificationStatus ?? 'UNKNOWN';
        const steps = res.decision_trace?.decisionSteps || [];
        const groundingGateRepairs = steps.filter((s) => s.phase === 'REVISE' && s.thoughtSummary.includes('GROUNDING_GATE')).length;
        const groundingBlocked = Boolean(tel?.fallbackState?.fallbackReason?.startsWith('GROUNDING_BLOCKED'));
        const firstAttemptClean = groundingGateRepairs === 0 && !groundingBlocked && (res.claim_validation?.rejected_claims?.length ?? 0) === 0;
        if (vStatus === 'DEGRADED_DETERMINISTIC_MODE') status = 'live_failed';

        turnRecords.push({
          scenarioId: item.scenarioId,
          propertyId: item.propertyId,
          turnIndex: t + 1,
          effectivePolicyVersion: policyMeta.effectivePolicyVersion,
          basePolicyVersion: policyMeta.basePolicyVersion,
          buildVersion: '3.0.0-llm-native-final',
          gitCommit,
          executedAt: new Date().toISOString(),
          userMessage: msg,
          referenceClockUsed: item.assignedReferenceClock,
          referenceClockLabel: item.referenceClockLabel,
          deliveredResponse: res.customer_visible_response,
          deliveredMedia: res.images || [],
          roomPresentationsCount: res.room_presentations?.length ?? 0,
          providerModel: res.decision_trace?.providerModel,
          isFallback: Boolean(tel?.fallbackState?.isFallback || (res.decision_trace?.providerModel && res.decision_trace.providerModel !== 'gemini:gemini-3.5-flash-lite')),
          verificationStatus: vStatus,
          groundingStatus: res.claim_validation?.grounding_status,
          rejectedClaims: res.claim_validation?.rejected_claims || [],
          firstAttemptClean,
          groundingGateRepairs,
          groundingBlocked,
          fallbackReason: tel?.fallbackState?.fallbackReason,
          hasThinkLeak: /<\/?think>/i.test(res.customer_visible_response || ''),
          toolsExecuted: res.internal_trace?.tools_executed || [],
          promptTokens: tel?.promptTokens ?? 0,
          completionTokens: tel?.completionTokens ?? 0,
          totalTokens: tel?.totalTokens ?? 0,
          latencyMs,
        });

        console.log(
          `  T${t + 1} [${res.decision_trace?.providerModel} | ${latencyMs}ms | tok=${tel?.totalTokens ?? 0} | tools=${res.internal_trace.tools_executed.join(',') || 'none'} | media=${res.images?.length ?? 0} | grounding=${res.claim_validation?.grounding_status} | firstClean=${firstAttemptClean}]`
        );
        await new Promise((r) => setTimeout(r, tel?.provider === 'groq' ? 11000 : 4500));
      } catch (err: any) {
        status = 'live_blocked';
        blockedReason = err.message;
        const latencyMs = Math.round(performance.now() - t0);
        turnRecords.push({
          scenarioId: item.scenarioId,
          propertyId: item.propertyId,
          turnIndex: t + 1,
          effectivePolicyVersion: policyMeta.effectivePolicyVersion,
          basePolicyVersion: policyMeta.basePolicyVersion,
          buildVersion: '3.0.0-llm-native-final',
          gitCommit,
          executedAt: new Date().toISOString(),
          userMessage: msg,
          referenceClockUsed: item.assignedReferenceClock,
          verificationStatus: 'BLOCKED',
          blockedReason,
          deliveredResponse: '',
          latencyMs,
        });
        console.log(`  T${t + 1} BLOCKED (${latencyMs}ms): ${err.message}`);
        break;
      }
    }

    if (status === 'live_blocked') {
      consecutiveBlocks += 1;
      existingMap.set(item.scenarioId, {
        scenarioId: item.scenarioId,
        propertyId: item.propertyId,
        split: item.split,
        category: item.category,
        batchGroup: item.batchGroup,
        source: item.source,
        status,
        blockedReason,
        effectivePolicyVersion: policyMeta.effectivePolicyVersion,
        gitCommit,
        businessPassed: false,
        turns: turnRecords,
      });
    } else {
      consecutiveBlocks = 0;
      const spec = catalogMap.get(item.scenarioId);
      const businessEvalRes = spec
        ? businessEval.evaluateInvariants(spec, turnRecords as any)
        : { passed: turnRecords.every((tr) => (tr.rejectedClaims || []).length === 0 && !tr.groundingBlocked), violations: [] };

      existingMap.set(item.scenarioId, {
        scenarioId: item.scenarioId,
        propertyId: item.propertyId,
        split: item.split,
        category: item.category,
        batchGroup: item.batchGroup,
        source: item.source,
        status,
        effectivePolicyVersion: policyMeta.effectivePolicyVersion,
        gitCommit,
        businessPassed: businessEvalRes.passed,
        findings: businessEvalRes.violations || [],
        turns: turnRecords,
      });
    }

    // Flush checkpoint after every scenario
    const allRecs = allItems.map((m) => existingMap.get(m.scenarioId)).filter(Boolean);
    const auditRes = auditor.evaluateCheckpointRecords(allRecs, catalogMap);
    const allTurns = allRecs.flatMap((r) => r.turns || []).filter((t: any) => t.verificationStatus !== 'BLOCKED');
    const lats = allTurns.map((t: any) => t.latencyMs).sort((a: number, b: number) => a - b);
    const p = (pct: number) => (lats.length ? lats[Math.min(lats.length - 1, Math.ceil((pct / 100) * lats.length) - 1)] : 0);

    const bundle = {
      updated_at: new Date().toISOString(),
      gitCommit,
      effectivePolicyVersion: policyMeta.effectivePolicyVersion,
      freeOnlyMode: true,
      strictLiveOnly: true,
      stop_reason: stopReason,
      manifest_target: allItems.length,
      summary: {
        executed_scenarios: allRecs.length,
        live_completed: allRecs.filter((r) => r.status === 'live_completed').length,
        live_blocked: allRecs.filter((r) => r.status === 'live_blocked').length,
        total_turns: allRecs.flatMap((r) => r.turns || []).length,
        live_verified_turns: allTurns.filter((t: any) => t.verificationStatus === 'LIVE_LLM_DECISION_VERIFIED').length,
        first_attempt_clean_turns: allTurns.filter((t: any) => t.firstAttemptClean).length,
        grounding_repairs: allTurns.reduce((a: number, t: any) => a + (t.groundingGateRepairs || 0), 0),
        repaired_turns: allTurns.filter((t: any) => (t.groundingGateRepairs || 0) > 0 && !t.groundingBlocked).length,
        grounding_blocks: allTurns.filter((t: any) => t.groundingBlocked).length,
        raw_think_leaks: allTurns.filter((t: any) => t.hasThinkLeak).length,
        failover_turns: allTurns.filter((t: any) => t.isFallback).length,
        total_tokens: allTurns.reduce((a: number, t: any) => a + (t.totalTokens || 0), 0),
        avg_tokens_per_turn: allTurns.length ? Math.round(allTurns.reduce((a: number, t: any) => a + (t.totalTokens || 0), 0) / allTurns.length) : 0,
        avg_latency_ms: lats.length ? Math.round(lats.reduce((a: number, b: number) => a + b, 0) / lats.length) : 0,
        p50_latency_ms: p(50),
        p95_latency_ms: p(95),
        audit_8axis_summary: auditRes.summary,
      },
      gateway_reliability: gateway.getReliabilityMetrics(),
      records: allRecs,
      audit_8axis_full: auditRes,
    };
    fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf-8');

    if (consecutiveBlocks >= 2) {
      stopReason = 'STOPPED_AFTER_2_CONSECUTIVE_API_BLOCKS';
      bundle.stop_reason = stopReason;
      fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf-8');
      console.error(`\n🛑 Stopping cleanly: ${stopReason}`);
      break;
    }
  }

  const finalOut = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  console.log('\n=== GATE 3 STRATIFIED SUMMARY ===');
  console.log(JSON.stringify(finalOut.summary, null, 2));
}

main().catch((err) => {
  console.error('Gate 3 Runner failed:', err);
  process.exit(1);
});
