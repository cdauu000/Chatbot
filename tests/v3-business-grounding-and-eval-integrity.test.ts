import { describe, it, expect, vi } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';
import { JCollectionAgent } from '../src/agent/jcollection-agent.js';
import { LLMAdapter } from '../src/conversation/adapters/llm-adapter.interface.js';
import {
  AutonomousScenarioCatalogV22,
  SimulationScenario,
} from '../src/testing/lab/autonomous-customer-simulation-lab-v2-2.js';
import {
  buildStratifiedSamplingManifest,
  OfflineEvaluationIntegrityAuditorV3,
  stripSyntheticScenarioIdSuffix,
} from '../src/testing/lab/evaluation-integrity-v3.js';
import { BusinessEvidenceRecord } from '../src/agent/agent-contracts.js';
import { extractVndMentions } from '../src/conversation/grounding/business-evidence.js';
import { AgentToolGateway } from '../src/agent/agent-tools.js';
import { getHolidayPolicyProvenance } from '../src/data-loader/pricing-policy-loader.js';
import fs from 'node:fs';
import path from 'node:path';

function makeStructuredMockAdapter(sequence: Array<Record<string, any>>): LLMAdapter {
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
          prompt_tokens: 500,
          completion_tokens: 120,
          total_tokens: 620,
          latency_ms: 85,
          retries_attempted: 0,
          isFallback: false,
        },
      };
    }),
  } as unknown as LLMAdapter;
}

