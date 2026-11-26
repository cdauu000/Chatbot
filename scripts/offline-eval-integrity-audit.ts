import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { AutonomousScenarioCatalogV22, SimulationScenario } from '../src/testing/lab/autonomous-customer-simulation-lab-v2-2.js';
import {
  buildStratifiedSamplingManifest,
  OfflineEvaluationIntegrityAuditorV3,
} from '../src/testing/lab/evaluation-integrity-v3.js';

function main() {
  const checkpointPath = path.resolve('artifacts', 'live-500-batches', 'live-500-checkpoint.json');
  const outDir = path.resolve('artifacts', 'eval-integrity');
  fs.mkdirSync(outDir, { recursive: true });

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const catalog = new AutonomousScenarioCatalogV22(2026);
  const all500 = catalog.generate500Scenarios();
  const catalogMap = new Map<string, SimulationScenario>(all500.map((s) => [s.id, s]));

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
  const records: any[] = checkpoint.records || [];

  const auditor = new OfflineEvaluationIntegrityAuditorV3(dataset);
  const auditResult = auditor.evaluateCheckpointRecords(records, catalogMap, '2026-11-28T14:00:00+07:00');

  // Stratified Sampling Manifest for next batch of 18 (6 HD, 6 TKC, 6 J Village) — NOT executed live
  const completedIds = new Set<string>(records.filter((r) => r.status === 'live_completed').map((r) => r.scenarioId));
  const manifest18 = buildStratifiedSamplingManifest(all500, completedIds, 18);

  const byProp: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  const bySplit: Record<string, number> = {};
  const byConvType: Record<string, number> = {};
  const byBatch: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const item of manifest18) {
    byProp[item.propertyId] = (byProp[item.propertyId] || 0) + 1;
    byCat[item.category] = (byCat[item.category] || 0) + 1;
    bySplit[item.split] = (bySplit[item.split] || 0) + 1;
    byConvType[item.conversationType] = (byConvType[item.conversationType] || 0) + 1;
    byBatch[item.batchGroup] = (byBatch[item.batchGroup] || 0) + 1;
    bySource[item.source] = (bySource[item.source] || 0) + 1;
  }

  const manifestBundle = {
    generated_at: new Date().toISOString(),
    execution_status: 'PLANNED_FOR_GATE3_3X6_LIVE_ACCEPTANCE',
    target_total: manifest18.length,
    distribution: {
      by_property: byProp,
      by_category: byCat,
      by_split: bySplit,
      by_conversation_type: byConvType,
      by_batch: byBatch,
      by_source: bySource,
    },
    scenarios: manifest18,
  };

  fs.writeFileSync(path.join(outDir, 'offline-reevaluation-54.json'), JSON.stringify(auditResult, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(outDir, 'false-pass-register.json'),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_false_pass: auditResult.falsePassRegister.length,
        cases: auditResult.falsePassRegister,
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(outDir, 'human-review-queue.json'),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_queued: auditResult.humanReviewQueue.length,
        items: auditResult.humanReviewQueue,
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(outDir, 'stratified-sampling-manifest-18.json'),
    JSON.stringify(manifestBundle, null, 2),
    'utf-8'
  );

  console.log('=== OFFLINE 8-AXIS RE-EVALUATION SUMMARY (54 CHECKPOINT) ===');
  console.log(JSON.stringify(auditResult.summary, null, 2));
  console.log('\n=== FALSE-PASS SCENARIOS DETECTED (54 CHECKPOINT) ===');
  console.log(auditResult.falsePassRegister.map((c) => `${c.scenarioId} (${c.gitCommit}): ${c.findings.join(' | ')}`).join('\n'));

  // Re-audit Gate 2 (gate2-critical-replay.json) read-only without mutating historical artifact
  const gate2Path = path.resolve(outDir, 'gate2-critical-replay.json');
  if (fs.existsSync(gate2Path)) {
    const g2 = JSON.parse(fs.readFileSync(gate2Path, 'utf-8'));
    const normalizedG2 = (g2.cases || []).map((c: any) => ({
      scenarioId: c.caseId,
      propertyId: c.propertyId,
      category: 'critical_replay',
      split: 'owner_regression_gate2',
      gitCommit: g2.gitCommit || 'pre-d5b5bdb',
      effectivePolicyVersion: g2.effectivePolicyVersion || '1.4.6',
      status: c.status === 'LIVE_COMPLETED' ? 'live_completed' : 'live_blocked',
      businessPassed: (c.turns || []).every((t: any) => !t.groundingBlocked && (t.rejectedClaims || []).length === 0),
      turns: c.turns || [],
    }));
    const g2Audit = auditor.evaluateCheckpointRecords(normalizedG2, catalogMap, '2026-11-28T14:00:00+07:00');
    const g2AllTurns = normalizedG2.flatMap((r: any) => r.turns || []);
    const g2LiveTurns = g2AllTurns.filter((t: any) => t.verificationStatus !== 'BLOCKED');
    const g2Reconciliation = {
      audited_at: new Date().toISOString(),
      source_artifact: 'artifacts/eval-integrity/gate2-critical-replay.json',
      source_git_commit: g2.gitCommit,
      historical_summary: g2.summary,
      turn_metric_reconciliation: {
        total_turns: g2AllTurns.length,
        blocked_turns: g2AllTurns.filter((t: any) => t.verificationStatus === 'BLOCKED').length,
        evaluated_live_turns: g2LiveTurns.length,
        first_attempt_clean_turns: g2LiveTurns.filter((t: any) => t.firstAttemptClean).length,
        repaired_turns_accepted: g2LiveTurns.filter((t: any) => (t.groundingGateRepairs || 0) > 0 && !t.groundingBlocked).length,
        grounding_repairs_total_attempts: g2LiveTurns.reduce((a: number, t: any) => a + (t.groundingGateRepairs || 0), 0),
        grounding_blocks: g2LiveTurns.filter((t: any) => t.groundingBlocked).length,
      },
      post_audit_8axis_summary: g2Audit.summary,
      reclassified_or_flagged_cases: g2Audit.evaluatedRecords
        .filter((r) => r.terminal_outcome !== 'CONFIRMED_PASS')
        .map((r) => ({
          scenarioId: r.scenarioId,
          propertyId: r.propertyId,
          historicalPassedFlag: r.historicalPassedFlag,
          terminal_outcome: r.terminal_outcome,
          isFalsePass: r.isFalsePass,
          findings: r.findings,
        })),
      evaluatedRecords: g2Audit.evaluatedRecords,
    };
    fs.writeFileSync(
      path.join(outDir, 'gate2-post-audit-reconciliation.json'),
      JSON.stringify(g2Reconciliation, null, 2),
      'utf-8'
    );
    console.log('\n=== GATE 2 POST-AUDIT RECONCILIATION ===');
    console.log(JSON.stringify(g2Reconciliation.turn_metric_reconciliation, null, 2));
    console.log(JSON.stringify(g2Reconciliation.reclassified_or_flagged_cases, null, 2));
  }

  // Re-audit Gate 3 (gate3-stratified-results.json) read-only without mutating historical artifact
  const gate3Path = path.resolve(outDir, 'gate3-stratified-results.json');
  if (fs.existsSync(gate3Path)) {
    const g3 = JSON.parse(fs.readFileSync(gate3Path, 'utf-8'));
    const g3Recs: any[] = g3.records || [];
    const g3Audit = auditor.evaluateCheckpointRecords(g3Recs, catalogMap, '2026-11-28T14:00:00+07:00');
    const g3AllTurns = g3Recs.flatMap((r: any) => r.turns || []);
    const g3LiveTurns = g3AllTurns.filter((t: any) => t.verificationStatus !== 'BLOCKED');
    const g3Reconciliation = {
      audited_at: new Date().toISOString(),
      source_artifact: 'artifacts/eval-integrity/gate3-stratified-results.json',
      source_git_commit: g3.gitCommit,
      denominator_breakdown: {
        total_gate3_scenarios: g3Recs.length,
        from_immutable_500_catalog: g3Recs.filter((r) => r.source === 'immutable_500_catalog').length,
        supplementary_outside_500: g3Recs
          .filter((r) => r.source !== 'immutable_500_catalog')
          .map((r) => r.scenarioId),
      },
      historical_summary: g3.summary,
      turn_metric_reconciliation: {
        total_turns: g3AllTurns.length,
        blocked_turns: g3AllTurns.filter((t: any) => t.verificationStatus === 'BLOCKED').length,
        evaluated_live_turns: g3LiveTurns.length,
        first_attempt_clean_turns: g3LiveTurns.filter((t: any) => t.firstAttemptClean).length,
        repaired_turns_accepted: g3LiveTurns.filter((t: any) => (t.groundingGateRepairs || 0) > 0 && !t.groundingBlocked).length,
        grounding_repairs_total_attempts: g3LiveTurns.reduce((a: number, t: any) => a + (t.groundingGateRepairs || 0), 0),
        grounding_blocks: g3LiveTurns.filter((t: any) => t.groundingBlocked).length,
      },
      post_audit_8axis_summary: g3Audit.summary,
      reclassified_or_flagged_cases: g3Audit.evaluatedRecords
        .filter((r) => r.terminal_outcome !== 'CONFIRMED_PASS')
        .map((r) => ({
          scenarioId: r.scenarioId,
          propertyId: r.propertyId,
          source: g3Recs.find((x) => x.scenarioId === r.scenarioId)?.source,
          historicalPassedFlag: r.historicalPassedFlag,
          terminal_outcome: r.terminal_outcome,
          isFalsePass: r.isFalsePass,
          findings: r.findings,
        })),
      evaluatedRecords: g3Audit.evaluatedRecords,
    };
    fs.writeFileSync(
      path.join(outDir, 'gate3-post-audit-reconciliation.json'),
      JSON.stringify(g3Reconciliation, null, 2),
      'utf-8'
    );
    console.log('\n=== GATE 3 POST-AUDIT RECONCILIATION ===');
    console.log(JSON.stringify(g3Reconciliation.turn_metric_reconciliation, null, 2));
    console.log(JSON.stringify(g3Reconciliation.post_audit_8axis_summary.by_terminal_outcome, null, 2));
    console.log(JSON.stringify(g3Reconciliation.reclassified_or_flagged_cases, null, 2));
  }

  console.log('\n=== STRATIFIED SAMPLING MANIFEST (18, NOT RUN) ===');
  console.log(JSON.stringify(manifestBundle.distribution, null, 2));
}

main();
