import { NormalizedDataset } from '../../domain/normalized-schema.js';
import { CoSoMa } from '../../domain/types.js';
import { ClaimLevelValidator } from '../../conversation/grounding/claim-validator.js';
import { computeDatasetVersionHash, extractVndMentions } from '../../conversation/grounding/business-evidence.js';
import { NeedCategory, SimulationScenario } from './autonomous-customer-simulation-lab-v2-2.js';
import { BusinessEvidenceRecord, ScopedRateFact } from '../../agent/agent-contracts.js';
import {
  getHolidayPolicyProvenance,
  loadActivePricingPolicyConfig,
} from '../../data-loader/pricing-policy-loader.js';

export type ExecutionStatusV3 = 'LIVE_COMPLETED' | 'BLOCKED' | 'FAILED_FALLBACK' | 'DEGRADED';
export type BusinessAccuracyStatusV3 = 'ACCURATE' | 'CONTRADICTED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_EVALUATED';
export type GoalCompletionStatusV3 = 'COMPLETE' | 'INCOMPLETE' | 'HUMAN_REVIEW_REQUIRED' | 'NOT_EVALUATED';
export type ContextUnderstandingStatusV3 =
  | 'ALIGNED'
  | 'TEMPORAL_LEAK'
  | 'CONTEXT_DRIFT'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'NOT_EVALUATED';
export type SemanticQualityStatusV3 = 'PASS' | 'MINOR_ISSUE' | 'FAIL' | 'HUMAN_REVIEW_REQUIRED' | 'NOT_EVALUATED';
export type MediaDeliveryStatusV3 =
  | 'DELIVERED'
  | 'MISSING_ATTACHMENT'
  | 'UNVERIFIED_MISSING_ARTIFACT'
  | 'NOT_REQUESTED'
  | 'NOT_EVALUATED';

export interface EvaluatedTurnV3 {
  scenarioId: string;
  turnIndex: number;
  propertyId: CoSoMa;
  providerModel: string;
  verificationStatus: string;
  toolsExecuted: string[];
  execution_status: ExecutionStatusV3;
  grounding_status: 'VERIFIED' | 'CONTRADICTED' | 'MISSING_EVIDENCE' | 'NOT_APPLICABLE' | 'INSUFFICIENT_EVIDENCE';
  business_accuracy: BusinessAccuracyStatusV3;
  goal_completion: GoalCompletionStatusV3;
  context_understanding: ContextUnderstandingStatusV3;
  semantic_quality: SemanticQualityStatusV3;
  media_delivery_status: MediaDeliveryStatusV3;
  latencyMs: number;
  totalTokens: number;
  findings: string[];
  needsHumanReview: boolean;
  humanReviewReason?: string;
}

export type TerminalOutcomeV3 = 'CONFIRMED_PASS' | 'CONFIRMED_FAIL' | 'PENDING_HUMAN_REVIEW' | 'BLOCKED';

export interface EvaluatedScenarioV3 {
  scenarioId: string;
  propertyId: CoSoMa;
  split: string;
  category: string;
  gitCommit: string;
  effectivePolicyVersion: string;
  historicalPassedFlag: boolean;
  execution_status: ExecutionStatusV3;
  grounding_status: 'VERIFIED' | 'CONTRADICTED' | 'MISSING_EVIDENCE' | 'NOT_APPLICABLE' | 'INSUFFICIENT_EVIDENCE';
  business_accuracy: BusinessAccuracyStatusV3;
  goal_completion: GoalCompletionStatusV3;
  context_understanding: ContextUnderstandingStatusV3;
  semantic_quality: SemanticQualityStatusV3;
  media_delivery_status: MediaDeliveryStatusV3;
  terminal_outcome: TerminalOutcomeV3;
  quality_passed: boolean;
  isFalsePass: boolean;
  needsHumanReview: boolean;
  humanReviewReasons: string[];
  findings: string[];
  operational_metrics: {
    turnCount: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
    totalTokens: number;
    hasProviderFailover: boolean;
    providerModels: string[];
    blockedReason?: string;
  };
  turns: EvaluatedTurnV3[];
}

export interface StratifiedManifestItem {
  scenarioId: string;
  propertyId: CoSoMa;
  category: NeedCategory;
  split: 'discovery' | 'held_out';
  source: 'immutable_500_catalog' | 'supplementary_tkc_faq';
  batchGroup: 'batch_1' | 'batch_2' | 'batch_3';
  turnsCount: number;
  conversationType: 'single_turn_scripted' | 'scripted_multi_turn';
  assignedReferenceClock: string;
  referenceClockLabel: string;
  cleanTurnMessages: string[];
  originalInitialMessage: string;
}

const REFERENCE_CLOCK_FIXTURES: Array<{ label: string; clock: string }> = [
  { label: 'weekday_morning_early', clock: '2026-11-24T07:30:00+07:00' }, // Tue 07:30
  { label: 'weekday_afternoon', clock: '2026-11-25T15:00:00+07:00' },     // Wed 15:00
  { label: 'weekend_evening_boundary', clock: '2026-11-28T18:10:00+07:00' }, // Sat 18:10
  { label: 'weekday_overnight_grace', clock: '2026-11-27T21:45:00+07:00' },  // Fri 21:45
];

/**
 * Strips debug suffix tags like "[ID-33]", "(#9)", "[heldout_35]", "[ho_120]" while keeping scenarioId in metadata.
 */
