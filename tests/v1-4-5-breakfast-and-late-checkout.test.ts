import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import {
  loadActivePricingPolicyConfig,
  loadOwnerPolicyAddendums,
  getOwnerPolicyAddendumPath,
  getV144PolicyAddendumPath,
  getV145PolicyAddendumPath,
  getEffectivePolicyMetadata,
  clearPricingPolicyConfigCache,
} from '../src/data-loader/pricing-policy-loader.js';
import { PreBookingQuoteEngine } from '../src/pricing/prebooking-quote-engine.js';
import { AgentToolGateway } from '../src/agent/agent-tools.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';

describe('J COLLECTION — BUSINESS POLICY ADDENDUM V1.4.5 (Breakfast FALSE & Late Checkout — Reconciled under V1.4.6)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const quoteEngine = new PreBookingQuoteEngine(dataset);

  it('1. Enforces addendum precedence V1.4.6 > V1.4.5 > V1.4.4, keeps V1.4.3 base compatibility, and audits V1.4.5 snapshot', () => {
    clearPricingPolicyConfigCache();
    const baseCfg = loadActivePricingPolicyConfig();
    expect(baseCfg.schema_version).toBe('1.4.3');

    const activePath = getOwnerPolicyAddendumPath();
    expect(activePath.replace(/\\/g, '/')).toContain('j_collection_business_policy_addendum_v1_4_6.json');

    const activeAddendum = loadOwnerPolicyAddendums();
    expect(activeAddendum).not.toBeNull();
    expect(activeAddendum!.policy_version).toBe('1.4.6');
    expect(activeAddendum!.extends_policy_version).toBe('1.4.5');
    // Breakfast FALSE introduced in V1.4.5 remains intact under V1.4.6
    expect(activeAddendum!.breakfast?.included_in_room_rate).toBe(false);
    expect(activeAddendum!.breakfast?.service_available).toBe(false);
    expect(activeAddendum!.breakfast?.separate_service_availability).toBe('FALSE');
    expect(activeAddendum!.late_checkout?.grace_period_minutes).toBe(10);
    expect(activeAddendum!.late_checkout?.standard_checkout_time).toBe('12:00');
    expect(activeAddendum!.late_checkout?.applies_to).toEqual(['qua_dem', 'ngay_dem']);

    // Explicitly loading V1.4.4 & V1.4.5 historical snapshots NEVER overwrites active cache
    const v144Historical = loadOwnerPolicyAddendums(getV144PolicyAddendumPath());
    expect(v144Historical?.breakfast?.separate_service_availability).toBe('UNKNOWN');
    const v145Historical = loadOwnerPolicyAddendums(getV145PolicyAddendumPath());
    expect(v145Historical?.policy_version).toBe('1.4.5');
    expect(v145Historical?.breakfast?.separate_service_availability).toBe('FALSE');
    expect(loadOwnerPolicyAddendums()?.policy_version).toBe('1.4.6');

    const meta = getEffectivePolicyMetadata();
    expect(meta.basePolicyVersion).toBe('1.4.3');
    expect(meta.effectivePolicyVersion).toBe('1.4.6');
    expect(meta.supersededVersions.some((v) => v.startsWith('1.4.4'))).toBe(true);
    expect(meta.supersededVersions).toContain('1.4.5');
  });

  it('2. Updates Breakfast KB, get_policies, and ClaimValidator to CONFIRMED FALSE across all 3 properties', async () => {
    const kb = new KnowledgeBase(dataset);
    const breakfastItem = kb.getById('POLICY_BREAKFAST');
    const lateItem = kb.getById('POLICY_LATE_CHECKOUT_PRICING');
    expect(breakfastItem?.version).toBe('1.4.5');
    expect(breakfastItem?.verification_status).toBe('CONFIRMED');
    expect(lateItem?.version).toBe('1.4.6');

    for (const prop of ['jacayl-ha-dong', 'jacayl-tran-khat-chan', 'j-village'] as const) {
      const gw = new AgentToolGateway(dataset, prop);
      const res = await gw.executeTool({
        toolCallId: `bf_${prop}`,
        toolName: 'get_policies',
        arguments: { property_id: prop, topic: 'breakfast' },
      });
      expect(res.status).toBe('SUCCESS');
      expect(res.data.effective_policy_version).toBe('1.4.6');
      expect(res.data.structured.included_in_room_rate).toBe(false);
      expect(res.data.structured.service_available).toBe(false);
      expect(res.data.structured.separate_service_availability).toBe('FALSE');
    }

    const validator = new ClaimLevelValidator(dataset);
    expect(
      validator.validate('Dạ bên em không phục vụ bữa sáng ạ.', { facility: 'jacayl-ha-dong' }).rejected_claims
    ).toEqual([]);
    expect(
      validator
        .validate('Dạ bên em có phục vụ bữa sáng nhẹ ạ.', { facility: 'jacayl-ha-dong' })
        .rejected_claims.some((c) => c.includes('REJECTED_BREAKFAST_SERVICE_AVAILABLE_CLAIM'))
    ).toBe(true);
  });

  it('3. Business Acceptance Cases A–D: Ha Dong 405 (100k/h) & 601/602 (200k/h) for both ngay_dem and qua_dem', async () => {
    const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');

    // Case A: 405 Check-in 20:00 -> Checkout 14:00 next day => ngay_dem 520k + 2h*100k = 720.000đ
    const caseA = await gw.executeTool({
      toolCallId: 'caseA',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '405-1st-time',
        stay_type: 'qua_dem',
        stay_intent: 'overnight_until_next_day',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T20:00:00+07:00',
        checkout_datetime: '2026-11-26T14:00:00+07:00',
      },
    });
    expect(caseA.data.stay_type).toBe('ngay_dem');
    expect(caseA.data.base_package_price_vnd).toBe(520000);
    expect(caseA.data.billable_extra_hours).toBe(2);
    expect(caseA.data.extra_hour_rate_vnd).toBe(100000);
    expect(caseA.data.extra_hour_subtotal_vnd).toBe(200000);
    expect(caseA.data.total_price_vnd).toBe(720000);
    expect(caseA.data.effective_policy_version).toBe('1.4.6');

    // Case B: 405 Check-in 22:00 -> Checkout 14:00 next day => qua_dem 420k + 2h*100k = 620.000đ
    const caseB = await gw.executeTool({
      toolCallId: 'caseB',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '405-1st-time',
        stay_type: 'qua_dem',
        stay_intent: 'overnight_until_next_day',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T22:00:00+07:00',
        checkout_datetime: '2026-11-26T14:00:00+07:00',
      },
    });
    expect(caseB.data.stay_type).toBe('qua_dem');
    expect(caseB.data.base_package_price_vnd).toBe(420000);
    expect(caseB.data.billable_extra_hours).toBe(2);
    expect(caseB.data.extra_hour_rate_vnd).toBe(100000);
    expect(caseB.data.extra_hour_subtotal_vnd).toBe(200000);
    expect(caseB.data.total_price_vnd).toBe(620000);

    // Case C: Ha Dong 601 (and 602) Check-in 20:00 -> Checkout 14:00 next day => ngay_dem 780k + 2h*200k = 1.180.000đ
    for (const roomId of ['601-50-sac-thai', '602-playboy']) {
      const caseC = await gw.executeTool({
        toolCallId: `caseC_${roomId}`,
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-ha-dong',
          room_id: roomId,
          stay_type: 'qua_dem',
          stay_intent: 'overnight_until_next_day',
          duration_hours: 1,
          checkin_datetime: '2026-11-25T20:00:00+07:00',
          checkout_datetime: '2026-11-26T14:00:00+07:00',
        },
      });
      expect(caseC.data.stay_type).toBe('ngay_dem');
      expect(caseC.data.base_package_price_vnd).toBe(780000);
      expect(caseC.data.billable_extra_hours).toBe(2);
      expect(caseC.data.extra_hour_rate_vnd).toBe(200000);
      expect(caseC.data.extra_hour_subtotal_vnd).toBe(400000);
      expect(caseC.data.total_price_vnd).toBe(1180000);
    }

    // Case D: Ha Dong 601 Check-in 22:00 -> Checkout 14:00 next day => qua_dem 700k + 2h*200k = 1.100.000đ
    const caseD = await gw.executeTool({
      toolCallId: 'caseD',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '601-50-sac-thai',
        stay_type: 'qua_dem',
        stay_intent: 'overnight_until_next_day',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T22:00:00+07:00',
        checkout_datetime: '2026-11-26T14:00:00+07:00',
      },
    });
    expect(caseD.data.stay_type).toBe('qua_dem');
    expect(caseD.data.base_package_price_vnd).toBe(700000);
    expect(caseD.data.billable_extra_hours).toBe(2);
    expect(caseD.data.extra_hour_rate_vnd).toBe(200000);
    expect(caseD.data.extra_hour_subtotal_vnd).toBe(400000);
    expect(caseD.data.total_price_vnd).toBe(1100000);
  });

  it('4. Business Acceptance Case E: 10-minute grace period reconciled to V1.4.6 recurring boundary grace', () => {
    // Under V1.4.6 (EVERY_EXTRA_HOUR_BOUNDARY), 13:01 & 13:10 => 1h (was 2h in V1.4.5) and 14:01 => 2h (was 3h in V1.4.5).
    const cases: Array<{ checkoutTime: string; expectedExtraHours: number; expectedExtraFee: number }> = [
      { checkoutTime: '2026-11-26T12:00:00+07:00', expectedExtraHours: 0, expectedExtraFee: 0 },
      { checkoutTime: '2026-11-26T12:09:00+07:00', expectedExtraHours: 0, expectedExtraFee: 0 },
      { checkoutTime: '2026-11-26T12:10:00+07:00', expectedExtraHours: 0, expectedExtraFee: 0 },
      { checkoutTime: '2026-11-26T12:11:00+07:00', expectedExtraHours: 1, expectedExtraFee: 100000 },
      { checkoutTime: '2026-11-26T13:00:00+07:00', expectedExtraHours: 1, expectedExtraFee: 100000 },
      { checkoutTime: '2026-11-26T13:01:00+07:00', expectedExtraHours: 1, expectedExtraFee: 100000 },
      { checkoutTime: '2026-11-26T13:10:00+07:00', expectedExtraHours: 1, expectedExtraFee: 100000 },
      { checkoutTime: '2026-11-26T14:00:00+07:00', expectedExtraHours: 2, expectedExtraFee: 200000 },
      { checkoutTime: '2026-11-26T14:01:00+07:00', expectedExtraHours: 2, expectedExtraFee: 200000 },
    ];

    for (const c of cases) {
      const q = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '405-1st-time',
        stay_type: 'qua_dem',
        checkin_datetime: '2026-11-25T22:00:00+07:00',
        checkout_datetime: c.checkoutTime,
      });
      expect(q.is_resolved).toBe(true);
      expect(q.billable_extra_hours).toBe(c.expectedExtraHours);
      expect(q.extra_hour_subtotal).toBe(c.expectedExtraFee);
      expect(q.total_estimate).toBe(420000 + c.expectedExtraFee);
    }
  });

  it('5. Business Acceptance Case F & Edge Cases: Composite room isolation (TKC 601 vs JV 601 vs HD 601), post-midnight check-in, and invalid reversed checkout', async () => {
    // TKC Room 601 (Golden Inox, extra_hour = 100k NOT 200k!)
    const gwTkc = new AgentToolGateway(dataset, 'jacayl-tran-khat-chan');
    const tkcOvernight = await gwTkc.executeTool({
      toolCallId: 'tkc_od',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-tran-khat-chan',
        room_id: '601-golden-inox',
        stay_type: 'qua_dem',
        stay_intent: 'overnight_until_next_day',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T22:00:00+07:00',
        checkout_datetime: '2026-11-26T14:00:00+07:00',
      },
    });
    expect(tkcOvernight.data.room_identity.composite_key).toBe('jacayl-tran-khat-chan::601-golden-inox');
    expect(tkcOvernight.data.extra_hour_rate_vnd).toBe(100000);
    expect(tkcOvernight.data.base_package_price_vnd).toBe(1100000);
    expect(tkcOvernight.data.total_price_vnd).toBe(1300000);

    // J Village Room 601 (Lagoon, extra_hour = 100k NOT 200k!)
    const gwJv = new AgentToolGateway(dataset, 'j-village');
    const jvDayNight = await gwJv.executeTool({
      toolCallId: 'jv_dn',
      toolName: 'quote_price',
      arguments: {
        property_id: 'j-village',
        room_id: '601-lagoon',
        stay_type: 'qua_dem',
        stay_intent: 'overnight_until_next_day',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T20:00:00+07:00',
        checkout_datetime: '2026-11-26T14:00:00+07:00',
      },
    });
    expect(jvDayNight.data.room_identity.composite_key).toBe('j-village::601-lagoon');
    expect(jvDayNight.data.stay_type).toBe('ngay_dem');
    expect(jvDayNight.data.extra_hour_rate_vnd).toBe(100000);
    expect(jvDayNight.data.base_package_price_vnd).toBe(1120000);
    expect(jvDayNight.data.total_price_vnd).toBe(1320000);

    // Cross-midnight check-in at 01:30 AM checks out at 12:00 SAME morning -> 13:00 same day = 1h extra
    const afterMidnight = quoteEngine.getQuote({
      co_so_ma: 'jacayl-ha-dong',
      ma_phong: '405-1st-time',
      stay_type: 'qua_dem',
      checkin_datetime: '2026-11-26T01:30:00+07:00',
      checkout_datetime: '2026-11-26T13:00:00+07:00',
    });
    expect(afterMidnight.standard_checkout).toBe('2026-11-26T12:00:00+07:00');
    expect(afterMidnight.billable_extra_hours).toBe(1);
    expect(afterMidnight.total_estimate).toBe(520000);

    // Reversed checkout earlier than checkin must fail validation cleanly
    const gwHd = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    const reversed = await gwHd.executeTool({
      toolCallId: 'rev',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '405-1st-time',
        stay_type: 'qua_dem',
        stay_intent: 'overnight_until_next_day',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T22:00:00+07:00',
        checkout_datetime: '2026-11-25T14:00:00+07:00',
      },
    });
    expect(reversed.data.pricing_status).toBe('INVALID_DATETIME');
    expect(reversed.data.total_price_vnd).toBeNull();
  });
});
