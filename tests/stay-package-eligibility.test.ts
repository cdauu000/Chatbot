import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { StayPackageEligibilityResolver } from '../src/pricing/stay-package-eligibility.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('Business Policy V1.4.3 Golden Tests — Group C: Stay Package Eligibility & Overnight Boundaries', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const resolver = new StayPackageEligibilityResolver();
  const orchestrator = new ConversationOrchestrator(dataset);
  const FIXED_CLOCK = '2026-11-28T19:00:00+07:00'; // Saturday evening

  // C01: Check-in 20:00, ở đến trưa mai
  it('C01: Check-in 20:00 ở đến trưa mai -> ALTERNATIVE_PACKAGE_RECOMMENDED (ngày đêm), giải thích mốc 21:40', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T20:00:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.requested_stay_type).toBe('qua_dem');
    expect(res.recommended_stay_type).toBe('ngay_dem');
    expect(res.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
    expect(res.explanation_reason_code).toBe('TOO_EARLY_FOR_OVERNIGHT');
    expect(res.customer_explanation).toContain('21:40');
    expect(res.customer_explanation).toContain('Ngày Đêm');
    expect(res.alternative_option?.checkin_time).toContain('21:40');
  });

  // C02: Check-in 20:29, ở đến trưa mai
  it('C02: Check-in 20:29 ở đến trưa mai -> ALTERNATIVE_PACKAGE_RECOMMENDED (ngày đêm)', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T20:29:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.recommended_stay_type).toBe('ngay_dem');
    expect(res.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
    expect(res.explanation_reason_code).toBe('TOO_EARLY_FOR_OVERNIGHT');
    expect(res.customer_explanation).toContain('21:40');
  });

  // C03: Check-in 20:30, ở đến trưa mai
  it('C03: Check-in 20:30 ở đến trưa mai -> ALTERNATIVE_PACKAGE_RECOMMENDED (ngày đêm)', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T20:30:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.recommended_stay_type).toBe('ngay_dem');
    expect(res.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
    expect(res.explanation_reason_code).toBe('TOO_EARLY_FOR_OVERNIGHT');
    expect(res.customer_explanation).toContain('21:40');
  });

  // C04: Check-in 21:39, ở đến trưa mai
  it('C04: Check-in 21:39 ở đến trưa mai -> ALTERNATIVE_PACKAGE_RECOMMENDED (ngày đêm, chưa tới mốc 21:40)', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T21:39:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.recommended_stay_type).toBe('ngay_dem');
    expect(res.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
    expect(res.explanation_reason_code).toBe('TOO_EARLY_FOR_OVERNIGHT');
  });

  // C05: Check-in 21:40, ở đến trưa mai
  it('C05: Check-in 21:40 ở đến trưa mai -> EARLY_CHECKIN_GRACE_APPLIED (hỗ trợ sớm 20 phút áp giá qua đêm)', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T21:40:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.recommended_stay_type).toBe('qua_dem');
    expect(res.eligibility_status).toBe('EARLY_CHECKIN_GRACE_APPLIED');
    expect(res.explanation_reason_code).toBe('EARLY_OVERNIGHT_WITHIN_20_MIN');
    expect(res.customer_explanation).toContain('hỗ trợ nhận phòng sớm tối đa 20 phút');
  });

  // C06: Check-in 21:59, ở đến trưa mai
  it('C06: Check-in 21:59 ở đến trưa mai -> EARLY_CHECKIN_GRACE_APPLIED (áp giá qua đêm)', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T21:59:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.recommended_stay_type).toBe('qua_dem');
    expect(res.eligibility_status).toBe('EARLY_CHECKIN_GRACE_APPLIED');
  });

  // C07: Check-in 22:00, ở đến trưa mai
  it('C07: Check-in 22:00 ở đến trưa mai -> ELIGIBLE (khung giờ qua đêm chuẩn 22:00 - 12:00)', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T22:00:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.recommended_stay_type).toBe('qua_dem');
    expect(res.eligibility_status).toBe('ELIGIBLE');
    expect(res.explanation_reason_code).toBe('STANDARD_OVERNIGHT_CHECKIN');
  });

  // C08: Khách gửi tin nhắn lúc 20:00 nhưng ghi rõ "Tôi đến lúc 21:40"
  it('C08: Khách gửi tin lúc 20:00 nhưng ghi rõ đến lúc 21:40 -> áp dụng giá qua đêm', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'qua_dem',
      requested_checkin_datetime: '2026-11-28T21:40:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.recommended_stay_type).toBe('qua_dem');
    expect(res.eligibility_status).toBe('EARLY_CHECKIN_GRACE_APPLIED');
  });

  // C09: Multi-turn: Lượt 1 check-in 20:00 (ngày đêm), Lượt 2 khách đổi 21:40 (qua đêm)
  it('C09: Multi-turn: Lượt 1 check-in 20:00 (ngày đêm), Lượt 2 khách đổi 21:40 chuyển qua đêm thành công', async () => {
    const sessionId = 'test-c09-multiturn';
    const prevEngine = process.env.CONVERSATION_ENGINE;
    process.env.CONVERSATION_ENGINE = 'legacy';
    try {
      // Turn 1: 20:00
      const turn1 = await orchestrator.processTurn(
        sessionId,
        'Tôi muốn nhận phòng lúc 20:00 tối nay ở qua đêm đến trưa mai tại Hà Đông',
        FIXED_CLOCK
      );

      expect(turn1.updated_state.stay_type).toBe('qua_dem');
      expect(turn1.internal_trace.rules_triggered).toContain('STAY_ELIGIBILITY_ALTERNATIVE_PACKAGE_RECOMMENDED');
      expect(turn1.customer_visible_response).toContain('21:40');
      expect(turn1.customer_visible_response).toContain('Ngày Đêm');

      // Turn 2: Khách đổi sang 21:40
      const turn2 = await orchestrator.processTurn(
        sessionId,
        'Vậy để anh đổi sang 21:40 nhận phòng nhé',
        FIXED_CLOCK
      );

      expect(turn2.updated_state.checkin_datetime).toContain('21:40');
      expect(turn2.internal_trace.rules_triggered).toContain('STAY_ELIGIBILITY_EARLY_CHECKIN_GRACE_APPLIED');
      expect(turn2.customer_visible_response).toContain('20 phút');
    } finally {
      if (prevEngine === undefined) delete process.env.CONVERSATION_ENGINE;
      else process.env.CONVERSATION_ENGINE = prevEngine;
    }
  });

  // C10: Check-in 13:00 muốn ở ngày đêm -> NEEDS_POLICY_CLARIFICATION
  it('C10: Check-in 13:00 cho gói ngày đêm -> NEEDS_POLICY_CLARIFICATION (tiêu chuẩn từ 14:00)', () => {
    const res = resolver.resolve({
      facility_id: 'jacayl-ha-dong',
      requested_stay_type: 'ngay_dem',
      requested_checkin_datetime: '2026-11-28T13:00:00+07:00',
      stay_until_next_day: true,
    });

    expect(res.eligibility_status).toBe('NEEDS_POLICY_CLARIFICATION');
    expect(res.explanation_reason_code).toBe('UNRESOLVED_STAY_WINDOW');
    expect(res.customer_explanation).toContain('14:00');
    expect(res.customer_explanation).toContain('lễ tân');
  });
});
