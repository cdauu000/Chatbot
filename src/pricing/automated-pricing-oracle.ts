import { NormalizedDataset } from '../domain/normalized-schema.js';
import { CoSoMa } from '../domain/types.js';
import { CheckinPricingResolver } from './checkin-pricing-resolver.js';
import { PreBookingQuoteEngine } from './prebooking-quote-engine.js';
import { PreBookingQuoteRequest, PreBookingQuoteResult } from './quote-types.js';
import { isRoomNotForSale } from '../domain/room-business-registry.js';
import { FacilityCategoryMapper } from './category-mapper.js';

export interface OracleExpectedPrice {
  co_so_ma: string;
  ma_phong: string;
  stay_type: string;
  checkin_datetime?: string;
  duration_hours?: number;
  expected_status: string;
  expected_base_2h?: number;
  expected_extra_rate?: number;
  expected_total?: number;
  reason?: string;
}

export interface OracleValidationResult {
  valid: boolean;
  reason?: string;
  details?: {
    actual_base_2h?: number;
    expected_base_2h?: number;
    actual_total?: number;
    expected_total?: number;
  };
}

export interface OracleMatrixEvaluation {
  total_combinations_tested: number;
  passed_combinations: number;
  failed_combinations: number;
  violations: Array<{
    scenario: string;
    expected: any;
    actual: any;
    reason: string;
  }>;
}

/**
 * Automated Pricing Oracle
 * Independent ground-truth reference implementation enforcing Business Policy V1.4.3
 * and canonical dataset pricing integrity. Rejects any fabricated prices.
 */
