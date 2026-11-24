import { NormalizedDataset } from '../../domain/normalized-schema.js';
import { CoSoMa } from '../../domain/types.js';
import { ClaimValidationSummary } from '../conversation-types.js';

export interface ClaimValidationConfig {
  allowedBookingDomainOverride?: string; // e.g. "jcollection.vn" only if explicitly configured
}

export class ClaimLevelValidator {
  private dataset: NormalizedDataset;
  private config: ClaimValidationConfig;

  constructor(dataset: NormalizedDataset, config?: ClaimValidationConfig) {
    this.dataset = dataset;
    this.config = config ?? {};
  }

  /**
   * Validates customer-facing text against Ground Truth facts and policies.
   */
  public validate(
    text: string,
    context: {
      facility?: CoSoMa | null;
      focusedRoomKey?: string | null;
      expectedQuotes?: Array<{ roomId: string; totalVnd: number }>;
      requestedAmenities?: string[];
    }
  ): ClaimValidationSummary {
    const verifiedClaims: string[] = [];
    const disclaimedClaims: string[] = [];
    const rejectedClaims: string[] = [];
    const evidenceCitations: string[] = [];

    const lower = text.toLowerCase();

    // 1. Availability commitment check: NEVER claim room is locked, held, or confirmed
    if (
      lower.includes('đã đặt phòng thành công') ||
      lower.includes('đặt phòng thành công') ||
      lower.includes('mã đặt phòng của bạn') ||
      lower.includes('phòng đã được khóa') ||
      lower.includes('hệ thống đã giữ phòng cho bạn')
    ) {
      rejectedClaims.push('REJECTED_FAKE_BOOKING_CONFIRMATION: Chatbot cannot confirm bookings directly.');
    } else {
      verifiedClaims.push('VERIFIED_NO_FAKE_BOOKING_CONFIRMATION');
    }

    // 2. 24/7 service claim check: Must not claim 24/7 without infrastructure
    if (lower.includes('24/7') || lower.includes('túc trực 24/7')) {
      rejectedClaims.push('REJECTED_UNVERIFIED_247_CLAIM: 24/7 staffing is unconfirmed in dataset.');
    }

    // 3. Booking URL source validation (Section A4)
    const urlMatches = text.match(/https?:\/\/[^\s\)\],]+/g) || [];
    for (const url of urlMatches) {
      const isDatasetUrl = this.dataset.co_so.some((cs) => cs.link === url || cs.zalo === url) ||
        this.dataset.phong.some((p) => p.link_phong === url);

      const isAllowedOverride =
        this.config.allowedBookingDomainOverride &&
        url.includes(this.config.allowedBookingDomainOverride);

      if (isDatasetUrl || isAllowedOverride) {
        verifiedClaims.push(`VERIFIED_BOOKING_URL: ${url}`);
        evidenceCitations.push(`url::${url}`);
      } else {
        rejectedClaims.push(`REJECTED_UNSOURCED_URL: ${url} does not exist in dataset and has no approved override.`);
      }
    }

    // 4. Hotline / Phone source validation (Section A6)
    const phoneMatches = text.match(/\b0\d{3}\s?\d{3}\s?\d{3}\b/g) || [];
    for (const phone of phoneMatches) {
      const cleanPhone = phone.replace(/\s/g, '');
      const isDatasetPhone = this.dataset.co_so.some((cs) => cs.dien_thoai?.replace(/\s/g, '') === cleanPhone);

      if (isDatasetPhone) {
        verifiedClaims.push(`VERIFIED_HOTLINE: ${phone}`);
        evidenceCitations.push(`phone::${cleanPhone}`);
      } else {
        rejectedClaims.push(`REJECTED_UNSOURCED_HOTLINE: ${phone} does not match any confirmed hotel phone number.`);
      }
    }

    // 5. Unconfirmed amenities check (Section A2: Projector & Double Bathtub)
    if (context.requestedAmenities) {
      if (context.requestedAmenities.some((a) => a.includes('máy chiếu') || a.includes('may chieu'))) {
        if (lower.includes('máy chiếu') || lower.includes('may chieu')) {
          if (
            lower.includes('chưa có thông tin xác nhận') ||
            lower.includes('chưa được xác nhận') ||
            lower.includes('cần xác minh') ||
            lower.includes('cần liên hệ')
          ) {
            disclaimedClaims.push('DISCLAIMED_UNVERIFIED_AMENITY: Máy chiếu');
            evidenceCitations.push('tien_nghi::may_chieu::unconfirmed');
          } else if (lower.includes('có máy chiếu rạp phim') || lower.includes('có máy chiếu')) {
            rejectedClaims.push('REJECTED_UNVERIFIED_AMENITY_ASSERTION: Máy chiếu asserted without evidence.');
          }
        }
      }

      if (context.requestedAmenities.some((a) => a.includes('bồn tắm đôi') || a.includes('bon tam doi'))) {
        if (
          lower.includes('chưa có thông tin') ||
          lower.includes('chưa được xác nhận') ||
          lower.includes('cần xác minh') ||
          lower.includes('bồn tắm nằm thư giãn')
        ) {
          disclaimedClaims.push('DISCLAIMED_UNVERIFIED_AMENITY: Bồn tắm đôi');
          evidenceCitations.push('tien_nghi::bon_tam_doi::unconfirmed');
        }
      }
    }

    // 5.1. Strict Amenity Claims: Reject inferred bed types (e.g. king-size) or converting "bồn tắm lớn" to "bồn tắm đôi"
    if (lower.includes('king-size') || lower.includes('king size') || lower.includes('queen-size') || lower.includes('queen size')) {
      rejectedClaims.push('REJECTED_UNSOURCED_BED_TYPE: Bed type (e.g. king-size) is not confirmed in canonical dataset.');
    }
    if ((lower.includes('50 — sắc thái') || lower.includes('phòng 601')) && (lower.includes('bồn tắm đôi') || lower.includes('bon tam doi'))) {
      rejectedClaims.push('REJECTED_UNCONFIRMED_DOUBLE_BATHTUB: Room 601 has "bồn tắm lớn" in dataset, not confirmed "bồn tắm đôi".');
    }

    // 5.2. Action Confirmation: Reject unverified SLA promises
    if (
      lower.includes('trong ít phút') ||
      lower.includes('trong vài phút') ||
      lower.includes('trong 5 phút') ||
      lower.includes('trong 10 phút')
    ) {
      rejectedClaims.push('REJECTED_UNVERIFIED_SLA_PROMISE: Staff response time cannot be promised without confirmed SLA.');
    }

    // 6. Business Policy V1.4.3 Checks:
    // 6.1. Holiday Surcharge Check: Strictly forbidden
    if (
      lower.includes('ngày lễ tăng') ||
      lower.includes('phụ thu ngày lễ') ||
      lower.includes('tăng thêm 30%') ||
      lower.includes('nhân hệ số ngày lễ') ||
      lower.includes('ngay le tang') ||
      lower.includes('phu thu ngay le')
    ) {
      const isHolidayDenial =
        lower.includes('không có phụ thu ngày lễ') ||
        lower.includes('không phụ thu ngày lễ') ||
        lower.includes('không tăng giá riêng vào ngày lễ') ||
        lower.includes('không tăng giá vào ngày lễ') ||
        lower.includes('không tăng giá') ||
        lower.includes('không áp dụng phụ thu ngày lễ') ||
        lower.includes('khong co phu thu ngay le');

      if (isHolidayDenial) {
        verifiedClaims.push('VERIFIED_NO_HOLIDAY_SURCHARGE: Confirmed no holiday surcharge under V1.4.3.');
      } else {
        rejectedClaims.push('REJECTED_HOLIDAY_SURCHARGE_CLAIM: Holiday surcharge is not allowed under V1.4.3.');
      }
    }

    // 6.2. Early Morning Hourly Pricing Check: Before 08:00 is CONFIRMED under V1.4.3
    if (
      (lower.includes('trước 8h') || lower.includes('truoc 8h') || lower.includes('trước 08h') || lower.includes('truoc 08h')) &&
      (lower.includes('chưa có bảng giá') || lower.includes('chưa có chính sách') || lower.includes('chua co bang gia') || lower.includes('chua co chinh sach'))
    ) {
      rejectedClaims.push('REJECTED_EARLY_MORNING_UNCONFIRMED_CLAIM: Early morning before 08:00 is CONFIRMED under V1.4.3.');
    }

    // 6.3. Minimum Hourly Stay: 1-hour package claims forbidden
    if (
      lower.includes('có gói 1 tiếng') ||
      lower.includes('co goi 1 tieng') ||
      lower.includes('gói 1 tiếng với giá') ||
      lower.includes('goi 1 tieng voi gia') ||
      lower.includes('thuê 1 tiếng với giá') ||
      lower.includes('thue 1 tieng voi gia') ||
      lower.includes('nửa giá hai tiếng') ||
      lower.includes('nửa giá 2 tiếng') ||
      lower.includes('nua gia 2 tieng') ||
      (lower.includes('thuê một tiếng') && lower.includes('nửa giá')) ||
      (lower.includes('gói 1 tiếng') && lower.includes('bằng nửa'))
    ) {
      const is1HourDenial =
        lower.includes('không có gói riêng 1 tiếng') ||
        lower.includes('không có gói 1 tiếng') ||
        lower.includes('không áp dụng gói 1 tiếng') ||
        lower.includes('tối thiểu 2 tiếng') ||
        lower.includes('tối thiểu 2h');

      if (is1HourDenial) {
        verifiedClaims.push('VERIFIED_NO_1_HOUR_PACKAGE: Confirmed minimum 2-hour duration.');
      } else {
        rejectedClaims.push('REJECTED_UNSUPPORTED_1_HOUR_CLAIM: 1-hour hourly package is not offered.');
      }
    }

    // 6.4. Overnight early check-in before 21:40 claims forbidden
    if (
      (lower.includes('21h30') || lower.includes('21:30') || lower.includes('20h') || lower.includes('20:30') || lower.includes('20:00') || lower.includes('19h')) &&
      (lower.includes('với giá qua đêm') || lower.includes('voi gia qua dem') || lower.includes('vẫn được giá qua đêm') || lower.includes('vẫn tính gói qua đêm') || lower.includes('van duoc gia qua dem') || lower.includes('van tinh goi qua dem'))
    ) {
      rejectedClaims.push('REJECTED_OVERNIGHT_EARLY_CHECKIN_CLAIM: Overnight rate only applies from 21:40 onwards.');
    }

    // 6.5. Overtime 10-minute boundary check
    if (
      lower.includes('trễ đúng 10 phút là bị tính thêm') ||
      lower.includes('tre dung 10 phut la bi tinh them') ||
      lower.includes('trễ 10 phút là tính thêm giờ') ||
      lower.includes('tre 10 phut la tinh them gio') ||
      lower.includes('từ phút 15') ||
      lower.includes('tu phut 15')
    ) {
      rejectedClaims.push('REJECTED_OVERTIME_10MIN_BOUNDARY_CLAIM: Exactly 10 minutes is within grace period, charges apply from minute 11.');
    }

    // 7. Canonical Room Identity Policy (Owner Confirmed):
    // 7.1. Reject invented commercial names (e.g. "Tổng Thống" for room 601 Ha Dong)
    if (lower.includes('tổng thống') || lower.includes('tong thong')) {
      // Check if this is a legitimate denial / correction of the fake name
      const isPresidentDenial =
        lower.includes('không có tên "tổng thống"') ||
        lower.includes('không có tên tổng thống') ||
        lower.includes('chứ không có tên "tổng thống"') ||
        lower.includes('chứ không có tên tổng thống') ||
        lower.includes('không có phòng tổng thống') ||
        lower.includes('không phải là phòng tổng thống') ||
        lower.includes('không phải phòng tổng thống') ||
        lower.includes('không có hạng tổng thống') ||
        lower.includes('không tồn tại phòng tổng thống') ||
        lower.includes('không có phòng mang tên tổng thống') ||
        lower.includes('không có phòng nào tên tổng thống') ||
        lower.includes('không có phòng nào là tổng thống');

      if (isPresidentDenial) {
        verifiedClaims.push('VERIFIED_CANONICAL_ROOM_CORRECTION: Clarified no President room exists.');
        evidenceCitations.push('canonical_identity::601_not_president');
      } else {
        rejectedClaims.push('REJECTED_CANONICAL_ROOM_NAME: Room 601 at Ha Dong is officially "50 — Sắc Thái", not "Tổng Thống".');
      }
    }

    // 7.2. Reject English translations of commercial room names
    if (lower.includes('50 shades') || lower.includes('fifty shades')) {
      const isTranslationDenial =
        lower.includes('không gọi là 50 shades') ||
        lower.includes('chứ không gọi là 50 shades') ||
        lower.includes('không dùng tên tiếng anh') ||
        lower.includes('không dịch sang tiếng anh') ||
        lower.includes('chứ không phải 50 shades') ||
        lower.includes('không phải tên 50 shades');

      if (isTranslationDenial) {
        verifiedClaims.push('VERIFIED_CANONICAL_NAME_CORRECTION: Clarified official Vietnamese name.');
        evidenceCitations.push('canonical_identity::50_sac_thai_untranslated');
      } else {
        rejectedClaims.push('REJECTED_CANONICAL_ROOM_TRANSLATION: Room names must not be translated. Official name is "50 — Sắc Thái".');
      }
    }

    // 7.3. Reject selling or quoting Room 401 Ha Dong (Non-commercial room)
    if (
      (lower.includes('401') && (lower.includes('hà đông') || lower.includes('ha dong'))) &&
      (lower.includes('giá dự kiến') || lower.includes('giá:') || lower.includes('phù hợp') || lower.includes('lựa chọn') || lower.includes('đặt phòng'))
    ) {
      // Check if this is a legitimate statement that room 401 is NOT for sale
      const is401Clarification =
        lower.includes('không sử dụng để kinh doanh') ||
        lower.includes('không kinh doanh') ||
        lower.includes('không bán') ||
        lower.includes('không mở bán') ||
        lower.includes('không nằm trong danh mục') ||
        lower.includes('không đón khách');

      if (is401Clarification) {
        verifiedClaims.push('VERIFIED_NON_COMMERCIAL_ROOM_CLARIFICATION: Correctly stated room 401 Ha Dong is not for sale.');
        evidenceCitations.push('room_business_registry::jacayl-ha-dong::401');
      } else {
        rejectedClaims.push('REJECTED_NON_COMMERCIAL_ROOM_SALE: Room 401 Ha Dong is NOT used for commercial business.');
      }
    }

    // 7.4. Reject fictitious rooms hallucinated in past reports
    const fictitiousRoomKeywords = [
      'cinema',
      'lồng sắt',
      'long sat',
      'gác mái cổ điển',
      'gac mai co dien',
    ];
    for (const kw of fictitiousRoomKeywords) {
      if (lower.includes(kw)) {
        rejectedClaims.push(`REJECTED_FICTITIOUS_ROOM: Room matching "${kw}" does not exist in canonical dataset.`);
      }
    }
    // "Nhật Bản" does not exist at Ha Dong
    if (context.facility === 'jacayl-ha-dong' && (lower.includes('nhật bản') || lower.includes('nhat ban'))) {
      rejectedClaims.push('REJECTED_FICTITIOUS_ROOM: Room "Nhật Bản" does not exist at Jacayl Hà Đông.');
    }

    // 7.5. Reject prepended room codes (e.g. "601 — 50 — Sắc Thái")
    if (
      lower.includes('601 — 50 — sắc thái') ||
      lower.includes('601 - 50 — sắc thái') ||
      lower.includes('601 - 50 - sắc thái') ||
      lower.includes('601 — 50 - sắc thái')
    ) {
      rejectedClaims.push('REJECTED_PREPENDED_ROOM_CODE: Technical room code "601" was prepended to canonical name "50 — Sắc Thái".');
    }

    // 8. Ground Truth Hardening (M3.5.1 Policy):
    // 8.1. Facility Address Validation: Strictly use canonical co_so.dia_chi
    if (lower.includes('tt3-c19') || (lower.includes('văn quán') && (lower.includes('địa chỉ') || lower.includes('tại cơ sở') || lower.includes('khu biệt thự')))) {
      rejectedClaims.push('REJECTED_UNSOURCED_ADDRESS: Address must strictly use canonical dataset (Ngã ba Phúc La Phùng Hưng), not unapproved "TT3-C19 Văn Quán".');
    }
    if (
      lower.includes('ngã ba phúc la phùng hưng') ||
      lower.includes('phúc la phùng hưng') ||
      lower.includes('283 trần khát chân') ||
      lower.includes('64 triệu việt vương')
    ) {
      verifiedClaims.push('VERIFIED_CANONICAL_FACILITY_ADDRESS');
      evidenceCitations.push('dataset::co_so::dia_chi');
    }

    // 8.2. Parking Distance, Location & Fee Validation: No invented distance or fee
    if (
      lower.includes('cách 50m') ||
      lower.includes('cách 100m') ||
      lower.includes('cách khoảng 50m') ||
      /\bcách\b.*\b(50|100)\s*m\b/.test(lower) ||
      ((lower.includes('gửi xe') || lower.includes('đỗ xe') || lower.includes('bãi xe') || lower.includes('bãi gửi') || lower.includes('bãi đỗ')) &&
        (lower.includes('50m') ||
          lower.includes('100m') ||
          lower.includes('rộng rãi ngay trước cửa') ||
          lower.includes('ngay trước cửa') ||
          lower.includes('rộng rãi') ||
          lower.includes('miễn phí') ||
          lower.includes('có phí') ||
          lower.includes('mất phí')))
    ) {
      rejectedClaims.push('REJECTED_UNSOURCED_PARKING_DISTANCE: Parking distance, exact location, or fee is unconfirmed in dataset ("quy_dinh.do_xe").');
    }

    // 8.3. Floor Assertion Validation: Do not infer floor when tang_theo_website is null
    if (
      (lower.includes('phòng tầng 4') || lower.includes('phong tang 4')) &&
      (lower.includes('hà đông') || lower.includes('ha dong') || context.facility === 'jacayl-ha-dong')
    ) {
      rejectedClaims.push('REJECTED_UNCONFIRMED_FLOOR_ASSERTION: Rooms at Ha Dong have null tang_theo_website in dataset; floor must not be asserted.');
    }

    const totalClaims = verifiedClaims.length + disclaimedClaims.length + rejectedClaims.length;

    return {
      total_claims: totalClaims,
      verified_claims: verifiedClaims,
      disclaimed_claims: disclaimedClaims,
      rejected_claims: rejectedClaims,
      evidence_citations: Array.from(new Set(evidenceCitations)),
    };
  }
}
