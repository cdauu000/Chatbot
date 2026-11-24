import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { CheckinPricingResolver } from '../src/pricing/checkin-pricing-resolver.js';
import { PreBookingQuoteEngine } from '../src/pricing/prebooking-quote-engine.js';
import { PRICING_TEST_FIXTURES_P01_P25 } from './fixtures/pricing-test-fixtures.js';

describe('Check-in-Based Pricing Resolver & Pre-Booking Quote Engine (Real Execution)', () => {
  const raw = loadRawDataset();
  const normalized = transformRawDatasetToDomain(raw);
  const resolver = new CheckinPricingResolver(normalized);
  const quoteEngine = new PreBookingQuoteEngine(normalized);

  // 1. Chạy thực tế toàn bộ 25 ca kiểm thử P-01 đến P-25
  describe('Bộ 25 Ca Kiểm thử Giá Chuẩn hóa (P-01 đến P-25)', () => {
    PRICING_TEST_FIXTURES_P01_P25.forEach((fixture) => {
      it(`[${fixture.testId}] ${fixture.description}`, () => {
        const resolution = resolver.resolvePrice({
          co_so_ma: fixture.co_so_ma,
          ma_phong: fixture.ma_phong,
          stay_type: fixture.stay_type,
          checkin_datetime: fixture.checkin_datetime,
        });

        // Kiểm tra trạng thái phân giải
        expect(resolution.status).toBe(fixture.expected_status);

        if (fixture.expected_status === 'UNRESOLVED_EARLY_MORNING') {
          expect(resolution.is_resolved).toBe(false);
          expect(resolution.base_2h_price).toBeUndefined();

          const quote = quoteEngine.getQuote({
            co_so_ma: fixture.co_so_ma,
            ma_phong: fixture.ma_phong,
            stay_type: fixture.stay_type,
            checkin_datetime: fixture.checkin_datetime,
            duration_hours: fixture.duration_hours,
          });

          expect(quote.is_resolved).toBe(false);
          // CẤM TUYỆT ĐỐI FALLBACK VỀ 0đ!
          expect(quote.total_estimate).toBeUndefined();
          expect(quote.total_estimate).not.toBe(0);
        } else {
          expect(resolution.is_resolved).toBe(true);
          if (resolution.is_resolved) {
            expect(resolution.base_2h_price).toBe(fixture.expected_base_2h);
            expect(resolution.extra_hour_rate).toBe(fixture.expected_extra_hour_rate);

            const quote = quoteEngine.getQuote({
              co_so_ma: fixture.co_so_ma,
              ma_phong: fixture.ma_phong,
              stay_type: fixture.stay_type,
              checkin_datetime: fixture.checkin_datetime,
              duration_hours: fixture.duration_hours,
            });

            expect(quote.is_resolved).toBe(true);
            expect(quote.total_estimate).toBe(fixture.expected_total_estimate);
          }
        }
      });
    });
  });

  // 2. Ca kiểm thử đặc thù bắt buộc từ Chủ dự án: Thứ Bảy 17:00, 4 giờ tại Hà Đông
  describe('Kiểm thử Bắt buộc: Thứ Bảy 17:00, nghỉ 4 giờ tại Jacayl Hà Đông (17:00 - 21:00)', () => {
    const checkin = '2026-11-28T17:00:00+07:00'; // Thứ Bảy 17:00
    const duration = 4;

    it('101 Lồng Chim: 449.000đ base + 2 x 100.000đ = 649.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '101-long-chim',
        stay_type: 'nghi_gio',
        checkin_datetime: checkin,
        duration_hours: duration,
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000);
      expect(quote.extra_hour_rate).toBe(100000);
      expect(quote.extra_hours).toBe(2);
      expect(quote.total_estimate).toBe(649000);
    });

    it('601 50 Sắc Thái: 449.000đ base + 2 x 200.000đ = 849.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '601-50-sac-thai',
        stay_type: 'nghi_gio',
        checkin_datetime: checkin,
        duration_hours: duration,
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000);
      expect(quote.extra_hour_rate).toBe(200000); // Phụ thu riêng 200k
      expect(quote.extra_hours).toBe(2);
      expect(quote.total_estimate).toBe(849000);
    });

    it('602 Playboy: 449.000đ base + 2 x 200.000đ = 849.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '602-playboy',
        stay_type: 'nghi_gio',
        checkin_datetime: checkin,
        duration_hours: duration,
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000);
      expect(quote.extra_hour_rate).toBe(200000); // Phụ thu riêng 200k
      expect(quote.extra_hours).toBe(2);
      expect(quote.total_estimate).toBe(849000);
    });

    it('Deluxe (202 Grand Canyon): 315.000đ base + 2 x 100.000đ = 515.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: checkin,
        duration_hours: duration,
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(315000);
      expect(quote.extra_hour_rate).toBe(100000);
      expect(quote.extra_hours).toBe(2);
      expect(quote.total_estimate).toBe(515000);
    });

    it('Standard (201 La Casta): 180.000đ base + 2 x 100.000đ = 380.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: checkin,
        duration_hours: duration,
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(180000);
      expect(quote.extra_hour_rate).toBe(100000);
      expect(quote.extra_hours).toBe(2);
      expect(quote.total_estimate).toBe(380000);
    });
  });

  // 3. Kiểm thử thay đổi thời lượng từ 2h lên 4h giữ nguyên check-in datetime
  describe('Kiểm thử Thay đổi Duration 2h -> 4h', () => {
    const checkin = '2026-11-28T10:00:00+07:00'; // Thứ Bảy 10:00

    it('giữ nguyên base 2h và tăng lũy tiến theo số giờ thêm', () => {
      const quote2h = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: checkin,
        duration_hours: 2,
      });

      const quote4h = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: checkin,
        duration_hours: 4,
      });

      expect(quote2h.base_2h_price).toBe(315000);
      expect(quote2h.total_estimate).toBe(315000);

      expect(quote4h.base_2h_price).toBe(315000); // Base không đổi!
      expect(quote4h.total_estimate).toBe(515000); // 315k + 2x100k
    });
  });

  // 4. Kiểm thử ghi nhận thời điểm check-in và policy version trong Quote Result
  describe('Khả năng Kiểm tra lại Quyết định (Auditability)', () => {
    it('kết quả quote ghi rõ policy_id, policy_version và checkin_applied', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-25T10:00:00+07:00',
        duration_hours: 3,
      });

      expect(quote.policy_id).toBe('J_COLLECTION_BUSINESS_POLICY_V1_4_3');
      expect(quote.policy_version).toBe('1.4.3');
      expect(quote.checkin_applied).toBe('2026-11-25T10:00:00+07:00');
      expect(quote.evidence_references?.length).toBeGreaterThan(0);
    });
  });

  // 5. Kiểm thử gói lưu trú qua đêm và ngày đêm
  describe('Lưu trú Trọn gói (Qua đêm & Ngày đêm)', () => {
    it('qua đêm tại J Village lấy trực tiếp giá dataset 639.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'j-village',
        ma_phong: '202-neon',
        stay_type: 'qua_dem',
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.total_estimate).toBe(639000);
      expect(quote.extra_hours).toBe(0);
    });

    it('ngày đêm tại Trần Khát Chân lấy trực tiếp giá dataset 2.000.000đ cho phòng 1001 Đêm', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-tran-khat-chan',
        ma_phong: '1001-dem',
        stay_type: 'ngay_dem',
      });

      expect(quote.is_resolved).toBe(true);
      expect(quote.total_estimate).toBe(2000000);
    });
  });
});
