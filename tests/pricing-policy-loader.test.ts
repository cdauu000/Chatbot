import { describe, it, expect } from 'vitest';
import {
  loadPricingPolicyConfig,
  loadActivePricingPolicyConfig,
  getLegacyPricingConfigPath,
} from '../src/data-loader/pricing-policy-loader.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { PRICING_TEST_FIXTURES_P01_P25 } from './fixtures/pricing-test-fixtures.js';
import { validateDurationHours, calculateQuote } from '../src/pricing/quote-types.js';

describe('Pricing Policy Loader & P-01 to P-25 Fixture Verification', () => {
  const activePolicyConfig = loadActivePricingPolicyConfig();
  const legacyPolicyConfig = loadPricingPolicyConfig(getLegacyPricingConfigPath());
  const raw = loadRawDataset();

  it('tải thành công cấu hình pricing addendum có phiên bản và timezone chuẩn', () => {
    expect(activePolicyConfig.schema_version).toBe('1.4.3');
    expect(activePolicyConfig.currency).toBe('VND');
    expect(activePolicyConfig.timezone).toBe('Asia/Ho_Chi_Minh');

    // Cấu hình cũ V1.0 vẫn được giữ nguyên để đối soát
    expect(legacyPolicyConfig.schema_version).toBe('1.0');
    expect(legacyPolicyConfig.config_id).toBe('J_COLLECTION_PRICING_ADDENDUM_2026_11_21');
  });

  it('xác nhận đủ 25 fixtures kiểm thử P-01 đến P-25', () => {
    expect(PRICING_TEST_FIXTURES_P01_P25.length).toBe(25);
    const testIds = PRICING_TEST_FIXTURES_P01_P25.map((f) => f.testId);
    for (let i = 1; i <= 25; i++) {
      const expectedId = `P-${String(i).padStart(2, '0')}`;
      expect(testIds.includes(expectedId)).toBe(true);
    }
  });

  it('mọi fixture P-01 đến P-25 đều tham chiếu phòng có thật 100% trong dataset gốc', () => {
    const rawKeys = new Set(raw.phong.map((p) => `${p.co_so_ma}::${p.ma_phong}`));

    PRICING_TEST_FIXTURES_P01_P25.forEach((fixture) => {
      const compositeKey = `${fixture.co_so_ma}::${fixture.ma_phong}`;
      expect(rawKeys.has(compositeKey)).toBe(true);
    });
  });

  it('xác nhận P-23 sử dụng phòng có thật 201-sapphire tại Trần Khát Chân (không dùng 102 giả)', () => {
    const p23 = PRICING_TEST_FIXTURES_P01_P25.find((f) => f.testId === 'P-23');
    expect(p23).toBeDefined();
    expect(p23?.co_so_ma).toBe('jacayl-tran-khat-chan');
    expect(p23?.ma_phong).toBe('201-sapphire');
    expect(p23?.expected_base_2h).toBe(500000);
  });

  it('xác nhận P-02 có giá cuối tuần Standard Hà Đông là chính xác 180.000đ (không có 179k)', () => {
    const p02 = PRICING_TEST_FIXTURES_P01_P25.find((f) => f.testId === 'P-02');
    expect(p02).toBeDefined();
    expect(p02?.expected_base_2h).toBe(180000);
    expect(p02?.expected_total_estimate).toBe(180000);
  });

  it('validateDurationHours từ chối số không hợp lệ: số thập phân, chuỗi, NaN, nhỏ hơn 2', () => {
    expect(() => validateDurationHours(2.5)).toThrowError(/Invalid duration_hours/);
    expect(() => validateDurationHours(1)).toThrowError(/Invalid duration_hours/);
    expect(() => validateDurationHours(0)).toThrowError(/Invalid duration_hours/);
    expect(() => validateDurationHours(-2)).toThrowError(/Invalid duration_hours/);
    expect(() => validateDurationHours('3')).toThrowError(/Invalid duration_hours/);
    expect(() => validateDurationHours(NaN)).toThrowError(/Invalid duration_hours/);
    expect(() => validateDurationHours(Infinity)).toThrowError(/Invalid duration_hours/);

    // Hợp lệ: số nguyên >= 2
    expect(validateDurationHours(2)).toBe(2);
    expect(validateDurationHours(3)).toBe(3);
    expect(validateDurationHours(5)).toBe(5);
  });

  it('calculateQuote không bao giờ fallback về 0đ khi base_2h_price chưa được phân giải', () => {
    const unresolvedResolution = {
      status: 'UNRESOLVED_EARLY_MORNING' as const,
      co_so_ma: 'jacayl-ha-dong' as const,
      ma_phong: '201-la-casta',
      raw_hang: 'Standard',
      base_2h_price: undefined, // Không xác định được
      extra_hour_rate: 100000,
      price_source: 'POLICY_UNKNOWN' as const,
    };

    const quoteResult = calculateQuote(unresolvedResolution, '201 — La Casta', 3);
    expect(quoteResult.is_resolved).toBe(false);
    expect(quoteResult.base_2h_price).toBeUndefined();
    // BẮT BUỘC: total_estimate là undefined, TUYỆT ĐỐI KHÔNG PHẢI 0đ!
    expect(quoteResult.total_estimate).toBeUndefined();
    expect(quoteResult.total_estimate).not.toBe(0);
  });

  it('calculateQuote tính toán chính xác khi giá đã được phân giải', () => {
    const resolvedResolution = {
      status: 'RESOLVED_DAYTIME_POLICY' as const,
      co_so_ma: 'jacayl-ha-dong' as const,
      ma_phong: '201-la-casta',
      raw_hang: 'Standard',
      base_2h_price: 159000,
      extra_hour_rate: 100000,
      price_source: 'OWNER_TIME_POLICY' as const,
    };

    // 2 giờ: 159k
    const quote2h = calculateQuote(resolvedResolution, '201 — La Casta', 2);
    expect(quote2h.is_resolved).toBe(true);
    expect(quote2h.total_estimate).toBe(159000);

    // 4 giờ: 159k + 2 * 100k = 359k
    const quote4h = calculateQuote(resolvedResolution, '201 — La Casta', 4);
    expect(quote4h.is_resolved).toBe(true);
    expect(quote4h.total_estimate).toBe(359000);
  });
});