describe('J COLLECTION V3.0 FINAL — Business Grounding, Claim Validation & Evaluation Integrity (Offline Mutation & Replay)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const validator = new ClaimLevelValidator(dataset);

  it('1. Valid vs wrong prices (SCENARIO-033 & SCENARIO-009 cases): verifies 420k/560k/700k and rejects 450k/590k/750k & 259k', () => {
    const validEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_q_std',
        propertyId: 'jacayl-ha-dong',
        roomId: '201-la-casta',
        category: 'Standard',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'qua_dem',
        amountVnd: 420000,
        basePriceVnd: 420000,
        alternateAmountsVnd: [420000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
      {
        evidenceId: 'ev_q_dlx',
        propertyId: 'jacayl-ha-dong',
        roomId: '202-grand-canyon',
        category: 'Deluxe',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'qua_dem',
        amountVnd: 560000,
        basePriceVnd: 560000,
        alternateAmountsVnd: [560000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
      {
        evidenceId: 'ev_q_cpt',
        propertyId: 'jacayl-ha-dong',
        roomId: '601-50-sac-thai',
        category: 'Concept',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'qua_dem',
        amountVnd: 700000,
        basePriceVnd: 700000,
        alternateAmountsVnd: [700000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const good = validator.validate(
      'Giá qua đêm tại Hà Đông: Standard 420.000đ, Deluxe 560.000đ, Concept 700.000đ ạ.',
      { facility: 'jacayl-ha-dong', validEvidence, effectivePolicyVersion: '1.4.6' }
    );
    expect(good.grounding_status).toBe('VERIFIED');
    expect(good.rejected_claims).toEqual([]);

    const bad = validator.validate(
      'Giá qua đêm tại Hà Đông: Standard 450.000đ, Deluxe 590.000đ, Concept 750.000đ ạ.',
      { facility: 'jacayl-ha-dong', validEvidence, effectivePolicyVersion: '1.4.6' }
    );
    expect(bad.grounding_status).toBe('CONTRADICTED');
    expect(bad.rejected_claims.length).toBeGreaterThanOrEqual(3);
  });

  it('2. Correct price attached to WRONG room or stay package is rejected as CONTRADICTED', () => {
    const validEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_q_601_2h',
        propertyId: 'jacayl-ha-dong',
        roomId: '601-50-sac-thai',
        category: 'Concept',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'nghi_gio',
        durationHours: 2,
        amountVnd: 399000,
        basePriceVnd: 399000,
        alternateAmountsVnd: [399000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
      {
        evidenceId: 'ev_q_601_qd',
        propertyId: 'jacayl-ha-dong',
        roomId: '601-50-sac-thai',
        category: 'Concept',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'qua_dem',
        amountVnd: 700000,
        basePriceVnd: 700000,
        alternateAmountsVnd: [700000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
      {
        evidenceId: 'ev_q_201_qd',
        propertyId: 'jacayl-ha-dong',
        roomId: '201-la-casta',
        category: 'Standard',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'qua_dem',
        amountVnd: 420000,
        basePriceVnd: 420000,
        alternateAmountsVnd: [420000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    // Wrong package on Room 601: stating 399.000đ for qua_dem (true qua_dem is 700.000đ)
    const wrongPkg = validator.validate('Phòng 601 gói qua đêm có giá 399.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence,
      effectivePolicyVersion: '1.4.6',
    });
    expect(wrongPkg.grounding_status).toBe('CONTRADICTED');

    // Wrong room on 420.000đ: attaching Standard's 420.000đ overnight to Room 601
    const wrongRoom = validator.validate('Phòng 601 gói qua đêm giá 420.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence,
      effectivePolicyVersion: '1.4.6',
    });
    expect(wrongRoom.grounding_status).toBe('CONTRADICTED');
  });

  it('3. Valid price belonging to ANOTHER property (cross-property contamination) is rejected', () => {
    const hdEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_q_601_hd',
        propertyId: 'jacayl-ha-dong',
        roomId: '601-50-sac-thai',
        category: 'Concept',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'qua_dem',
        amountVnd: 700000,
        alternateAmountsVnd: [700000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    // 1.100.000đ is TKC 601 overnight, NOT Ha Dong 601 overnight
    const crossPrice = validator.validate('Phòng 601 gói qua đêm là 1.100.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: hdEvidence,
      effectivePolicyVersion: '1.4.6',
    });
    expect(crossPrice.grounding_status).toBe('CONTRADICTED');

    // Cross-property expectedQuote object itself rejected
    const crossQuoteObj = validator.validate('Giá qua đêm phòng 601 là 1.100.000đ.', {
      facility: 'jacayl-ha-dong',
      expectedQuotes: [
        { propertyId: 'jacayl-tran-khat-chan', roomId: '601-golden-inox', totalVnd: 1100000 },
      ],
      effectivePolicyVersion: '1.4.6',
    });
    expect(crossQuoteObj.grounding_status).toBe('CONTRADICTED');
  });

  it('4. VND formatting normalization & missing thousand units (SCENARIO-018: 420\u202f000\u202fđ vs 560 đ)', () => {
    const mentions = extractVndMentions('Standard 420\u202f000\u202fđ, Deluxe 560\u202fđ, 420k, 1,2 triệu, 0đ');
    expect(mentions.map((m) => m.amountVnd)).toEqual([420000, 560, 420000, 1200000, 0]);

    const res = validator.validate('Giá qua đêm: Standard 420\u202f000\u202fđ, Deluxe 560\u202fđ.', {
      facility: 'jacayl-ha-dong',
      expectedQuotes: [
        { roomId: '201-la-casta', category: 'Standard', stayType: 'qua_dem', totalVnd: 420000 },
        { roomId: '202-grand-canyon', category: 'Deluxe', stayType: 'qua_dem', totalVnd: 560000 },
      ],
      effectivePolicyVersion: '1.4.6',
    });
    expect(res.grounding_status).toBe('CONTRADICTED');
    expect(res.rejected_claims.some((r) => r.includes('560'))).toBe(true);
  });

  it('5. Valid 0đ fee (10-minute grace / holiday 0đ) is VERIFIED without false <10k rejection', () => {
    const res = validator.validate(
      'Trả muộn trong ân hạn 10 phút theo Policy V1.4.6: 0đ phát sinh, ngày lễ cũng phụ thu 0đ ạ.',
      {
        facility: 'jacayl-ha-dong',
        expectedQuotes: [
          {
            roomId: '405-1st-time',
            stayType: 'qua_dem',
            extraHourSubtotalVnd: 0,
            totalVnd: 420000,
          },
        ],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(res.grounding_status).toBe('VERIFIED');
    expect(res.rejected_claims).toEqual([]);
  });

  it('6. Customer-stated budget (e.g. 600k / 400k) is NOT_APPLICABLE and never triggers missing evidence or contradiction', () => {
    const res = validator.validate(
      'Với ngân sách 600.000đ của anh/chị, phòng 101 nghỉ 4 tiếng có tổng chi phí là 599.000đ ạ.',
      {
        facility: 'jacayl-ha-dong',
        guestBudgetVnd: 600000,
        expectedQuotes: [
          { roomId: '101-long-chim', category: 'Concept', stayType: 'nghi_gio', durationHours: 4, totalVnd: 599000 },
        ],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(res.grounding_status).toBe('VERIFIED');
    expect(res.rejected_claims).toEqual([]);
    const budgetCheck = res.claim_checks?.find((c) => c.normalized_value === 600000);
    expect(budgetCheck?.status).toBe('NOT_APPLICABLE');
  });

  it('7. Valid prior-turn evidence is reused on Turn 2 without forcing redundant tool call', async () => {
    const mockAdapter = makeStructuredMockAdapter([
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Lookup room 201 overnight quote',
        tool_calls: [{ tool_name: 'quote_price', arguments: { property_id: 'jacayl-ha-dong', room_id: '201-la-casta', stay_type: 'qua_dem' } }],
      },
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Reply with verified overnight quote',
        final_response: 'Dạ phòng 201 — La Casta gói qua đêm giá 420.000đ ạ.',
      },
      // Turn 2: Guest asks again or asks to reconfirm -> model reuses valid evidence from Turn 1 directly (0 tools on Turn 2!)
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Reuse still-valid Turn 1 quote evidence for 201 overnight',
        final_response: 'Dạ đúng rồi ạ, phòng 201 gói qua đêm vẫn là 420.000đ ạ.',
      },
    ]);

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: mockAdapter,
      strictLiveOnly: true,
    });

    const t1 = await agent.processTurn('s-reuse', 'Phòng 201 qua đêm bao nhiêu?', '2026-11-25T15:00:00+07:00');
    expect(t1.claim_validation?.grounding_status).toBe('VERIFIED');
    expect(t1.internal_trace.tools_executed).toEqual(['quote_price']);

    const t2 = await agent.processTurn('s-reuse', 'Chốt lại giá qua đêm 201 giúp mình nhé', '2026-11-25T15:01:00+07:00');
    expect(t2.internal_trace.tools_executed).toEqual([]); // Reused without redundant tool call!
    expect(t2.claim_validation?.grounding_status).toBe('VERIFIED');
    expect(t2.decision_trace?.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(t2.customer_visible_response).toContain('420.000đ');
  });

  it('8. Prior evidence becomes INVALIDATED when constraints change & Output Gate forces self-correction (replays SCENARIO-033 T2)', async () => {
    const mockAdapter = makeStructuredMockAdapter([
      // Turn 1: Quote 2h hourly for 201 (159k)
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Quote 2h hourly 201',
        tool_calls: [{ tool_name: 'quote_price', arguments: { property_id: 'jacayl-ha-dong', room_id: '201-la-casta', stay_type: 'nghi_gio', duration_hours: 2 } }],
      },
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Send 2h quote',
        final_response: 'Dạ phòng 201 nghỉ 2 tiếng ngày thường giá 159.000đ ạ.',
      },
      // Turn 2 Iteration 1: Guest asks qua_dem; model hallucinates 450.000đ without calling tool (SCENARIO-033 pattern!)
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Guess overnight price without tool',
        final_response: 'Dạ gói qua đêm phòng 201 là 450.000đ ạ.',
      },
      // Turn 2 Iteration 2 (after Output Gate feedback): Model self-corrects by calling quote_price!
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Call quote_price for verified qua_dem rate after grounding gate feedback',
        tool_calls: [{ tool_name: 'quote_price', arguments: { property_id: 'jacayl-ha-dong', room_id: '201-la-casta', stay_type: 'qua_dem' } }],
      },
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Respond with verified 420.000đ quote',
        final_response: 'Dạ gói qua đêm phòng 201 — La Casta giá 420.000đ ạ.',
      },
    ]);

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: mockAdapter,
      strictLiveOnly: true,
    });

    await agent.processTurn('s-sc33', 'Phòng 201 2 tiếng giá sao?', '2026-11-25T15:00:00+07:00');
    const t2 = await agent.processTurn('s-sc33', 'Thế lấy qua đêm từ 22h thì sao?', '2026-11-25T15:01:00+07:00');

    expect(t2.decision_trace?.decisionSteps.some((s) => s.phase === 'REVISE')).toBe(true);
    expect(t2.internal_trace.tools_executed).toContain('quote_price');
    expect(t2.customer_visible_response).toContain('420.000đ');
    expect(t2.customer_visible_response).not.toContain('450.000đ');
    expect(t2.claim_validation?.grounding_status).toBe('VERIFIED');
  });

  it('9. Valid structured claim_ref with wrong final_response price is caught as CONTRADICTED', () => {
    const validEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_quote_201_4h',
        propertyId: 'jacayl-ha-dong',
        roomId: '201-la-casta',
        category: 'Standard',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'nghi_gio',
        durationHours: 4,
        amountVnd: 359000,
        basePriceVnd: 159000,
        extraHourRateVnd: 100000,
        alternateAmountsVnd: [159000, 359000],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const res = validator.validate('Phòng 201 nghỉ 4 tiếng hết 259.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence,
      structuredClaimRefs: ['ev_quote_201_4h'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(res.grounding_status).toBe('CONTRADICTED');
    expect(res.rejected_claims.some((r) => r.includes('259'))).toBe(true);
  });

  it('10 & 11. Non-existent room asserted (SCENARIO-041 "Phòng 301") is blocked, while clarifying non-existence is ALLOWED', async () => {
    // 10. Assertion rejected (Unit)
    const badAssert = validator.validate('Ví dụ: Phòng 101, 201, 301 tại Hà Đông đều đang mở đón khách.', {
      facility: 'jacayl-ha-dong',
    });
    expect(badAssert.grounding_status).toBe('CONTRADICTED');
    expect(badAssert.rejected_claims.some((r) => r.includes('301'))).toBe(true);

    // 11. Clarification accepted without false rejection (Unit)
    const goodDeny = validator.validate('Dạ cơ sở Hà Đông hiện không có phòng 301 trong danh mục, tầng 3 bắt đầu từ phòng 302 ạ.', {
      facility: 'jacayl-ha-dong',
    });
    expect(goodDeny.rejected_claims).toEqual([]);
    expect(goodDeny.verified_claims.some((c) => c.includes('VERIFIED_NON_EXISTENT_ROOM_CLARIFICATION'))).toBe(true);

    // Exhausting retries on non-existent room blocks release of fake room number
    const stubHallucinating = makeStructuredMockAdapter([
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Suggest room 301 directly',
        final_response: 'Anh/chị có thể chọn Phòng 301 tại Hà Đông nhé.',
      },
    ]);
    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: stubHallucinating,
      strictLiveOnly: false,
    });
    const res = await agent.processTurn('s-sc41', 'Tư vấn giúp mình phòng ở Hà Đông', '2026-11-25T15:00:00+07:00');
    expect(res.customer_visible_response).not.toContain('301');
    expect(res.decision_trace?.verificationStatus).not.toBe('LIVE_LLM_DECISION_VERIFIED');
  });

  it('12. Media delivery consistency (SCENARIO-120 T3): catches raw URL without attachment & re-attaches via media_refs without auto-attaching ordinary turns', async () => {
    // Raw URL without deliveredMedia rejected
    const rawOnly = validator.validate(
      'Ảnh phòng 101: https://pub-a4f6c96b880a43f8a62e2085ac1159b8.r2.dev/sites/jcollection-booking/rooms/j-ha-dong/concept__101/cover.large.webp',
      { facility: 'jacayl-ha-dong', deliveredMedia: [] }
    );
    expect(rawOnly.grounding_status).toBe('CONTRADICTED');

    // Replay multi-turn media caching: Turn 1 get_room_media -> Turn 2 ordinary text (no auto photos) -> Turn 3 media_refs resend
    const mockAdapter = makeStructuredMockAdapter([
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Get photos of room 101',
        tool_calls: [{ tool_name: 'get_room_media', arguments: { property_id: 'jacayl-ha-dong', room_id: '101-long-chim' } }],
      },
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Show 101 album',
        final_response: 'Dạ em gửi anh/chị hình ảnh thực tế phòng 101 — Lồng Chim bên dưới ạ.',
      },
      // Turn 2: ordinary follow-up question mentioning 101 without photo request
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Confirm hotline cleanly without media_refs',
        final_response: 'Dạ để kiểm tra phòng 101 còn trống không, anh/chị liên hệ 0522 464 646 ạ.',
      },
      // Turn 3: guest explicitly asks to re-send photos -> model uses cached media_refs cleanly!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Re-send cached album for 101 via media_refs',
        media_refs: ['101-long-chim'],
        final_response: 'Dạ em gửi lại album ảnh phòng 101 — Lồng Chim ở ngay bên dưới ạ.',
      },
    ]);

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', { llmAdapter: mockAdapter });
    const t1 = await agent.processTurn('s-media', 'Cho xem ảnh phòng 101', '2026-11-25T15:00:00+07:00');
    expect(t1.images?.length).toBeGreaterThan(0);

    const t2 = await agent.processTurn('s-media', 'Phòng 101 có trống tối nay không?', '2026-11-25T15:01:00+07:00');
    expect(t2.images?.length ?? 0).toBe(0); // Never auto-attach photos when not requested!

    const t3 = await agent.processTurn('s-media', 'Gửi giúp mình ảnh chụp thực tế góc phòng này với ạ?', '2026-11-25T15:02:00+07:00');
    expect(t3.internal_trace.tools_executed).toEqual([]); // Reused cached media evidence cleanly!
    expect(t3.images?.length).toBeGreaterThan(0);
    expect(t3.room_presentations?.[0]?.roomId).toBe('101-long-chim');
  });

  it('13. Temporal hygiene (SCENARIO-035): rejects locking unconfirmed referenceClock 14:00 as arrival time when guest only said "chiều nay"', () => {
    const leaked = validator.validate(
      'Dạ, giá phòng nghỉ 4 tiếng (từ 14:00 chiều nay) tại Jacayl Hotel Hà Đông là 380.000đ ạ.',
      {
        facility: 'jacayl-ha-dong',
        referenceClock: '2026-11-28T14:00:00+07:00',
        userMessage: 'Cho mình xin thông tin chi phí phòng 4 tiếng tại Hà Đông chiều nay?',
        expectedQuotes: [{ roomId: '201-la-casta', stayType: 'nghi_gio', durationHours: 4, totalVnd: 380000 }],
      }
    );
    expect(leaked.grounding_status).toBe('CONTRADICTED');
    expect(leaked.rejected_claims.some((r) => r.includes('REFERENCE_CLOCK'))).toBe(true);

    // Conditional or user-specified hour MUST still be allowed (no false positive!)
    const allowedUserHour = validator.validate(
      'Dạ nhận phòng từ 14:00 chiều nay (cuối tuần) gói 4 tiếng giá 380.000đ ạ.',
      {
        facility: 'jacayl-ha-dong',
        referenceClock: '2026-11-28T14:00:00+07:00',
        userMessage: '14h chiều nay anh qua 4 tiếng hết bao nhiêu?',
        expectedQuotes: [{ roomId: '201-la-casta', stayType: 'nghi_gio', durationHours: 4, totalVnd: 380000 }],
      }
    );
    expect(allowedUserHour.rejected_claims).toEqual([]);
  });

  it('14. Policy version mismatch (deprecated V1.4.4 / wrong grace rule under V1.4.6) is caught', () => {
    const badPolicy = validator.validate(
      'Theo Policy V1.4.4, ân hạn 10 phút chỉ áp dụng một lần sau 12:00 trưa.',
      { facility: 'jacayl-ha-dong', effectivePolicyVersion: '1.4.6' }
    );
    expect(badPolicy.grounding_status).toBe('CONTRADICTED');
    expect(badPolicy.rejected_claims.some((r) => r.includes('POLICY_VERSION_MISMATCH'))).toBe(true);
  });

  it('15. Verifies generated 8-axis offline re-evaluation (54 scenarios / 96 turns) and stratified 18-scenario manifest cleanly', () => {
    const checkpoint = JSON.parse(
      fs.readFileSync(path.resolve('artifacts', 'live-500-batches', 'live-500-checkpoint.json'), 'utf-8')
    );
    const catalog = new AutonomousScenarioCatalogV22(2026);
    const all500 = catalog.generate500Scenarios();
    const catMap = new Map<string, SimulationScenario>(all500.map((s) => [s.id, s]));

    const auditor = new OfflineEvaluationIntegrityAuditorV3(dataset);
    const result = auditor.evaluateCheckpointRecords(checkpoint.records, catMap);

    expect(result.summary.total_scenarios).toBe(54);
    expect(result.summary.total_turns).toBe(96);
    expect(result.summary.by_execution_status.LIVE_COMPLETED).toBe(52);
    expect(result.summary.by_execution_status.BLOCKED).toBe(2);

    // Verify all named False-PASS audit cases are explicitly caught in falsePassRegister!
    const fpIds = new Set(result.falsePassRegister.map((f) => f.scenarioId));
    for (const id of ['SCENARIO-009', 'SCENARIO-018', 'SCENARIO-027', 'SCENARIO-033', 'SCENARIO-035', 'SCENARIO-039', 'SCENARIO-041', 'SCENARIO-120']) {
      expect(fpIds.has(id)).toBe(true);
    }

    // Stratified 18 manifest invariants
    const completedIds = new Set<string>(
      checkpoint.records.filter((r: any) => r.status === 'live_completed').map((r: any) => r.scenarioId)
    );
    const manifest18 = buildStratifiedSamplingManifest(all500, completedIds, 18);
    expect(manifest18.length).toBe(18);
    expect(manifest18.filter((m) => m.propertyId === 'jacayl-ha-dong').length).toBe(6);
    expect(manifest18.filter((m) => m.propertyId === 'jacayl-tran-khat-chan').length).toBe(6);
    expect(manifest18.filter((m) => m.propertyId === 'j-village').length).toBe(6);
    expect(manifest18.filter((m) => m.category === 'photos_room_selection').length).toBe(5);
    expect(manifest18.filter((m) => m.category === 'amenities_features').length).toBe(4);
    expect(manifest18.filter((m) => m.category === 'requirement_context_changes').length).toBe(4);
    expect(manifest18.filter((m) => m.category === 'faq_policies').length).toBe(3);
    expect(manifest18.filter((m) => m.category === 'pricing_time_packages').length).toBe(2);
    expect(manifest18.filter((m) => m.conversationType === 'scripted_multi_turn').length).toBeGreaterThanOrEqual(12);
    expect(manifest18.filter((m) => m.split === 'held_out').length).toBeGreaterThanOrEqual(4);
    for (const batchName of ['batch_1', 'batch_2', 'batch_3'] as const) {
      expect(manifest18.filter((m) => m.batchGroup === batchName).length).toBe(6);
    }
    expect(result.summary.reconciliation_check_overlap_count).toBe(0);
    const outcomeSum =
      result.summary.by_terminal_outcome.CONFIRMED_PASS +
      result.summary.by_terminal_outcome.CONFIRMED_FAIL +
      result.summary.by_terminal_outcome.PENDING_HUMAN_REVIEW +
      result.summary.by_terminal_outcome.BLOCKED;
    expect(outcomeSum).toBe(54);
    // SCENARIO-007 and SCENARIO-014 belong in PENDING_HUMAN_REVIEW, NOT double-counted in falsePassRegister
    expect(fpIds.has('SCENARIO-007')).toBe(false);
    expect(fpIds.has('SCENARIO-014')).toBe(false);
    const hrIds = new Set(result.humanReviewQueue.map((h) => h.scenarioId));
    expect(hrIds.has('SCENARIO-007')).toBe(true);
    expect(hrIds.has('SCENARIO-014')).toBe(true);
    for (const m of manifest18) {
      expect(m.cleanTurnMessages[0]).toBe(stripSyntheticScenarioIdSuffix(m.originalInitialMessage));
      expect(m.cleanTurnMessages[0]).not.toMatch(/\[(ID-|heldout_|ho_)/i);
    }
  });

  it('16. False-rejection prevention: accepts "12:00 trưa", multi-category/package lines, and multi-hour subtotals when valid', () => {
    const sampleCatalog: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_cat_hd_test',
        propertyId: 'jacayl-ha-dong',
        evidenceType: 'CATALOG_SEARCH',
        toolSource: 'search_rooms',
        categoryRateSnapshots: [
          {
            category: 'Standard',
            base2hVnd: 159000,
            overnightVnd: 420000,
            base2hVnds: [159000, 180000],
            overnightVnds: [420000],
            hourlyExtendedVnds: [359000, 380000, 200000],
          },
          {
            category: 'Deluxe',
            base2hVnd: 279000,
            overnightVnd: 560000,
            base2hVnds: [279000, 315000],
            overnightVnds: [560000],
            hourlyExtendedVnds: [479000, 515000, 200000],
          },
          {
            category: 'Concept',
            base2hVnd: 399000,
            overnightVnd: 700000,
            base2hVnds: [399000, 449000],
            overnightVnds: [700000],
            hourlyExtendedVnds: [599000, 649000, 799000, 849000, 400000],
          },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const multiPhrase =
      '1. Standard: Giá từ 159.000đ/2 giờ (qua đêm từ 420.000đ).\n' +
      '2. Cuối tuần: 180.000đ đối với Standard, 315.000đ đối với Deluxe và 449.000đ đối với Concept.\n' +
      '3. Concept (601): 2h đầu 399.000đ + 2h thêm 400.000đ = 799.000đ.\n' +
      '4. Trả phòng trước 12:00 trưa hôm sau.';

    const check = validator.validate(multiPhrase, {
      facility: 'jacayl-ha-dong',
      validEvidence: sampleCatalog,
      effectivePolicyVersion: '1.4.6',
    });
    expect(check.rejected_claims).toEqual([]);
    expect(check.grounding_status).toBe('VERIFIED');
  });

  it('17. StayType change invalidates stale QUOTE evidence, while bathtub constraint retraction preserves valid quotes', async () => {
    const mockAdapter = makeStructuredMockAdapter([
      // Turn 1: quote Standard 2h
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Quote 2h hourly 201',
        tool_calls: [{ tool_name: 'quote_price', arguments: { property_id: 'jacayl-ha-dong', room_id: '201-la-casta', stay_type: 'nghi_gio', duration_hours: 2 } }],
      },
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Quote 2h Standard',
        final_response: 'Dạ phòng 201 nghỉ 2 tiếng ngày thường giá 159.000đ ạ.',
      },
      // Turn 2: retract bathtub -> MUST NOT wipe prior valid quote; still can quote 159.000đ!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Reuse still-valid 201 2h quote after retracting bathtub preference',
        final_response: 'Dạ nếu không cần bồn tắm thì phòng 201 vẫn áp dụng giá 159.000đ/2 giờ ạ.',
      },
      // Turn 3: guest explicitly switches stayType to ngay_dem -> stale nghi_gio quote invalidated! Attempt to repeat 159.000đ as ngay_dem is caught!
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Wrongly cite old hourly price for day_night',
        final_response: 'Dạ gói cả ngày phòng 201 giá 159.000đ ạ.',
      },
      {
        action: 'CALL_TOOLS',
        thought_summary: 'Fetch actual ngay_dem quote for 201',
        tool_calls: [{ tool_name: 'quote_price', arguments: { property_id: 'jacayl-ha-dong', room_id: '201-la-casta', stay_type: 'ngay_dem' } }],
      },
      {
        action: 'RESPOND_DIRECTLY',
        thought_summary: 'Return verified day_night price',
        final_response: 'Dạ gói cả ngày (ngày đêm) phòng 201 — La Casta giá 520.000đ ạ.',
      },
    ]);

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: mockAdapter,
      strictLiveOnly: true,
    });

    const t1 = await agent.processTurn('s-retract-stay', 'Phòng 201 2 tiếng giá sao?', '2026-11-25T15:00:00+07:00');
    expect(t1.customer_visible_response).toContain('159.000đ');

    const t2 = await agent.processTurn('s-retract-stay', 'Thôi không cần bồn tắm nữa đâu em.', '2026-11-25T15:01:00+07:00');
    expect(t2.internal_trace.tools_executed).toEqual([]);
    expect(t2.claim_validation?.grounding_status).toBe('VERIFIED');

    const t3 = await agent.processTurn('s-retract-stay', 'Đổi sang gói cả ngày (ngày đêm) cho anh nhé.', '2026-11-25T15:02:00+07:00');
    expect(t3.decision_trace?.decisionSteps.some((s) => s.phase === 'REVISE')).toBe(true);
    expect(t3.internal_trace.tools_executed).toContain('quote_price');
    expect(t3.customer_visible_response).toContain('520.000đ');
  });

  it('18. ScopedRates blocks cross-package price confusion (e.g. ngay_dem 780k cited as qua_dem)', () => {
    const scopedEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_quote_601_elig',
        propertyId: 'jacayl-ha-dong',
        roomId: '601-50-sac-thai',
        category: 'Concept',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'qua_dem',
        amountVnd: 700000,
        alternateAmountsVnd: [700000, 780000],
        scopedRates: [
          { amountVnd: 700000, role: 'PACKAGE_RATE', roomId: '601-50-sac-thai', category: 'Concept', stayPackage: 'qua_dem' },
          { amountVnd: 780000, role: 'PACKAGE_RATE', roomId: '601-50-sac-thai', category: 'Concept', stayPackage: 'ngay_dem' },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const falsePkg = validator.validate('Phòng 601 gói qua đêm giá 780.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: scopedEvidence,
      effectivePolicyVersion: '1.4.6',
    });
    expect(falsePkg.grounding_status).toBe('CONTRADICTED');
    expect(falsePkg.rejected_claims.some((r) => r.includes('780'))).toBe(true);

    const exactPkg = validator.validate('Phòng 601 gói qua đêm giá 700.000đ, còn gói cả ngày (ngày đêm) là 780.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: scopedEvidence,
      effectivePolicyVersion: '1.4.6',
    });
    expect(exactPkg.rejected_claims).toEqual([]);
    expect(exactPkg.grounding_status).toBe('VERIFIED');
  });

  it('19. Rejects unverified real-time room vacancy assertions while allowing catalog disclaimer', () => {
    const fakeStock = validator.validate('Dạ phòng 201 tại Hà Đông hiện vẫn đang còn trống tối nay cho mình ạ.', {
      facility: 'jacayl-ha-dong',
    });
    expect(fakeStock.grounding_status).toBe('CONTRADICTED');
    expect(fakeStock.rejected_claims.some((r) => r.includes('VACANCY'))).toBe(true);

    const properDisclaimer = validator.validate(
      'Dạ phòng 201 có trong danh mục cơ sở Hà Đông ạ, nhưng hệ thống chưa kiểm tra trực tiếp tình trạng phòng trống theo thời gian thực nên mình vui lòng liên hệ lễ tân 0522 464 646 để giữ phòng nhé.',
      { facility: 'jacayl-ha-dong' }
    );
    expect(properDisclaimer.rejected_claims).toEqual([]);
  });

  it('20. Zero-fee (0đ) validation separates holiday vs grace-period evidence and rejects unrelated 0đ rentals', () => {
    const validGrace = validator.validate('Trễ 10 phút nằm trong mức ân hạn nên phụ phí quá giờ là 0đ ạ.', {
      facility: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
    });
    expect(validGrace.rejected_claims).toEqual([]);

    const badFreeRoom = validator.validate('Hôm nay bên em ưu đãi phòng Standard nghỉ 2 giờ đầu giá 0đ ạ.', {
      facility: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
    });
    expect(badFreeRoom.grounding_status).toBe('CONTRADICTED');
    expect(badFreeRoom.rejected_claims.some((r) => r.includes('INVALID_ZERO_PRICE'))).toBe(true);
  });

  it('21. Structured claim_refs accepts canonical roomIds grounded in active evidence and rejects ungrounded roomIds', () => {
    const validCatalogEv: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_search_hd',
        propertyId: 'jacayl-ha-dong',
        evidenceType: 'CATALOG_SEARCH',
        toolSource: 'search_rooms',
        catalogRoomIds: ['201-la-casta', '202-grand-canyon'],
        categoryRateSnapshots: [
          {
            category: 'Standard',
            base2hVnd: 159000,
            hourlyExtendedVnds: [359000],
          },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const validRoomRef = validator.validate('Phòng 201 nghỉ 4 tiếng ngày thường giá 359.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: validCatalogEv,
      structuredClaimRefs: ['201-la-casta'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(validRoomRef.rejected_claims).toEqual([]);
    expect(validRoomRef.grounding_status).toBe('VERIFIED');

    const badRoomRef = validator.validate('Phòng 201 nghỉ 4 tiếng giá 359.000đ ạ.', {
      facility: 'jacayl-ha-dong',
      validEvidence: validCatalogEv,
      structuredClaimRefs: ['999-nonexistent'],
      effectivePolicyVersion: '1.4.6',
    });
    expect(badRoomRef.grounding_status).toBe('CONTRADICTED');
    expect(badRoomRef.rejected_claims.some((r) => r.includes('REJECTED_INVALID_CLAIM_REF'))).toBe(true);
  });

  it('22. Turn-2 get_policies (late_checkout) + Turn-1 search_rooms allows Concept 602 200k extra hour & overnight 420k/560k/700k even alongside Turn-1 nghi_gio 4h QUOTE', () => {
    const mixedSessionEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_search_t1',
        propertyId: 'jacayl-ha-dong',
        evidenceType: 'CATALOG_SEARCH',
        toolSource: 'search_rooms',
        categoryRateSnapshots: [
          { category: 'Standard', overnightVnd: 420000, overnightVnds: [420000], extraHourRateVnd: 100000, extraHourRateVnds: [100000] },
          { category: 'Deluxe', overnightVnd: 560000, overnightVnds: [560000], extraHourRateVnd: 100000, extraHourRateVnds: [100000] },
          { category: 'Concept', overnightVnd: 700000, overnightVnds: [700000], extraHourRateVnd: 200000, extraHourRateVnds: [200000] },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
      {
        evidenceId: 'ev_quote_201_t1',
        propertyId: 'jacayl-ha-dong',
        roomId: '201-la-casta',
        category: 'Standard',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'nghi_gio',
        durationHours: 4,
        amountVnd: 359000,
        scopedRates: [{ amountVnd: 359000, role: 'TOTAL', roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio', durationHours: 4 }],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
      {
        evidenceId: 'ev_policy_t2',
        propertyId: 'jacayl-ha-dong',
        evidenceType: 'POLICY',
        toolSource: 'get_policies',
        alternateAmountsVnd: [100000, 200000],
        scopedRates: [
          { amountVnd: 100000, role: 'POLICY_RATE', stayPackage: 'EXTRA_HOUR' },
          { amountVnd: 200000, role: 'EXTRA_HOUR_RATE', roomId: '602-playboy', category: 'Concept', stayPackage: 'EXTRA_HOUR' },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 2,
      },
    ];

    const turn2Resp =
      'Gói qua đêm từ 22:00:\n' +
      '- Hạng Standard: 420.000đ\n' +
      '- Hạng Deluxe: 560.000đ\n' +
      '- Hạng Concept: 700.000đ\n' +
      'Phụ thu trễ sau 12:00 trưa: 100.000đ/giờ (riêng 602 Playboy là 200.000đ/giờ).';

    const check = validator.validate(turn2Resp, {
      facility: 'jacayl-ha-dong',
      validEvidence: mixedSessionEvidence,
      effectivePolicyVersion: '1.4.6',
    });
    expect(check.rejected_claims).toEqual([]);
    expect(check.grounding_status).toBe('VERIFIED');
  });

  it('23. 4h breakdown line ("380.000đ (2h đầu 180.000đ + 2h thêm 200.000đ)") does not misread "2h đầu" as 2h total scope', () => {
    const condEvidence: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_quote_201_4h_cond',
        propertyId: 'jacayl-ha-dong',
        roomId: '201-la-casta',
        category: 'Standard',
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: 'nghi_gio',
        durationHours: 4,
        scopedRates: [
          { amountVnd: 359000, role: 'TOTAL', roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio', durationHours: 4 },
          { amountVnd: 380000, role: 'TOTAL', roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio', durationHours: 4, timeCondition: 'weekend' },
          { amountVnd: 159000, role: 'BASE_2H', roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio', durationHours: 2 },
          { amountVnd: 180000, role: 'BASE_2H', roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio', durationHours: 2, timeCondition: 'weekend' },
          { amountVnd: 200000, role: 'EXTRA_HOUR_SUBTOTAL', roomId: '201-la-casta', category: 'Standard', stayPackage: 'nghi_gio', durationHours: 4 },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'CONDITIONAL',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const breakdownText =
      'Hạng Standard (phòng 201 — La Casta):\n' +
      '- Ngày thường: 359.000đ (2h đầu 159.000đ + 2h thêm 200.000đ)\n' +
      '- Ban ngày cuối tuần (T7-CN): 380.000đ (gồm 2h đầu 180.000đ, phụ thu 2 tiếng tiếp theo 200.000đ)';

    const check = validator.validate(breakdownText, {
      facility: 'jacayl-ha-dong',
      validEvidence: condEvidence,
      effectivePolicyVersion: '1.4.6',
    });
    expect(check.rejected_claims).toEqual([]);
    expect(check.grounding_status).toBe('VERIFIED');
  });

  it('24. Missing get_room_media when user explicitly requests room photos triggers MISSING_EVIDENCE (while clarification passes)', () => {
    const omittedMedia = validator.validate('Dạ phòng Crimson Suite bên J Village có bồn tắm và giá 2 tiếng 570.000đ ạ.', {
      facility: 'j-village',
      userMessage: 'Phòng Crimson Suite bên J Village có bồn tắm không và gửi giúp mình ảnh với giá 2 tiếng nhé',
      expectedQuotes: [{ propertyId: 'j-village', roomId: 'crimson-suite', stayType: 'nghi_gio', durationHours: 2, totalVnd: 570000 }],
      deliveredMedia: [],
    });
    expect(omittedMedia.grounding_status).toBe('MISSING_EVIDENCE');
    expect(omittedMedia.missing_evidence_claims.some((m) => m.includes('MISSING_MEDIA_ATTACHMENT'))).toBe(true);

    const clarifiedMissingRoom = validator.validate('Dạ tại J Village bên em không có phòng số 201 nên chưa có ảnh phòng này ạ.', {
      facility: 'j-village',
      userMessage: 'Cho mình xem ảnh phòng 201 tại J Village nhé.',
      deliveredMedia: [],
    });
    expect(clarifiedMissingRoom.missing_evidence_claims).toEqual([]);
  });

  it('25. Finding A — Heterogeneous Concept 4h category pricing rejects sole-tier rate and accepts full multi-tier / range presentation', async () => {
    const tools = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    const searchRes = await tools.executeTool({
      toolCallId: 'tc_find_a',
      toolName: 'search_rooms',
      arguments: { property_id: 'jacayl-ha-dong', category: 'Concept', must_have_amenities: [] },
    });
    const conceptSummary = searchRes.data.category_pricing_summary.find((s: any) => s.category === 'Concept');
    expect(conceptSummary).toBeDefined();
    expect(conceptSummary.is_uniform_across_rooms).toBe(false);
    expect(conceptSummary.ranges.extra_hour_rate_vnd).toEqual({ min: 100000, max: 200000 });

    const catSnapshotEv: BusinessEvidenceRecord[] = [
      {
        evidenceId: 'ev_search_hd_concept',
        propertyId: 'jacayl-ha-dong',
        evidenceType: 'CATALOG_SEARCH',
        toolSource: 'search_rooms',
        stayPackage: 'nghi_gio',
        categoryRateSnapshots: [
          {
            category: 'Concept',
            base2hVnds: [399000, 449000],
            extraHourRateVnds: [100000, 200000],
            hourlyExtendedVnds: [599000, 649000, 799000, 849000],
          },
        ],
        effectivePolicyVersion: '1.4.6',
        datasetVersion: 'canonical',
        validityScope: 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: 1,
      },
    ];

    const incompleteCategoryClaim = validator.validate(
      'Dạ hạng Concept nghỉ 4 tiếng ngày thường tại Hà Đông có giá 799.000đ (ví dụ phòng 101 — Lồng Chim hoặc 601 — 50 Sắc Thái) ạ.',
      {
        facility: 'jacayl-ha-dong',
        validEvidence: catSnapshotEv,
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(incompleteCategoryClaim.rejected_claims.some((c) => c.includes('REJECTED_INCOMPLETE_CATEGORY_PRICING'))).toBe(true);

    const completeRangeClaim = validator.validate(
      'Dạ hạng Concept nghỉ 4 tiếng ngày thường tại Hà Đông dao động từ 599.000đ (phòng 101 Lồng Chim) đến 799.000đ (phòng 601 50 Sắc Thái, 602 Playboy) ạ.',
      {
        facility: 'jacayl-ha-dong',
        validEvidence: catSnapshotEv,
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(completeRangeClaim.rejected_claims).toEqual([]);
    expect(completeRangeClaim.grounding_status).toBe('VERIFIED');
  });

  it('26. Finding B — Room <-> Category relation validation catches misattributed room categories across canonical rooms', () => {
    const misattributedHd = validator.validate(
      'Dạ bên Hà Đông hạng Deluxe gồm phòng 302 và phòng 305 rất rộng rãi ạ.',
      {
        facility: 'jacayl-ha-dong',
        validEvidence: [],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(
      misattributedHd.rejected_claims.some((c) => c.includes('REJECTED_ROOM_CATEGORY_RELATION') && c.includes('305'))
    ).toBe(true);

    const accurateSplitHd = validator.validate(
      'Dạ bên Hà Đông hạng Deluxe có phòng 302 (Barbie Bedroom) và hạng Standard có phòng 305 (Yêu I) ạ.',
      {
        facility: 'jacayl-ha-dong',
        validEvidence: [],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(accurateSplitHd.rejected_claims).toEqual([]);
  });

  it('27. Finding C — Holiday policy provenance requires OWNER_CONFIRMED_ACTIVE and treats unconfirmed policy as UNKNOWN', () => {
    const confirmedProv = getHolidayPolicyProvenance();
    expect(confirmedProv.confirmedByOwner).toBe(true);
    expect(confirmedProv.hasHolidaySurcharge).toBe(false);
    expect(confirmedProv.status).toBe('FALSE');
    expect(confirmedProv.approvalStatus).toBe('OWNER_CONFIRMED_ACTIVE');

    const unconfirmedCfg = {
      schema_version: '1.4.2',
      source_metadata: { status: 'UNCONFIRMED', source_type: 'UNKNOWN' },
      holiday_policy: { has_holiday_surcharge: false, status: 'UNCONFIRMED_HOLIDAY_POLICY' },
    } as any;
    const unconfirmedProv = getHolidayPolicyProvenance(unconfirmedCfg);
    expect(unconfirmedProv.confirmedByOwner).toBe(false);
    expect(unconfirmedProv.status).toBe('UNKNOWN');

    const unconfirmedZeroHoliday = validator.validate(
      'Dạ dịp lễ J Collection không phụ thu thêm (0đ phụ thu ngày lễ) ạ.',
      {
        facility: 'jacayl-tran-khat-chan',
        effectivePolicyVersion: '1.4.6',
        policyConfig: unconfirmedCfg,
        validEvidence: [
          {
            evidenceId: 'ev_pol_unconfirmed',
            propertyId: 'jacayl-tran-khat-chan',
            evidenceType: 'POLICY',
            toolSource: 'get_policies',
            stayPackage: 'ALL',
            holidayZeroConfirmed: false,
            effectivePolicyVersion: '1.4.6',
            datasetVersion: 'canonical',
            validityScope: 'SESSION_WHILE_VALID',
            isValid: true,
            recordedTurn: 1,
          },
        ],
      }
    );
    expect(unconfirmedZeroHoliday.rejected_claims.some((c) => c.includes('REJECTED_UNCONFIRMED_HOLIDAY_POLICY'))).toBe(true);
    expect(unconfirmedZeroHoliday.rejected_claims.some((c) => c.includes('REJECTED_INVALID_ZERO_PRICE'))).toBe(true);
  });

  it('28. Finding D — Website omission emits UNKNOWN in runtime tools and blocks categorical "không có" assertions', async () => {
    const jvTools = new AgentToolGateway(dataset, 'j-village');
    const facts202 = await jvTools.executeTool({
      toolCallId: 'tc_find_d_facts',
      toolName: 'get_room_facts',
      arguments: { property_id: 'j-village', room_id: '202-neon' },
    });
    expect(facts202.status).toBe('SUCCESS');
    expect(facts202.data.has_bathtub).toBe('UNKNOWN');

    const searchResult = await jvTools.executeTool({
      toolCallId: 'tc_find_d_search',
      toolName: 'search_rooms',
      arguments: { property_id: 'j-village', must_have_amenities: ['bon_tam'] },
    });
    expect(searchResult.data.excluded_candidates?.some((e: any) => String(e.reason).includes('UNKNOWN'))).toBe(true);

    const falseAbsenceClaim = validator.validate(
      'Dạ phòng 202 — Neon bên J Village không có bồn tắm đâu ạ.',
      {
        facility: 'j-village',
        validEvidence: [],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(falseAbsenceClaim.rejected_claims.some((c) => c.includes('REJECTED_UNVERIFIED_AMENITY_ABSENCE'))).toBe(true);

    const honestUnknownClaim = validator.validate(
      'Dạ hiện chưa có thông tin xác nhận chính thức về bồn tắm của phòng 202 — Neon trong dữ liệu hệ thống, để chắc chắn anh/chị liên hệ lễ tân kiểm tra giúp em nhé ạ.',
      {
        facility: 'j-village',
        validEvidence: [],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(honestUnknownClaim.rejected_claims).toEqual([]);
  });

  it('29. Finding E — Unconditional real-time vacancy guard rejects "đang còn trống" even with nearby disclaimer', () => {
    const disclaimedStockClaim = validator.validate(
      'Dạ phòng 201 — La Casta hiện đang còn trống phục vụ anh/chị nhé, vui lòng liên hệ trực tiếp lễ tân để xác nhận giữ phòng thực tế ạ.',
      {
        facility: 'jacayl-ha-dong',
        validEvidence: [],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(
      disclaimedStockClaim.rejected_claims.some((c) => c.includes('REJECTED_UNVERIFIED_VACANCY_CLAIM'))
    ).toBe(true);

    const honestStockDisclaimer = validator.validate(
      'Dạ bên em không thể xác nhận tình trạng phòng 201 còn trống hay không theo thời gian thực qua hệ thống; anh/chị vui lòng gọi hotline lễ tân để kiểm tra trực tiếp ạ.',
      {
        facility: 'jacayl-ha-dong',
        validEvidence: [],
        effectivePolicyVersion: '1.4.6',
      }
    );
    expect(honestStockDisclaimer.rejected_claims).toEqual([]);
  });
});
