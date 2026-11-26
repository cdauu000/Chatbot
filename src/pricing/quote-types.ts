import { CoSoMa, PricingStatusCode, StayType } from '../domain/types.js';
import { PricingResolutionOutput } from './pricing-types.js';
import { parseVietnamDateTime } from './checkin-pricing-resolver.js';
import { getEffectivePolicyMetadata, loadOwnerPolicyAddendums } from '../data-loader/pricing-policy-loader.js';

/**
 * J Collection AI Concierge - Pre-Booking Quote Types & Formulas
 * Strict validation: duration_hours must be a finite integer >= 2.
 * No fake pricing: If base_2h_price is undefined, total_estimate must be undefined.
 */

export interface PreBookingQuoteRequest {
  co_so_ma: CoSoMa;
  ma_phong: string;
  stay_type?: StayType; // defaults to 'nghi_gio'
  duration_hours?: number;
  checkin_datetime?: string;
  checkout_datetime?: string;
}

export interface LateCheckoutCalculation {
  is_valid: boolean;
  error_reason?: string;
  late_checkout_applied: boolean;
  standard_checkout: string;
  confirmed_checkout: string;
  grace_period_minutes: number;
  grace_period_mode: 'EVERY_EXTRA_HOUR_BOUNDARY' | 'FIRST_HOUR_ONLY';
  actual_late_checkout_minutes: number;
  actual_late_checkout_seconds?: number;
  billable_extra_hours: number;
  extra_hour_rate: number;
  extra_hour_subtotal: number;
  effective_policy_version: string;
}

