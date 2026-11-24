import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';

describe('Milestone 3 - D2. Claim-Level Validator', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const validator = new ClaimLevelValidator(dataset);

  it('rejects unsourced booking URLs and verifies dataset URLs', () => {
    // 1. Text with unsourced booking domain
    const badText = 'Anh/chị vui lòng đặt phòng tại website: https://jcollection.vn/booking nhé ạ!';
    const badResult = validator.validate(badText, {});
    expect(badResult.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_URL'))).toBe(true);

    // 2. Text with dataset confirmed booking domain
    const goodText = 'Anh/chị có thể đặt trực tiếp tại link: https://www.bookphong.com/co-so/jacayl-ha-dong nhé ạ!';
    const goodResult = validator.validate(goodText, {});
    expect(goodResult.verified_claims.some((c) => c.includes('VERIFIED_BOOKING_URL'))).toBe(true);
    expect(goodResult.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_URL'))).toBe(false);
  });

  it('allows booking domain override when explicitly configured', () => {
    const customValidator = new ClaimLevelValidator(dataset, {
      allowedBookingDomainOverride: 'jcollection.vn',
    });
    const text = 'Anh/chị vui lòng đặt phòng tại: https://jcollection.vn/dat-phong nhé ạ!';
    const result = customValidator.validate(text, {});
    expect(result.verified_claims.some((c) => c.includes('VERIFIED_BOOKING_URL'))).toBe(true);
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_URL'))).toBe(false);
  });

  it('rejects fake hotlines and verifies dataset hotlines', () => {
    // 1. Fake hotline
    const badText = 'Anh/chị gọi hotline 0981 234 567 để đặt phòng nhé!';
    const badResult = validator.validate(badText, {});
    expect(badResult.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_HOTLINE'))).toBe(true);

    // 2. Real dataset hotline for Ha Dong (0522 464 646)
    const goodText = 'Anh/chị có thể gọi trực tiếp hotline 0522 464 646 của cơ sở Hà Đông ạ!';
    const goodResult = validator.validate(goodText, {});
    expect(goodResult.verified_claims.some((c) => c.includes('VERIFIED_HOTLINE'))).toBe(true);
  });

  it('rejects fake booking confirmations', () => {
    const text = 'Chúc mừng anh/chị đã đặt phòng thành công, mã đặt phòng của bạn là JCOL1234 ạ!';
    const result = validator.validate(text, {});
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_FAKE_BOOKING_CONFIRMATION'))).toBe(true);
  });

  it('rejects unsupported 24/7 staffing claims', () => {
    const text = 'Em là trợ lý ảo luôn sẵn sàng túc trực 24/7 để hỗ trợ anh/chị ạ!';
    const result = validator.validate(text, {});
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_UNVERIFIED_247_CLAIM'))).toBe(true);
  });

  it('properly disclaims unconfirmed amenities (Section A2)', () => {
    const text =
      'Phòng 1001 Đêm có bồn tắm nằm thư giãn. Lưu ý: Tiện nghi máy chiếu và bồn tắm đôi chưa có thông tin xác nhận chính thức trên website, anh/chị cần xác minh trực tiếp với lễ tân cơ sở ạ.';
    const result = validator.validate(text, {
      requestedAmenities: ['máy chiếu', 'bồn tắm đôi'],
    });

    expect(result.disclaimed_claims.some((c) => c.includes('DISCLAIMED_UNVERIFIED_AMENITY'))).toBe(true);
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_UNVERIFIED_AMENITY'))).toBe(false);
  });

  // V1.4.3: New Claim Level Validation Invariants
  it('rejects holiday surcharge claims', () => {
    const text = 'Ngày lễ 14/2 bên em có phụ thu ngày lễ 50.000đ nhé ạ!';
    const result = validator.validate(text, {});
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_HOLIDAY_SURCHARGE_CLAIM'))).toBe(true);
  });

  it('rejects unsupported 1-hour package claims', () => {
    const text = 'Dạ bên em có gói 1 tiếng với giá 80.000đ ạ!';
    const result = validator.validate(text, {});
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_UNSUPPORTED_1_HOUR_CLAIM'))).toBe(true);
  });

  it('rejects overnight check-in claims before 21:40 boundary', () => {
    const text = 'Anh/chị có thể nhận phòng qua đêm lúc 20:30 với giá qua đêm ạ!';
    const result = validator.validate(text, {});
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_OVERNIGHT_EARLY_CHECKIN_CLAIM'))).toBe(true);
  });

  it('rejects incorrect 10-minute overtime boundary claims', () => {
    const text = 'Dạ quá 10 phút bên em vẫn miễn phí, từ phút 15 mới tính thêm giờ ạ!';
    const result = validator.validate(text, {});
    expect(result.rejected_claims.some((c) => c.includes('REJECTED_OVERTIME_10MIN_BOUNDARY_CLAIM'))).toBe(true);
  });
});