export class AutomatedPricingOracle {
  private dataset: NormalizedDataset;
  private resolver: CheckinPricingResolver;
  private quoteEngine: PreBookingQuoteEngine;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
    this.resolver = new CheckinPricingResolver(dataset);
    this.quoteEngine = new PreBookingQuoteEngine(dataset);
  }

  /**
   * Computes ground-truth expected pricing according to Business Policy V1.4.3.
   * Pure deterministic rule enforcement.
   */
  public static computeExpected(
    dataset: NormalizedDataset,
    co_so_ma: string,
    ma_phong: string,
    stay_type: 'nghi_gio' | 'qua_dem' | 'ngay_dem' = 'nghi_gio',
    checkin_datetime?: string,
    duration_hours: number = 2
  ): OracleExpectedPrice {
    // 1. Room Business Registry check
    if (isRoomNotForSale(co_so_ma, ma_phong)) {
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours,
        expected_status: 'NOT_FOR_SALE',
        expected_base_2h: undefined,
        expected_extra_rate: 0,
        expected_total: undefined,
        reason: 'Phòng 401 tại Jacayl Hà Đông không sử dụng để kinh doanh.',
      };
    }

    const room = dataset.phong.find((p) => p.co_so_ma === co_so_ma && p.ma_phong === ma_phong);
    if (!room) {
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours,
        expected_status: 'INVALID_ROOM_OR_BRANCH',
        expected_base_2h: undefined,
        expected_extra_rate: 100000,
        expected_total: undefined,
        reason: 'Phòng không tồn tại trong dataset.',
      };
    }

    // 2. Duration check for hourly stay
    if (stay_type === 'nghi_gio') {
      if (duration_hours < 2 || !Number.isInteger(duration_hours)) {
        return {
          co_so_ma,
          ma_phong,
          stay_type,
          checkin_datetime,
          duration_hours,
          expected_status: 'DECLINED_AS_UNSUPPORTED_PACKAGE',
          expected_base_2h: undefined,
          expected_extra_rate: room.gia_goc_dataset.gio_phat_sinh_ap_dung,
          expected_total: undefined,
          reason: 'Thời gian nghỉ giờ tối thiểu là 2 tiếng.',
        };
      }
    }

    const extra_hour_rate = room.gia_goc_dataset.gio_phat_sinh_ap_dung;

    // 3. Package stays: qua_dem & ngay_dem
    if (stay_type === 'qua_dem') {
      const basePrice = room.gia_goc_dataset.qua_dem;
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours: 1,
        expected_status: 'RESOLVED_BASE_DATASET',
        expected_base_2h: basePrice,
        expected_extra_rate: extra_hour_rate,
        expected_total: basePrice,
        reason: 'Nghỉ qua đêm theo giá gốc dataset.',
      };
    }

    if (stay_type === 'ngay_dem') {
      const basePrice = room.gia_goc_dataset.ngay_dem;
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours: 1,
        expected_status: 'RESOLVED_BASE_DATASET',
        expected_base_2h: basePrice,
        expected_extra_rate: extra_hour_rate,
        expected_total: basePrice,
        reason: 'Nghỉ ngày đêm theo giá gốc dataset.',
      };
    }

    // 4. Hourly stay ('nghi_gio')
    // 4a. Facilities outside Hà Đông: 100% dataset rates 24/7
    if (co_so_ma !== 'jacayl-ha-dong') {
      const base2h = room.gia_goc_dataset.nghi_gio_2h;
      const extraHours = Math.max(0, duration_hours - 2);
      const total = base2h + extraHours * extra_hour_rate;
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours,
        expected_status: 'RESOLVED_BASE_DATASET',
        expected_base_2h: base2h,
        expected_extra_rate: extra_hour_rate,
        expected_total: total,
        reason: 'Cơ sở ngoài Hà Đông dùng giá dataset 24/7.',
      };
    }

    // 4b. Jacayl Hà Đông hourly stay
    if (!checkin_datetime) {
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours,
        expected_status: 'TIME_UNSPECIFIED_ESTIMATE',
        expected_base_2h: undefined,
        expected_extra_rate: extra_hour_rate,
        expected_total: undefined,
        reason: 'Chưa có ngày và giờ check-in cụ thể.',
      };
    }

    // Parse datetime in Vietnam Time
    const dt = new Date(checkin_datetime);
    if (isNaN(dt.getTime())) {
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours,
        expected_status: 'INVALID_DATETIME',
        expected_base_2h: undefined,
        expected_extra_rate: extra_hour_rate,
        expected_total: undefined,
        reason: 'Datetime không hợp lệ.',
      };
    }

    // Extract Vietnam local day of week and time
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(dt);

    const partMap: Record<string, string> = {};
    parts.forEach((p) => {
      partMap[p.type] = p.value;
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
    const dow = weekdayMap[partMap.weekday] ?? 1;
    const hour = parseInt(partMap.hour === '24' ? '0' : partMap.hour, 10);
    const minute = parseInt(partMap.minute, 10);
    const totalMinutes = hour * 60 + minute;

    // Check-in before 08:00 (< 480 minutes) or from 18:00 (>= 1080 minutes): Base dataset rate
    if (totalMinutes < 480 || totalMinutes >= 1080) {
      const base2h = room.gia_goc_dataset.nghi_gio_2h;
      const extraHours = Math.max(0, duration_hours - 2);
      const total = base2h + extraHours * extra_hour_rate;
      return {
        co_so_ma,
        ma_phong,
        stay_type,
        checkin_datetime,
        duration_hours,
        expected_status: 'RESOLVED_BASE_DATASET',
        expected_base_2h: base2h,
        expected_extra_rate: extra_hour_rate,
        expected_total: total,
        reason: totalMinutes < 480 ? 'Hà Đông trước 08:00 dùng giá gốc dataset.' : 'Hà Đông từ 18:00 trở đi dùng giá gốc dataset.',
      };
    }

    // Daytime (08:00 - trước 18:00)
    const isWeekend = dow === 6 || dow === 7;
    const mapping = FacilityCategoryMapper.resolve('jacayl-ha-dong', room.hang);
    const tier = mapping.mapped_owner_tier ?? mapping.raw_hang;

    let base2h: number;
    if (tier === 'Standard') {
      // Standard: 159k weekday, 180k weekend (strictly 180k, never 189k!)
      base2h = isWeekend ? 180000 : 159000;
    } else if (tier === 'Deluxe') {
      // Deluxe: 279k weekday, 315k weekend
      base2h = isWeekend ? 315000 : 279000;
    } else {
      // Suite / Concept: 399k weekday, 449k weekend
      base2h = isWeekend ? 449000 : 399000;
    }

    const extraHours = Math.max(0, duration_hours - 2);
    const total = base2h + extraHours * extra_hour_rate;

    return {
      co_so_ma,
      ma_phong,
      stay_type,
      checkin_datetime,
      duration_hours,
      expected_status: 'RESOLVED_DAYTIME_POLICY',
      expected_base_2h: base2h,
      expected_extra_rate: extra_hour_rate,
      expected_total: total,
      reason: `Hà Đông ban ngày ${isWeekend ? 'cuối tuần' : 'ngày thường'} hạng ${tier}.`,
    };
  }

  public computeExpected(
    co_so_ma: string,
    ma_phong: string,
    stay_type: 'nghi_gio' | 'qua_dem' | 'ngay_dem' = 'nghi_gio',
    checkin_datetime?: string,
    duration_hours: number = 2
  ): OracleExpectedPrice {
    return AutomatedPricingOracle.computeExpected(
      this.dataset,
      co_so_ma,
      ma_phong,
      stay_type,
      checkin_datetime,
      duration_hours
    );
  }

  /**
   * Validates a candidate quote against the deterministic Oracle ground truth.
   */
  public static validateQuote(quote: PreBookingQuoteResult, dataset: NormalizedDataset): OracleValidationResult {
    const expected = AutomatedPricingOracle.computeExpected(
      dataset,
      quote.co_so_ma,
      quote.ma_phong,
      quote.stay_type as any,
      quote.checkin_applied,
      quote.duration_hours
    );

    if (quote.pricing_status !== expected.expected_status) {
      return {
        valid: false,
        reason: `Status mismatch: actual="${quote.pricing_status}", expected="${expected.expected_status}"`,
      };
    }

    if (expected.expected_base_2h !== undefined) {
      if (quote.base_2h_price !== expected.expected_base_2h) {
        return {
          valid: false,
          reason: `Base price mismatch: actual=${quote.base_2h_price}, expected=${expected.expected_base_2h}`,
          details: {
            actual_base_2h: quote.base_2h_price,
            expected_base_2h: expected.expected_base_2h,
            actual_total: quote.total_estimate,
            expected_total: expected.expected_total,
          },
        };
      }
    }

    if (expected.expected_total !== undefined) {
      if (quote.total_estimate !== expected.expected_total) {
        return {
          valid: false,
          reason: `Total estimate mismatch: actual=${quote.total_estimate}, expected=${expected.expected_total}`,
          details: {
            actual_base_2h: quote.base_2h_price,
            expected_base_2h: expected.expected_base_2h,
            actual_total: quote.total_estimate,
            expected_total: expected.expected_total,
          },
        };
      }
    }

    // Zero holiday surcharge verification: Must not contain any holiday surcharge additions
    if (quote.price_breakdown_text && /phụ thu ngày lễ/i.test(quote.price_breakdown_text)) {
      return {
        valid: false,
        reason: 'Forbidden holiday surcharge detected in quote breakdown text.',
      };
    }

    return { valid: true };
  }

  public validateQuote(quote: PreBookingQuoteResult): OracleValidationResult {
    return AutomatedPricingOracle.validateQuote(quote, this.dataset);
  }

  public static assertValidQuote(quote: PreBookingQuoteResult, dataset: NormalizedDataset): void {
    const validation = AutomatedPricingOracle.validateQuote(quote, dataset);
    if (!validation.valid) {
      throw new Error(`[AutomatedPricingOracle Violation] ${validation.reason}`);
    }
  }

  /**
   * Throws an error if the quote violates the Automated Pricing Oracle.
   */
  public assertValidQuote(quote: PreBookingQuoteResult): void {
    const validation = this.validateQuote(quote);
    if (!validation.valid) {
      throw new Error(`[AutomatedPricingOracle Violation] ${validation.reason}`);
    }
  }

  /**
   * Runs an exhaustive matrix verification across all facilities, room categories,
   * time slots, durations, and edge cases.
   */
  public runFullMatrixEvaluation(): OracleMatrixEvaluation {
    const violations: OracleMatrixEvaluation['violations'] = [];
    let total = 0;
    let passed = 0;

    const facilities = ['jacayl-ha-dong', 'jacayl-tran-khat-chan', 'j-village'];
    const stayTypes: Array<'nghi_gio' | 'qua_dem' | 'ngay_dem'> = ['nghi_gio', 'qua_dem', 'ngay_dem'];
    const timestamps = [
      // Weekday daytime
      '2026-11-25T10:00:00+07:00', // Wed 10:00
      '2026-11-25T14:30:00+07:00', // Wed 14:30
      '2026-11-25T17:30:00+07:00', // Wed 17:30
      // Weekend daytime
      '2026-11-28T10:00:00+07:00', // Sat 10:00
      '2026-11-28T15:00:00+07:00', // Sat 15:00
      '2026-11-29T11:00:00+07:00', // Sun 11:00
      // Early morning (<08:00)
      '2026-11-25T06:00:00+07:00', // Wed 06:00
      '2026-11-28T07:30:00+07:00', // Sat 07:30
      // Evening (>=18:00)
      '2026-11-25T18:00:00+07:00', // Wed 18:00
      '2026-11-25T20:00:00+07:00', // Wed 20:00
      '2026-11-28T19:30:00+07:00', // Sat 19:30
      '2026-11-28T22:30:00+07:00', // Sat 22:30
    ];
    const durations = [2, 3, 4, 5];

    // Representative rooms across all facilities
    const sampleRooms: Array<{ co_so_ma: CoSoMa; ma_phong: string }> = [
      // Hà Đông
      { co_so_ma: 'jacayl-ha-dong', ma_phong: '201-la-casta' }, // Standard
      { co_so_ma: 'jacayl-ha-dong', ma_phong: '202-grand-canyon' }, // Deluxe
      { co_so_ma: 'jacayl-ha-dong', ma_phong: '101-long-chim' }, // Concept (100k extra rate)
      { co_so_ma: 'jacayl-ha-dong', ma_phong: '601-50-sac-thai' }, // Concept (200k extra rate)
      { co_so_ma: 'jacayl-ha-dong', ma_phong: '401' }, // NOT_FOR_SALE
      // Trần Khát Chân
      { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '401-blush' }, // Standard (commercial)
      { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '102-galaxy' }, // Concept
      // J Village
      { co_so_ma: 'j-village', ma_phong: '401-mosaic' }, // Deluxe (commercial)
      { co_so_ma: 'j-village', ma_phong: '201-oasis' }, // Standard
    ];

    for (const r of sampleRooms) {
      for (const st of stayTypes) {
        if (st === 'nghi_gio') {
          for (const ts of timestamps) {
            for (const dur of durations) {
              total++;
              const actualQuote = this.quoteEngine.getQuote({
                co_so_ma: r.co_so_ma,
                ma_phong: r.ma_phong,
                stay_type: st,
                checkin_datetime: ts,
                duration_hours: dur,
              });

              const val = this.validateQuote(actualQuote);
              if (val.valid) {
                passed++;
              } else {
                violations.push({
                  scenario: `${r.co_so_ma}::${r.ma_phong} | ${st} | ${ts} | ${dur}h`,
                  expected: this.computeExpected(r.co_so_ma, r.ma_phong, st, ts, dur),
                  actual: actualQuote,
                  reason: val.reason ?? 'Unknown violation',
                });
              }
            }
          }
        } else {
          // Package stays
          total++;
          const actualQuote = this.quoteEngine.getQuote({
            co_so_ma: r.co_so_ma,
            ma_phong: r.ma_phong,
            stay_type: st,
          });

          const val = this.validateQuote(actualQuote);
          if (val.valid) {
            passed++;
          } else {
            violations.push({
              scenario: `${r.co_so_ma}::${r.ma_phong} | ${st}`,
              expected: this.computeExpected(r.co_so_ma, r.ma_phong, st),
              actual: actualQuote,
              reason: val.reason ?? 'Unknown violation',
            });
          }
        }
      }
    }

    return {
      total_combinations_tested: total,
      passed_combinations: passed,
      failed_combinations: violations.length,
      violations,
    };
  }
}