export function stripSyntheticScenarioIdSuffix(message: string): string {
  return String(message || '')
    .replace(/\s*(\[(?:ID-|heldout_|ho_|ho_img_|ho_dim_|câu hỏi #|yêu cầu #)[^\]]+\]|\((?:#|mã #|ma-)?\d+\))\s*$/gi, '')
    .trim();
}

/**
 * Independent offline 8-axis re-evaluator for stored Live 500 checkpoint records.
 * Uses canonical dataset facts + ClaimLevelValidator rather than runtime businessPassed flags.
 */
export class OfflineEvaluationIntegrityAuditorV3 {
  private dataset: NormalizedDataset;
  private claimValidator: ClaimLevelValidator;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
    this.claimValidator = new ClaimLevelValidator(dataset);
  }

  public evaluateCheckpointRecords(
    records: any[],
    catalogMap: Map<string, SimulationScenario>,
    defaultReferenceClock = '2026-11-28T14:00:00+07:00'
  ): {
    summary: Record<string, any>;
    falsePassRegister: any[];
    humanReviewQueue: any[];
    evaluatedRecords: EvaluatedScenarioV3[];
  } {
    const evaluatedRecords: EvaluatedScenarioV3[] = [];
    const falsePassRegister: any[] = [];
    const humanReviewQueue: any[] = [];

    for (const rec of records) {
      const scenarioSpec = catalogMap.get(rec.scenarioId);
      const evalRec = this.evaluateSingleScenario(rec, scenarioSpec, defaultReferenceClock);
      evaluatedRecords.push(evalRec);

      if (evalRec.isFalsePass) {
        falsePassRegister.push({
          scenarioId: evalRec.scenarioId,
          propertyId: evalRec.propertyId,
          gitCommit: evalRec.gitCommit,
          effectivePolicyVersion: evalRec.effectivePolicyVersion,
          historicalPassedFlag: evalRec.historicalPassedFlag,
          execution_status: evalRec.execution_status,
          grounding_status: evalRec.grounding_status,
          business_accuracy: evalRec.business_accuracy,
          goal_completion: evalRec.goal_completion,
          context_understanding: evalRec.context_understanding,
          media_delivery_status: evalRec.media_delivery_status,
          findings: evalRec.findings,
        });
      }

      if (evalRec.needsHumanReview) {
        humanReviewQueue.push({
          scenarioId: evalRec.scenarioId,
          propertyId: evalRec.propertyId,
          gitCommit: evalRec.gitCommit,
          category: evalRec.category,
          reasons: evalRec.humanReviewReasons,
          findings: evalRec.findings,
        });
      }
    }

    const total = evaluatedRecords.length;
    const summary = {
      evaluated_at: new Date().toISOString(),
      total_scenarios: total,
      total_turns: evaluatedRecords.reduce((a, r) => a + r.turns.length, 0),
      by_execution_status: {
        LIVE_COMPLETED: evaluatedRecords.filter((r) => r.execution_status === 'LIVE_COMPLETED').length,
        BLOCKED: evaluatedRecords.filter((r) => r.execution_status === 'BLOCKED').length,
        DEGRADED: evaluatedRecords.filter((r) => r.execution_status === 'DEGRADED').length,
        FAILED_FALLBACK: evaluatedRecords.filter((r) => r.execution_status === 'FAILED_FALLBACK').length,
      },
      historical_businessPassed_true: evaluatedRecords.filter((r) => r.historicalPassedFlag).length,
      strict_quality_passed_true: evaluatedRecords.filter((r) => r.quality_passed).length,
      by_terminal_outcome: {
        CONFIRMED_PASS: evaluatedRecords.filter((r) => r.terminal_outcome === 'CONFIRMED_PASS').length,
        CONFIRMED_FAIL: evaluatedRecords.filter((r) => r.terminal_outcome === 'CONFIRMED_FAIL').length,
        PENDING_HUMAN_REVIEW: evaluatedRecords.filter((r) => r.terminal_outcome === 'PENDING_HUMAN_REVIEW').length,
        BLOCKED: evaluatedRecords.filter((r) => r.terminal_outcome === 'BLOCKED').length,
      },
      false_pass_count: falsePassRegister.length,
      human_review_queue_count: humanReviewQueue.length,
      reconciliation_check_overlap_count: evaluatedRecords.filter((r) => r.isFalsePass && r.needsHumanReview).length,
      breakdown_by_commit: {
        pre_dc11876: {
          total: evaluatedRecords.filter((r) => r.gitCommit !== 'dc11876').length,
          live_completed: evaluatedRecords.filter(
            (r) => r.gitCommit !== 'dc11876' && r.execution_status === 'LIVE_COMPLETED'
          ).length,
          confirmed_pass: evaluatedRecords.filter((r) => r.gitCommit !== 'dc11876' && r.terminal_outcome === 'CONFIRMED_PASS').length,
          confirmed_fail: evaluatedRecords.filter((r) => r.gitCommit !== 'dc11876' && r.terminal_outcome === 'CONFIRMED_FAIL').length,
          pending_human_review: evaluatedRecords.filter((r) => r.gitCommit !== 'dc11876' && r.terminal_outcome === 'PENDING_HUMAN_REVIEW').length,
          quality_passed: evaluatedRecords.filter((r) => r.gitCommit !== 'dc11876' && r.quality_passed).length,
          false_pass: falsePassRegister.filter((f) => f.gitCommit !== 'dc11876').length,
        },
        commit_dc11876: {
          total: evaluatedRecords.filter((r) => r.gitCommit === 'dc11876').length,
          live_completed: evaluatedRecords.filter(
            (r) => r.gitCommit === 'dc11876' && r.execution_status === 'LIVE_COMPLETED'
          ).length,
          confirmed_pass: evaluatedRecords.filter((r) => r.gitCommit === 'dc11876' && r.terminal_outcome === 'CONFIRMED_PASS').length,
          confirmed_fail: evaluatedRecords.filter((r) => r.gitCommit === 'dc11876' && r.terminal_outcome === 'CONFIRMED_FAIL').length,
          pending_human_review: evaluatedRecords.filter((r) => r.gitCommit === 'dc11876' && r.terminal_outcome === 'PENDING_HUMAN_REVIEW').length,
          blocked: evaluatedRecords.filter((r) => r.gitCommit === 'dc11876' && r.execution_status === 'BLOCKED').length,
          quality_passed: evaluatedRecords.filter((r) => r.gitCommit === 'dc11876' && r.quality_passed).length,
          false_pass: falsePassRegister.filter((f) => f.gitCommit === 'dc11876').length,
        },
      },
    };

    return { summary, falsePassRegister, humanReviewQueue, evaluatedRecords };
  }

  private evaluateSingleScenario(
    rec: any,
    scenarioSpec: SimulationScenario | undefined,
    referenceClock: string
  ): EvaluatedScenarioV3 {
    const propertyId = rec.propertyId as CoSoMa;
    const gitCommit = rec.gitCommit || 'pre-dc11876';
    const effectivePolicyVersion = rec.effectivePolicyVersion || '1.4.6';
    const historicalPassedFlag = Boolean(rec.businessPassed);
    const turnsRaw: any[] = rec.turns || [];

    // Build canonical ground-truth property catalog evidence so independent oracle checks true prices
    const propertyRooms = this.dataset.phong.filter((r) => r.co_so_ma === propertyId);
    const byCat = new Map<
      string,
      {
        base2hVnds: Set<number>;
        overnightVnds: Set<number>;
        dayNightVnds: Set<number>;
        extraHourRateVnds: Set<number>;
        hourlyExtendedVnds: Set<number>;
      }
    >();
    const canonicalAmountsSet = new Set<number>();

    for (const r of propertyRooms) {
      const bp = r.gia_goc_dataset;
      if (!bp) continue;
      const cat = r.hang;
      const prev = byCat.get(cat) || {
        base2hVnds: new Set<number>(),
        overnightVnds: new Set<number>(),
        dayNightVnds: new Set<number>(),
        extraHourRateVnds: new Set<number>(),
        hourlyExtendedVnds: new Set<number>(),
      };

      if (typeof bp.nghi_gio_2h === 'number') {
        canonicalAmountsSet.add(bp.nghi_gio_2h);
        prev.base2hVnds.add(bp.nghi_gio_2h);
      }
      if (typeof bp.qua_dem === 'number') {
        canonicalAmountsSet.add(bp.qua_dem);
        prev.overnightVnds.add(bp.qua_dem);
      }
      if (typeof bp.ngay_dem === 'number') {
        canonicalAmountsSet.add(bp.ngay_dem);
        prev.dayNightVnds.add(bp.ngay_dem);
      }
      if (typeof bp.gio_phat_sinh_ap_dung === 'number') {
        canonicalAmountsSet.add(bp.gio_phat_sinh_ap_dung);
        prev.extraHourRateVnds.add(bp.gio_phat_sinh_ap_dung);
      }
      // Valid extended hourly totals (3h..6h) and extra-hour subtotals (N * extra_rate) for base rates
      for (let ext = 1; ext <= 4; ext++) {
        const tot = bp.nghi_gio_2h + ext * bp.gio_phat_sinh_ap_dung;
        const sub = ext * bp.gio_phat_sinh_ap_dung;
        canonicalAmountsSet.add(tot);
        canonicalAmountsSet.add(sub);
        prev.hourlyExtendedVnds.add(tot);
        prev.hourlyExtendedVnds.add(sub);
      }
      // Ha Dong weekend daytime rates + 4h sums
      if (propertyId === 'jacayl-ha-dong') {
        const wkBase = cat === 'Standard' ? 180000 : cat === 'Deluxe' ? 315000 : cat === 'Concept' ? 449000 : undefined;
        if (wkBase) {
          canonicalAmountsSet.add(wkBase);
          prev.base2hVnds.add(wkBase);
          for (let ext = 1; ext <= 4; ext++) {
            const wkTot = wkBase + ext * bp.gio_phat_sinh_ap_dung;
            canonicalAmountsSet.add(wkTot);
            prev.hourlyExtendedVnds.add(wkTot);
          }
        }
      }
      byCat.set(cat, prev);
    }

    const activePolicyConfig = loadActivePricingPolicyConfig();
    const datasetHash = computeDatasetVersionHash(this.dataset, activePolicyConfig);
    const holProv = getHolidayPolicyProvenance(activePolicyConfig);

    const oracleEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: `oracle_catalog_${propertyId}`,
        propertyId,
        evidenceType: 'CATALOG_SEARCH',
        toolSource: 'oracle',
        stayPackage: 'ALL',
        alternateAmountsVnd: Array.from(canonicalAmountsSet),
        categoryRateSnapshots: Array.from(byCat.entries()).map(([category, vals]) => ({
          category,
          base2hVnd: vals.base2hVnds.size > 0 ? Math.min(...vals.base2hVnds) : undefined,
          overnightVnd: vals.overnightVnds.size > 0 ? Math.min(...vals.overnightVnds) : undefined,
          dayNightVnd: vals.dayNightVnds.size > 0 ? Math.min(...vals.dayNightVnds) : undefined,
          extraHourRateVnd: vals.extraHourRateVnds.size > 0 ? Math.min(...vals.extraHourRateVnds) : undefined,
          base2hVnds: Array.from(vals.base2hVnds),
          overnightVnds: Array.from(vals.overnightVnds),
          dayNightVnds: Array.from(vals.dayNightVnds),
          extraHourRateVnds: Array.from(vals.extraHourRateVnds),
          hourlyExtendedVnds: Array.from(vals.hourlyExtendedVnds),
        })),
        effectivePolicyVersion,
        datasetVersion: datasetHash,
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 0,
      },
    ];

    const oraclePolicyScoped: ScopedRateFact[] = propertyRooms.map((r) => ({
      amountVnd: r.gia_goc_dataset.gio_phat_sinh_ap_dung,
      role: 'EXTRA_HOUR_RATE' as const,
      roomId: r.ma_phong,
      category: r.hang,
      stayPackage: 'EXTRA_HOUR' as const,
      eligible: true,
    }));
    oraclePolicyScoped.push({
      amountVnd: 100000,
      role: 'POLICY_RATE',
      stayPackage: 'EXTRA_HOUR',
      isDefaultPolicyRate: true,
      eligible: true,
    });
    const oraclePolicyEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: `oracle_policy_${propertyId}`,
        propertyId,
        evidenceType: 'POLICY',
        toolSource: 'get_policies',
        stayPackage: 'ALL',
        alternateAmountsVnd: Array.from(new Set(oraclePolicyScoped.map((r) => r.amountVnd))),
        scopedRates: oraclePolicyScoped,
        conditions: ['late_checkout', 'holiday_surcharge'],
        holidayZeroConfirmed: holProv.confirmedByOwner && holProv.hasHolidaySurcharge === false,
        holidayProvenance: holProv.provenancePath,
        effectivePolicyVersion,
        datasetVersion: datasetHash,
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 0,
      },
    ];

    const turnResults: EvaluatedTurnV3[] = [];
    const scenarioFindings: string[] = [];
    const humanReasons: string[] = [];
    let cumulativeHasCatalogOrQuoteEvidence = false;
    let cumulativeHasPolicyRateEvidence = false;

    for (let i = 0; i < turnsRaw.length; i++) {
      const t = turnsRaw[i];
      const vStatus = String(t.verificationStatus || '');
      const toolsExecuted: string[] = Array.isArray(t.toolsExecuted) ? t.toolsExecuted : [];
      const resp = String(t.deliveredResponse || t.customerVisibleResponse || '');
      const userMsg = String(t.userMessage || '');
      const findings: string[] = [];

      let execution_status: ExecutionStatusV3 = 'LIVE_COMPLETED';
      if (vStatus === 'BLOCKED' || rec.status === 'live_blocked') {
        execution_status = 'BLOCKED';
      } else if (vStatus === 'DEGRADED_DETERMINISTIC_MODE') {
        execution_status = 'DEGRADED';
      } else if (vStatus !== 'LIVE_LLM_DECISION_VERIFIED' && rec.status !== 'live_completed') {
        execution_status = 'FAILED_FALLBACK';
      }

      if (execution_status === 'BLOCKED') {
        turnResults.push({
          scenarioId: rec.scenarioId,
          turnIndex: t.turnIndex ?? i + 1,
          propertyId,
          providerModel: t.providerModel || 'BLOCKED',
          verificationStatus: vStatus,
          toolsExecuted,
          execution_status: 'BLOCKED',
          grounding_status: 'INSUFFICIENT_EVIDENCE',
          business_accuracy: 'NOT_EVALUATED',
          goal_completion: 'NOT_EVALUATED',
          context_understanding: 'NOT_EVALUATED',
          semantic_quality: 'NOT_EVALUATED',
          media_delivery_status: 'NOT_EVALUATED',
          latencyMs: t.latencyMs ?? 0,
          totalTokens: (t.promptTokens ?? 0) + (t.completionTokens ?? 0),
          findings: [`Turn blocked by upstream Free API: ${t.blockedReason || rec.blockedReason || 'unavailable'}`],
          needsHumanReview: false,
        });
        scenarioFindings.push(`Turn ${i + 1} BLOCKED by API`);
        continue;
      }

      // 1) Independent Claim & Business Oracle check
      // Check against strict tool grounding FIRST (carrying forward valid session catalog/quote/policy evidence across turns)
      const vndMentions = extractVndMentions(resp);
      const hasPriceTools = toolsExecuted.some((tn) => tn === 'quote_price' || tn === 'search_rooms' || tn === 'get_room_facts');
      const hasPolicyTools = toolsExecuted.some((tn) => tn === 'get_policies');
      if (hasPriceTools) cumulativeHasCatalogOrQuoteEvidence = true;
      if (hasPolicyTools) cumulativeHasPolicyRateEvidence = true;

      const effectiveHasPriceEvidence = hasPriceTools || cumulativeHasCatalogOrQuoteEvidence;
      const effectiveValidEvidence: BusinessEvidenceRecord[] = [
        ...(effectiveHasPriceEvidence ? oracleEvidence : []),
        ...(hasPolicyTools || cumulativeHasPolicyRateEvidence ? oraclePolicyEvidence : []),
      ];

      // NEVER fabricate or reconstruct missing deliveredMedia[] artifacts!
      const hasRawDeliveredMedia = Array.isArray(t.deliveredMedia);
      const effectiveDeliveredMedia = hasRawDeliveredMedia ? t.deliveredMedia : [];

      // Run ClaimValidator against canonical property evidence + cumulative tool execution!
      const claimAuditAgainstRuntimeTools = this.claimValidator.validate(resp, {
        facility: propertyId,
        validEvidence: effectiveValidEvidence,
        deliveredMedia: effectiveDeliveredMedia,
        effectivePolicyVersion,
        policyConfig: activePolicyConfig,
        userMessage: userMsg,
        referenceClock: t.referenceClock || referenceClock,
      });

      const canonicalTruthCheck = this.evaluateCanonicalRateAccuracy(propertyId, userMsg, resp);

      let grounding_status: EvaluatedTurnV3['grounding_status'] =
        claimAuditAgainstRuntimeTools.grounding_status ?? 'NOT_APPLICABLE';
      let business_accuracy: BusinessAccuracyStatusV3 = 'ACCURATE';

      if (claimAuditAgainstRuntimeTools.rejected_claims.length > 0 || canonicalTruthCheck.contradictions.length > 0) {
        business_accuracy = 'CONTRADICTED';
        if (claimAuditAgainstRuntimeTools.rejected_claims.length > 0) {
          findings.push(...claimAuditAgainstRuntimeTools.rejected_claims);
        }
        findings.push(...canonicalTruthCheck.contradictions);
        if (grounding_status === 'MISSING_EVIDENCE' || grounding_status === 'NOT_APPLICABLE') {
          grounding_status = 'CONTRADICTED';
        }
      } else if (
        grounding_status === 'MISSING_EVIDENCE' &&
        !Array.isArray(t.deliveredMedia) &&
        typeof t.deliveredMediaCount === 'number' &&
        t.deliveredMediaCount > 0 &&
        (claimAuditAgainstRuntimeTools.missing_evidence_claims || []).every((m) => m.includes('MISSING_MEDIA_ATTACHMENT'))
      ) {
        // Compact logs that recorded count without deliveredMedia[] cannot pass media verification,
        // so map to INSUFFICIENT_EVIDENCE + PENDING_HUMAN_REVIEW instead of false PASS or fabricated URLs.
        grounding_status = 'INSUFFICIENT_EVIDENCE';
      } else if (
        vndMentions.length > 0 &&
        !effectiveHasPriceEvidence &&
        !hasPolicyTools &&
        !cumulativeHasPolicyRateEvidence &&
        !/(?:bên em|khách sạn).*(?:không|miễn)/i.test(resp)
      ) {
        grounding_status = 'MISSING_EVIDENCE';
        findings.push(
          `MISSING_PRICE_EVIDENCE_IN_TURN: Response mentions [${vndMentions.map((v) => v.raw).join(', ')}] with toolsExecuted=[${toolsExecuted.join(', ')}].`
        );
      }

      // Policy rule audit (e.g. SCENARIO-027 Turn 2: 18h-20h + qua đêm)
      if (
        /(?:trước 22:00|18:00|20:00).*(?:nghỉ giờ).*(?:chuyển sang gói qua đêm|chuyển sang qua đêm)/i.test(resp) &&
        !/ngày đêm/i.test(resp)
      ) {
        business_accuracy = 'CONTRADICTED';
        grounding_status = 'CONTRADICTED';
        findings.push(
          'POLICY_RULE_VIOLATION: Claimed 18:00/20:00 arrival transitioning to overnight uses hourly + overnight instead of ngay_dem (14:00-21:39 rule).'
        );
      }

      let needsHumanReview = false;
      let humanReviewReason: string | undefined;

      // 2) Media Delivery Status (NEVER treat unverified compact counts as DELIVERED canonical proof!)
      let media_delivery_status: MediaDeliveryStatusV3 = 'NOT_REQUESTED';
      const userRequestedPhotos =
        /xem\s*(?:hình|ảnh)|gửi.*ảnh|album\s*ảnh|ảnh chụp thực tế|photo/i.test(userMsg) ||
        scenarioSpec?.turnSpecs?.[i]?.expectedGoal === 'VIEW_ROOM_PHOTOS' ||
        scenarioSpec?.turnSpecs?.[i]?.expectedGoal === 'PROACTIVE_ROOM_PHOTO_INQUIRY';
      const rawDeliveredCount = Array.isArray(t.deliveredMedia) ? t.deliveredMedia.length : 0;
      const compactCountOnly = !Array.isArray(t.deliveredMedia) && typeof t.deliveredMediaCount === 'number' ? t.deliveredMediaCount : 0;

      if (userRequestedPhotos) {
        if (rawDeliveredCount > 0) {
          media_delivery_status = 'DELIVERED';
        } else if (compactCountOnly > 0) {
          media_delivery_status = 'UNVERIFIED_MISSING_ARTIFACT';
          needsHumanReview = true;
          humanReviewReason =
            humanReviewReason ||
            `Media artifact deliveredMedia[] omitted from log (recorded count=${compactCountOnly}); cannot independently verify canonical URLs.`;
          findings.push(`UNVERIFIED_MEDIA_ARTIFACT: Compact log records count=${compactCountOnly} without deliveredMedia[].`);
        } else {
          media_delivery_status = 'MISSING_ATTACHMENT';
          findings.push('MISSING_MEDIA_ATTACHMENT: Guest requested room photos, yet deliveredMedia is empty.');
        }
      } else if (rawDeliveredCount > 0) {
        media_delivery_status = 'DELIVERED';
      }

      // 3) Independent Goal Completion evaluation (NEVER blank-default COMPLETE!)
      let goal_completion: GoalCompletionStatusV3 = 'HUMAN_REVIEW_REQUIRED';
      const userAsks4h = /\b4\s*(?:tiếng|tieng|giờ|gio|h)\b/i.test(userMsg);
      const userAsksOvernightPrice = /qua đêm.*(?:phụ thu|tính thế nào|bao nhiêu)/i.test(userMsg);
      const isDegradedOrBlockedText =
        execution_status !== 'LIVE_COMPLETED' ||
        /chưa hoàn tất đối soát đầy đủ dữ kiện biểu giá/i.test(resp) ||
        resp.trim().length < 20;

      if (isDegradedOrBlockedText) {
        goal_completion = 'INCOMPLETE';
        findings.push(
          execution_status !== 'LIVE_COMPLETED'
            ? `INCOMPLETE_DEGRADED_EXECUTION: Execution status is ${execution_status}, cannot mark goal COMPLETE.`
            : 'INCOMPLETE_RESPONSE_OR_GROUNDING_BLOCK: Response is empty or fell back to grounding refusal.'
        );
      } else if (userAsks4h) {
        const mentions359Or380 = /\b(359\.?000|380\.?000|479\.?000|515\.?000|599\.?000|649\.?000|799\.?000|849\.?000|359k|380k|599k|649k|799k|849k)\b/i.test(resp);
        const defersFormulaVague = /sẽ có phụ phí|tính theo quy định phụ thu giờ/i.test(resp) && !mentions359Or380;
        if (defersFormulaVague || vndMentions.length === 0) {
          goal_completion = 'INCOMPLETE';
          findings.push('INCOMPLETE_GOAL_4H_QUOTE: Guest asked for 4-hour price, but AI omitted computed 4h totals.');
        } else {
          goal_completion = 'COMPLETE';
        }
      } else if (userAsksOvernightPrice && vndMentions.length === 0 && /nêu rõ|tính theo|phụ thu/i.test(userMsg)) {
        goal_completion = 'HUMAN_REVIEW_REQUIRED';
        needsHumanReview = true;
        humanReviewReason = 'Guest asked overnight surcharge/calculation; model gave time/grace policy without quoting rates.';
      } else if (scenarioSpec?.category === 'booking_handoff_closing') {
        goal_completion = 'HUMAN_REVIEW_REQUIRED';
        needsHumanReview = true;
        humanReviewReason = 'Subjective naturalness & tone verification for booking handoff escalation.';
      } else {
        // Goal satisfaction cannot be assumed solely from VND digits, tool presence, or hotline keywords.
        // Automated COMPLETE requires explicit verified canonical claim grounding (and delivered media if requested),
        // excluding subjective open-ended advice or requirement-change turns that need human semantic verification.
        const hasVerifiedDomainContent =
          (claimAuditAgainstRuntimeTools.claim_checks || []).some((c) => c.status === 'VERIFIED') ||
          (claimAuditAgainstRuntimeTools.verified_claims || []).some(
            (vc) =>
              !vc.startsWith('VERIFIED_NO_FAKE_BOOKING_CONFIRMATION') &&
              !vc.startsWith('VERIFIED_HOTLINE') &&
              !vc.startsWith('VERIFIED_BOOKING_URL')
          );
        const isSubjectiveCategory =
          scenarioSpec?.category === 'advice_preferences_budget' ||
          scenarioSpec?.category === 'requirement_context_changes';
        const isObjectivelyVerified =
          !isSubjectiveCategory &&
          hasVerifiedDomainContent &&
          claimAuditAgainstRuntimeTools.grounding_status === 'VERIFIED' &&
          business_accuracy === 'ACCURATE' &&
          (!userRequestedPhotos || media_delivery_status === 'DELIVERED') &&
          media_delivery_status !== 'UNVERIFIED_MISSING_ARTIFACT';

        if (isObjectivelyVerified) {
          goal_completion = 'COMPLETE';
        } else {
          goal_completion = 'HUMAN_REVIEW_REQUIRED';
          needsHumanReview = true;
          humanReviewReason =
            humanReviewReason ||
            'Response cannot be objectively certified as COMPLETE offline without semantic human evaluation.';
        }
      }

      // 4) Context Understanding & Temporal Hygiene (NEVER auto-ALIGNED merely because response is non-empty!)
      let context_understanding: ContextUnderstandingStatusV3 = 'HUMAN_REVIEW_REQUIRED';
      const tempViolations = (claimAuditAgainstRuntimeTools.claim_checks || []).filter(
        (c) => c.claim_type === 'TEMPORAL' && c.status === 'CONTRADICTED'
      );
      const mentionsOtherPropertyName =
        (propertyId !== 'jacayl-ha-dong' && /hà đông|ngã ba phúc la/i.test(resp)) ||
        (propertyId !== 'jacayl-tran-khat-chan' && /trần khát chân/i.test(resp)) ||
        (propertyId !== 'j-village' && /j\s*village|triệu việt vương/i.test(resp));

      if (tempViolations.length > 0) {
        context_understanding = 'TEMPORAL_LEAK';
        findings.push(...tempViolations.map((v) => v.reason));
      } else if (mentionsOtherPropertyName && !/hà đông|trần khát chân|j\s*village|triệu việt vương/i.test(userMsg)) {
        context_understanding = 'CONTEXT_DRIFT';
        findings.push(`PROPERTY_CONTEXT_DRIFT: Response referenced another property inside ${propertyId} session.`);
      } else if (
        propertyId === 'jacayl-ha-dong' &&
        /ban ngày cuối tuần|t7-cn/i.test(resp) &&
        !/cuối tuần|thứ 7|t7|chủ nhật|cn|chiều nay|ngày thường/i.test(userMsg) &&
        !/ngày thường/i.test(resp)
      ) {
        context_understanding = 'TEMPORAL_LEAK';
        findings.push('TEMPORAL_FIXTURE_BIAS: Locked generic Ha Dong inquiry onto weekend daytime rate (Saturday fixture) without mentioning weekday/evening rate.');
      } else if (
        execution_status === 'LIVE_COMPLETED' &&
        goal_completion === 'COMPLETE' &&
        claimAuditAgainstRuntimeTools.grounding_status === 'VERIFIED'
      ) {
        context_understanding = 'ALIGNED';
      } else {
        context_understanding = 'HUMAN_REVIEW_REQUIRED';
        needsHumanReview = true;
        humanReviewReason =
          humanReviewReason ||
          'Context alignment across intent/constraints could not be objectively verified offline.';
      }

      // 5) Independent Semantic Quality Evaluation (NEVER blind PASS on degraded/empty/leaked replies)
      let semantic_quality: SemanticQualityStatusV3 = 'HUMAN_REVIEW_REQUIRED';
      const hasRawWebp = /https?:\/\/[^\s]+\.webp/i.test(resp);
      const hasThinkOrJsonLeak = /<\/?(?:think|thought|reasoning)>|\{"action"\s*:/i.test(resp);
      if (hasRawWebp && rawDeliveredCount === 0) {
        semantic_quality = 'FAIL';
        findings.push('RAW_IMAGE_URL_WITHOUT_ATTACHMENT: Response pasted raw .webp gallery links into prose.');
      } else if (hasThinkOrJsonLeak) {
        semantic_quality = 'FAIL';
        findings.push('RAW_REASONING_OR_JSON_LEAK: Response leaked raw CoT tags or JSON.');
      } else if (execution_status !== 'LIVE_COMPLETED') {
        semantic_quality = 'FAIL';
        findings.push(`SEMANTIC_FAIL_ON_NON_LIVE_EXECUTION: ${execution_status} response cannot receive semantic PASS.`);
      } else if (resp.length > 1400) {
        semantic_quality = 'MINOR_ISSUE';
        findings.push(`VERBOSE_RESPONSE: Length=${resp.length} chars (>1400).`);
      } else if (goal_completion === 'HUMAN_REVIEW_REQUIRED' || context_understanding === 'HUMAN_REVIEW_REQUIRED') {
        semantic_quality = 'HUMAN_REVIEW_REQUIRED';
      } else {
        semantic_quality = 'PASS';
      }

      if (humanReviewReason) humanReasons.push(`Turn ${i + 1}: ${humanReviewReason}`);
      scenarioFindings.push(...findings.map((f) => `T${i + 1}: ${f}`));

      turnResults.push({
        scenarioId: rec.scenarioId,
        turnIndex: t.turnIndex ?? i + 1,
        propertyId,
        providerModel: t.providerModel || 'unknown',
        verificationStatus: vStatus,
        toolsExecuted,
        execution_status,
        grounding_status,
        business_accuracy,
        goal_completion,
        context_understanding,
        semantic_quality,
        media_delivery_status,
        latencyMs: t.latencyMs ?? 0,
        totalTokens: (t.promptTokens ?? 0) + (t.completionTokens ?? 0),
        findings,
        needsHumanReview,
        humanReviewReason,
      });
    }

    // Aggregate scenario level conservatively (worst state dominates)
    const execution_status: ExecutionStatusV3 = turnResults.some((t) => t.execution_status === 'BLOCKED')
      ? 'BLOCKED'
      : turnResults.some((t) => t.execution_status === 'DEGRADED')
        ? 'DEGRADED'
        : turnResults.some((t) => t.execution_status === 'FAILED_FALLBACK')
          ? 'FAILED_FALLBACK'
          : 'LIVE_COMPLETED';

    const grounding_status = turnResults.some((t) => t.grounding_status === 'CONTRADICTED')
      ? 'CONTRADICTED'
      : turnResults.some((t) => t.grounding_status === 'MISSING_EVIDENCE')
        ? 'MISSING_EVIDENCE'
        : turnResults.some((t) => t.grounding_status === 'INSUFFICIENT_EVIDENCE')
          ? 'INSUFFICIENT_EVIDENCE'
          : turnResults.some((t) => t.grounding_status === 'VERIFIED')
            ? 'VERIFIED'
            : 'NOT_APPLICABLE';

    const business_accuracy: BusinessAccuracyStatusV3 =
      execution_status === 'BLOCKED'
        ? 'NOT_EVALUATED'
        : turnResults.some((t) => t.business_accuracy === 'CONTRADICTED')
          ? 'CONTRADICTED'
          : turnResults.some((t) => t.business_accuracy === 'INSUFFICIENT_EVIDENCE')
            ? 'INSUFFICIENT_EVIDENCE'
            : 'ACCURATE';

    const goal_completion: GoalCompletionStatusV3 =
      execution_status === 'BLOCKED'
        ? 'NOT_EVALUATED'
        : turnResults.some((t) => t.goal_completion === 'INCOMPLETE')
          ? 'INCOMPLETE'
          : turnResults.some((t) => t.goal_completion === 'HUMAN_REVIEW_REQUIRED')
            ? 'HUMAN_REVIEW_REQUIRED'
            : 'COMPLETE';

    const context_understanding: ContextUnderstandingStatusV3 =
      execution_status === 'BLOCKED'
        ? 'NOT_EVALUATED'
        : turnResults.some((t) => t.context_understanding === 'TEMPORAL_LEAK')
          ? 'TEMPORAL_LEAK'
          : turnResults.some((t) => t.context_understanding === 'CONTEXT_DRIFT')
            ? 'CONTEXT_DRIFT'
            : turnResults.some((t) => t.context_understanding === 'HUMAN_REVIEW_REQUIRED')
              ? 'HUMAN_REVIEW_REQUIRED'
              : 'ALIGNED';

    const semantic_quality: SemanticQualityStatusV3 =
      execution_status === 'BLOCKED'
        ? 'NOT_EVALUATED'
        : turnResults.some((t) => t.semantic_quality === 'FAIL')
          ? 'FAIL'
          : turnResults.some((t) => t.semantic_quality === 'HUMAN_REVIEW_REQUIRED')
            ? 'HUMAN_REVIEW_REQUIRED'
            : turnResults.some((t) => t.semantic_quality === 'MINOR_ISSUE')
              ? 'MINOR_ISSUE'
              : 'PASS';

    const media_delivery_status: MediaDeliveryStatusV3 = turnResults.some(
      (t) => t.media_delivery_status === 'MISSING_ATTACHMENT'
    )
      ? 'MISSING_ATTACHMENT'
      : turnResults.some((t) => t.media_delivery_status === 'UNVERIFIED_MISSING_ARTIFACT')
        ? 'UNVERIFIED_MISSING_ARTIFACT'
        : turnResults.some((t) => t.media_delivery_status === 'DELIVERED')
          ? 'DELIVERED'
          : execution_status === 'BLOCKED'
            ? 'NOT_EVALUATED'
            : 'NOT_REQUESTED';

    const hasObjectiveFailure =
      execution_status !== 'LIVE_COMPLETED' ||
      business_accuracy === 'CONTRADICTED' ||
      grounding_status === 'CONTRADICTED' ||
      grounding_status === 'MISSING_EVIDENCE' ||
      goal_completion === 'INCOMPLETE' ||
      (context_understanding !== 'ALIGNED' && context_understanding !== 'HUMAN_REVIEW_REQUIRED') ||
      semantic_quality === 'FAIL' ||
      media_delivery_status === 'MISSING_ATTACHMENT';

    const hasPendingHumanReview =
      execution_status === 'LIVE_COMPLETED' &&
      !hasObjectiveFailure &&
      (turnResults.some((t) => t.needsHumanReview) ||
        goal_completion === 'HUMAN_REVIEW_REQUIRED' ||
        semantic_quality === 'HUMAN_REVIEW_REQUIRED' ||
        context_understanding === 'HUMAN_REVIEW_REQUIRED' ||
        media_delivery_status === 'UNVERIFIED_MISSING_ARTIFACT');

    const terminal_outcome: TerminalOutcomeV3 =
      execution_status === 'BLOCKED'
        ? 'BLOCKED'
        : hasObjectiveFailure
          ? 'CONFIRMED_FAIL'
          : hasPendingHumanReview
            ? 'PENDING_HUMAN_REVIEW'
            : 'CONFIRMED_PASS';

    const quality_passed = terminal_outcome === 'CONFIRMED_PASS';
    const isFalsePass = terminal_outcome === 'CONFIRMED_FAIL' && historicalPassedFlag;
    const totalLatencyMs = turnResults.reduce((a, t) => a + t.latencyMs, 0);
    const providerModels = turnResults.map((t) => t.providerModel);
    const hasProviderFailover = turnsRaw.some((t) => Boolean(t.isFallback));

    return {
      scenarioId: rec.scenarioId,
      propertyId,
      split: rec.split || scenarioSpec?.split || 'unknown',
      category: rec.category || scenarioSpec?.category || 'unknown',
      gitCommit,
      effectivePolicyVersion,
      historicalPassedFlag,
      execution_status,
      grounding_status,
      business_accuracy,
      goal_completion,
      context_understanding,
      semantic_quality,
      media_delivery_status,
      terminal_outcome,
      quality_passed,
      isFalsePass,
      needsHumanReview: terminal_outcome === 'PENDING_HUMAN_REVIEW',
      humanReviewReasons: humanReasons,
      findings: scenarioFindings,
      operational_metrics: {
        turnCount: turnResults.length,
        totalLatencyMs,
        avgLatencyMs: turnResults.length > 0 ? Math.round(totalLatencyMs / turnResults.length) : 0,
        totalTokens: turnResults.reduce((a, t) => a + t.totalTokens, 0),
        hasProviderFailover,
        providerModels,
        blockedReason: rec.blockedReason,
      },
      turns: turnResults,
    };
  }

  /**
   * Independent rate/truth checker verifying VND claims against the canonical catalog of propertyId.
   */
  private evaluateCanonicalRateAccuracy(
    propertyId: CoSoMa,
    userMsg: string,
    resp: string
  ): { contradictions: string[] } {
    const contradictions: string[] = [];
    const mentions = extractVndMentions(resp);
    if (mentions.length === 0) return { contradictions };

    const rooms = this.dataset.phong.filter((r) => r.co_so_ma === propertyId);
    const allAllowed = new Set<number>([0]);
    for (const r of rooms) {
      const bp = r.gia_goc_dataset;
      if (!bp) continue;
      for (const base of [bp.nghi_gio_2h, bp.qua_dem, bp.ngay_dem, bp.gio_phat_sinh_ap_dung]) {
        if (typeof base === 'number') {
          allAllowed.add(base);
        }
      }
      // Valid 2h + N extra hours (N = 1..6) for base dataset rate
      for (let ext = 1; ext <= 6; ext++) {
        allAllowed.add(bp.nghi_gio_2h + ext * bp.gio_phat_sinh_ap_dung);
        allAllowed.add(ext * bp.gio_phat_sinh_ap_dung);
      }
    }

    // Also include Hà Đông weekend daytime rates (Standard 180k, Deluxe 315k, Concept 449k + N*100k/200k)
    if (propertyId === 'jacayl-ha-dong') {
      for (const wkBase of [180000, 315000, 449000]) {
        allAllowed.add(wkBase);
        for (let ext = 1; ext <= 6; ext++) {
          allAllowed.add(wkBase + ext * 100000);
          allAllowed.add(wkBase + ext * 200000);
        }
      }
    }

    // Pre-build user-mentioned numbers to avoid flagging echoed budgets (like 600k/400k/800k)
    const userNums = new Set(extractVndMentions(userMsg).map((m) => m.amountVnd));

    for (const m of mentions) {
      if (userNums.has(m.amountVnd) && /ngân sách|tầm|dưới|khoảng|của bạn|của anh/i.test(m.sentenceLower)) {
        continue;
      }
      // Explicitly verify truncated unit error (e.g. "560 đ" or "700 đ") or fabricated rate ("450.000đ", "590.000đ", "750.000đ")
      if (!allAllowed.has(m.amountVnd)) {
        // Also allow pairwise diffs if delta phrasing
        if (!/chênh lệch|cao hơn|thấp hơn|rẻ hơn|tiết kiệm/i.test(m.sentenceLower)) {
          contradictions.push(
            `CANONICAL_RATE_MISMATCH: Amount ${m.raw} (${m.amountVnd.toLocaleString('vi-VN')}đ) is not a valid canonical rate or valid hourly sum for ${propertyId}.`
          );
        }
      }

      // Independent P0-3 per-room extra_hour_rate check & P0-1 role check on direct per-hour unit mentions
      const sLower = m.sentenceLower;
      const beforeM = resp.slice(Math.max(0, m.index - 28), m.index).toLowerCase();
      const afterM = resp.slice(m.index + m.raw.length, m.index + m.raw.length + 18).toLowerCase();
      const isBase2hOrTotalMention =
        /(?:2\s*(?:giờ|gio|h|tiếng)\s*đầu|giá\s*2\s*(?:giờ|gio|h|tiếng)|trọn\s*gói|tổng(?:\s*cộng|\s*tiền)?|=\s*$)/iu.test(
          beforeM
        );
      const isOwnPerHourUnit =
        !isBase2hOrTotalMention &&
        (/^\s*(?:\/\s*(?:giờ|gio|h|tiếng)(?![\p{L}\d])|mỗi\s*(?:giờ|gio|tiếng)(?![\p{L}\d]))/iu.test(afterM) ||
          /(?:phụ\s*thu\s*(?:thêm\s*)?(?:giờ|gio|tiếng)|mỗi\s*(?:giờ|gio|tiếng)(?:\s*(?:thêm|tiếp\s*theo))?|phát\s*sinh(?:\s*mỗi)?\s*(?:giờ|gio|tiếng)|(?:^|[\s\d(])[x×*])\s*[:là]*\s*$/iu.test(
            beforeM
          ));
      if (isOwnPerHourUnit) {
        for (const r of rooms) {
          const code = r.ma_phong.split('-')[0].toLowerCase();
          if (new RegExp(`(?<![\\p{L}\\d])${code}(?![\\p{L}\\d])`, 'i').test(sLower)) {
            const expectedExtra = r.gia_goc_dataset.gio_phat_sinh_ap_dung;
            if (m.amountVnd !== expectedExtra && !/\b(?:601|602)\b/.test(sLower.replace(code, ''))) {
              contradictions.push(
                `ORACLE_ROOM_EXTRA_RATE_MISMATCH: Room ${r.ma_phong} specifies canonical extra-hour rate ${expectedExtra.toLocaleString('vi-VN')}đ/h, not ${m.raw}.`
              );
            }
          }
        }
      }

      // Specific Hà Đông 4h Standard/Deluxe/Concept check when line names category & 4h total:
      if (propertyId === 'jacayl-ha-dong') {
        if (/standard/i.test(sLower) && /\b4\s*(?:tiếng|giờ|h)\b|2 giờ thêm/i.test(sLower) && /=\s*\d/.test(sLower)) {
          if (m.amountVnd === 259000) {
            contradictions.push('ARITHMETIC_TOTAL_MISMATCH: Standard 4h stated as 259.000đ instead of 359.000đ.');
          }
        }
        if (/deluxe/i.test(sLower) && /\b4\s*(?:tiếng|giờ|h)\b|2 giờ thêm/i.test(sLower) && /=\s*\d/.test(sLower)) {
          if (m.amountVnd === 379000) {
            contradictions.push('ARITHMETIC_TOTAL_MISMATCH: Deluxe 4h stated as 379.000đ instead of 479.000đ.');
          }
        }
      }
    }

    return { contradictions };
  }
}

/**
 * Stratified sampling selector for unrun scenarios:
 * - When targetTotal === 18 (Gate 3 Live Acceptance standard), enforces:
 *   - 6 HD + 6 TKC + 6 J Village
 *   - 5 photos_room_selection (4 HD, 1 TKC) + 4 amenities_features (4 TKC)
 *     + 4 requirement_context_changes (4 JV) + 3 faq_policies (2 JV, 1 supplementary TKC FAQ)
 *     + 2 pricing_time_packages (2 HD)
 *   - >= 12 multi-turn & >= 4 held_out scenarios, partitioned into 3 batches of 6 (2 HD + 2 TKC + 2 JV per batch)
 * - Strips synthetic Scenario ID suffixes and assigns rotated reference clocks.
 */
export function buildStratifiedSamplingManifest(
  all500: SimulationScenario[],
  completedScenarioIds: Set<string>,
  targetTotal = 18
): StratifiedManifestItem[] {
  const uncompleted = all500.filter((s) => !completedScenarioIds.has(s.id));
  const usedCleanOpenings = new Set<string>();
  const usedIds = new Set<string>();
  let clockCursor = 0;

  const pickBest = (
    prop: CoSoMa,
    cat: NeedCategory,
    count: number,
    preferMultiTurn = true,
    preferHeldOutFirst = false
  ): Array<{ sc?: SimulationScenario; supp?: StratifiedManifestItem }> => {
    const out: Array<{ sc?: SimulationScenario; supp?: StratifiedManifestItem }> = [];
    for (let k = 0; k < count; k++) {
      const wantHeldOut = k % 2 === (preferHeldOutFirst ? 0 : 1);
      const pool = uncompleted
        .filter((s) => s.propertyId === prop && s.category === cat && !usedIds.has(s.id))
        .sort((a, b) => {
          const splitA = (a.split === 'held_out') === wantHeldOut ? 1 : 0;
          const splitB = (b.split === 'held_out') === wantHeldOut ? 1 : 0;
          if (splitB !== splitA) return splitB - splitA;
          if (preferMultiTurn && b.turnsCount !== a.turnsCount) return b.turnsCount - a.turnsCount;
          return a.id.localeCompare(b.id);
        });

      const pick =
        pool.find((s) => !usedCleanOpenings.has(stripSyntheticScenarioIdSuffix(s.initialMessage).toLowerCase())) ||
        pool[0];
      if (pick) {
        usedIds.add(pick.id);
        usedCleanOpenings.add(stripSyntheticScenarioIdSuffix(pick.initialMessage).toLowerCase());
        out.push({ sc: pick });
      }
    }
    return out;
  };

  if (targetTotal === 18) {
    // Exact Gate 3 quota matrix across immutable 500 catalog + 1 explicit supplementary TKC FAQ scenario
    const hdSelected = [
      ...pickBest('jacayl-ha-dong', 'photos_room_selection', 4, true, false),
      ...pickBest('jacayl-ha-dong', 'pricing_time_packages', 2, true, true),
    ];
    const tkcFrom500 = [
      ...pickBest('jacayl-tran-khat-chan', 'photos_room_selection', 1, true, true),
      ...pickBest('jacayl-tran-khat-chan', 'amenities_features', 4, true, false),
    ];
    const jvSelected = [
      ...pickBest('j-village', 'requirement_context_changes', 4, true, false),
      ...pickBest('j-village', 'faq_policies', 2, false, true),
    ];

    const toManifestItem = (
      entry: { sc?: SimulationScenario; supp?: StratifiedManifestItem },
      batchGroup: 'batch_1' | 'batch_2' | 'batch_3'
    ): StratifiedManifestItem => {
      if (entry.supp) return { ...entry.supp, batchGroup };
      const sc = entry.sc!;
      const fx = REFERENCE_CLOCK_FIXTURES[clockCursor % REFERENCE_CLOCK_FIXTURES.length];
      clockCursor += 1;
      return {
        scenarioId: sc.id,
        propertyId: sc.propertyId,
        category: sc.category,
        split: sc.split,
        source: 'immutable_500_catalog',
        batchGroup,
        turnsCount: sc.turnsCount,
        conversationType: sc.turnsCount > 1 ? 'scripted_multi_turn' : 'single_turn_scripted',
        assignedReferenceClock: fx.clock,
        referenceClockLabel: fx.label,
        cleanTurnMessages: sc.turnSpecs.map((t) => stripSyntheticScenarioIdSuffix(t.userMessage)),
        originalInitialMessage: sc.initialMessage,
      };
    };

    // Immutable 500 catalog assigns 0 faq_policies to TKC, so supplement 1 isolated TKC FAQ item without altering 500 catalog
    const tkcFx = REFERENCE_CLOCK_FIXTURES[3];
    const supplementaryTkcFaq: StratifiedManifestItem = {
      scenarioId: 'PILOT-TKC-FAQ-001',
      propertyId: 'jacayl-tran-khat-chan',
      category: 'faq_policies',
      split: 'held_out',
      source: 'supplementary_tkc_faq',
      batchGroup: 'batch_3',
      turnsCount: 2,
      conversationType: 'scripted_multi_turn',
      assignedReferenceClock: tkcFx.clock,
      referenceClockLabel: tkcFx.label,
      cleanTurnMessages: [
        'Cơ sở Trần Khát Chân dịp lễ cuối tuần có phụ thu thêm tiền phòng hay phục vụ bữa sáng không em?',
        'Nếu anh đặt gói qua đêm mà trễ giờ trả phòng 12h trưa khoảng 10 phút rồi thêm 1 tiếng thì tính phí phát sinh sao em?',
      ],
      originalInitialMessage:
        'Cơ sở Trần Khát Chân dịp lễ cuối tuần có phụ thu thêm tiền phòng hay phục vụ bữa sáng không em?',
    };
    const tkcSelected = [...tkcFrom500, { supp: supplementaryTkcFaq }];

    // Interleave into 3 balanced batches of 6 (each batch has 2 HD + 2 TKC + 2 JV)
    const batches: Array<'batch_1' | 'batch_2' | 'batch_3'> = ['batch_1', 'batch_2', 'batch_3'];
    const result: StratifiedManifestItem[] = [];
    for (let b = 0; b < 3; b++) {
      const batchName = batches[b];
      result.push(toManifestItem(hdSelected[b * 2], batchName));
      result.push(toManifestItem(hdSelected[b * 2 + 1], batchName));
      result.push(toManifestItem(tkcSelected[b * 2], batchName));
      result.push(toManifestItem(tkcSelected[b * 2 + 1], batchName));
      result.push(toManifestItem(jvSelected[b * 2], batchName));
      result.push(toManifestItem(jvSelected[b * 2 + 1], batchName));
    }
    return result;
  }

  // Generic fallback for non-18 targetTotal calls
  const perPropertyTarget = Math.max(1, Math.floor(targetTotal / 3));
  const properties: CoSoMa[] = ['jacayl-ha-dong', 'jacayl-tran-khat-chan', 'j-village'];
  const categoryPriorityOrder: NeedCategory[] = [
    'photos_room_selection',
    'amenities_features',
    'requirement_context_changes',
    'faq_policies',
    'advice_preferences_budget',
    'availability_catalog_categories',
    'booking_handoff_closing',
    'pricing_time_packages',
  ];

  const selected: StratifiedManifestItem[] = [];
  for (const prop of properties) {
    const propPool = uncompleted.filter((s) => s.propertyId === prop);
    const chosenForProp: SimulationScenario[] = [];
    const chosenIds = new Set<string>();
    let preferHeldOut = false;

    for (const cat of categoryPriorityOrder) {
      if (chosenForProp.length >= perPropertyTarget) break;
      const catPool = propPool
        .filter((s) => s.category === cat && !chosenIds.has(s.id))
        .sort((a, b) => {
          const splitDiffA = (a.split === 'held_out') === preferHeldOut ? 1 : 0;
          const splitDiffB = (b.split === 'held_out') === preferHeldOut ? 1 : 0;
          if (splitDiffB !== splitDiffA) return splitDiffB - splitDiffA;
          return b.turnsCount - a.turnsCount;
        });

      const uniquePick =
        catPool.find((s) => !usedCleanOpenings.has(stripSyntheticScenarioIdSuffix(s.initialMessage).toLowerCase())) ||
        catPool[0];
      if (uniquePick) {
        chosenForProp.push(uniquePick);
        chosenIds.add(uniquePick.id);
        usedCleanOpenings.add(stripSyntheticScenarioIdSuffix(uniquePick.initialMessage).toLowerCase());
        preferHeldOut = !preferHeldOut;
      }
    }

    if (chosenForProp.length < perPropertyTarget) {
      const remainder = propPool
        .filter((s) => !chosenIds.has(s.id))
        .sort((a, b) => b.turnsCount - a.turnsCount);
      for (const cand of remainder) {
        if (chosenForProp.length >= perPropertyTarget) break;
        chosenForProp.push(cand);
        chosenIds.add(cand.id);
      }
    }

    for (let idx = 0; idx < chosenForProp.length; idx++) {
      const sc = chosenForProp[idx];
      const fx = REFERENCE_CLOCK_FIXTURES[clockCursor % REFERENCE_CLOCK_FIXTURES.length];
      clockCursor += 1;
      const bIdx = Math.min(2, Math.floor((idx * 3) / Math.max(1, chosenForProp.length)));
      selected.push({
        scenarioId: sc.id,
        propertyId: sc.propertyId,
        category: sc.category,
        split: sc.split,
        source: 'immutable_500_catalog',
        batchGroup: bIdx === 0 ? 'batch_1' : bIdx === 1 ? 'batch_2' : 'batch_3',
        turnsCount: sc.turnsCount,
        conversationType: sc.turnsCount > 1 ? 'scripted_multi_turn' : 'single_turn_scripted',
        assignedReferenceClock: fx.clock,
        referenceClockLabel: fx.label,
        cleanTurnMessages: sc.turnSpecs.map((t) => stripSyntheticScenarioIdSuffix(t.userMessage)),
        originalInitialMessage: sc.initialMessage,
      });
    }
  }

  return selected;
}
