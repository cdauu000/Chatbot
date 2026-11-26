import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { getEffectivePolicyMetadata } from '../src/data-loader/pricing-policy-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { FreeLLMGateway, GatewayRoutingMode } from '../src/conversation/adapters/free-llm-gateway.js';
import { JCollectionAgent } from '../src/agent/jcollection-agent.js';
import { CoSoMa } from '../src/domain/types.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';

interface Gate2Case {
  caseId: string;
  title: string;
  propertyId: CoSoMa;
  providerMode: GatewayRoutingMode;
  referenceClock: string;
  turns: string[];
}

const GATE2_CASES: Gate2Case[] = [
  {
    caseId: 'REPLAY-SCENARIO-033',
    title: 'Verbatim SCENARIO-033: Ha Dong 4h -> Overnight 22h (Prevent 450k/590k/750k hallucination)',
    propertyId: 'jacayl-ha-dong',
    providerMode: 'auto',
    referenceClock: '2026-11-28T14:00:00+07:00',
    turns: [
      'gia nghi 4 tieng o hà đông tinh the nao shop? (#33)',
      'Nếu mình lấy thêm gói qua đêm từ 22h ở Hà Đông thì phụ thu hay tính thế nào?',
    ],
  },
  {
    caseId: 'REPLAY-SCENARIO-035',
    title: 'Verbatim SCENARIO-035: Ambiguous "chiều nay" must NOT lock referenceClock 14:00 as guest arrival',
    propertyId: 'jacayl-ha-dong',
    providerMode: 'auto',
    referenceClock: '2026-11-28T14:00:00+07:00',
    turns: [
      'Cho mình xin thông tin chi phí phòng 4 tiếng tại Hà Đông chiều nay? [heldout_35]',
      'Thế còn gói nghỉ qua đêm tại Hà Đông bắt đầu từ mấy giờ tối vậy bạn? [ho_35]',
    ],
  },
  {
    caseId: 'REPLAY-SCENARIO-039',
    title: 'Verbatim SCENARIO-039: Complete 4h total quote (no 2h base + vague surcharge) -> Overnight 22h',
    propertyId: 'jacayl-ha-dong',
    providerMode: 'auto',
    referenceClock: '2026-11-25T15:00:00+07:00',
    turns: [
      'Báo giá giúp mình gói 4 tiếng ở Hà Đông nhé bạn. [câu hỏi #39]',
      'Nếu mình lấy thêm gói qua đêm từ 22h ở Hà Đông thì phụ thu hay tính thế nào?',
    ],
  },
  {
    caseId: 'REPLAY-SCENARIO-041',
    title: 'Verbatim SCENARIO-041 + Non-existent Room 301 check (must NOT fabricate Phong 301)',
    propertyId: 'jacayl-ha-dong',
    providerMode: 'auto',
    referenceClock: '2026-11-27T21:45:00+07:00',
    turns: [
      'gia nghi 4 tieng o hà đông tinh the nao shop? (#41)',
      'Ở Hà Đông có phòng 301 không shop? Nếu có cho mình xem thông tin phòng 301 nhé.',
    ],
  },
  {
    caseId: 'REPLAY-QUOTE-REUSE-RETRACT',
    title: 'Multi-turn valid quote reuse after non-pricing constraint retraction (bathtub)',
    propertyId: 'jacayl-ha-dong',
    providerMode: 'auto',
    referenceClock: '2026-11-25T15:00:00+07:00',
    turns: [
      'Phòng 201 — La Casta ở Hà Đông nghỉ 2 tiếng và có bồn tắm thì sao bạn?',
      'Thôi không cần bồn tắm nữa đâu, phòng 201 đó giá 2 tiếng vẫn vậy đúng không?',
    ],
  },
  {
    caseId: 'REPLAY-PKG-SWITCH',
    title: 'Multi-turn stay package switch invalidates prior QUOTE evidence and triggers re-quote',
    propertyId: 'jacayl-tran-khat-chan',
    providerMode: 'auto',
    referenceClock: '2026-11-25T15:00:00+07:00',
    turns: [
      'Phòng 201 ở Trần Khát Chân gói qua đêm giá bao nhiêu em?',
      'À đổi sang gói cả ngày (ngày đêm) cho phòng 201 đó giúp anh nhé.',
    ],
  },
  {
    caseId: 'REPLAY-MEDIA-CACHE',
    title: 'Media attachment + ordinary turn no auto-attach + cached media_refs resend',
    propertyId: 'j-village',
    providerMode: 'auto',
    referenceClock: '2026-11-25T15:00:00+07:00',
    turns: [
      'Cho mình xem hình ảnh thực tế phòng 202 (Neon) tại J Village nhé.',
      'Phòng 202 này có ban công hay bồn tắm không em?',
      'Gửi lại giúp mình bộ ảnh phòng 202 đó với.',
    ],
  },
  {
    caseId: 'REPLAY-BUDGET-NO-QUOTE',
    title: 'Customer budget inquiry without quoting tool needed stays free of false rejection',
    propertyId: 'jacayl-tran-khat-chan',
    providerMode: 'auto',
    referenceClock: '2026-11-24T07:30:00+07:00',
    turns: [
      'Tầm ngân sách khoảng 400k thì Trần Khát Chân có hạng phòng nào nghỉ giờ phù hợp không bạn?',
    ],
  },
  {
    caseId: 'REPLAY-GROQ-QWEN-PARITY',
    title: 'Secondary provider live verification (Groq Qwen 3.8 27B): 4h + qua_dem Phòng 201 Hà Đông',
    propertyId: 'jacayl-ha-dong',
    providerMode: 'groq',
    referenceClock: '2026-11-25T15:00:00+07:00',
    turns: [
      'Báo giúp mình giá phòng 201 — La Casta ở Hà Đông cho gói nghỉ 4 tiếng và gói qua đêm nhé.',
    ],
  },
];

