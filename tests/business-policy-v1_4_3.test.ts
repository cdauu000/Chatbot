import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { CheckinPricingResolver } from '../src/pricing/checkin-pricing-resolver.js';
import { PreBookingQuoteEngine } from '../src/pricing/prebooking-quote-engine.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { PolicyQAEngine } from '../src/knowledge/policy-qa-engine.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';

describe('Business Policy V1.4.3 Golden Tests — Group A, B, D', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const resolver = new CheckinPricingResolver(dataset);
  const quoteEngine = new PreBookingQuoteEngine(dataset);
  const kb = new KnowledgeBase(dataset);
  const policyQa = new PolicyQAEngine(kb);
  const claimValidator = new ClaimLevelValidator(dataset);

  // =========================================================================
  // NHÓM A: Biểu giá ban ngày Jacayl Hà Đông & Ranh giới (A01 - A10)
  // =========================================================================
  describe('Nhóm A: Biểu giá ban ngày Jacayl Hà Đông & Ranh giới 08:00 / 18:00', () => {
    // A01: Thứ Hai 07:59 (Standard Hà Đông: 201 La Casta) -> RESOLVED_BASE_DATASET, 159.000đ
    it('A01: Thứ Hai 07:59 tại Hà Đông (Standard 201) dùng giá gốc dataset = 159.000đ', () => {
      const res = resolver.resolvePrice({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-23T07:59:00+07:00',
      });
      expect(res.status).toBe('RESOLVED_BASE_DATASET');
      expect(res.is_resolved).toBe(true);
      expect(res.base_2h_price).toBe(159000);
      expect(res.price_source).toBe('BASE_DATASET_REFERENCE');
    });

    // A02: Thứ Hai 08:00 (Standard Hà Đông: 201 La Casta) -> RESOLVED_DAYTIME_POLICY, 159.000đ
    it('A02: Thứ Hai 08:00 tại Hà Đông (Standard 201) dùng bảng giá ban ngày = 159.000đ', () => {
      const res = resolver.resolvePrice({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-23T08:00:00+07:00',
      });
      expect(res.status).toBe('RESOLVED_DAYTIME_POLICY');
      expect(res.is_resolved).toBe(true);
      expect(res.base_2h_price).toBe(159000);
      expect(res.price_source).toBe('OWNER_TIME_POLICY');
    });

    // A03: Thứ Hai 17:59 (Deluxe Hà Đông: 202 Grand Canyon) -> RESOLVED_DAYTIME_POLICY, 279.000đ
    it('A03: Thứ Hai 17:59 tại Hà Đông (Deluxe 202) dùng bảng giá ban ngày = 279.000đ', () => {
      const res = resolver.resolvePrice({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-23T17:59:00+07:00',
      });
      expect(res.status).toBe('RESOLVED_DAYTIME_POLICY');
      expect(res.is_resolved).toBe(true);
      expect(res.base_2h_price).toBe(279000);
    });

    // A04: Thứ Hai 18:00 (Deluxe Hà Đông: 202 Grand Canyon) -> RESOLVED_BASE_DATASET, 279.000đ
    it('A04: Thứ Hai 18:00 tại Hà Đông (Deluxe 202) dùng giá gốc dataset = 279.000đ', () => {
      const res = resolver.resolvePrice({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '202-grand-canyon',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-23T18:00:00+07:00',
      });
      expect(res.status).toBe('RESOLVED_BASE_DATASET');
      expect(res.is_resolved).toBe(true);
      expect(res.base_2h_price).toBe(279000);
    });

    // A05: Thứ Bảy 07:59 (Suite/Concept 101 Lồng Chim) -> RESOLVED_BASE_DATASET, 399.000đ
    it('A05: Thứ Bảy 07:59 tại Hà Đông (Suite 101) dùng giá gốc dataset = 399.000đ', () => {
      const res = resolver.resolvePrice({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '101-long-chim',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T07:59:00+07:00',
      });
      expect(res.status).toBe('RESOLVED_BASE_DATASET');
      expect(res.is_resolved).toBe(true);
      expect(res.base_2h_price).toBe(399000);
    });

    // A06: Thứ Bảy 08:00 (Suite/Concept 101 Lồng Chim) -> RESOLVED_DAYTIME_POLICY, 449.000đ
    it('A06: Thứ Bảy 08:00 tại Hà Đông (Suite 101) áp bảng giá cuối tuần ban ngày = 449.000đ', () => {
      const res = resolver.resolvePrice({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '101-long-chim',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T08:00:00+07:00',
      });
      expect(res.status).toBe('RESOLVED_DAYTIME_POLICY');
      expect(res.is_resolved).toBe(true);
      expect(res.base_2h_price).toBe(449000);
    });

    // A07: Thứ Bảy 17:59 (Concept 601 50 Sắc Thái, phụ thu riêng 200k/h) 3h -> 449k + 200k = 649.000đ
    it('A07: Thứ Bảy 17:59 phòng 601 (phụ thu riêng 200k/h) 3 giờ = 449k + 200k = 649.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '601-50-sac-thai',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T17:59:00+07:00',
        duration_hours: 3,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(449000);
      expect(quote.extra_hour_rate).toBe(200000);
      expect(quote.total_estimate).toBe(649000);
    });

    // A08: Thứ Bảy 18:00 (Concept 601 50 Sắc Thái, phụ thu riêng 200k/h) 3h -> 399k + 200k = 599.000đ
    it('A08: Thứ Bảy 18:00 phòng 601 3 giờ = 399k base + 200k phụ thu = 599.000đ', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '601-50-sac-thai',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-28T18:00:00+07:00',
        duration_hours: 3,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(399000);
      expect(quote.extra_hour_rate).toBe(200000);
      expect(quote.total_estimate).toBe(599000);
    });

    // A09: Khách hỏi thuê 1 giờ -> QuoteEngine từ chối với DECLINED_AS_UNSUPPORTED_PACKAGE
    it('A09: QuoteEngine từ chối gói 1 giờ với DECLINED_AS_UNSUPPORTED_PACKAGE', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-25T10:00:00+07:00',
        duration_hours: 1,
      });
      expect(quote.is_resolved).toBe(false);
      expect(quote.pricing_status).toBe('DECLINED_AS_UNSUPPORTED_PACKAGE');
      expect(quote.total_estimate).toBeUndefined();
    });

    // A10: Khách thuê 2 giờ (Hà Đông Standard, Thứ Tư 10:00) -> 159.000đ hợp lệ
    it('A10: Khách thuê 2 giờ (Hà Đông Standard 201, Thứ Tư 10:00) = 159.000đ trọn gói', () => {
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2026-11-25T10:00:00+07:00',
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(159000);
      expect(quote.extra_hours).toBe(0);
      expect(quote.total_estimate).toBe(159000);
    });
  });

  // =========================================================================
  // NHÓM B: Chính sách Ngày Lễ & Dịp Đặc biệt (B01 - B05)
  // =========================================================================
  describe('Nhóm B: Chính sách Ngày Lễ & Dịp Đặc biệt V1.4.3 (Không phụ thu riêng)', () => {
    // B01: Valentine 14/02 rơi vào Thứ Hai -> giá ngày thường tiêu chuẩn
    it('B01: Valentine 14/02 rơi vào Thứ Hai áp giá ngày thường (Standard 159k, Deluxe 279k, Suite 399k)', () => {
      // 2028-02-14 là Thứ Hai
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2028-02-14T10:00:00+07:00',
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(159000);
      expect(quote.total_estimate).toBe(159000);
    });

    // B02: 30/04 rơi vào Thứ Bảy -> giá cuối tuần tiêu chuẩn, không phụ thu thêm
    it('B02: 30/04 rơi vào Thứ Bảy áp giá cuối tuần tiêu chuẩn (Standard 180k)', () => {
      // 2022-04-30 là Thứ Bảy
      const quote = quoteEngine.getQuote({
        co_so_ma: 'jacayl-ha-dong',
        ma_phong: '201-la-casta',
        stay_type: 'nghi_gio',
        checkin_datetime: '2022-04-30T10:00:00+07:00',
        duration_hours: 2,
      });
      expect(quote.is_resolved).toBe(true);
      expect(quote.base_2h_price).toBe(180000);
      expect(quote.total_estimate).toBe(180000);
    });

    // B03: Tết Nguyên Đán -> Policy QA khẳng định áp giá chuẩn, không có phụ thu riêng
    it('B03: Policy QA khẳng định dịp Tết không có phụ thu riêng', () => {
      const ans = policyQa.answer('Tết Nguyên Đán khách sạn có tăng giá không?');
      expect(ans).not.toBeNull();
      expect(ans?.verification_status).toBe('CONFIRMED');
      expect(ans?.answer_text).toContain('không có phụ thu ngày lễ');
      expect(ans?.requires_staff_verification).toBe(false);
    });

    // B04: Khách hỏi khuyến mãi Valentine -> không tự bịa voucher
    it('B04: Không bịa khuyến mãi hay voucher khi khách hỏi ưu đãi Valentine', () => {
      const ans = policyQa.answer('Ngày 14/2 Valentine có voucher giảm giá nào không em?');
      expect(ans).not.toBeNull();
      expect(ans?.verification_status).toBe('CONFIRMED');
      expect(ans?.answer_text).toContain('không có phụ thu ngày lễ');
    });

    // B05: Khách hỏi ngày lễ giá có tăng gấp đôi không -> Trả lời không tăng gấp đôi
    it('B05: Khách hỏi ngày lễ giá có tăng gấp đôi không -> Policy QA giải thích rõ ràng', () => {
      const ans = policyQa.answer('Ngày lễ 20/10 bên mình giá phòng có phụ thu hay tăng gấp đôi không?');
      expect(ans).not.toBeNull();
      expect(ans?.verification_status).toBe('CONFIRMED');
      expect(ans?.answer_text).toContain('không có phụ thu ngày lễ');
    });
  });

  // =========================================================================
  // NHÓM D: Giới hạn Quá Giờ 10 Phút & Từ chối Tính Tiền Checkout (D01 - D05)
  // =========================================================================
  describe('Nhóm D: Giới hạn Quá Giờ 10 Phút & Từ chối Tính Tiền Checkout (D01 - D05)', () => {
    // D01: Quá giờ 10 phút -> Policy QA giải thích chính sách ân hạn 10 phút
    it('D01: Quá giờ 10 phút nằm trong giới hạn ân hạn, sau 10p tính thêm 1 giờ', () => {
      const ans = policyQa.answer('Bên mình cho trễ tối đa bao nhiêu phút vậy em?');
      expect(ans).not.toBeNull();
      expect(ans?.verification_status).toBe('CONFIRMED');
      expect(ans?.answer_text.toLowerCase()).toContain('sau 10p bên em tính giờ tiếp theo');
    });

    // D02: Quá 11 phút -> Bắt đầu tính thêm 1 giờ
    it('D02: Policy QA khẳng định từ phút thứ 11 bắt đầu tính phí 1 giờ phụ thu', () => {
      const ans = policyQa.answer('Tôi trả phòng muộn 11 phút thì tính thế nào?');
      expect(ans).not.toBeNull();
      expect(ans?.verification_status).toBe('CONFIRMED');
      expect(ans?.answer_text.toLowerCase()).toContain('sau 10p bên em tính giờ tiếp theo');
    });

    // D03: Khách yêu cầu tính tiền phạt checkout thực tế -> Từ chối, chuyển lễ tân
    it('D03: Từ chối tính tiền checkout thực tế tại phòng, chuyển lễ tân quầy', () => {
      const ans = policyQa.answer('Tôi đang ở quá giờ 20 phút, tính giúp tôi hóa đơn checkout hết bao nhiêu?');
      expect(ans).not.toBeNull();
      expect(ans?.topic).toBe('CHECKOUT_BILLING_REQUEST');
      expect(ans?.requires_staff_verification).toBe(true);
      expect(ans?.answer_text).toContain('lễ tân tại quầy');
    });

    // D04: ClaimValidator chặn claim "Sau 15 phút mới tính thêm giờ"
    it('D04: ClaimValidator chặn khẳng định sai về mốc 15 phút miễn phí', () => {
      const text = 'Dạ quá 10 phút bên em vẫn miễn phí, từ phút 15 mới tính thêm giờ ạ!';
      const res = claimValidator.validate(text, {});
      expect(res.rejected_claims.some((c) => c.includes('REJECTED_OVERTIME_10MIN_BOUNDARY_CLAIM'))).toBe(true);
    });

    // D05: ClaimValidator cho phép câu trả lời chuẩn "Sau 10p bên em tính giờ tiếp theo"
    it('D05: ClaimValidator chấp thuận câu trả lời chuẩn xác về mốc 10 phút', () => {
      const text = 'Dạ sau 10p bên em tính giờ tiếp theo ạ.';
      const res = claimValidator.validate(text, {});
      expect(res.rejected_claims.some((c) => c.includes('REJECTED_OVERTIME_10MIN_BOUNDARY_CLAIM'))).toBe(false);
    });
  });
});
