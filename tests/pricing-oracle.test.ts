import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { AutomatedPricingOracle } from '../src/pricing/automated-pricing-oracle.js';
import { PreBookingQuoteEngine } from '../src/pricing/prebooking-quote-engine.js';
import { PreBookingQuoteResult } from '../src/pricing/quote-types.js';

describe('Automated Pricing Oracle (Business Policy V1.4.3 & Dataset Ground Truth)', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const oracle = new AutomatedPricingOracle(dataset);
  const quoteEngine = new PreBookingQuoteEngine(dataset);

  describe('1. Exhaustive Combinations Matrix Test', () => {
    it('evaluates all sample combinations across 3 properties with 0 violations', () => {
      const evaluation = oracle.runFullMatrixEvaluation();
      expect(evaluation.total_combinations_tested).toBeGreaterThan(400);
      expect(evaluation.failed_combinations).toBe(0);
      expect(evaluation.violations).toHaveLength(0);
      expect(evaluation.passed_combinations).toBe(evaluation.total_combinations_tested);
    });
  });

  describe('2. Jacayl Hà Đông Daytime Pricing (08:00 - 18:00)', () => {
    // Weekday (Wed 14:00)
    const weekdayCheckin = '2026-11-25T14:00:00+07:00';

    it('Standard Hà Đông weekday daytime is strictly 159.000đ / 2h', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: weekdayCheckin,
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(159000);
      expect(quote.total_estimate).toBe(159000);
    });

    it('Deluxe Hà Đông weekday daytime is strictly 279.000đ / 2h', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: weekdayCheckin,
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(279000);
      expect(quote.total_estimate).toBe(279000);
    });

    it('Concept (Suite) Hà Đông weekday daytime is strictly 399.000đ / 2h', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '101-long-chim',
        stay_type: 'nghi_gio',
        checkin_datetime: weekdayCheckin,
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(399000);
      expect(quote.total_estimate).toBe(399000);
    });

    // Weekend (Sat 15:00)
    const weekendCheckin = '2026-11-28T15:00:00+07:00';

    it('Standard Hà Đông weekend daytime is strictly 180.000đ / 2h (NEVER 189.000đ)', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: weekendCheckin,
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(180000);
      expect(quote.base_2h_price).not.toBe(189000); // Guard against M4.3 report typo
      expect(quote.total_estimate).toBe(180000);
    });

    it('Deluxe Hà Đông weekend daytime is strictly 315.000đ / 2h', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: weekendCheckin,
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(315000);
      expect(quote.total_estimate).toBe(315000);
    });

    it('Concept (Suite) Hà Đông weekend daytime is strictly 449.000đ / 2h', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '101-long-chim',
        stay_type: 'nghi_gio',
        checkin_datetime: weekendCheckin,
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000);
      expect(quote.total_estimate).toBe(449000);
    });
  });

  describe('3. Hà Đông Outside 08:00 - 18:00 (Early Morning & Evening Fallback)', () => {
    it('Hà Đông before 08:00 (07:00) applies room dataset base price, not daytime table', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-25T07:00:00+07:00',
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.pricing_status).toBe('RESOLVED_BASE_DATASET');
      expect(quote.base_2h_price).toBe(159000); // 201-la-casta dataset base price
    });

    it('Hà Đông from 18:00 (19:30) applies room dataset base price, NOT fabricated evening table', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T19:30:00+07:00',
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.pricing_status).toBe('RESOLVED_BASE_DATASET');
      expect(quote.base_2h_price).toBe(279000); // 202-grand-canyon dataset base price
      // Must NOT be fabricated evening table values like 229000
      expect(quote.base_2h_price).not.toBe(229000);
    });
  });

  describe('4. Extra Hour Surcharges (Room-Specific Ground Truth)', () => {
    it('Phòng 101 Lồng Chim extra hour rate is 100.000đ / h', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '101-long-chim',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T10:00:00+07:00', // Saturday morning: 449k
        duration_hours: 4, // 2 extra hours
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.extra_hour_rate).toBe(100000);
      expect(quote.extra_hours).toBe(2);
      expect(quote.total_estimate).toBe(449000 + 2 * 100000); // 649.000đ
    });

    it('Phòng 601 50 Sắc Thái extra hour rate is 200.000đ / h', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '601-50-sac-thai',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T10:00:00+07:00', // Saturday morning: 449k
        duration_hours: 4, // 2 extra hours
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.extra_hour_rate).toBe(200000);
      expect(quote.extra_hours).toBe(2);
      expect(quote.total_estimate).toBe(449000 + 2 * 200000); // 849.000đ
    });
  });

  describe('5. Oracle Rejection & Boundary Protection', () => {
    it('rejects candidate quote if base price is fabricated (e.g. 189.000đ for standard weekend)', () => {
      const fabricatedQuote: PreBookingQuoteResult = {
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        ten_phong: '201 — La Casta',
        stay_type: 'nghi_gio',
        duration_hours: 2,
        is_resolved: true,
        pricing_status: 'RESOLVED_DAYTIME_POLICY',
        base_2h_price: 189000, // Fabricated 189k instead of 180k!
        extra_hours: 0,
        extra_hour_rate: 100000,
        total_estimate: 189000,
        checkin_applied: '2026-11-28T15:00:00+07:00',
        price_breakdown_text: 'Bảng giá cuối tuần',
      };

      const val = oracle.validateQuote(fabricatedQuote);
      expect(val.valid).toBe(false);
      expect(val.reason).toContain('Base price mismatch');

      expect(() => {
        oracle.assertValidQuote(fabricatedQuote);
      }).toThrowError(/\[AutomatedPricingOracle Violation\]/);
    });

    it('rejects candidate quote if forbidden holiday surcharge is present', () => {
      const holidayQuote: PreBookingQuoteResult = {
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        ten_phong: '201 — La Casta',
        stay_type: 'nghi_gio',
        duration_hours: 2,
        is_resolved: true,
        pricing_status: 'RESOLVED_DAYTIME_POLICY',
        base_2h_price: 180000,
        extra_hours: 0,
        extra_hour_rate: 100000,
        total_estimate: 230000, // 180k + 50k holiday surcharge
        checkin_applied: '2026-11-28T15:00:00+07:00',
        price_breakdown_text: 'Giá 180.000đ + Phụ thu ngày lễ 50.000đ',
      };

      const val = oracle.validateQuote(holidayQuote);
      expect(val.valid).toBe(false);
      expect(val.reason).toContain('Total estimate mismatch');
    });

    it('enforces NOT_FOR_SALE status for jacayl-ha-dong room 401', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '401',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T15:00:00+07:00',
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(false);
      expect(quote.pricing_status).toBe('NOT_FOR_SALE');
      expect(quote.total_estimate).toBeUndefined();
    });
  });
});