async function main() {
  process.env.CONVERSATION_ENGINE = 'agentic';
  process.env.FREE_ONLY_MODE = 'true';

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const policyMeta = getEffectivePolicyMetadata();
  const claimValidator = new ClaimLevelValidator(dataset);

  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    gitCommit = 'unknown';
  }

  console.log('========================================================================');
  console.log(`GATE 2 — CRITICAL LIVE REPLAY | Policy V${policyMeta.effectivePolicyVersion} | Commit ${gitCommit}`);
  console.log('========================================================================');

  const geminiGateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const groqGateway = new FreeLLMGateway({ mode: 'groq', freeOnlyMode: true });

  const caseResults: any[] = [];
  let totalTurns = 0;
  let liveVerifiedTurns = 0;
  let blockedTurns = 0;
  let firstAttemptCleanTurns = 0;
  let repairedTurns = 0;
  let totalRepairs = 0;
  let totalGroundingBlocks = 0;
  let totalRejectedClaims = 0;
  let rawThinkLeaks = 0;

  for (const gc of GATE2_CASES) {
    const gateway = gc.providerMode === 'groq' ? groqGateway : geminiGateway;
    const agent = new JCollectionAgent(dataset, gc.propertyId, {
      llmAdapter: gateway,
      referenceClock: gc.referenceClock,
      strictLiveOnly: true,
    });
    const sessionId = `gate2-${gc.caseId.toLowerCase()}-${Date.now()}`;
    const turnLogs: any[] = [];
    let caseBlocked = false;

    console.log(`\n▶ ${gc.caseId} [${gc.propertyId} | mode=${gc.providerMode}]: ${gc.title}`);

    for (let i = 0; i < gc.turns.length; i++) {
      const userMessage = gc.turns[i];
      totalTurns += 1;
      const t0 = performance.now();
      try {
        const res = await agent.processTurn(sessionId, userMessage, {
          referenceClock: gc.referenceClock,
          strictLiveOnly: true,
        });
        const latencyMs = Math.round(performance.now() - t0);
        const tel = res.decision_trace?.llmTelemetry;
        const vStatus = res.decision_trace?.verificationStatus ?? 'UNKNOWN';
        const steps = res.decision_trace?.decisionSteps || [];
        const repairCount = steps.filter((s) => s.phase === 'REVISE' && /GROUNDING|chỉ số|bộ lọc/i.test(s.thoughtSummary)).length;
        const groundingGateRepairs = steps.filter((s) => s.phase === 'REVISE' && s.thoughtSummary.includes('GROUNDING_GATE')).length;
        const groundingBlocked = Boolean(tel?.fallbackState?.fallbackReason?.startsWith('GROUNDING_BLOCKED'));
        const firstAttemptClean = groundingGateRepairs === 0 && !groundingBlocked && (res.claim_validation?.rejected_claims?.length ?? 0) === 0;
        const hasThinkLeak = /<\/?think>/i.test(res.customer_visible_response || '');

        if (vStatus === 'LIVE_LLM_DECISION_VERIFIED' && !groundingBlocked) liveVerifiedTurns += 1;
        if (firstAttemptClean) firstAttemptCleanTurns += 1;
        if (groundingGateRepairs > 0 && !groundingBlocked) repairedTurns += 1;
        totalRepairs += groundingGateRepairs;
        if (groundingBlocked) totalGroundingBlocks += 1;
        totalRejectedClaims += res.claim_validation?.rejected_claims?.length ?? 0;
        if (hasThinkLeak) rawThinkLeaks += 1;

        const postAudit = claimValidator.validate(res.customer_visible_response, {
          facility: gc.propertyId,
          deliveredMedia: res.images || [],
          effectivePolicyVersion: policyMeta.effectivePolicyVersion,
          userMessage,
          referenceClock: gc.referenceClock,
        });

        turnLogs.push({
          turnIndex: i + 1,
          userMessage,
          referenceClock: gc.referenceClock,
          customerVisibleResponse: res.customer_visible_response,
          toolsExecuted: res.internal_trace.tools_executed,
          evidenceReferences: res.evidence_references,
          deliveredMediaCount: res.images?.length ?? 0,
          roomPresentationsCount: res.room_presentations?.length ?? 0,
          verificationStatus: vStatus,
          groundingStatus: res.claim_validation?.grounding_status,
          rejectedClaims: res.claim_validation?.rejected_claims || [],
          missingEvidenceClaims: res.claim_validation?.missing_evidence_claims || [],
          postAuditForbiddenUrlsOrIdentity: postAudit.rejected_claims,
          firstAttemptClean,
          groundingGateRepairs,
          groundingBlocked,
          hasThinkLeak,
          providerModel: res.decision_trace?.providerModel,
          isFallback: Boolean(tel?.fallbackState?.isFallback),
          fallbackReason: tel?.fallbackState?.fallbackReason,
          promptTokens: tel?.promptTokens ?? 0,
          completionTokens: tel?.completionTokens ?? 0,
          totalTokens: tel?.totalTokens ?? 0,
          latencyMs,
        });

        console.log(
          `  T${i + 1} [${res.decision_trace?.providerModel} | ${latencyMs}ms | tok=${tel?.totalTokens ?? 0} | tools=${res.internal_trace.tools_executed.join(',') || 'none'} | media=${res.images?.length ?? 0} | grounding=${res.claim_validation?.grounding_status} | firstClean=${firstAttemptClean} | repairs=${groundingGateRepairs}]`
        );
        console.log(`     Resp: ${res.customer_visible_response.replace(/\s+/g, ' ').slice(0, 200)}...`);
        await new Promise((r) => setTimeout(r, tel?.provider === 'groq' ? 11000 : 4500));
      } catch (err: any) {
        const latencyMs = Math.round(performance.now() - t0);
        blockedTurns += 1;
        caseBlocked = true;
        turnLogs.push({
          turnIndex: i + 1,
          userMessage,
          referenceClock: gc.referenceClock,
          verificationStatus: 'BLOCKED',
          blockedReason: err.message,
          latencyMs,
        });
        console.log(`  T${i + 1} BLOCKED (${latencyMs}ms): ${err.message}`);
        break;
      }
    }

    caseResults.push({
      caseId: gc.caseId,
      title: gc.title,
      propertyId: gc.propertyId,
      providerMode: gc.providerMode,
      status: caseBlocked ? 'BLOCKED' : 'LIVE_COMPLETED',
      turns: turnLogs,
    });
  }

  const outPath = path.resolve('artifacts', 'eval-integrity', 'gate2-critical-replay.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    gitCommit,
    effectivePolicyVersion: policyMeta.effectivePolicyVersion,
    freeOnlyMode: true,
    strictLiveOnly: true,
    summary: {
      total_cases: caseResults.length,
      completed_cases: caseResults.filter((c) => c.status === 'LIVE_COMPLETED').length,
      blocked_cases: caseResults.filter((c) => c.status === 'BLOCKED').length,
      total_turns: totalTurns,
      live_verified_turns: liveVerifiedTurns,
      blocked_turns: blockedTurns,
      first_attempt_clean_turns: firstAttemptCleanTurns,
      first_attempt_clean_rate_pct: totalTurns > 0 ? Math.round((firstAttemptCleanTurns / totalTurns) * 1000) / 10 : 0,
      repaired_turns: repairedTurns,
      grounding_repairs: totalRepairs,
      grounding_blocks: totalGroundingBlocks,
      rejected_claims_on_final_output: totalRejectedClaims,
      raw_think_leaks: rawThinkLeaks,
    },
    gemini_gateway_reliability: geminiGateway.getReliabilityMetrics(),
    groq_gateway_reliability: groqGateway.getReliabilityMetrics(),
    cases: caseResults,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n=== GATE 2 SUMMARY ===');
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((err) => {
  console.error('Gate 2 Runner failed:', err);
  process.exit(1);
});