export interface PreBookingQuoteResult {
  co_so_ma: CoSoMa;
  ma_phong: string;
  ten_phong: string;
  stay_type: StayType;
  duration_hours: number;
  is_resolved: boolean;
  base_2h_price?: number;
  extra_hours: number;
  extra_hour_rate: number;
  extra_hour_subtotal?: number;
  total_estimate?: number; // strictly undefined when unresolved, NEVER 0!
  pricing_status: PricingStatusCode;
  price_breakdown_text: string;
  policy_id: string;
  policy_version: string;
  effective_policy_version?: string;
  checkin_applied?: string;
  confirmed_checkout?: string;
  standard_checkout?: string;
  grace_period_minutes?: number;
  grace_period_mode?: 'EVERY_EXTRA_HOUR_BOUNDARY' | 'FIRST_HOUR_ONLY';
  actual_late_checkout_minutes?: number;
  actual_late_checkout_seconds?: number;
  billable_extra_hours?: number;
  late_checkout_applied?: boolean;
  evidence_references?: string[];
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Pure late-checkout fee calculation for package stays ('qua_dem', 'ngay_dem')
 * under Owner Business Policy Addendum V1.4.6:
 * - Standard checkout: 12:00 next day (or same morning if check-in occurred between 00:00-05:59).
 * - Recurring 10-minute grace period (EVERY_EXTRA_HOUR_BOUNDARY):
 *   billableExtraHours = Math.max(0, Math.ceil((lateMinutes - graceMinutes) / 60))
 *   computed with exact integer math to prevent floating-point rounding drift:
 *   0..10m => 0h; 11..70m => 1h; 71..130m => 2h; 131..190m => 3h; 191m => 4h...
 * - Multiplied by the room's canonical extra_hour_rate (default 100,000đ, or room-specific rate such as 200,000đ).
 */
export function calculateLateCheckoutExtension(params: {
  stay_type: StayType;
  checkin_datetime?: string;
  checkout_datetime: string;
  extra_hour_rate: number;
}): LateCheckoutCalculation {
  const addendum = loadOwnerPolicyAddendums();
  const policyMeta = getEffectivePolicyMetadata();
  const lateCfg = addendum?.late_checkout;
  const standardTime = lateCfg?.standard_checkout_time ?? '12:00';
  const graceMinutes = lateCfg?.grace_period_minutes ?? 10;
  const graceMode = lateCfg?.grace_period_mode ?? 'EVERY_EXTRA_HOUR_BOUNDARY';
  const extraHourRate = params.extra_hour_rate > 0 ? params.extra_hour_rate : (lateCfg?.default_extra_hour_rate_vnd ?? 100000);

  const checkoutParts = parseVietnamDateTime(params.checkout_datetime);
  if (!checkoutParts) {
    return {
      is_valid: false,
      error_reason: `Chuỗi checkout_datetime không hợp lệ: "${params.checkout_datetime}". Yêu cầu định dạng ISO 8601.`,
      late_checkout_applied: false,
      standard_checkout: standardTime,
      confirmed_checkout: params.checkout_datetime,
      grace_period_minutes: graceMinutes,
      grace_period_mode: graceMode,
      actual_late_checkout_minutes: 0,
      actual_late_checkout_seconds: 0,
      billable_extra_hours: 0,
      extra_hour_rate: extraHourRate,
      extra_hour_subtotal: 0,
      effective_policy_version: policyMeta.effectivePolicyVersion,
    };
  }

  const checkinParts =
    params.checkin_datetime &&
    !params.checkin_datetime.startsWith('CHECKIN_') &&
    !params.checkin_datetime.startsWith('UNSPECIFIED')
      ? parseVietnamDateTime(params.checkin_datetime)
      : null;

  if (checkinParts) {
    const checkinMs = checkinParts.exactEpochMs ?? new Date(checkinParts.isoNormalized).getTime();
    const checkoutMs = checkoutParts.exactEpochMs ?? new Date(checkoutParts.isoNormalized).getTime();
    if (checkoutMs < checkinMs) {
      return {
        is_valid: false,
        error_reason: `Thời gian trả phòng (${checkoutParts.isoNormalized}) không thể sớm hơn thời gian nhận phòng (${checkinParts.isoNormalized}).`,
        late_checkout_applied: false,
        standard_checkout: standardTime,
        confirmed_checkout: checkoutParts.isoNormalized,
        grace_period_minutes: graceMinutes,
        grace_period_mode: graceMode,
        actual_late_checkout_minutes: 0,
        actual_late_checkout_seconds: 0,
        billable_extra_hours: 0,
        extra_hour_rate: extraHourRate,
        extra_hour_subtotal: 0,
        effective_policy_version: policyMeta.effectivePolicyVersion,
      };
    }
  }

  const checkoutDateOnly = checkoutParts.isoNormalized.split('T')[0];
  let standardCheckoutDate = checkoutDateOnly;
  if (checkinParts) {
    const checkinDateOnly = checkinParts.isoNormalized.split('T')[0];
    // Afternoon/evening check-in (>= 06:00) checks out at 12:00 on the following calendar day;
    // post-midnight check-in (< 06:00) checks out at 12:00 on that same morning.
    standardCheckoutDate = checkinParts.hour >= 6 ? addDaysToIsoDate(checkinDateOnly, 1) : checkinDateOnly;
  }

  const standardCheckoutIso = `${standardCheckoutDate}T${standardTime}:00+07:00`;
  const standardMs = new Date(standardCheckoutIso).getTime();
  const checkoutMs = checkoutParts.exactEpochMs ?? new Date(checkoutParts.isoNormalized).getTime();
  const actualLateMs = Math.max(0, checkoutMs - standardMs);
  const actualLateSeconds = Math.floor(actualLateMs / 1000);
  const actualLateMinutes = Math.floor(actualLateMs / 60000);

  const graceMs = graceMinutes * 60000;
  const hourMs = 3600000;
  let billableExtraHours = 0;
  if (actualLateMs > graceMs) {
    billableExtraHours =
      graceMode === 'FIRST_HOUR_ONLY'
        ? Math.floor((actualLateMs + hourMs - 1) / hourMs)
        : Math.max(0, Math.floor((actualLateMs - graceMs + hourMs - 1) / hourMs));
  }
  const extraHourSubtotal = billableExtraHours * extraHourRate;

  return {
    is_valid: true,
    late_checkout_applied: true,
    standard_checkout: standardCheckoutIso,
    confirmed_checkout: checkoutParts.isoNormalized,
    grace_period_minutes: graceMinutes,
    grace_period_mode: graceMode,
    actual_late_checkout_minutes: actualLateMinutes,
    actual_late_checkout_seconds: actualLateSeconds,
    billable_extra_hours: billableExtraHours,
    extra_hour_rate: extraHourRate,
    extra_hour_subtotal: extraHourSubtotal,
    effective_policy_version: policyMeta.effectivePolicyVersion,
  };
}

/**
 * Strict validator for duration_hours
 * Must be a finite integer >= 2
 */
export function validateDurationHours(duration_hours: unknown): number {
  if (
    typeof duration_hours !== 'number' ||
    !Number.isFinite(duration_hours) ||
    !Number.isInteger(duration_hours) ||
    duration_hours < 2
  ) {
    throw new Error(
      `Invalid duration_hours: ${duration_hours}. Expected a finite integer >= 2.`
    );
  }
  return duration_hours;
}

/**
 * Pure calculation function for pre-booking quote.
 * Guarantees zero 0đ fallback if price is unresolved.
 */
export function calculateQuote(
  resolution: PricingResolutionOutput,
  ten_phong: string,
  rawDuration: unknown,
  rawCheckoutDatetime?: string
): PreBookingQuoteResult {
  const isHourly = !resolution.stay_type || resolution.stay_type === 'nghi_gio';
  const policyMeta = getEffectivePolicyMetadata();

  // Decline duration < 2 for hourly stays
  if (isHourly && (typeof rawDuration === 'number' && (rawDuration < 2 || !Number.isInteger(rawDuration)))) {
    return {
      co_so_ma: resolution.co_so_ma,
      ma_phong: resolution.ma_phong,
      ten_phong,
      stay_type: 'nghi_gio',
      duration_hours: rawDuration,
      is_resolved: false,
      base_2h_price: undefined,
      extra_hours: 0,
      extra_hour_rate: resolution.extra_hour_rate,
      total_estimate: undefined,
      pricing_status: 'DECLINED_AS_UNSUPPORTED_PACKAGE',
      price_breakdown_text: 'J Collection không cung cấp gói nghỉ giờ 1 tiếng. Thời gian nghỉ giờ tối thiểu là 2 tiếng.',
      policy_id: resolution.policy_id,
      policy_version: resolution.policy_version,
      effective_policy_version: policyMeta.effectivePolicyVersion,
      checkin_applied: undefined,
      evidence_references: ['Business Policy V1.4.3: minimum_hourly_duration = 2'],
    };
  }

  const duration_hours = isHourly ? validateDurationHours(rawDuration) : 1;
  let extra_hours = isHourly ? duration_hours - 2 : 0;
  const extra_hour_rate = resolution.extra_hour_rate;

  if (resolution.base_2h_price === undefined) {
    return {
      co_so_ma: resolution.co_so_ma,
      ma_phong: resolution.ma_phong,
      ten_phong,
      stay_type: resolution.stay_type,
      duration_hours,
      is_resolved: false,
      base_2h_price: undefined,
      extra_hours,
      extra_hour_rate,
      total_estimate: undefined, // Strictly undefined, never 0!
      pricing_status: resolution.status,
      price_breakdown_text:
        resolution.disclaimer ?? 'Chưa xác định được giá do thiếu chính sách hoặc giờ nhận phòng.',
      policy_id: resolution.policy_id,
      policy_version: resolution.policy_version,
      effective_policy_version: policyMeta.effectivePolicyVersion,
      checkin_applied: undefined,
      evidence_references: [],
    };
  }

  const checkinApplied =
    'checkin_timestamp_normalized' in resolution
      ? resolution.checkin_timestamp_normalized
      : undefined;

  const base_2h_price = resolution.base_2h_price;
  let total_estimate = isHourly ? base_2h_price + extra_hours * extra_hour_rate : base_2h_price;
  let extra_hour_subtotal = isHourly ? extra_hours * extra_hour_rate : 0;
  let lateCalc: LateCheckoutCalculation | undefined;

  if (!isHourly && rawCheckoutDatetime) {
    lateCalc = calculateLateCheckoutExtension({
      stay_type: resolution.stay_type,
      checkin_datetime: checkinApplied,
      checkout_datetime: rawCheckoutDatetime,
      extra_hour_rate,
    });
    if (!lateCalc.is_valid) {
      return {
        co_so_ma: resolution.co_so_ma,
        ma_phong: resolution.ma_phong,
        ten_phong,
        stay_type: resolution.stay_type,
        duration_hours,
        is_resolved: false,
        base_2h_price: undefined,
        extra_hours: 0,
        extra_hour_rate,
        total_estimate: undefined,
        pricing_status: 'INVALID_DATETIME',
        price_breakdown_text: lateCalc.error_reason ?? 'Thời gian trả phòng không hợp lệ.',
        policy_id: resolution.policy_id,
        policy_version: resolution.policy_version,
        effective_policy_version: policyMeta.effectivePolicyVersion,
        checkin_applied: checkinApplied,
        confirmed_checkout: lateCalc.confirmed_checkout,
        evidence_references: [],
      };
    }
    extra_hours = lateCalc.billable_extra_hours;
    extra_hour_subtotal = lateCalc.extra_hour_subtotal;
    total_estimate = base_2h_price + extra_hour_subtotal;
  }

  let breakdown: string;
  if (!isHourly) {
    const pkgLabel = resolution.stay_type === 'qua_dem' ? 'Qua đêm' : 'Ngày đêm';
    if (lateCalc && lateCalc.billable_extra_hours > 0) {
      const graceNote =
        lateCalc.grace_period_mode === 'EVERY_EXTRA_HOUR_BOUNDARY'
          ? `ân hạn ${lateCalc.grace_period_minutes} phút cho từng mốc giờ`
          : `qua ân hạn ${lateCalc.grace_period_minutes} phút`;
      breakdown =
        `Gói ${pkgLabel}: ${base_2h_price.toLocaleString('vi-VN')}đ + ${lateCalc.billable_extra_hours} giờ phát sinh sau 12:00 ` +
        `(trễ ${lateCalc.actual_late_checkout_minutes} phút, ${graceNote}; ` +
        `${lateCalc.billable_extra_hours} x ${extra_hour_rate.toLocaleString('vi-VN')}đ = ${extra_hour_subtotal.toLocaleString('vi-VN')}đ) ` +
        `= ${total_estimate.toLocaleString('vi-VN')}đ`;
    } else if (lateCalc && (lateCalc.actual_late_checkout_seconds ?? lateCalc.actual_late_checkout_minutes * 60) > 0) {
      const remSec = (lateCalc.actual_late_checkout_seconds ?? 0) % 60;
      const lateDurationLabel =
        lateCalc.actual_late_checkout_minutes > 0
          ? remSec > 0
            ? `${lateCalc.actual_late_checkout_minutes} phút ${remSec} giây`
            : `${lateCalc.actual_late_checkout_minutes} phút`
          : `${remSec} giây`;
      breakdown =
        `Gói ${pkgLabel}: ${base_2h_price.toLocaleString('vi-VN')}đ ` +
        `(trả muộn ${lateDurationLabel} sau 12:00 nằm trong ân hạn ${lateCalc.grace_period_minutes} phút -> 0đ phát sinh)`;
    } else {
      breakdown = `Gói ${pkgLabel}: ${base_2h_price.toLocaleString('vi-VN')}đ`;
    }
  } else if (extra_hours > 0) {
    breakdown = `2 giờ đầu: ${base_2h_price.toLocaleString('vi-VN')}đ + ${extra_hours} giờ thêm (${extra_hours} x ${extra_hour_rate.toLocaleString('vi-VN')}đ): ${extra_hour_subtotal.toLocaleString('vi-VN')}đ = ${total_estimate.toLocaleString('vi-VN')}đ`;
  } else {
    breakdown = `Trọn gói 2 giờ đầu: ${base_2h_price.toLocaleString('vi-VN')}đ`;
  }

  const evidenceRefs = [
    ...('evidence_references' in resolution ? resolution.evidence_references : []),
    ...(lateCalc
      ? [
          `Addendum V${policyMeta.effectivePolicyVersion}: Tiêu chuẩn checkout ${lateCalc.standard_checkout}, ân hạn ${lateCalc.grace_period_minutes} phút (${lateCalc.grace_period_mode}), phát sinh ${extra_hour_rate.toLocaleString('vi-VN')}đ/giờ.`,
        ]
      : []),
  ];

  return {
    co_so_ma: resolution.co_so_ma,
    ma_phong: resolution.ma_phong,
    ten_phong,
    stay_type: resolution.stay_type,
    duration_hours,
    is_resolved: true,
    base_2h_price,
    extra_hours,
    extra_hour_rate,
    extra_hour_subtotal,
    total_estimate,
    pricing_status: resolution.status,
    price_breakdown_text: breakdown,
    policy_id: resolution.policy_id,
    policy_version: resolution.policy_version,
    effective_policy_version: policyMeta.effectivePolicyVersion,
    checkin_applied: checkinApplied,
    confirmed_checkout: lateCalc?.confirmed_checkout,
    standard_checkout: lateCalc?.standard_checkout,
    grace_period_minutes: lateCalc?.grace_period_minutes,
    grace_period_mode: lateCalc?.grace_period_mode,
    actual_late_checkout_minutes: lateCalc?.actual_late_checkout_minutes,
    actual_late_checkout_seconds: lateCalc?.actual_late_checkout_seconds,
    billable_extra_hours: lateCalc?.billable_extra_hours,
    late_checkout_applied: lateCalc?.late_checkout_applied ?? false,
    evidence_references: evidenceRefs,
  };
}
