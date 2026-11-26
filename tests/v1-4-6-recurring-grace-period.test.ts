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
import { AutomatedPricingOracle } from '../src/pricing/automated-pricing-oracle.js';
import { AgentToolGateway } from '../src/agent/agent-tools.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';

describe('J COLLECTION — BUSINESS POLICY ADDENDUM V1.4.6 (Recurring 10-Minute Grace Period)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const quoteEngine = new PreBookingQuoteEngine(dataset);

  it('1. Composes V1.4.4 -> V1.4.5 -> V1.4.6 cumulatively without losing Breakfast FALSE or V1.4.3 base compatibility', async () => {
    clearPricingPolicyConfigCache();
    const baseCfg = loadActivePricingPolicyConfig();
    expect(baseCfg.schema_version).toBe('1.4.3');

    const activePath = getOwnerPolicyAddendumPath();
    expect(activePath.replace(/\\/g, '/')).toContain('j_collection_business_policy_addendum_v1_4_6.json');

    const activeAddendum = loadOwnerPolicyAddendums();
    expect(activeAddendum).not.toBeNull();
    expect(activeAddendum!.policy_version).toBe('1.4.6');
    expect(activeAddendum!.extends_policy_version).toBe('1.4.5');
    expect(activeAddendum!.late_checkout?.grace_period_minutes).toBe(10);
    expect(activeAddendum!.late_checkout?.grace_period_mode).toBe('EVERY_EXTRA_HOUR_BOUNDARY');
    expect(activeAddendum!.late_checkout?.rounding_method).toBe('CEIL_AFTER_RECURRING_GRACE');

    // Breakfast FALSE from V1.4.5 MUST be preserved when V1.4.6 is active
    expect(activeAddendum!.breakfast?.included_in_room_rate).toBe(false);
    expect(activeAddendum!.breakfast?.service_available).toBe(false);
    expect(activeAddendum!.breakfast?.separate_service_availability).toBe('FALSE');

    // Historical V1.4.4 & V1.4.5 remain auditable without polluting active cache
    expect(loadOwnerPolicyAddendums(getV144PolicyAddendumPath())?.breakfast?.separate_service_availability).toBe('UNKNOWN');
    expect(loadOwnerPolicyAddendums(getV145PolicyAddendumPath())?.policy_version).toBe('1.4.5');
    expect(loadOwnerPolicyAddendums()?.policy_version).toBe('1.4.6');

    const meta = getEffectivePolicyMetadata();
    expect(meta.basePolicyVersion).toBe('1.4.3');
    expect(meta.effectivePolicyVersion).toBe('1.4.6');
    expect(meta.activeAddendumId).toBe('J_COLLECTION_OWNER_POLICY_ADDENDUM_V1_4_6');
    expect(meta.supersededVersions).toContain('1.4.5');
    expect(meta.supersededVersions.some((v) => v.startsWith('1.4.4'))).toBe(true);

    const kb = new KnowledgeBase(dataset);
    expect(kb.getById('POLICY_BREAKFAST')?.version).toBe('1.4.5');
    expect(kb.getById('POLICY_LATE_CHECKOUT_PRICING')?.version).toBe('1.4.6');

    const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    const latePolicy = await gw.executeTool({
      toolCallId: 'pol_late',
      toolName: 'get_policies',
      arguments: { property_id: 'jacayl-ha-dong', topic: 'late_checkout' },
    });
    expect(latePolicy.status).toBe('SUCCESS');
    expect(latePolicy.data.effective_policy_version).toBe('1.4.6');
    expect(latePolicy.data.structured.grace_period_mode).toBe('EVERY_EXTRA_HOUR_BOUNDARY');

    const bfPolicy = await gw.executeTool({
      toolCallId: 'pol_bf',
      toolName: 'get_policies',
      arguments: { property_id: 'jacayl-ha-dong', topic: 'breakfast' },
    });
    expect(bfPolicy.data.structured.service_available).toBe(false);
    expect(bfPolicy.data.structured.separate_service_availability).toBe('FALSE');

    const validator = new ClaimLevelValidator(dataset);
    const vRes = validator.validate(
      'Dạ anh trả phòng lúc 13h05 thì bên em chỉ tính thêm 1 tiếng thôi ạ, vì mỗi mốc giờ đều có ân hạn 10 phút.',
      { facility: 'jacayl-ha-dong' }
    );
    expect(vRes.rejected_claims).toEqual([]);
    expect(vRes.verified_claims.some((c) => c.includes('VERIFIED_RECURRING_OVERTIME_GRACE_V1_4_6'))).toBe(true);
  });

  it('2. Section VI.A Boundary Tests: precomputed independent table across all 20 minute boundaries (0..191m), pre-12:00 checkout & Asia/Ho_Chi_Minh cross-day', () => {
    // Hardcoded independent Owner acceptance table (minute offset past 12:00 -> expected billable hours)
    const expectedBoundaries: Array<{ lateMinutes: number; expectedBillableHours: number }> = [
      { lateMinutes: 0, expectedBillableHours: 0 },
      { lateMinutes: 1, expectedBillableHours: 0 },
      { lateMinutes: 9, expectedBillableHours: 0 },
      { lateMinutes: 10, expectedBillableHours: 0 },
      { lateMinutes: 11, expectedBillableHours: 1 },
      { lateMinutes: 59, expectedBillableHours: 1 },
      { lateMinutes: 60, expectedBillableHours: 1 },
      { lateMinutes: 61, expectedBillableHours: 1 },
      { lateMinutes: 69, expectedBillableHours: 1 },
      { lateMinutes: 70, expectedBillableHours: 1 },
      { lateMinutes: 71, expectedBillableHours: 2 },
      { lateMinutes: 119, expectedBillableHours: 2 },
      { lateMinutes: 120, expectedBillableHours: 2 },
      { lateMinutes: 121, expectedBillableHours: 2 },
      { lateMinutes: 129, expectedBillableHours: 2 },
      { lateMinutes: 130, expectedBillableHours: 2 },
      { lateMinutes: 131, expectedBillableHours: 3 },
      { lateMinutes: 180, expectedBillableHours: 3 },
      { lateMinutes: 190, expectedBillableHours: 3 },
      { lateMinutes: 191, expectedBillableHours: 4 },
    ];

    const standardMs = new Date('2026-11-26T12:00:00+07:00').getTime();
    for (const row of expectedBoundaries) {
      const targetIso = new Date(standardMs + row.lateMinutes * 60000)
        .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
        .replace(' ', 'T') + '+07:00';

      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '405-1st-time',
        stay_type: 'qua_dem',
        checkin_datetime: '2026-11-25T22:00:00+07:00',
        checkout_datetime: targetIso,
      });

      const oracle = AutomatedPricingOracle.computeExpected(
        dataset,
        'jacayl-ha-dong',
        '405-1st-time',
        'qua_dem',
        '2026-11-25T22:00:00+07:00',
        1,
        targetIso
      );

      expect(quote.actual_late_checkout_minutes).toBe(row.lateMinutes);
      expect(quote.billable_extra_hours).toBe(row.expectedBillableHours);
      expect(quote.grace_period_minutes).toBe(10);
      expect(quote.grace_period_mode).toBe('EVERY_EXTRA_HOUR_BOUNDARY');
      expect(quote.effective_policy_version).toBe('1.4.6');
      expect(quote.total_estimate).toBe(420000 + row.expectedBillableHours * 100000);
      expect(oracle.expected_total).toBe(420000 + row.expectedBillableHours * 100000);
    }

    // Checkout BEFORE standard 12:00 (e.g. 11:30) => 0 late minutes, 0 extra fee
    const earlyCheckout = quoteEngine.getQuote({
      co_so_ma: 'jacayl-ha-dong',
      ma_phong: '405-1st-time',
      stay_type: 'qua_dem',
      checkin_datetime: '2026-11-25T22:00:00+07:00',
      checkout_datetime: '2026-11-26T11:30:00+07:00',
    });
    expect(earlyCheckout.actual_late_checkout_minutes).toBe(0);
    expect(earlyCheckout.billable_extra_hours).toBe(0);
    expect(earlyCheckout.total_estimate).toBe(420000);

    // Cross-day post-midnight check-in (01:15 AM on Nov 26) -> standard 12:00 SAME day Nov 26; 13:10 => 70m => 1h
    const postMidnight = quoteEngine.getQuote({
      co_so_ma: 'jacayl-ha-dong',
      ma_phong: '405-1st-time',
      stay_type: 'qua_dem',
      checkin_datetime: '2026-11-26T01:15:00+07:00',
      checkout_datetime: '2026-11-26T13:10:00+07:00',
    });
    expect(postMidnight.standard_checkout).toBe('2026-11-26T12:00:00+07:00');
    expect(postMidnight.billable_extra_hours).toBe(1);
    expect(postMidnight.total_estimate).toBe(520000);
  });

  it('3. Section VI.B Ha Dong Room 405 (420k qua_dem / 520k ngay_dem / 100k extra) via quote_price tool', async () => {
    const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');

    const checkin22Cases: Array<{ checkoutTime: string; expectedTotal: number; expectedExtraHours: number }> = [
      { checkoutTime: '12:10', expectedTotal: 420000, expectedExtraHours: 0 },
      { checkoutTime: '12:11', expectedTotal: 520000, expectedExtraHours: 1 },
      { checkoutTime: '13:05', expectedTotal: 520000, expectedExtraHours: 1 },
      { checkoutTime: '13:10', expectedTotal: 520000, expectedExtraHours: 1 },
      { checkoutTime: '13:11', expectedTotal: 620000, expectedExtraHours: 2 },
      { checkoutTime: '14:10', expectedTotal: 620000, expectedExtraHours: 2 },
      { checkoutTime: '14:11', expectedTotal: 720000, expectedExtraHours: 3 },
      { checkoutTime: '15:10', expectedTotal: 720000, expectedExtraHours: 3 },
    ];

    for (const c of checkin22Cases) {
      const res = await gw.executeTool({
        toolCallId: `hd405_22_${c.checkoutTime}`,
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-ha-dong',
          room_id: '405-1st-time',
          stay_type: 'qua_dem',
          stay_intent: 'overnight_until_next_day',
          duration_hours: 1,
          checkin_datetime: '2026-11-25T22:00:00+07:00',
          checkout_datetime: `2026-11-26T${c.checkoutTime}:00+07:00`,
        },
      });
      expect(res.data.stay_type).toBe('qua_dem');
      expect(res.data.base_package_price_vnd).toBe(420000);
      expect(res.data.billable_extra_hours).toBe(c.expectedExtraHours);
      expect(res.data.extra_hour_rate_vnd).toBe(100000);
      expect(res.data.total_price_vnd).toBe(c.expectedTotal);
      expect(res.data.effective_policy_version).toBe('1.4.6');
      expect(res.data.grace_period_mode).toBe('EVERY_EXTRA_HOUR_BOUNDARY');
      expect(res.data.unconfirmed_conditions.length).toBeGreaterThanOrEqual(0);
    }

    const checkin20Cases: Array<{ checkoutTime: string; expectedTotal: number; expectedExtraHours: number }> = [
      { checkoutTime: '12:10', expectedTotal: 520000, expectedExtraHours: 0 },
      { checkoutTime: '13:05', expectedTotal: 620000, expectedExtraHours: 1 },
      { checkoutTime: '14:10', expectedTotal: 720000, expectedExtraHours: 2 },
      { checkoutTime: '14:11', expectedTotal: 820000, expectedExtraHours: 3 },
    ];

    for (const c of checkin20Cases) {
      const res = await gw.executeTool({
        toolCallId: `hd405_20_${c.checkoutTime}`,
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-ha-dong',
          room_id: '405-1st-time',
          stay_type: 'qua_dem',
          stay_intent: 'overnight_until_next_day',
          duration_hours: 1,
          checkin_datetime: '2026-11-25T20:00:00+07:00',
          checkout_datetime: `2026-11-26T${c.checkoutTime}:00+07:00`,
        },
      });
      expect(res.data.stay_type).toBe('ngay_dem');
      expect(res.data.base_package_price_vnd).toBe(520000);
      expect(res.data.billable_extra_hours).toBe(c.expectedExtraHours);
      expect(res.data.total_price_vnd).toBe(c.expectedTotal);
    }
  });

  it('4. Section VI.C Ha Dong Rooms 601 & 602 (700k qua_dem / 780k ngay_dem / 200k extra) across V1.4.6 boundaries', async () => {
    const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    const checkin22Cases: Array<{ checkoutTime: string; expectedTotal: number; expectedExtraHours: number }> = [
      { checkoutTime: '13:10', expectedTotal: 900000, expectedExtraHours: 1 },
      { checkoutTime: '13:11', expectedTotal: 1100000, expectedExtraHours: 2 },
      { checkoutTime: '14:05', expectedTotal: 1100000, expectedExtraHours: 2 },
      { checkoutTime: '14:10', expectedTotal: 1100000, expectedExtraHours: 2 },
      { checkoutTime: '14:11', expectedTotal: 1300000, expectedExtraHours: 3 },
      { checkoutTime: '14:15', expectedTotal: 1300000, expectedExtraHours: 3 },
    ];

    for (const roomId of ['601-50-sac-thai', '602-playboy']) {
      for (const c of checkin22Cases) {
        const res = await gw.executeTool({
          toolCallId: `hd_${roomId}_${c.checkoutTime}`,
          toolName: 'quote_price',
          arguments: {
            property_id: 'jacayl-ha-dong',
            room_id: roomId,
            stay_type: 'qua_dem',
            stay_intent: 'overnight_until_next_day',
            duration_hours: 1,
            checkin_datetime: '2026-11-25T22:00:00+07:00',
            checkout_datetime: `2026-11-26T${c.checkoutTime}:00+07:00`,
          },
        });
        expect(res.data.base_package_price_vnd).toBe(700000);
        expect(res.data.extra_hour_rate_vnd).toBe(200000);
        expect(res.data.billable_extra_hours).toBe(c.expectedExtraHours);
        expect(res.data.extra_hour_subtotal_vnd).toBe(c.expectedExtraHours * 200000);
        expect(res.data.total_price_vnd).toBe(c.expectedTotal);
      }

      // Check-in 20:00 (ngay_dem 780k) -> checkout 14:10 = 1.180.000đ; 14:11 = 1.380.000đ
      const q1410 = await gw.executeTool({
        toolCallId: `hd20_${roomId}_1410`,
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-ha-dong',
          room_id: roomId,
          stay_type: 'qua_dem',
          stay_intent: 'overnight_until_next_day',
          duration_hours: 1,
          checkin_datetime: '2026-11-25T20:00:00+07:00',
          checkout_datetime: '2026-11-26T14:10:00+07:00',
        },
      });
      expect(q1410.data.stay_type).toBe('ngay_dem');
      expect(q1410.data.base_package_price_vnd).toBe(780000);
      expect(q1410.data.billable_extra_hours).toBe(2);
      expect(q1410.data.total_price_vnd).toBe(1180000);

      const q1411 = await gw.executeTool({
        toolCallId: `hd20_${roomId}_1411`,
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-ha-dong',
          room_id: roomId,
          stay_type: 'qua_dem',
          stay_intent: 'overnight_until_next_day',
          duration_hours: 1,
          checkin_datetime: '2026-11-25T20:00:00+07:00',
          checkout_datetime: '2026-11-26T14:11:00+07:00',
        },
      });
      expect(q1411.data.billable_extra_hours).toBe(3);
      expect(q1411.data.total_price_vnd).toBe(1380000);
    }
  });

  it('5. Section VI.D Multi-property Integrity: Room 601 across Ha Dong (1.100k), TKC (1.300k), and J Village (919k) at 22:00 -> 14:10', async () => {
    const cases: Array<{
      propertyId: 'jacayl-ha-dong' | 'jacayl-tran-khat-chan' | 'j-village';
      roomId: string;
      expectedBase: number;
      expectedRate: number;
      expectedTotal: number;
    }> = [
      { propertyId: 'jacayl-ha-dong', roomId: '601-50-sac-thai', expectedBase: 700000, expectedRate: 200000, expectedTotal: 1100000 },
      { propertyId: 'jacayl-tran-khat-chan', roomId: '601-golden-inox', expectedBase: 1100000, expectedRate: 100000, expectedTotal: 1300000 },
      { propertyId: 'j-village', roomId: '601-lagoon', expectedBase: 719000, expectedRate: 100000, expectedTotal: 919000 },
    ];

    for (const c of cases) {
      const gw = new AgentToolGateway(dataset, c.propertyId);
      const res = await gw.executeTool({
        toolCallId: `mp_601_${c.propertyId}`,
        toolName: 'quote_price',
        arguments: {
          property_id: c.propertyId,
          room_id: c.roomId,
          stay_type: 'qua_dem',
          stay_intent: 'overnight_until_next_day',
          duration_hours: 1,
          checkin_datetime: '2026-11-25T22:00:00+07:00',
          checkout_datetime: '2026-11-26T14:10:00+07:00',
        },
      });
      expect(res.data.room_identity.composite_key).toBe(`${c.propertyId}::${c.roomId}`);
      expect(res.data.base_package_price_vnd).toBe(c.expectedBase);
      expect(res.data.extra_hour_rate_vnd).toBe(c.expectedRate);
      expect(res.data.billable_extra_hours).toBe(2);
      expect(res.data.extra_hour_subtotal_vnd).toBe(c.expectedRate * 2);
      expect(res.data.total_price_vnd).toBe(c.expectedTotal);
      expect(res.data.effective_policy_version).toBe('1.4.6');
      expect(res.data.grace_period_mode).toBe('EVERY_EXTRA_HOUR_BOUNDARY');
    }
  });

  it('6. Odd-second and sub-minute millisecond precision at recurring 10-minute grace boundaries', () => {
    const cases: Array<{
      checkoutIso: string;
      expectedSeconds: number;
      expectedMinutes: number;
      expectedExtraHours: number;
      expectedTotal: number;
    }> = [
      { checkoutIso: '2026-11-26T12:00:30+07:00', expectedSeconds: 30, expectedMinutes: 0, expectedExtraHours: 0, expectedTotal: 420000 },
      { checkoutIso: '2026-11-26T12:10:00+07:00', expectedSeconds: 600, expectedMinutes: 10, expectedExtraHours: 0, expectedTotal: 420000 },
      { checkoutIso: '2026-11-26T12:10:00.500+07:00', expectedSeconds: 600, expectedMinutes: 10, expectedExtraHours: 1, expectedTotal: 520000 },
      { checkoutIso: '2026-11-26T12:10:01+07:00', expectedSeconds: 601, expectedMinutes: 10, expectedExtraHours: 1, expectedTotal: 520000 },
      { checkoutIso: '2026-11-26T13:09:59+07:00', expectedSeconds: 4199, expectedMinutes: 69, expectedExtraHours: 1, expectedTotal: 520000 },
      { checkoutIso: '2026-11-26T13:10:00+07:00', expectedSeconds: 4200, expectedMinutes: 70, expectedExtraHours: 1, expectedTotal: 520000 },
      { checkoutIso: '2026-11-26T13:10:01+07:00', expectedSeconds: 4201, expectedMinutes: 70, expectedExtraHours: 2, expectedTotal: 620000 },
      { checkoutIso: '2026-11-26T13:10:30+07:00', expectedSeconds: 4230, expectedMinutes: 70, expectedExtraHours: 2, expectedTotal: 620000 },
      { checkoutIso: '2026-11-26T14:10:00+07:00', expectedSeconds: 7800, expectedMinutes: 130, expectedExtraHours: 2, expectedTotal: 620000 },
      { checkoutIso: '2026-11-26T14:10:01+07:00', expectedSeconds: 7801, expectedMinutes: 130, expectedExtraHours: 3, expectedTotal: 720000 },
      { checkoutIso: '2026-11-26T14:10:59+07:00', expectedSeconds: 7859, expectedMinutes: 130, expectedExtraHours: 3, expectedTotal: 720000 },
    ];

    for (const c of cases) {
      const q = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '405-1st-time',
        stay_type: 'qua_dem',
        checkin_datetime: '2026-11-25T22:00:00+07:00',
        checkout_datetime: c.checkoutIso,
      });
      expect(q.is_resolved).toBe(true);
      expect(q.actual_late_checkout_seconds).toBe(c.expectedSeconds);
      expect(q.actual_late_checkout_minutes).toBe(c.expectedMinutes);
      expect(q.billable_extra_hours).toBe(c.expectedExtraHours);
      expect(q.total_estimate).toBe(c.expectedTotal);
      expect(q.effective_policy_version).toBe('1.4.6');
    }
  });
});
