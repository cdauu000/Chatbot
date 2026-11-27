import { describe, it, expect, vi } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { JCollectionAgent } from '../src/agent/jcollection-agent.js';
import { LLMAdapter } from '../src/conversation/adapters/llm-adapter.interface.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';
import {
  computeDatasetVersionHash,
  invalidateStaleBusinessEvidence,
} from '../src/conversation/grounding/business-evidence.js';
import { CheckinPricingResolver } from '../src/pricing/checkin-pricing-resolver.js';
import { calculateLateCheckoutExtension } from '../src/pricing/quote-types.js';
import { OfflineEvaluationIntegrityAuditorV3 } from '../src/testing/lab/evaluation-integrity-v3.js';
import { loadActivePricingPolicyConfig } from '../src/data-loader/pricing-policy-loader.js';

function makeMockSequenceAdapter(sequence: Array<Record<string, any>>): LLMAdapter {
  let idx = 0;
  return {
    getProviderName: () => 'groq',
    isConfigured: () => true,
    callChatCompletion: vi.fn().mockImplementation(async () => {
      const payload = sequence[Math.min(idx, sequence.length - 1)];
      idx += 1;
      return {
        raw_content: JSON.stringify(payload),
        telemetry: {
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
          prompt_tokens: 450,
          completion_tokens: 140,
          total_tokens: 590,
          latency_ms: 60,
          retries_attempted: 0,
          isFallback: false,
        },
      };
    }),
  } as unknown as LLMAdapter;
}

