import { CoSoMa, PricingStatusCode, StayType } from '../domain/types.js';
import { PricingResolutionOutput } from './pricing-types.js';

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
  total_estimate?: number; // strictly undefined when unresolved, NEVER 0!
  pricing_status: PricingStatusCode;
  price_breakdown_text: string;
  policy_id: string;
  policy_version: string;
  checkin_applied?: string;
  evidence_references?: string[];
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
  rawDuration: unknown
): PreBookingQuoteResult {
  const isHourly = !resolution.stay_type || resolution.stay_type === 'nghi_gio';

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
      checkin_applied: undefined,
      evidence_references: ['Business Policy V1.4.3: minimum_hourly_duration = 2'],
    };
  }

  const duration_hours = isHourly ? validateDurationHours(rawDuration) : 1;
  const extra_hours = isHourly ? duration_hours - 2 : 0;
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
      checkin_applied: undefined,
      evidence_references: [],
    };
  }

  const base_2h_price = resolution.base_2h_price;
  const total_estimate = isHourly ? base_2h_price + extra_hours * extra_hour_rate : base_2h_price;

  let breakdown: string;
  if (!isHourly) {
    const pkgLabel = resolution.stay_type === 'qua_dem' ? 'Qua đêm' : 'Ngày đêm';
    breakdown = `Gói ${pkgLabel}: ${base_2h_price.toLocaleString('vi-VN')}đ`;
  } else if (extra_hours > 0) {
    breakdown = `2 giờ đầu: ${base_2h_price.toLocaleString('vi-VN')}đ + ${extra_hours} giờ thêm (${extra_hours} x ${extra_hour_rate.toLocaleString('vi-VN')}đ): ${(extra_hours * extra_hour_rate).toLocaleString('vi-VN')}đ = ${total_estimate.toLocaleString('vi-VN')}đ`;
  } else {
    breakdown = `Trọn gói 2 giờ đầu: ${base_2h_price.toLocaleString('vi-VN')}đ`;
  }

  const checkinApplied =
    'checkin_timestamp_normalized' in resolution
      ? resolution.checkin_timestamp_normalized
      : undefined;

  const evidenceRefs =
    'evidence_references' in resolution ? resolution.evidence_references : [];

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
    total_estimate,
    pricing_status: resolution.status,
    price_breakdown_text: breakdown,
    policy_id: resolution.policy_id,
    policy_version: resolution.policy_version,
    checkin_applied: checkinApplied,
    evidence_references: evidenceRefs,
  };
}
