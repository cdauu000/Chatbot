import { describe, it, expect } from 'vitest';
import {
  loadActivePricingPolicyConfig,
  loadPricingPolicyConfig,
  getLegacyPricingConfigPath,
  getActivePricingConfigPath,
  getV142PricingConfigPath,
  validatePolicyCategoryConsistency,
} from '../src/data-loader/pricing-policy-loader.js';
import { FACILITY_CATEGORY_CONFIGS, FacilityCategoryMapper } from '../src/pricing/category-mapper.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';

describe('Pre-M1 Blocker: Policy Consistency & V1.4.3 Active Configuration', () => {
  const activeConfig = loadActivePricingPolicyConfig();
  const raw = loadRawDataset();

  it('xác nhận cấu hình active là V1.4.3 với config_id chuẩn', () => {
    expect(activeConfig.schema_version).toBe('1.4.3');
    expect(activeConfig.config_id).toBe('J_COLLECTION_BUSINESS_POLICY_V1_4_3');
    expect(activeConfig.currency).toBe('VND');
    expect(activeConfig.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('xác nhận quyết định của Chủ dự án: Concept = Suite tại Hà Đông được OWNER_CONFIRMED', () => {
    const hdConfig = activeConfig.facilities['jacayl-ha-dong'];
    expect(hdConfig).toBeDefined();

    const suiteMapping = hdConfig.category_mapping?.['Suite'];
    expect(suiteMapping).toBeDefined();
    expect(suiteMapping.dataset_hang).toBe('Concept');
    expect(suiteMapping.status).toBe('OWNER_CONFIRMED');

    // Kiểm tra chéo với FacilityCategoryMapper
    const mapperResult = FacilityCategoryMapper.resolve('jacayl-ha-dong', 'Concept');
    expect(mapperResult.raw_hang).toBe('Concept');
    expect(mapperResult.mapped_owner_tier).toBe('Suite');
    expect(mapperResult.confirmation_status).toBe('OWNER_CONFIRMED');

    // Đảm bảo không thay đổi hang: "Concept" trong raw JSON gốc
    const rawConceptRooms = raw.phong.filter(
      (p) => p.co_so_ma === 'jacayl-ha-dong' && p.hang === 'Concept'
    );
    expect(rawConceptRooms.length).toBe(3);
  });

  it('xác nhận pricing_basis = CHECKIN_TIMESTAMP và cross_window_behavior = KEEP_CHECKIN_BASE_PRICE', () => {
    expect(activeConfig.scope.pricing_basis).toBe('CHECKIN_TIMESTAMP');
    expect(activeConfig.scope.cross_window_behavior).toBe('KEEP_CHECKIN_BASE_PRICE');

    const hdConfirmed = activeConfig.facilities['jacayl-ha-dong'].confirmed_decisions;
    expect(hdConfirmed?.crosses_18_boundary).toBe('KEEP_CHECKIN_BASE_PRICE');
    expect(hdConfirmed?.price_at_checkout_vs_checkin).toBe('CHECKIN_TIMESTAMP');
    expect(hdConfirmed?.weekend_standard_daytime_price).toBe(180000);
  });

  it('xác nhận chính sách V1.4.3: Không phụ thu ngày lễ và check-in trước 08:00 dùng giá gốc dataset', () => {
    const hdConfirmed = activeConfig.facilities['jacayl-ha-dong'].confirmed_decisions;
    expect(hdConfirmed?.before_08_pricing_source).toBe('BASE_DATASET_REFERENCE');
    expect(hdConfirmed?.holiday_surcharge).toBe('NO_HOLIDAY_SURCHARGE');

    expect(activeConfig.holiday_policy).toBeDefined();
    expect(activeConfig.holiday_policy?.has_holiday_surcharge).toBe(false);
    expect(activeConfig.holiday_policy?.status).toContain('CONFIRMED');

    expect(activeConfig.scope.minimum_hourly_duration).toBe(2);
    expect(activeConfig.scope.one_hour_package_available).toBe(false);
  });

  it('vẫn có thể nạp cấu hình V1.4.2 lịch sử bằng getV142PricingConfigPath()', () => {
    const v142Path = getV142PricingConfigPath();
    const v142Config = loadPricingPolicyConfig(v142Path);
    expect(v142Config.schema_version).toBe('1.4.2');
    expect(v142Config.config_id).toBe('J_COLLECTION_PRICING_POLICY_V1_4_2');
  });

  it('chặn tuyệt đối việc load cấu hình V1.0 cũ làm active policy (Release Blocker)', () => {
    const legacyPath = getLegacyPricingConfigPath();

    // Load bằng loadPricingPolicyConfig thông thường thì được (cho mục đích audit)
    const legacyConfig = loadPricingPolicyConfig(legacyPath);
    expect(legacyConfig.schema_version).toBe('1.0');

    // Nhưng load bằng loadActivePricingPolicyConfig thì BẮT BUỘC ném lỗi!
    expect(() => loadActivePricingPolicyConfig(legacyPath)).toThrowError(
      /Invalid active pricing policy version: 1.0/
    );
  });

  it('validatePolicyCategoryConsistency vượt qua khi mapper và config khớp 100%', () => {
    expect(() =>
      validatePolicyCategoryConsistency(activeConfig, FACILITY_CATEGORY_CONFIGS)
    ).not.toThrow();
  });

  it('validatePolicyCategoryConsistency phát hiện xung đột nếu sửa đổi mapping bất hợp lệ', () => {
    // Giả lập một cấu hình lỗi thời nơi Suite chưa được xác nhận
    const conflictedConfig = JSON.parse(JSON.stringify(activeConfig));
    conflictedConfig.facilities['jacayl-ha-dong'].category_mapping['Suite'].status =
      'NEEDS_OWNER_CONFIRMATION';

    expect(() =>
      validatePolicyCategoryConsistency(conflictedConfig, FACILITY_CATEGORY_CONFIGS)
    ).toThrowError(/category_mapping.Suite must match Concept with OWNER_CONFIRMED/);
  });
});