describe('J COLLECTION V3.0 FINAL — Source-Verified Grounding Correction & Simplification (P0-1..P0-4 + Oracle)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const validator = new ClaimLevelValidator(dataset);
  const activeHash = computeDatasetVersionHash(dataset);

  it('P0-1a (False Acceptance Caught in Full Mock Runtime): Rejects EXTRA_HOUR_SUBTOTAL / BASE_2H / EXTRA_HOUR_RATE confusion and repairs via GROUNDING_GATE', async () => {
    const mockAdapter = makeMockSequenceAdapter([
      // Step 1: Model calls quote_price for 101-long-chim 4h on weekday (base=399k, extra=100k/h, extra_sub=200k, total=599k)
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Tra cứu báo giá 4 tiếng cho phòng 101 Hà Đông vào tối ngày thường.',
        tool_calls: [
          {
            tool_name: 'quote_price',
            arguments: {
              property_id: 'jacayl-ha-dong',
              room_id: '101-long-chim',
              stay_type: 'nghi_gio',
              duration_hours: 4,
              checkin_datetime: '2026-11-25T20:00:00+07:00',
              checkin_confidence: 'CONFIRMED',
            },
          },
        ],
      },
      // Step 2 (False Acceptance attempt): Conflates 200k EXTRA_HOUR_SUBTOTAL as EXTRA_HOUR_RATE ("200.000đ/giờ") and 399k BASE_2H as 4h TOTAL!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Trả lời giá 4 tiếng.',
        final_response:
          'Dạ phòng 101 — Lồng Chim nghỉ 4 tiếng có tổng giá là 399.000đ (nếu phát sinh thêm sẽ tính đơn giá 200.000đ/giờ) ạ.',
      },
      // Step 3 (Repaired after GROUNDING_GATE REVISE): Strict typed roles match cleanly
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Sửa lại đúng từng vai trò đơn giá 599k tổng, 399k 2h đầu, 100k/giờ phát sinh.',
        final_response:
          'Dạ phòng 101 — Lồng Chim nghỉ 4 tiếng (nhận 20:00 tối thứ Tư) có tổng chi phí là 599.000đ (gồm 2 giờ đầu 399.000đ + phụ thu 2 tiếng tiếp theo 200.000đ, đơn giá 100.000đ/giờ) ạ.',
      },
    ]);

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: mockAdapter,
      strictLiveOnly: true,
    });

    const res = await agent.processTurn('s-p0-1-runtime', 'Phòng 101 Lồng Chim 20h tối thứ Tư nghỉ 4 tiếng bao nhiêu tiền?');
    expect(res.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(res.decision_trace.decisionSteps.some((s) => s.phase === 'REVISE' && s.thoughtSummary.includes('GROUNDING_GATE'))).toBe(true);
    expect(res.customer_visible_response).toContain('599.000đ');
    expect(res.claim_validation.rejected_claims).toEqual([]);
  });

  it('P0-1b (False Rejection Prevention & Direct Role Isolation): Rejects PACKAGE_RATE as BASE_2H while allowing accurate breakdown on Attempt 1', async () => {
    const wrongRoleDirect = validator.validate(
      'Dạ phòng 201 — La Casta giá gói 2 tiếng đầu là 420.000đ ạ.',
      {
        facility: 'jacayl-ha-dong',
        expectedQuotes: [
          {
            propertyId: 'jacayl-ha-dong',
            roomId: '201-la-casta',
            stayType: 'nghi_gio',
            durationHours: 2,
            baseVnd: 159000,
            totalVnd: 159000,
          },
          {
            propertyId: 'jacayl-ha-dong',
            roomId: '201-la-casta',
            stayType: 'qua_dem',
            baseVnd: 420000,
            totalVnd: 420000,
          },
        ],
      }
    );
    expect(wrongRoleDirect.rejected_claims.some((c) => c.includes('REJECTED_PRICE_MISMATCH'))).toBe(true);

    // Accurate full breakdown in mock runtime must pass Attempt 1 cleanly without false REVISE!
    const cleanRuntime = makeMockSequenceAdapter([
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Tính giá 4 tiếng phòng 201 lúc 20:00 tối thứ Tư.',
        tool_calls: [
          {
            tool_name: 'quote_price',
            arguments: {
              property_id: 'jacayl-ha-dong',
              room_id: '201-la-casta',
              stay_type: 'nghi_gio',
              duration_hours: 4,
              checkin_datetime: '2026-11-25T20:00:00+07:00',
              checkin_confidence: 'CONFIRMED',
            },
          },
        ],
      },
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Báo đúng 359k tổng, 159k 2h đầu, 200k 2h thêm, 100k/giờ.',
        final_response:
          'Dạ phòng 201 — La Casta gói nghỉ 4 tiếng lúc 20:00 tối thứ Tư tổng chi phí 359.000đ (gồm 2h đầu 159.000đ + phụ thu 2 tiếng tiếp theo 200.000đ theo đơn giá 100.000đ/giờ) ạ.',
      },
    ]);
    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', { llmAdapter: cleanRuntime, strictLiveOnly: true });
    const res = await agent.processTurn('s-p0-1-clean', 'Phòng 201 nghỉ 4 tiếng từ 20h thứ Tư giá sao?');
    expect(res.decision_trace.decisionSteps.some((s) => s.phase === 'REVISE' && s.thoughtSummary.includes('GROUNDING_GATE'))).toBe(false);
    expect(res.claim_validation.rejected_claims).toEqual([]);
    expect(res.claim_validation.grounding_status).toBe('VERIFIED');
  });

  it('P0-2 (Full Mock Runtime Lifecycle): Blocks asserting INELIGIBLE qua_dem at 18:00 and invalidates weekend quote when guest shifts to weekday evening', async () => {
    // 1) False acceptance caught: guest arrives at 18:00 asking qua_dem -> INELIGIBLE (only ngay_dem 500k eligible, or 420k ONLY if waiting until 21:40)
    const adapter18h = makeMockSequenceAdapter([
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Kiểm tra điều kiện gói qua đêm lúc 18:00 cho phòng 201.',
        tool_calls: [
          {
            tool_name: 'quote_price',
            arguments: {
              property_id: 'jacayl-ha-dong',
              room_id: '201-la-casta',
              stay_type: 'qua_dem',
              stay_intent: 'overnight_until_next_day',
              checkin_datetime: '2026-11-25T18:00:00+07:00',
              checkin_confidence: 'CONFIRMED',
            },
          },
        ],
      },
      // Draft 1 falsely claims 420k qua_dem applies directly at 18:00!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Báo giá qua đêm 420k lúc 18:00.',
        final_response: 'Dạ anh nhận phòng 201 lúc 18:00 áp dụng gói qua đêm tổng giá 420.000đ đến 12h trưa hôm sau ạ.',
      },
      // Draft 2 respects eligibility & alternative condition cleanly (201 ngay_dem canonical rate = 520.000đ)
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Giải thích 18:00 chưa đủ điều kiện Qua đêm, tư vấn Ngày đêm 520k hoặc đợi 21:40.',
        final_response:
          'Dạ nhận phòng lúc 18:00 chưa đủ điều kiện áp dụng gói qua đêm (từ 22:00 / ân hạn 21:40), nên phù hợp nhất là gói ngày đêm phòng 201 giá 520.000đ đến 12:00 trưa hôm sau; nếu anh/chị đợi đến 21:40 mới nhận phòng thì dùng gói qua đêm 420.000đ ạ.',
      },
    ]);

    const agent1 = new JCollectionAgent(dataset, 'jacayl-ha-dong', { llmAdapter: adapter18h, strictLiveOnly: true });
    const res1 = await agent1.processTurn('s-p0-2-elig', '18h tối nay anh qua phòng 201 ở qua đêm đến trưa mai thì tính gói nào?');
    expect(res1.decision_trace.decisionSteps.some((s) => s.phase === 'REVISE' && s.thoughtSummary.includes('GROUNDING_GATE'))).toBe(true);
    expect(res1.customer_visible_response).toContain('520.000đ');
    expect(res1.claim_validation.rejected_claims).toEqual([]);

    // 2) Conditional time-window swap rejected (weekend rate 180k stated for weekday) & stale evidence invalidated on check-in window shift
    const condSwapCheck = validator.validate(
      'Dạ ngày thường nghỉ 2 tiếng phòng 201 giá 180.000đ ạ.',
      {
        facility: 'jacayl-ha-dong',
        expectedQuotes: [
          {
            propertyId: 'jacayl-ha-dong',
            roomId: '201-la-casta',
            stayType: 'nghi_gio',
            durationHours: 2,
            baseVnd: 159000,
            totalVnd: 159000,
            timeCondition: 'weekday_or_after_18',
            eligible: true,
          },
          {
            propertyId: 'jacayl-ha-dong',
            roomId: '201-la-casta',
            stayType: 'nghi_gio',
            durationHours: 2,
            baseVnd: 180000,
            totalVnd: 180000,
            timeCondition: 'weekend_daytime',
            eligible: true,
          },
        ],
      }
    );
    expect(condSwapCheck.rejected_claims.some((c) => c.includes('REJECTED_TIME_CONDITION_MISMATCH'))).toBe(true);

    // Evidence lifecycle check on window shift (weekend daytime -> weekday evening)
    const mockState: any = {
      trustedPropertyId: 'jacayl-ha-dong',
      turnCount: 1,
      verifiedBusinessEvidence: [
        {
          evidenceId: 'ev_wknd_q1',
          propertyId: 'jacayl-ha-dong',
          roomId: '201-la-casta',
          evidenceType: 'QUOTE',
          toolSource: 'quote_price',
          stayPackage: 'nghi_gio',
          amountVnd: 180000,
          durationHours: 2,
          checkinDatetime: '2026-11-28T15:00:00+07:00',
          effectivePolicyVersion: '1.4.6',
          datasetVersion: activeHash,
          validityScope: 'SESSION_WHILE_VALID',
          isValid: true,
          recordedTurn: 1,
        },
      ],
    };
    invalidateStaleBusinessEvidence(mockState, {
      propertyId: 'jacayl-ha-dong',
      stayType: 'nghi_gio',
      durationHours: 2,
      checkinDatetime: '2026-11-25T20:00:00+07:00',
      effectivePolicyVersion: '1.4.6',
      datasetVersion: activeHash,
    });
    expect(mockState.verifiedBusinessEvidence[0].isValid).toBe(false);
    expect(mockState.verifiedBusinessEvidence[0].invalidatedReason).toContain('CHECKIN_WINDOW_SHIFTED');
  });

  it('P0-3 (Per-Room Rate Precedence in Full Mock Runtime): Default 100k policy rate NEVER overrides room 601 specific 200k/h rate', async () => {
    const precedenceAdapter = makeMockSequenceAdapter([
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Tra cứu chính sách quá giờ và đơn giá riêng phòng 601.',
        tool_calls: [
          { tool_name: 'get_policies', arguments: { property_id: 'jacayl-ha-dong', topic: 'late_checkout' } },
          { tool_name: 'get_room_facts', arguments: { property_id: 'jacayl-ha-dong', room_id: '601-50-sac-thai' } },
        ],
      },
      // Draft 1 erroneously uses default 100.000đ/giờ for room 601!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Trả lời mức mặc định 100k/h cho phòng 601.',
        final_response: 'Dạ phòng 601 (50 Sắc Thái) trả phòng muộn sau 12:10 phụ thu 100.000đ/giờ ạ.',
      },
      // Draft 2 corrects to room-specific 200.000đ/giờ
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Sửa đúng đơn giá riêng của phòng 601 là 200.000đ/giờ.',
        final_response:
          'Dạ phòng 601 (50 — Sắc Thái) có ân hạn 10 phút đầu miễn phí (12:00–12:10 = 0đ), từ 12:11 tính theo đơn giá riêng của phòng là 200.000đ/giờ ạ.',
      },
    ]);

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', { llmAdapter: precedenceAdapter, strictLiveOnly: true });
    const res = await agent.processTurn('s-p0-3-prec', 'Phòng 601 Sắc Thái ở qua đêm mà trả phòng sau 12h thì phụ thu mỗi tiếng bao nhiêu?');
    expect(res.decision_trace.decisionSteps.some((s) => s.phase === 'REVISE' && s.thoughtSummary.includes('GROUNDING_GATE'))).toBe(true);
    expect(res.customer_visible_response).toContain('200.000đ');
    expect(res.claim_validation.rejected_claims).toEqual([]);

    // Engine/resolver default leakage guards
    const resolver = new CheckinPricingResolver(dataset);
    const missingRoom = resolver.resolvePrice({ co_so_ma: 'jacayl-ha-dong', ma_phong: '999-nonexistent', stay_type: 'nghi_gio' });
    expect(missingRoom.is_resolved).toBe(false);
    expect(missingRoom.extra_hour_rate).toBe(0);

    const invalidLate = calculateLateCheckoutExtension({
      stay_type: 'qua_dem',
      checkout_datetime: '2026-11-26T14:00:00+07:00',
      extra_hour_rate: 0,
    });
    expect(invalidLate.is_valid).toBe(false);
    expect(invalidLate.error_reason).toContain('MISSING_ROOM_EXTRA_HOUR_RATE');
  });

  it('P0-4 & Simplification: Content hash mutates on price/policy edit, rejects stale revisions, and validates structured claim_refs (::ROLE / #field)', () => {
    const mutatedDataset = {
      ...dataset,
      phong: dataset.phong.map((p, idx) =>
        idx === 0 ? { ...p, gia_goc_dataset: { ...p.gia_goc_dataset, nghi_gio_2h: p.gia_goc_dataset.nghi_gio_2h + 1000 } } : p
      ),
    };
    const mutatedHash = computeDatasetVersionHash(mutatedDataset);
    expect(activeHash.startsWith('rev#')).toBe(true);
    expect(mutatedHash).not.toBe(activeHash);

    const activePolicy = loadActivePricingPolicyConfig();
    const mutatedPolicy = { ...activePolicy, config_id: 'MUTATED_POLICY_REVISION' };
    expect(computeDatasetVersionHash(dataset, mutatedPolicy)).not.toBe(activeHash);

    // Reject stale dataset revision when evidence carries an old revision
    const staleCheck = validator.validate('Dạ phòng 201 giá 159.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      validEvidence: [
        {
          evidenceId: 'ev_stale_rev',
          propertyId: 'jacayl-ha-dong',
          roomId: '201-la-casta',
          evidenceType: 'QUOTE',
          toolSource: 'quote_price',
          stayPackage: 'nghi_gio',
          amountVnd: 159000,
          scopedRates: [{ amountVnd: 159000, role: 'TOTAL', roomId: '201-la-casta', stayPackage: 'nghi_gio', durationHours: 2, eligible: true }],
          effectivePolicyVersion: '1.4.6',
          datasetVersion: mutatedHash,
          validityScope: 'SESSION_WHILE_VALID',
          isValid: true,
          recordedTurn: 1,
        },
      ],
    });
    expect(staleCheck.rejected_claims.some((c) => c.includes('REJECTED_STALE_DATASET_REVISION'))).toBe(true);

    // Structured claim_refs (<evId>::ROLE and <evId>#field) pass when matched & fail when mismatched
    const evList = [
      {
        evidenceId: 'ev_q201_ref',
        propertyId: 'jacayl-ha-dong' as const,
        roomId: '201-la-casta',
        category: 'Standard',
        evidenceType: 'QUOTE' as const,
        toolSource: 'quote_price',
        stayPackage: 'nghi_gio' as const,
        amountVnd: 359000,
        durationHours: 4,
        scopedRates: [
          { amountVnd: 359000, role: 'TOTAL' as const, roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio' as const, durationHours: 4, eligible: true },
          { amountVnd: 159000, role: 'BASE_2H' as const, roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio' as const, durationHours: 2, eligible: true },
        ],
        fieldRefs: { total: 359000, base_2h: 159000 },
        effectivePolicyVersion: '1.4.6',
        datasetVersion: activeHash,
        validityScope: 'SESSION_WHILE_VALID' as const,
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const validRefRes = validator.validate('Dạ phòng 201 gói 4h là 359.000đ (2h đầu 159.000đ) ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: evList,
      structuredClaimRefs: ['ev_q201_ref::TOTAL', 'ev_q201_ref#base_2h'],
    });
    expect(validRefRes.rejected_claims).toEqual([]);

    const badRefRes = validator.validate('Dạ phòng 201 giá 159.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: evList,
      structuredClaimRefs: ['ev_q201_ref::TOTAL'],
    });
    expect(badRefRes.rejected_claims.some((c) => c.includes('REJECTED_CLAIM_REF_TEXT_MISMATCH'))).toBe(true);
  });

  it('Priority 6 Independent Oracle: Never fabricates missing deliveredMedia[] and never default-passes DEGRADED or ungrounded outputs', () => {
    const auditor = new OfflineEvaluationIntegrityAuditorV3(dataset);
    const fakeMediaAudit = auditor.evaluateCheckpointRecords(
      [
        {
          scenarioId: 'TEST-MISSING-MEDIA-ARTIFACT',
          propertyId: 'j-village',
          category: 'photos_room_selection',
          split: 'held_out',
          status: 'live_completed',
          businessPassed: true,
          turns: [
            {
              turnIndex: 1,
              userMessage: 'Cho mình xem ảnh phòng 202 Neon ở J Village nhé',
              deliveredResponse: 'Dạ em gửi kèm album hình ảnh phòng 202 Neon tại J Village ạ.',
              toolsExecuted: ['get_room_media'],
              verificationStatus: 'LIVE_LLM_DECISION_VERIFIED',
              deliveredMediaCount: 3, // count present, but actual deliveredMedia[] array omitted!
            },
          ],
        },
        {
          scenarioId: 'TEST-DEGRADED-NO-DEFAULT-PASS',
          propertyId: 'jacayl-ha-dong',
          category: 'pricing_time_packages',
          split: 'held_out',
          status: 'live_completed',
          businessPassed: true,
          turns: [
            {
              turnIndex: 1,
              userMessage: 'Phòng 601 trả phòng trễ 1 tiếng phụ thu bao nhiêu?',
              deliveredResponse: 'Dạ phòng 601 (50 — Sắc Thái) trả phòng muộn tính phụ thu 100.000đ/giờ ạ.',
              toolsExecuted: ['get_policies'],
              verificationStatus: 'DEGRADED_DETERMINISTIC_MODE',
            },
          ],
        },
      ],
      new Map()
    );

    const mediaRec = fakeMediaAudit.evaluatedRecords.find((r) => r.scenarioId === 'TEST-MISSING-MEDIA-ARTIFACT')!;
    expect(mediaRec.media_delivery_status).toBe('UNVERIFIED_MISSING_ARTIFACT');
    expect(mediaRec.terminal_outcome).toBe('PENDING_HUMAN_REVIEW');

    const degradedRec = fakeMediaAudit.evaluatedRecords.find((r) => r.scenarioId === 'TEST-DEGRADED-NO-DEFAULT-PASS')!;
    expect(degradedRec.terminal_outcome).toBe('CONFIRMED_FAIL');
    expect(degradedRec.semantic_quality).toBe('FAIL');
    expect(degradedRec.goal_completion).toBe('INCOMPLETE');
    expect(degradedRec.findings.some((f) => f.includes('ORACLE_ROOM_EXTRA_RATE_MISMATCH'))).toBe(true);

    // Non-empty hotline/VND text without canonical tool verification NEVER defaults to COMPLETE or ALIGNED
    const ungroundedHotlineAudit = auditor.evaluateCheckpointRecords(
      [
        {
          scenarioId: 'TEST-NO-KEYWORD-DEFAULT-PASS',
          propertyId: 'jacayl-ha-dong',
          category: 'faq_policies',
          split: 'held_out',
          status: 'live_completed',
          businessPassed: true,
          turns: [
            {
              turnIndex: 1,
              userMessage: 'Cho mình hỏi bên mình có xuất hóa đơn đỏ VAT hay nhận thanh toán thẻ không?',
              deliveredResponse: 'Dạ anh/chị vui lòng liên hệ trực tiếp quầy lễ tân hoặc hotline 0522 464 646 để được hỗ trợ ạ.',
              toolsExecuted: [],
              verificationStatus: 'LIVE_LLM_DECISION_VERIFIED',
            },
          ],
        },
      ],
      new Map()
    );
    const hotlineRec = ungroundedHotlineAudit.evaluatedRecords[0];
    expect(hotlineRec.goal_completion).toBe('HUMAN_REVIEW_REQUIRED');
    expect(hotlineRec.context_understanding).toBe('HUMAN_REVIEW_REQUIRED');
    expect(hotlineRec.terminal_outcome).toBe('PENDING_HUMAN_REVIEW');
  });

  it('Final Contract Completion: Enforces strict roleMatchesFact, full hash sensitivity (caption/description/provenance), missing/null/budget/ambiguous claim_refs, and {{ref:...}} backend rendering', async () => {
    // 1. roleMatchesFact: 'ANY' rejects EXTRA_HOUR_RATE (200k on 601 without per-hour framing);
    //    TOTAL missing duration rejects 4h hourly total; PACKAGE_RATE rejects surcharged TOTAL (520k)
    const lateOvernightEv = [
      {
        evidenceId: 'ev_q601_overnight',
        propertyId: 'jacayl-ha-dong' as const,
        roomId: '601-50-sac-thai',
        category: 'Concept',
        evidenceType: 'QUOTE' as const,
        toolSource: 'quote_price',
        stayPackage: 'qua_dem' as const,
        amountVnd: 900000, // 700k base + 200k 1h late checkout
        basePriceVnd: 700000,
        extraHourRateVnd: 200000,
        extraHourSubtotalVnd: 200000,
        scopedRates: [
          { amountVnd: 900000, role: 'TOTAL' as const, roomId: '601-50-sac-thai', stayPackage: 'qua_dem' as const, eligible: true, isBaseEquivalent: false },
          { amountVnd: 700000, role: 'PACKAGE_RATE' as const, roomId: '601-50-sac-thai', stayPackage: 'qua_dem' as const, eligible: true, isBaseEquivalent: true },
          { amountVnd: 200000, role: 'EXTRA_HOUR_RATE' as const, roomId: '601-50-sac-thai', stayPackage: 'EXTRA_HOUR' as const, eligible: true },
          { amountVnd: 200000, role: 'EXTRA_HOUR_SUBTOTAL' as const, roomId: '601-50-sac-thai', stayPackage: 'qua_dem' as const, eligible: true },
        ],
        fieldRefs: { total: 900000, package_rate: 700000, extra_hour_subtotal: 200000 },
        effectivePolicyVersion: '1.4.6',
        datasetVersion: activeHash,
        validityScope: 'SESSION_WHILE_VALID' as const,
        isValid: true,
        recordedTurn: 1,
      },
    ];
    // 'ANY' must reject 200k EXTRA_HOUR_RATE masquerading as package quote
    const anyVsExtraRate = validator.validate('Dạ phòng 601 giá 200.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: lateOvernightEv,
      effectivePolicyVersion: '1.4.6',
    });
    expect(anyVsExtraRate.rejected_claims.length).toBeGreaterThan(0);

    // 'PACKAGE_RATE' must reject non-equivalent surcharged TOTAL (900k labeled "giá gói")
    const pkgVsSurchargedTotal = validator.validate('Dạ phòng 601 giá gói qua đêm gốc là 900.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: lateOvernightEv,
      effectivePolicyVersion: '1.4.6',
    });
    expect(pkgVsSurchargedTotal.rejected_claims.some((r) => r.includes('REJECTED_PRICE_MISMATCH'))).toBe(true);

    // 'TOTAL' missing duration must reject 4h hourly total when "4 tiếng" is omitted
    const ev4h = [
      {
        evidenceId: 'ev_101_4h',
        propertyId: 'jacayl-ha-dong' as const,
        roomId: '101-long-chim',
        category: 'Concept',
        evidenceType: 'QUOTE' as const,
        toolSource: 'quote_price',
        stayPackage: 'nghi_gio' as const,
        durationHours: 4,
        amountVnd: 599000,
        scopedRates: [
          { amountVnd: 599000, role: 'TOTAL' as const, roomId: '101-long-chim', stayPackage: 'nghi_gio' as const, durationHours: 4, eligible: true },
        ],
        fieldRefs: { total: 599000, extra_hour_subtotal: null },
        effectivePolicyVersion: '1.4.6',
        datasetVersion: activeHash,
        validityScope: 'SESSION_WHILE_VALID' as const,
        isValid: true,
        recordedTurn: 1,
      },
    ];
    const totalWithoutDuration = validator.validate('Dạ phòng 101 tổng chi phí là 599.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: ev4h,
      effectivePolicyVersion: '1.4.6',
    });
    expect(totalWithoutDuration.rejected_claims.some((r) => r.includes('REJECTED_PRICE_MISMATCH'))).toBe(true);

    // 2. Claim_refs negative edges: missing #field, null #field (-> NEVER 0đ), missing amount in text, budget-only echo, ambiguous multi-condition role
    const missingField = validator.validate('Dạ phòng 101 nghỉ 4 tiếng tổng 599.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: ev4h,
      structuredClaimRefs: ['ev_101_4h#does_not_exist'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(missingField.rejected_claims.some((c) => c.includes('REJECTED_MISSING_FIELD_REF'))).toBe(true);

    const nullFieldZeroCheck = validator.validate('Dạ phòng 101 phụ thu 0đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: ev4h,
      structuredClaimRefs: ['ev_101_4h#extra_hour_subtotal'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(nullFieldZeroCheck.rejected_claims.some((c) => c.includes('REJECTED_MISSING_FIELD_REF'))).toBe(true);

    const refMissingFromText = validator.validate('Dạ em xin kiểm tra lại giúp anh ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: ev4h,
      structuredClaimRefs: ['ev_101_4h::TOTAL'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(refMissingFromText.rejected_claims.some((c) => c.includes('REJECTED_CLAIM_REF_TEXT_MISMATCH'))).toBe(true);

    const budgetBypassAttempt = validator.validate('Với ngân sách 599.000đ của anh, phòng 101 là lựa chọn đẹp nhất ạ.', {
      facility: 'jacayl-ha-dong',
      guestBudgetVnd: 599000,
      validEvidence: ev4h,
      structuredClaimRefs: ['ev_101_4h::TOTAL'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(budgetBypassAttempt.rejected_claims.some((c) => c.includes('REJECTED_CLAIM_REF_TEXT_MISMATCH'))).toBe(true);

    const condMultiEv = [
      {
        evidenceId: 'ev_cond_201',
        propertyId: 'jacayl-ha-dong' as const,
        roomId: '201-la-casta',
        category: 'Standard',
        evidenceType: 'QUOTE' as const,
        toolSource: 'quote_price',
        stayPackage: 'nghi_gio' as const,
        durationHours: 2,
        scopedRates: [
          { amountVnd: 159000, role: 'TOTAL' as const, roomId: '201-la-casta', stayPackage: 'nghi_gio' as const, durationHours: 2, timeCondition: 'weekday_or_after_18', eligible: true },
          { amountVnd: 180000, role: 'TOTAL' as const, roomId: '201-la-casta', stayPackage: 'nghi_gio' as const, durationHours: 2, timeCondition: 'weekend_daytime', eligible: true },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: activeHash,
        validityScope: 'CONDITIONAL' as const,
        isValid: true,
        recordedTurn: 1,
      },
    ];
    const ambiguousRefRes = validator.validate('Dạ phòng 201 giá 159.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: condMultiEv,
      structuredClaimRefs: ['ev_cond_201::TOTAL'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(ambiguousRefRes.rejected_claims.some((c) => c.includes('REJECTED_AMBIGUOUS_CLAIM_REF'))).toBe(true);

    const disambiguatedRefRes = validator.validate('Dạ phòng 201 ban ngày cuối tuần giá 180.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: condMultiEv,
      structuredClaimRefs: ['ev_cond_201::TOTAL@weekend_daytime'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(disambiguatedRefRes.rejected_claims).toEqual([]);

    // 3. Full Content Hash Sensitivity: caption, meta_description, and amenity provenance mutations ALL alter dataset hash
    const captionMutated = {
      ...dataset,
      phong: dataset.phong.map((p, idx) =>
        idx === 0 && p.anh.length > 0
          ? { ...p, anh: p.anh.map((a, aIdx) => (aIdx === 0 ? { ...a, nhan: `${a.nhan}_MODIFIED` } : a)) }
          : p
      ),
    };
    const descMutated = {
      ...dataset,
      phong: dataset.phong.map((p, idx) => (idx === 0 ? { ...p, meta_description: 'Modified canonical description' } : p)),
    };
    const amenityProvMutated = {
      ...dataset,
      phong: dataset.phong.map((p, idx) =>
        idx === 0
          ? {
              ...p,
              tien_nghi: {
                ...p.tien_nghi,
                bon_tam: { ...p.tien_nghi.bon_tam, source: 'MODIFIED_PROVENANCE' },
              },
            }
          : p
      ),
    };
    expect(computeDatasetVersionHash(captionMutated)).not.toBe(activeHash);
    expect(computeDatasetVersionHash(descMutated)).not.toBe(activeHash);
    expect(computeDatasetVersionHash(amenityProvMutated)).not.toBe(activeHash);

    // 4. Full Mock Runtime {{ref:...}} Backend Rendering:
    //    Invalid/ambiguous placeholder is caught by GROUNDING_GATE and valid qualified placeholder renders exact canonical VND!
    const runtimeRefAdapter = makeMockSequenceAdapter([
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Tra cứu báo giá điều kiện cho phòng 201 nghỉ 2 giờ.',
        tool_calls: [{ tool_name: 'quote_price', arguments: { property_id: 'jacayl-ha-dong', room_id: '201-la-casta', stay_type: 'nghi_gio', duration_hours: 2 } }],
      },
      // Attempt 1 tries an ambiguous {{ref:ev_quote_201-la-casta_t1_1::TOTAL}} across weekday & weekend quotes -> blocked by Grounding Gate!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Dùng placeholder mơ hồ không chỉ rõ khung giờ.',
        final_response: 'Dạ phòng 201 — La Casta gói 2 tiếng giá {{ref:ev_quote_201-la-casta_t1_1::TOTAL}} ạ.',
      },
      // Attempt 2 uses exact disambiguated structured refs so backend renders 159.000đ and 180.000đ cleanly!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Dùng placeholder phân biệt rõ ngày thường và cuối tuần.',
        final_response:
          'Dạ phòng 201 — La Casta nghỉ 2 tiếng có giá ngày thường / sau 18:00 là {{ref:ev_quote_201-la-casta_t1_1::TOTAL@weekday_or_after_18}} và ban ngày cuối tuần là {{ref:ev_quote_201-la-casta_t1_1::TOTAL@weekend_daytime}} ạ.',
      },
    ]);

    const runtimeAgent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: runtimeRefAdapter,
      strictLiveOnly: true,
    });
    const prevEnvCommit = process.env.IMMUTABLE_BUILD_COMMIT;
    process.env.IMMUTABLE_BUILD_COMMIT = 'immutable-test-sha-123';
    try {
      const rtRes = await runtimeAgent.processTurn('s-structured-render', 'Phòng 201 nghỉ 2 tiếng giá sao em?');
      expect(rtRes.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
      expect(rtRes.decision_trace.decisionSteps.some((s) => s.phase === 'REVISE' && s.thoughtSummary.includes('REJECTED_AMBIGUOUS_CLAIM_REF'))).toBe(true);
      expect(rtRes.customer_visible_response).toContain('159.000đ');
      expect(rtRes.customer_visible_response).toContain('180.000đ');
      expect(rtRes.customer_visible_response).not.toContain('{{ref:');
      expect(rtRes.claim_validation.rejected_claims).toEqual([]);
      expect(rtRes.claim_validation.grounding_status).toBe('VERIFIED');
      expect(rtRes.decision_trace.llmTelemetry?.buildIdentity?.commit).toBe('immutable-test-sha-123');
      expect(rtRes.decision_trace.llmTelemetry?.buildIdentity?.isImmutableStamp).toBe(true);
    } finally {
      if (prevEnvCommit === undefined) delete process.env.IMMUTABLE_BUILD_COMMIT;
      else process.env.IMMUTABLE_BUILD_COMMIT = prevEnvCommit;
    }
  });
});
