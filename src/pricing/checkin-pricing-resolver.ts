import {
  CheckinPricingResolutionInput,
  PricingResolutionOutput,
  ResolvedPricingOutput,
  UnresolvedPricingOutput,
} from './pricing-types.js';
import { NormalizedDataset, NormalizedRoom } from '../domain/normalized-schema.js';
import { FacilityCategoryMapper } from './category-mapper.js';
import { loadActivePricingPolicyConfig } from '../data-loader/pricing-policy-loader.js';
import { OwnerTierLabel } from '../domain/types.js';

export interface VietnamDateTimeParts {
  dayOfWeekIso: number; // 1 = Mon ... 7 = Sun
  hour: number;
  minute: number;
  second?: number;
  exactEpochMs?: number;
  isoNormalized: string;
}

export interface VietnamTemporalContext {
  isoTimestamp: string;
  localDate: string;
  localTime: string;
  timezone: 'Asia/Ho_Chi_Minh';
  dayOfWeekIso: number;
  dayOfWeekVi: string;
  dayOfWeekEn: string;
  isWeekend: boolean;
}

const VI_WEEKDAYS: Record<number, string> = {
  1: 'Thứ Hai',
  2: 'Thứ Ba',
  3: 'Thứ Tư',
  4: 'Thứ Năm',
  5: 'Thứ Sáu',
  6: 'Thứ Bảy',
  7: 'Chủ Nhật',
};

const EN_WEEKDAYS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export function getVietnamTemporalContext(source: string | Date = new Date()): VietnamTemporalContext {
  const isoInput = source instanceof Date ? source.toISOString() : source;
  const parsed = parseVietnamDateTime(isoInput) ?? parseVietnamDateTime(new Date().toISOString())!;
  const [localDate, timeWithOffset] = parsed.isoNormalized.split('T');
  const localTime = (timeWithOffset || '00:00').slice(0, 5);
  return {
    isoTimestamp: parsed.isoNormalized,
    localDate,
    localTime,
    timezone: 'Asia/Ho_Chi_Minh',
    dayOfWeekIso: parsed.dayOfWeekIso,
    dayOfWeekVi: VI_WEEKDAYS[parsed.dayOfWeekIso] || 'Không xác định',
    dayOfWeekEn: EN_WEEKDAYS[parsed.dayOfWeekIso] || 'Unknown',
    isWeekend: parsed.dayOfWeekIso === 6 || parsed.dayOfWeekIso === 7,
  };
}

export function parseVietnamDateTime(isoString?: string): VietnamDateTimeParts | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const map: Record<string, string> = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });

    const weekdayMap: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7,
    };

    const dayOfWeekIso = weekdayMap[map.weekday];
    if (!dayOfWeekIso) return null;

    const rawHour = map.hour === '24' ? '0' : map.hour;
    const hour = parseInt(rawHour, 10);
    const minute = parseInt(map.minute, 10);
    const second = Math.min(59, Math.max(0, parseInt(map.second || '0', 10) || 0));
    const ms = d.getMilliseconds();

    const year = map.year;
    const month = map.month.padStart(2, '0');
    const day = map.day.padStart(2, '0');
    const padHour = String(hour).padStart(2, '0');
    const padMin = String(minute).padStart(2, '0');
    const padSec = String(second).padStart(2, '0');
    const msSuffix = ms > 0 ? `.${String(ms).padStart(3, '0')}` : '';
    const isoNormalized = `${year}-${month}-${day}T${padHour}:${padMin}:${padSec}${msSuffix}+07:00`;

    return {
      dayOfWeekIso,
      hour,
      minute,
      second,
      exactEpochMs: d.getTime(),
      isoNormalized,
    };
  } catch {
    return null;
  }
}

export class CheckinPricingResolver {
  private dataset: NormalizedDataset;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
  }

  /**
   * Resolves room price according to check-in timestamp and policy rules.
   * Pure deterministic TypeScript logic, no LLM dependency.
   */
  public resolvePrice(input: CheckinPricingResolutionInput): PricingResolutionOutput {
    const activePolicy = loadActivePricingPolicyConfig();
    const policyId = activePolicy.config_id;
    const policyVersion = activePolicy.schema_version;

    // 1. Locate room in dataset
    const room = this.dataset.phong.find(
      (p) => p.co_so_ma === input.co_so_ma && p.ma_phong === input.ma_phong
    );

    if (!room) {
      return {
        is_resolved: false,
        status: 'INVALID_ROOM_OR_BRANCH',
        co_so_ma: input.co_so_ma,
        ma_phong: input.ma_phong,
        extra_hour_rate: 100000,
        reason_code: 'ROOM_NOT_FOUND',
        missing_information_or_unresolved_policy: `Phòng ${input.ma_phong} không tồn tại tại cơ sở ${input.co_so_ma}.`,
        base_2h_price: undefined,
        disclaimer: 'Không tìm thấy thông tin phòng trong dữ liệu.',
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'POLICY_UNKNOWN',
        stay_type: input.stay_type,
      };
    }

    const extra_hour_rate = room.gia_goc_dataset.gio_phat_sinh_ap_dung;

    // 2. Package stay types: Qua đêm & Ngày đêm (use base dataset rates directly 24/7)
    if (input.stay_type === 'qua_dem') {
      return {
        is_resolved: true,
        status: 'RESOLVED_BASE_DATASET',
        room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        raw_hang: room.hang,
        base_2h_price: room.gia_goc_dataset.qua_dem,
        extra_hour_rate,
        checkin_timestamp_normalized: input.checkin_datetime ?? 'CHECKIN_QUA_DEM_DEFAULT',
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'BASE_DATASET_REFERENCE',
        evidence_references: [
          `room.gia.qua_dem: ${room.gia_goc_dataset.qua_dem}`,
          'Quy định giờ qua đêm: 22h - 12h hôm sau',
        ],
        stay_type: input.stay_type,
      };
    }

    if (input.stay_type === 'ngay_dem') {
      return {
        is_resolved: true,
        status: 'RESOLVED_BASE_DATASET',
        room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        raw_hang: room.hang,
        base_2h_price: room.gia_goc_dataset.ngay_dem,
        extra_hour_rate,
        checkin_timestamp_normalized: input.checkin_datetime ?? 'CHECKIN_NGAY_DEM_DEFAULT',
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'BASE_DATASET_REFERENCE',
        evidence_references: [
          `room.gia.ngay_dem: ${room.gia_goc_dataset.ngay_dem}`,
          'Quy định giờ ngày đêm: 14h - 12h hôm sau',
        ],
        stay_type: input.stay_type,
      };
    }

    // 3. Hourly stay ('nghi_gio'):
    // For J Village and Jacayl Trần Khát Chân: 100% use base dataset rate 24/7
    if (room.co_so_ma !== 'jacayl-ha-dong') {
      return {
        is_resolved: true,
        status: 'RESOLVED_BASE_DATASET',
        room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        raw_hang: room.hang,
        base_2h_price: room.gia_goc_dataset.nghi_gio_2h,
        extra_hour_rate,
        checkin_timestamp_normalized: input.checkin_datetime ?? 'UNSPECIFIED_DATETIME',
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'BASE_DATASET_REFERENCE',
        evidence_references: [
          `room.gia.nghi_gio_2h: ${room.gia_goc_dataset.nghi_gio_2h}`,
          `Cơ sở ${room.co_so_ma} sử dụng giá tham khảo dataset gốc 24/7 (không áp dụng biểu giá giờ Hà Đông)`,
        ],
        stay_type: input.stay_type,
      };
    }

    // 4. Jacayl Hà Đông hourly stay:
    if (!input.checkin_datetime) {
      return {
        is_resolved: false,
        status: 'TIME_UNSPECIFIED_ESTIMATE',
        room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        raw_hang: room.hang,
        extra_hour_rate,
        reason_code: 'MISSING_CHECKIN_DATETIME',
        missing_information_or_unresolved_policy:
          'Chưa có ngày và giờ check-in cụ thể để áp dụng biểu giá thời gian Hà Đông.',
        base_2h_price: undefined,
        disclaimer:
          'Dạ giá nghỉ giờ tại Hà Đông thay đổi theo ngày thường/cuối tuần và khung giờ (08:00 - 18:00). Anh/chị cho em xin thời gian dự kiến nhận phòng ạ.',
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'POLICY_UNKNOWN',
        stay_type: input.stay_type,
      };
    }

    const dtParts = parseVietnamDateTime(input.checkin_datetime);
    if (!dtParts) {
      return {
        is_resolved: false,
        status: 'INVALID_DATETIME',
        room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        raw_hang: room.hang,
        extra_hour_rate,
        reason_code: 'INVALID_DATETIME_FORMAT',
        missing_information_or_unresolved_policy: `Chuỗi datetime không hợp lệ: "${input.checkin_datetime}". Yêu cầu định dạng ISO 8601.`,
        base_2h_price: undefined,
        disclaimer: 'Thời gian nhận phòng không hợp lệ.',
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'POLICY_UNKNOWN',
        stay_type: input.stay_type,
      };
    }

    const { dayOfWeekIso, hour, minute, isoNormalized } = dtParts;
    const totalMinutes = hour * 60 + minute;

    // 4.1. Check-in before 08:00 (00:00 <= totalMinutes < 480)
    // Under Business Policy V1.4.3: Outside 08:00-18:00, use base dataset rate room.gia.nghi_gio_2h
    if (totalMinutes < 480) {
      return {
        is_resolved: true,
        status: 'RESOLVED_BASE_DATASET',
        room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        raw_hang: room.hang,
        base_2h_price: room.gia_goc_dataset.nghi_gio_2h,
        extra_hour_rate,
        checkin_timestamp_normalized: isoNormalized,
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'BASE_DATASET_REFERENCE',
        evidence_references: [
          `Hà Đông trước 08:00 (Check-in: ${isoNormalized})`,
          `room.gia.nghi_gio_2h trong dataset: ${room.gia_goc_dataset.nghi_gio_2h}`,
          'Theo Business Policy V1.4.3: khung ban ngày chỉ áp dụng 08:00 - 18:00; trước 08:00 dùng giá gốc nghỉ giờ trong dataset.',
        ],
        stay_type: input.stay_type,
      };
    }

    // 4.2. Check-in between 08:00 and 18:00 exclusive (480 <= totalMinutes < 1080)
    if (totalMinutes >= 480 && totalMinutes < 1080) {
      const categoryMapping = FacilityCategoryMapper.resolve('jacayl-ha-dong', room.hang);
      const appliedTier = (categoryMapping.mapped_owner_tier ?? categoryMapping.raw_hang) as OwnerTierLabel;

      const hdPolicy = activePolicy.facilities['jacayl-ha-dong'];
      const isWeekend = dayOfWeekIso === 6 || dayOfWeekIso === 7;

      const rateGroup = hdPolicy.daytime_rates.find((rg) =>
        rg.days_of_week_iso.includes(dayOfWeekIso)
      );

      if (!rateGroup || typeof rateGroup.rates_by_owner_category[appliedTier] !== 'number') {
        return {
          is_resolved: false,
          status: 'UNRESOLVED_POLICY',
          room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
          co_so_ma: room.co_so_ma,
          ma_phong: room.ma_phong,
          raw_hang: room.hang,
          applied_tier: appliedTier,
          extra_hour_rate,
          reason_code: 'MISSING_TIER_RATE_IN_POLICY',
          missing_information_or_unresolved_policy: `Không tìm thấy đơn giá cho hạng ${appliedTier} trong chính sách ngày ${dayOfWeekIso}.`,
          base_2h_price: undefined,
          disclaimer: 'Chưa có cấu hình giá cho hạng phòng này.',
          policy_id: policyId,
          policy_version: policyVersion,
          price_source: 'POLICY_UNKNOWN',
          stay_type: input.stay_type,
        };
      }

      const base_2h_price = rateGroup.rates_by_owner_category[appliedTier];

      return {
        is_resolved: true,
        status: 'RESOLVED_DAYTIME_POLICY',
        room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        raw_hang: room.hang,
        applied_tier: appliedTier,
        base_2h_price,
        extra_hour_rate,
        checkin_timestamp_normalized: isoNormalized,
        policy_id: policyId,
        policy_version: policyVersion,
        price_source: 'OWNER_TIME_POLICY',
        evidence_references: [
          `Hà Đông Daytime Policy: ${isWeekend ? 'Cuối tuần (T7-CN)' : 'Ngày thường (T2-T6)'}`,
          `Check-in lúc ${isoNormalized} (khung 08:00 - 18:00)`,
          `Hạng gốc: ${room.hang} -> Áp dụng hạng: ${appliedTier} (${categoryMapping.confirmation_status})`,
          `Quy tắc mốc Check-in: Giá 2h đầu được ấn định tại thời điểm check-in và không đổi suốt phiên nghỉ.`,
        ],
        stay_type: input.stay_type,
      };
    }

    // 4.3. Check-in evening (18:00 <= totalMinutes < 1440)
    // After 18:00 on all days: fall back to base dataset price room.gia.nghi_gio_2h
    return {
      is_resolved: true,
      status: 'RESOLVED_BASE_DATASET',
      room_key: { co_so_ma: room.co_so_ma, ma_phong: room.ma_phong },
      co_so_ma: room.co_so_ma,
      ma_phong: room.ma_phong,
      raw_hang: room.hang,
      base_2h_price: room.gia_goc_dataset.nghi_gio_2h,
      extra_hour_rate,
      checkin_timestamp_normalized: isoNormalized,
      policy_id: policyId,
      policy_version: policyVersion,
      price_source: 'BASE_DATASET_REFERENCE',
      evidence_references: [
        `Hà Đông sau 18:00 (Check-in: ${isoNormalized})`,
        `room.gia.nghi_gio_2h trong dataset: ${room.gia_goc_dataset.nghi_gio_2h}`,
        'Sau 18h mọi ngày trong tuần áp dụng giá có sẵn theo từng phòng trong dataset gốc.',
      ],
      stay_type: input.stay_type,
    };
  }
}
