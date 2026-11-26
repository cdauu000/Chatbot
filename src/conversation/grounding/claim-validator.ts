import { NormalizedDataset, NormalizedRoom } from '../../domain/normalized-schema.js';
import { CoSoMa, StayType } from '../../domain/types.js';
import {
  ClaimValidationSummary,
  DetailedClaimCheck,
} from '../conversation-types.js';
import {
  getHolidayPolicyProvenance,
  loadActivePricingPolicyConfig,
  loadOwnerPolicyAddendums,
  PricingPolicyConfig,
} from '../../data-loader/pricing-policy-loader.js';
import {
  BusinessEvidenceRecord,
  GroundingStatus,
  RoomPresentationBlock,
  RoomPresentationImage,
} from '../../agent/agent-contracts.js';
import { resolveTriStateAmenity } from '../../agent/agent-tools.js';
import { extractVndMentions, ParsedVndMention } from './business-evidence.js';

export interface ClaimValidationConfig {
  allowedBookingDomainOverride?: string; // e.g. "jcollection.vn" only if explicitly configured
}

export interface ExpectedQuoteInput {
  propertyId?: CoSoMa;
  roomId: string;
  roomCode?: string;
  roomName?: string;
  category?: string;
  stayType?: StayType;
  durationHours?: number;
  baseVnd?: number;
  extraHourRateVnd?: number;
  extraHourSubtotalVnd?: number;
  totalVnd: number;
  alternateAmountsVnd?: number[];
  checkinCondition?: string;
  policyVersion?: string;
}

export interface ClaimValidationContext {
  facility?: CoSoMa | null;
  focusedRoomKey?: string | null;
  expectedQuotes?: ExpectedQuoteInput[];
  requestedAmenities?: string[];
  validEvidence?: BusinessEvidenceRecord[];
  deliveredMedia?: RoomPresentationImage[];
  mediaGroups?: RoomPresentationBlock[];
  effectivePolicyVersion?: string;
  userMessage?: string;
  guestBudgetVnd?: number;
  referenceClock?: string;
  checkinConfidence?: string;
  structuredClaimRefs?: string[];
  structuredMediaRefs?: string[];
  policyConfig?: PricingPolicyConfig;
}

export class ClaimLevelValidator {
  private dataset: NormalizedDataset;
  private config: ClaimValidationConfig;

  constructor(dataset: NormalizedDataset, config?: ClaimValidationConfig) {
    this.dataset = dataset;
    this.config = config ?? {};
  }

  /**
   * Validates customer-facing text against Ground Truth facts, scoped business evidence,
   * room identity catalog, media attachments, temporal discipline, and policies.
   */
  public validate(text: string, context: ClaimValidationContext = {}): ClaimValidationSummary {
    const verifiedClaims: string[] = [];
    const disclaimedClaims: string[] = [];
    const rejectedClaims: string[] = [];
    const evidenceCitations: string[] = [];
    const missingEvidenceClaims: string[] = [];
    const contradictedClaims: string[] = [];
    const claimChecks: DetailedClaimCheck[] = [];

    const lower = text.toLowerCase();

    const recordCheck = (check: DetailedClaimCheck) => {
      claimChecks.push(check);
      if (check.matched_evidence_id) {
        evidenceCitations.push(check.matched_evidence_id);
      }
      if (check.status === 'CONTRADICTED') {
        contradictedClaims.push(check.reason);
        rejectedClaims.push(check.reason);
      } else if (check.status === 'MISSING_EVIDENCE') {
        missingEvidenceClaims.push(check.reason);
      }
    };

    // 1. Availability commitment check: NEVER claim room is locked, held, or confirmed
    if (
      lower.includes('đã đặt phòng thành công') ||
      lower.includes('đặt phòng thành công') ||
      lower.includes('mã đặt phòng của bạn') ||
      lower.includes('phòng đã được khóa') ||
      lower.includes('hệ thống đã giữ phòng cho bạn') ||
      lower.includes('em giữ phòng') ||
      lower.includes('bên em đã giữ phòng') ||
      lower.includes('em đã giữ phòng') ||
      lower.includes('em đã đặt phòng') ||
      lower.includes('đã báo lễ tân giữ phòng cho')
    ) {
      rejectedClaims.push('REJECTED_FAKE_BOOKING_CONFIRMATION: Chatbot cannot confirm or hold bookings directly.');
      contradictedClaims.push('REJECTED_FAKE_BOOKING_CONFIRMATION');
    } else {
      verifiedClaims.push('VERIFIED_NO_FAKE_BOOKING_CONFIRMATION');
    }

    // 2. 24/7 service claim check
    if (lower.includes('24/7') || lower.includes('túc trực 24/7')) {
      const msg = 'REJECTED_UNVERIFIED_247_CLAIM: 24/7 staffing is unconfirmed in dataset.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    // 3. Booking & Canonical Media URL source validation
    const urlMatches = text.match(/https?:\/\/[^\s\)\],>]+/g) || [];
    for (const url of urlMatches) {
      const cleanUrl = url.replace(/[.,;!?]+$/, '');
      const isDatasetUrl =
        this.dataset.co_so.some(
          (cs) => cs.link === cleanUrl || cs.zalo === cleanUrl || cs.website === cleanUrl || cs.anh_dai_dien === cleanUrl
        ) ||
        this.dataset.phong.some((p) => p.link_phong === cleanUrl || (p.anh || []).some((img) => img.url === cleanUrl));

      const isAllowedOverride =
        this.config.allowedBookingDomainOverride && url.includes(this.config.allowedBookingDomainOverride);

      if (isDatasetUrl || isAllowedOverride) {
        verifiedClaims.push(`VERIFIED_BOOKING_URL: ${cleanUrl}`);
        evidenceCitations.push(`url::${cleanUrl}`);
      } else {
        const msg = `REJECTED_UNSOURCED_URL: ${cleanUrl} does not exist in dataset and has no approved override.`;
        rejectedClaims.push(msg);
        contradictedClaims.push(msg);
      }
    }

    // 4. Hotline / Phone source validation
    const phoneMatches = text.match(/\b0\d{3}\s?\d{3}\s?\d{3}\b/g) || [];
    for (const phone of phoneMatches) {
      const cleanPhone = phone.replace(/\s/g, '');
      const isDatasetPhone = this.dataset.co_so.some((cs) => cs.dien_thoai?.replace(/\s/g, '') === cleanPhone);
      if (isDatasetPhone) {
        verifiedClaims.push(`VERIFIED_HOTLINE: ${phone}`);
        evidenceCitations.push(`phone::${cleanPhone}`);
      } else {
        const msg = `REJECTED_UNSOURCED_HOTLINE: ${phone} does not match any confirmed hotel phone number.`;
        rejectedClaims.push(msg);
        contradictedClaims.push(msg);
      }
    }

    // 5. Unconfirmed amenities & strict amenity guards
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
            const msg = 'REJECTED_UNVERIFIED_AMENITY_ASSERTION: Máy chiếu asserted without evidence.';
            rejectedClaims.push(msg);
            contradictedClaims.push(msg);
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

    if (lower.includes('king-size') || lower.includes('king size') || lower.includes('queen-size') || lower.includes('queen size')) {
      const msg = 'REJECTED_UNSOURCED_BED_TYPE: Bed type (e.g. king-size) is not confirmed in canonical dataset.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }
    if ((lower.includes('50 — sắc thái') || lower.includes('phòng 601')) && (lower.includes('bồn tắm đôi') || lower.includes('bon tam doi'))) {
      const msg = 'REJECTED_UNCONFIRMED_DOUBLE_BATHTUB: Room 601 has "bồn tắm lớn" in dataset, not confirmed "bồn tắm đôi".';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    // 5.2. Action Confirmation: Reject unverified SLA promises
    if (
      lower.includes('trong ít phút') ||
      lower.includes('trong vài phút') ||
      lower.includes('trong 5 phút') ||
      lower.includes('trong 10 phút')
    ) {
      const msg = 'REJECTED_UNVERIFIED_SLA_PROMISE: Staff response time cannot be promised without confirmed SLA.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    // 6. Business Policy Checks (V1.4.3 + V1.4.5 + V1.4.6)
    this.validatePolicyRules(text, lower, context, verifiedClaims, rejectedClaims, contradictedClaims, evidenceCitations);

    // 7. Canonical Room Identity Policy & Dynamic Catalog Existence Validation (propertyId::roomId)
    this.validateRoomIdentity(text, lower, context, verifiedClaims, rejectedClaims, evidenceCitations, recordCheck);

    // 8. Scoped Monetary & Quote Evidence Validation (uses expectedQuotes + validEvidence)
    this.validateMonetaryAndQuoteClaims(text, context, verifiedClaims, evidenceCitations, recordCheck);

    // 9. Structured Claim Reference Verification (when model outputs claim_refs)
    this.validateStructuredClaimRefs(text, context, recordCheck);

    // 10. Media Attachment Consistency
    this.validateMediaAttachments(text, urlMatches, context, verifiedClaims, evidenceCitations, recordCheck);

    // 11. Temporal Assumption Hygiene
    this.validateTemporalHygiene(text, lower, context, recordCheck);

    // 12. Ground Truth Hardening: Address, Parking, Floor & Breakfast
    this.validateGroundTruthAndBreakfast(lower, context, verifiedClaims, rejectedClaims, contradictedClaims, evidenceCitations);

    // Determine aggregate GroundingStatus cleanly (rejectedClaims empty alone != VERIFIED)
    let groundingStatus: GroundingStatus = 'NOT_APPLICABLE';
    if (rejectedClaims.length > 0 || contradictedClaims.length > 0) {
      groundingStatus = 'CONTRADICTED';
    } else if (missingEvidenceClaims.length > 0) {
      groundingStatus = 'MISSING_EVIDENCE';
    } else if (
      claimChecks.some((c) => c.status === 'VERIFIED') ||
      verifiedClaims.length > 0 ||
      disclaimedClaims.length > 0
    ) {
      groundingStatus = 'VERIFIED';
    }

    const totalClaims = verifiedClaims.length + disclaimedClaims.length + rejectedClaims.length + missingEvidenceClaims.length;

    return {
      total_claims: totalClaims,
      verified_claims: verifiedClaims,
      disclaimed_claims: disclaimedClaims,
      rejected_claims: Array.from(new Set(rejectedClaims)),
      evidence_citations: Array.from(new Set(evidenceCitations)),
      grounding_status: groundingStatus,
      missing_evidence_claims: Array.from(new Set(missingEvidenceClaims)),
      contradicted_claims: Array.from(new Set(contradictedClaims)),
      claim_checks: claimChecks,
    };
  }

  private validatePolicyRules(
    _text: string,
    lower: string,
    context: ClaimValidationContext,
    verifiedClaims: string[],
    rejectedClaims: string[],
    contradictedClaims: string[],
    evidenceCitations: string[]
  ): void {
    // 6.1. Holiday Surcharge (provenance-checked against active Owner-confirmed policy)
    if (
      lower.includes('ngày lễ tăng') ||
      lower.includes('phụ thu ngày lễ') ||
      lower.includes('tăng thêm 30%') ||
      lower.includes('nhân hệ số ngày lễ') ||
      lower.includes('ngay le tang') ||
      lower.includes('phu thu ngay le')
    ) {
      const holProv = getHolidayPolicyProvenance(context.policyConfig ?? loadActivePricingPolicyConfig());
      const isHolidayDenial =
        lower.includes('không có phụ thu ngày lễ') ||
        lower.includes('không phụ thu ngày lễ') ||
        lower.includes('không tăng giá riêng vào ngày lễ') ||
        lower.includes('không tăng giá vào ngày lễ') ||
        lower.includes('không tăng giá') ||
        lower.includes('không áp dụng phụ thu ngày lễ') ||
        lower.includes('khong co phu thu ngay le');

      if (!holProv.confirmedByOwner || holProv.hasHolidaySurcharge !== false) {
        const isUnknownNotice =
          lower.includes('chưa có thông tin') ||
          lower.includes('chưa được xác nhận') ||
          lower.includes('unknown') ||
          lower.includes('liên hệ lễ tân');
        if (!isUnknownNotice) {
          const msg = `REJECTED_UNCONFIRMED_HOLIDAY_POLICY: Active policy (${holProv.policyId}) lacks OWNER_CONFIRMED_ACTIVE approval for holiday surcharge; must remain UNKNOWN.`;
          rejectedClaims.push(msg);
          contradictedClaims.push(msg);
        }
      } else if (isHolidayDenial) {
        verifiedClaims.push(`VERIFIED_NO_HOLIDAY_SURCHARGE: Confirmed no holiday surcharge (${holProv.provenancePath}).`);
        evidenceCitations.push(holProv.provenancePath);
      } else {
        const msg = `REJECTED_HOLIDAY_SURCHARGE_CLAIM: Holiday surcharge is not allowed under ${holProv.policyId}.`;
        rejectedClaims.push(msg);
        contradictedClaims.push(msg);
      }
    }

    // 6.2. Early Morning before 08:00
    if (
      (lower.includes('trước 8h') || lower.includes('truoc 8h') || lower.includes('trước 08h') || lower.includes('truoc 08h')) &&
      (lower.includes('chưa có bảng giá') || lower.includes('chưa có chính sách') || lower.includes('chua co bang gia') || lower.includes('chua co chinh sach'))
    ) {
      const msg = 'REJECTED_EARLY_MORNING_UNCONFIRMED_CLAIM: Early morning before 08:00 is CONFIRMED under V1.4.3.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    // 6.3. Minimum 2-hour hourly stay
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
        const msg = 'REJECTED_UNSUPPORTED_1_HOUR_CLAIM: 1-hour hourly package is not offered.';
        rejectedClaims.push(msg);
        contradictedClaims.push(msg);
      }
    }

    // 6.4. Overnight early check-in before 21:40
    if (
      (lower.includes('21h30') || lower.includes('21:30') || lower.includes('20h') || lower.includes('20:30') || lower.includes('20:00') || lower.includes('19h')) &&
      (lower.includes('với giá qua đêm') ||
        lower.includes('voi gia qua dem') ||
        lower.includes('vẫn được giá qua đêm') ||
        lower.includes('vẫn tính gói qua đêm') ||
        lower.includes('van duoc gia qua dem') ||
        lower.includes('van tinh goi qua dem'))
    ) {
      const msg = 'REJECTED_OVERNIGHT_EARLY_CHECKIN_CLAIM: Overnight rate only applies from 21:40 onwards.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    // 6.5. Overtime 10-minute recurring boundary & Policy version alignment (V1.4.6)
    if (
      lower.includes('trễ đúng 10 phút là bị tính thêm') ||
      lower.includes('tre dung 10 phut la bi tinh them') ||
      lower.includes('trễ 10 phút là tính thêm giờ') ||
      lower.includes('tre 10 phut la tinh them gio') ||
      lower.includes('từ phút 15') ||
      lower.includes('tu phut 15')
    ) {
      const msg = 'REJECTED_OVERTIME_10MIN_BOUNDARY_CLAIM: Exactly 10 minutes is within grace period, charges apply from minute 11.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    const effectiveVer = context.effectivePolicyVersion ?? '1.4.6';
    if (
      effectiveVer === '1.4.6' &&
      (lower.includes('chỉ áp dụng một lần') || lower.includes('chỉ áp dụng 1 lần') || lower.includes('chỉ ân hạn giờ đầu'))
    ) {
      const msg = 'REJECTED_POLICY_VERSION_MISMATCH: Policy V1.4.6 applies 10-minute grace to EVERY extra-hour boundary, not first hour only.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    if (
      (lower.includes('mỗi mốc giờ') || lower.includes('từng mốc giờ') || lower.includes('moi moc gio')) &&
      (lower.includes('10 phút') || lower.includes('10p') || lower.includes('10 phut'))
    ) {
      verifiedClaims.push('VERIFIED_RECURRING_OVERTIME_GRACE_V1_4_6: Matches Owner Directive V1.4.6.');
      evidenceCitations.push('j_collection_business_policy_addendum_v1_4_6.json#late_checkout');
    }

    // Check explicit policy version contradiction (e.g., citing deprecated V1.4.4 or mismatched quote policy version)
    const mentionedVer = lower.match(/policy\s*v?(1\.\d+\.\d+)/i);
    if (mentionedVer && mentionedVer[1] === '1.4.4' && effectiveVer === '1.4.6') {
      const msg = `REJECTED_POLICY_VERSION_MISMATCH: Response cites outdated Policy V${mentionedVer[1]} while active policy is V${effectiveVer}.`;
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }
  }

  private validateRoomIdentity(
    text: string,
    lower: string,
    context: ClaimValidationContext,
    verifiedClaims: string[],
    rejectedClaims: string[],
    evidenceCitations: string[],
    recordCheck: (c: DetailedClaimCheck) => void
  ): void {
    // Legacy canonical identity guards (Section 7.1 - 7.5)
    if (lower.includes('tổng thống') || lower.includes('tong thong')) {
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

    if (
      lower.includes('401') &&
      (lower.includes('hà đông') || lower.includes('ha dong') || context.facility === 'jacayl-ha-dong') &&
      (lower.includes('giá dự kiến') || lower.includes('giá:') || lower.includes('phù hợp') || lower.includes('lựa chọn') || lower.includes('đặt phòng') || /401\D{0,25}\d{3}\.\d{3}/.test(lower))
    ) {
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

    const fictitiousRoomKeywords = ['cinema', 'lồng sắt', 'long sat', 'gác mái cổ điển', 'gac mai co dien'];
    for (const kw of fictitiousRoomKeywords) {
      if (lower.includes(kw)) {
        rejectedClaims.push(`REJECTED_FICTITIOUS_ROOM: Room matching "${kw}" does not exist in canonical dataset.`);
      }
    }
    if (context.facility === 'jacayl-ha-dong' && (lower.includes('nhật bản') || lower.includes('nhat ban'))) {
      rejectedClaims.push('REJECTED_FICTITIOUS_ROOM: Room "Nhật Bản" does not exist at Jacayl Hà Đông.');
    }

    if (
      lower.includes('601 — 50 — sắc thái') ||
      lower.includes('601 - 50 — sắc thái') ||
      lower.includes('601 - 50 - sắc thái') ||
      lower.includes('601 — 50 - sắc thái')
    ) {
      rejectedClaims.push('REJECTED_PREPENDED_ROOM_CODE: Technical room code "601" was prepended to canonical name "50 — Sắc Thái".');
    }

    // Dynamic Canonical Catalog Check using propertyId::roomId (NO hardcoded room whitelists)
    if (!context.facility) return;
    const facilityRooms = this.dataset.phong.filter((p) => p.co_so_ma === context.facility);
    const validRoomCodes = new Set(
      facilityRooms
        .filter((p) => !(context.facility === 'jacayl-ha-dong' && p.ma_phong.startsWith('401')))
        .map((p) => p.ma_phong.split('-')[0].toLowerCase())
    );

    // Extract room code mentions: "Phòng 301", "P.301", "Phòng 101, 201, 301..."
    const mentionedCodes: Array<{ code: string; raw: string; index: number }> = [];
    const listPattern = /(?:phòng|phong|p\.?|room|mã phòng|ma phong)\s+(\d{3,4}(?:\s*[,/và&]\s*\d{3,4})*)/gi;
    let lm: RegExpExecArray | null;
    while ((lm = listPattern.exec(text)) !== null) {
      const groupStr = lm[1];
      const numPattern = /\b(\d{3,4})\b/g;
      let nm: RegExpExecArray | null;
      while ((nm = numPattern.exec(groupStr)) !== null) {
        mentionedCodes.push({
          code: nm[1],
          raw: `${lm[0]}`,
          index: lm.index + nm.index,
        });
      }
    }

    for (const item of mentionedCodes) {
      // Skip known non-room numbers like 1001 in "1001 Đêm" only if validRoomCodes already has '1001'
      const codeLower = item.code.toLowerCase();
      // Ignore 4-digit years like 2026 or 1800 if preceded by words like năm/hotline
      const preCtx = text.slice(Math.max(0, item.index - 15), item.index).toLowerCase();
      if (/năm|hotline|sđt/.test(preCtx)) continue;

      const sentenceStart = Math.max(0, text.lastIndexOf('\n', item.index) + 1);
      const nextNl = text.indexOf('\n', item.index);
      const sentence = text.slice(sentenceStart, nextNl === -1 ? text.length : nextNl).toLowerCase();
      const localClause = text.slice(Math.max(0, item.index - 45), Math.min(text.length, item.index + 65)).toLowerCase();

      if (validRoomCodes.has(codeLower)) {
        const matchedRoom = facilityRooms.find((r) => r.ma_phong.split('-')[0].toLowerCase() === codeLower);
        recordCheck({
          claim_type: 'ROOM',
          raw_text: `Phòng ${item.code}`,
          normalized_value: `${context.facility}::${matchedRoom?.ma_phong || item.code}`,
          status: 'VERIFIED',
          reason: `Verified room ${context.facility}::${matchedRoom?.ma_phong || item.code} in canonical catalog.`,
          matched_evidence_id: matchedRoom ? matchedRoom.id : `${context.facility}::${item.code}`,
        });
      } else {
        // Non-existent (or 401 non-commercial) room code: allow explicit denial / clarification!
        const isDenialOrClarification =
          /không có\s+(?:phòng|p\.?)\s*\d*|không tồn tại|chưa có\s+(?:phòng|thông tin)|không thuộc danh mục|không nằm trong danh mục|không nằm trong hệ thống|không có trong danh sách|chưa tìm thấy|không mở bán|không kinh doanh|không bán|chỉ có\s+(?:phòng|các phòng)/.test(
            localClause
          ) || /không có phòng\b.*nào|không tồn tại/.test(sentence);

        if (isDenialOrClarification) {
          verifiedClaims.push(`VERIFIED_NON_EXISTENT_ROOM_CLARIFICATION: Correctly clarified room ${item.code} is not in ${context.facility}.`);
          recordCheck({
            claim_type: 'ROOM',
            raw_text: `Phòng ${item.code}`,
            normalized_value: `${context.facility}::${item.code}`,
            status: 'VERIFIED',
            reason: `Agent accurately denied/clarified non-existent room ${item.code} at ${context.facility}.`,
            matched_evidence_id: `catalog::${context.facility}::non_existent_${item.code}`,
          });
        } else {
          recordCheck({
            claim_type: 'ROOM',
            raw_text: `Phòng ${item.code}`,
            normalized_value: `${context.facility}::${item.code}`,
            status: 'CONTRADICTED',
            reason: `REJECTED_NON_EXISTENT_ROOM_ASSERTION: Room ${item.code} does not exist in canonical catalog of ${context.facility}.`,
          });
        }
      }
    }

    // Relational Check 1 (Room <-> Category): verify attributed category matches canonical room.hang
    this.validateRoomCategoryRelations(text, lower, facilityRooms, verifiedClaims, recordCheck);

    // Relational Check 2 (Room <-> Amenity Provenance): forbid claiming "không có" when status is UNKNOWN
    this.validateAmenityProvenance(text, facilityRooms, recordCheck);

    // Unconditional Real-Time Vacancy Guard: static catalog existence != PMS room availability
    // Disclaimers do NOT excuse an affirmative stock assertion.
    const sentences = text.split(/[\n.!?;]+/).map((s) => s.trim()).filter(Boolean);
    for (const sen of sentences) {
      const senLower = sen.toLowerCase();
      const assertsStock =
        /(?:hiện\s+|vẫn\s+|chắc\s+chắn\s+)?(?:đang\s+|vẫn\s+)?còn\s+(?:trống|phòng\s+trống)(?!\s*(?:hay\s+)?không\b|\s+chưa\b)|(?:phòng|hạng\s+\w+)\s+(?:chắc\s+chắn\s+|hiện\s+)?đang\s+trống|còn\s+\d+\s+phòng\s+trống/iu.test(
          senLower
        );
      if (!assertsStock) continue;
      const isExplicitNegationOrCheck =
        /(?:không\s+(?:thể|khẳng định|xác nhận|biết|hiển thị|xem được|kiểm tra được)|chưa\s+(?:thể|kiểm tra được|xác nhận được|có\s+(?:dữ liệu|thông tin|trạng thái))|(?:kiểm tra|check|xác nhận|hỏi|xem)\s+(?:lại\s+)?(?:xem\s+|tình trạng\s+)?[^.\n]*(?:còn trống|có trống|trống))[^.\n]{0,35}(?:còn\s+trống|đang\s+trống|phòng\s+trống)/iu.test(
          senLower
        );
      if (!isExplicitNegationOrCheck) {
        recordCheck({
          claim_type: 'BOOKING',
          raw_text: sen.slice(0, 80),
          status: 'CONTRADICTED',
          reason:
            'REJECTED_UNVERIFIED_VACANCY_CLAIM: Affirmative real-time room vacancy claim is forbidden without live PMS check (disclaimers do not allow asserting stock).',
        });
      }
    }
  }

  /**
   * Validates that any category label attributed to a room matches its canonical dataset `hang`.
   */
  private validateRoomCategoryRelations(
    text: string,
    _lower: string,
    facilityRooms: NormalizedRoom[],
    verifiedClaims: string[],
    recordCheck: (c: DetailedClaimCheck) => void
  ): void {
    const uniqueCats = Array.from(new Set(facilityRooms.map((r) => r.hang))).sort((a, b) => b.length - a.length);
    if (uniqueCats.length === 0) return;

    const catRegex = new RegExp(
      `(?<![\\p{L}\\d])(?:hạng\\s+(?:phòng\\s+)?)?(${uniqueCats.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\d])`,
      'giu'
    );

    const segments = text
      .split(/[\n.;]+|(?:\b(?:hoặc|hay|còn)\b\s+(?=(?:hạng|phòng|standard|deluxe|concept|premium|suite|superior|vip)\b))/iu)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const seg of segments) {
      const segLower = seg.toLowerCase();
      if (/(?:không phải|không thuộc|chứ không|thay vì|nâng cấp lên|chuyển sang|giữa\s+.*?\bvà\b|so với)/iu.test(segLower)) {
        continue;
      }
      catRegex.lastIndex = 0;
      const catsInSeg: Array<{ cat: string; index: number }> = [];
      let cm: RegExpExecArray | null;
      while ((cm = catRegex.exec(segLower)) !== null) {
        const canonical = uniqueCats.find((u) => u.toLowerCase() === cm![1].toLowerCase());
        if (canonical) catsInSeg.push({ cat: canonical, index: cm.index });
      }
      if (catsInSeg.length !== 1) continue;
      const statedCat = catsInSeg[0].cat;

      // Find explicit rooms attributed inside this exact segment (only clear attribution: near category or in list like "hạng Deluxe như 302, 305")
      const isAttributionSeg =
        /hạng\s+|thuộc\s+|như\s+|ví dụ|vd:|\(|:\s*\d{3}/iu.test(segLower) ||
        /\bphòng\s+\d{3,4}\b/iu.test(segLower);
      if (!isAttributionSeg) continue;

      for (const rm of facilityRooms) {
        const code = rm.ma_phong.split('-')[0].toLowerCase();
        const codeMentioned = new RegExp(`(?<![\\p{L}\\d])${code}(?![\\p{L}\\d])`, 'i').test(segLower);
        const nameLower = rm.ten_phong.toLowerCase();
        // Match full name or distinctive title >= 5 chars (excluding generic category word itself)
        const titlePart = nameLower.replace(/^\d+\s*[—–-]\s*/, '').trim();
        const nameMentioned =
          titlePart.length >= 5 &&
          !uniqueCats.some((u) => u.toLowerCase() === titlePart) &&
          new RegExp(`(?<![\\p{L}\\d])${titlePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'iu').test(segLower);

        if (!codeMentioned && !nameMentioned) continue;

        if (rm.hang.toLowerCase() !== statedCat.toLowerCase()) {
          recordCheck({
            claim_type: 'ROOM',
            raw_text: `${rm.ten_phong} <-> ${statedCat}`,
            normalized_value: `${rm.ma_phong}::true=${rm.hang}::stated=${statedCat}`,
            status: 'CONTRADICTED',
            reason: `REJECTED_ROOM_CATEGORY_RELATION: Room ${rm.ten_phong} (${rm.ma_phong}) belongs to category "${rm.hang}", not "${statedCat}".`,
          });
        } else {
          verifiedClaims.push(`VERIFIED_ROOM_CATEGORY_RELATION: ${rm.ma_phong} matches ${rm.hang}.`);
        }
      }
    }
  }

  /**
   * Prevents asserting affirmative amenity absence ("không có bồn tắm" / "không có ghế tình yêu")
   * when canonical dataset status is UNKNOWN (omitted on website rather than confirmed absent).
   */
  private validateAmenityProvenance(
    text: string,
    facilityRooms: NormalizedRoom[],
    recordCheck: (c: DetailedClaimCheck) => void
  ): void {
    const clauses = text.split(/[\n.;]+/).map((s) => s.trim()).filter(Boolean);
    for (const cl of clauses) {
      const clLower = cl.toLowerCase();
      const claimsNoTub =
        /(?:không có|không được trang bị|không trang bị|không có trang bị)\s+bồn tắm/iu.test(clLower) &&
        !/(?:chưa có thông tin|không tìm thấy thông tin|không nhắc|không công bố)/iu.test(clLower);
      const claimsNoChair =
        /(?:không có|không được trang bị|không trang bị|không có trang bị)\s+ghế tình yêu/iu.test(clLower) &&
        !/(?:chưa có thông tin|không tìm thấy thông tin|không nhắc|không công bố)/iu.test(clLower);
      if (!claimsNoTub && !claimsNoChair) continue;

      for (const rm of facilityRooms) {
        const code = rm.ma_phong.split('-')[0].toLowerCase();
        const titlePart = rm.ten_phong.toLowerCase().replace(/^\d+\s*[—–-]\s*/, '').trim();
        const mentioned =
          new RegExp(`(?<![\\p{L}\\d])${code}(?![\\p{L}\\d])`, 'i').test(clLower) ||
          (titlePart.length >= 4 && clLower.includes(titlePart));
        if (!mentioned) continue;

        if (claimsNoTub && resolveTriStateAmenity(rm.tien_nghi.bon_tam) === 'UNKNOWN') {
          recordCheck({
            claim_type: 'AMENITY',
            raw_text: `${rm.ten_phong}: không có bồn tắm`,
            status: 'CONTRADICTED',
            reason: `REJECTED_UNVERIFIED_AMENITY_ABSENCE: Room ${rm.ma_phong} has UNKNOWN bon_tam status in catalog; website omission cannot be stated as "không có".`,
          });
        }
        if (claimsNoChair && resolveTriStateAmenity(rm.tien_nghi.ghe_tinh_yeu) === 'UNKNOWN') {
          recordCheck({
            claim_type: 'AMENITY',
            raw_text: `${rm.ten_phong}: không có ghế tình yêu`,
            status: 'CONTRADICTED',
            reason: `REJECTED_UNVERIFIED_AMENITY_ABSENCE: Room ${rm.ma_phong} has UNKNOWN ghe_tinh_yeu status in catalog; website omission cannot be stated as "không có".`,
          });
        }
      }
    }
  }

  private validateMonetaryAndQuoteClaims(
    text: string,
    context: ClaimValidationContext,
    verifiedClaims: string[],
    evidenceCitations: string[],
    recordCheck: (c: DetailedClaimCheck) => void
  ): void {
    const mentions = extractVndMentions(text);
    if (mentions.length === 0) return;

    const addendum = loadOwnerPolicyAddendums();
    const activeEffectivePolicy = context.effectivePolicyVersion ?? '1.4.6';

    // Collect valid active evidence & expectedQuotes for THIS facility
    const rawExpected = context.expectedQuotes || [];
    const rawEvidence = context.validEvidence || [];

    // Check cross-property pollution in passed expectedQuotes or evidence
    for (const q of rawExpected) {
      if (q.propertyId && context.facility && q.propertyId !== context.facility) {
        recordCheck({
          claim_type: 'PRICE',
          raw_text: `${q.totalVnd}`,
          normalized_value: q.totalVnd,
          status: 'CONTRADICTED',
          reason: `REJECTED_CROSS_PROPERTY_QUOTE_EVIDENCE: Quote ${q.roomId} belongs to ${q.propertyId}, not ${context.facility}.`,
        });
      }
      if (q.policyVersion && q.policyVersion !== activeEffectivePolicy) {
        recordCheck({
          claim_type: 'POLICY',
          raw_text: `V${q.policyVersion}`,
          status: 'CONTRADICTED',
          reason: `REJECTED_POLICY_VERSION_MISMATCH: Quote policy V${q.policyVersion} mismatches active Policy V${activeEffectivePolicy}.`,
        });
      }
    }

    const validPriceEntries: BusinessEvidenceRecord[] = rawEvidence.filter(
      (ev) =>
        ev.isValid &&
        (!context.facility || ev.propertyId === context.facility) &&
        ev.effectivePolicyVersion === activeEffectivePolicy &&
        (ev.evidenceType === 'QUOTE' ||
          ev.evidenceType === 'CATALOG_SEARCH' ||
          ev.evidenceType === 'ROOM_FACTS' ||
          ev.evidenceType === 'POLICY')
    );

    // Bridge context.expectedQuotes if caller passed expectedQuotes directly (e.g. unit test without state)
    const bridgedFromExpected: BusinessEvidenceRecord[] = rawExpected
      .filter((q) => !context.facility || !q.propertyId || q.propertyId === context.facility)
      .map((q, idx) => {
        const roomMeta = context.facility
          ? this.dataset.phong.find(
            (p) => p.co_so_ma === context.facility && (p.ma_phong === q.roomId || p.ma_phong.startsWith(q.roomId))
          )
          : undefined;
        const alts = new Set<number>([q.totalVnd, ...(q.alternateAmountsVnd || [])]);
        if (typeof q.baseVnd === 'number') alts.add(q.baseVnd);
        if (typeof q.extraHourRateVnd === 'number') alts.add(q.extraHourRateVnd);
        if (typeof q.extraHourSubtotalVnd === 'number') alts.add(q.extraHourSubtotalVnd);
        return {
          evidenceId: `expected_quote_${q.roomId}_${idx}`,
          propertyId: (q.propertyId ?? context.facility ?? 'jacayl-ha-dong') as CoSoMa,
          roomId: roomMeta?.ma_phong ?? q.roomId,
          roomCode: q.roomCode ?? (roomMeta?.ma_phong ?? q.roomId).split('-')[0],
          roomName: q.roomName ?? roomMeta?.ten_phong,
          category: q.category ?? roomMeta?.hang,
          evidenceType: 'QUOTE' as const,
          toolSource: 'quote_price',
          stayPackage: q.stayType,
          amountVnd: q.totalVnd,
          basePriceVnd: q.baseVnd,
          extraHourRateVnd: q.extraHourRateVnd,
          extraHourSubtotalVnd: q.extraHourSubtotalVnd,
          alternateAmountsVnd: Array.from(alts),
          durationHours: q.durationHours,
          checkinDatetime: q.checkinCondition,
          effectivePolicyVersion: q.policyVersion ?? activeEffectivePolicy,
          datasetVersion: 'canonical',
          validityScope: 'SESSION_WHILE_VALID' as const,
          isValid: true,
          recordedTurn: 0,
        };
      });

    // Combine deduplicated active price evidence (prefer full validPriceEntries + expectedQuotes)
    const activeEntries = [...validPriceEntries];
    for (const b of bridgedFromExpected) {
      const dup = activeEntries.some(
        (e) =>
          e.evidenceType === 'QUOTE' &&
          e.roomId === b.roomId &&
          e.amountVnd === b.amountVnd &&
          e.stayPackage === b.stayPackage &&
          e.durationHours === b.durationHours
      );
      if (!dup) activeEntries.push(b);
    }

    const facilityRooms: NormalizedRoom[] = context.facility
      ? this.dataset.phong.filter((p) => p.co_so_ma === context.facility)
      : [];

    const userMsgLower = (context.userMessage || '').toLowerCase();

    for (const mention of mentions) {
      const localPre = text.slice(Math.max(0, mention.index - 55), mention.index).toLowerCase();
      const localAround = text
        .slice(Math.max(0, mention.index - 50), Math.min(text.length, mention.index + mention.raw.length + 40))
        .toLowerCase();

      // 1) Distinguish guest budget / echoed user figures -> NOT_APPLICABLE
      const isBudgetPhrase =
        /(?:ngân sách|tầm giá|tầm tiền|trong tầm|tài chính|mức trần|tối đa|dưới mức|dưới\s*$|trên\s*$|bạn đưa ra|bạn vừa nêu|bạn hỏi|anh\/chị nêu|khách nêu|với mức)\s*[^.\n:]*$/i.test(
          localPre
        ) ||
        /(?:của anh\/chị|của bạn|vượt ngân sách|nằm trong ngân sách)/i.test(localAround) ||
        (typeof context.guestBudgetVnd === 'number' &&
          mention.amountVnd === context.guestBudgetVnd &&
          /(?:ngân sách|tầm|khoảng|dưới|tối đa|vượt)/i.test(mention.sentenceLower));

      if (isBudgetPhrase) {
        recordCheck({
          claim_type: 'PRICE',
          raw_text: mention.raw,
          normalized_value: mention.amountVnd,
          status: 'NOT_APPLICABLE',
          reason: `Guest budget or echoed customer threshold (${mention.raw}), not a hotel price assertion.`,
        });
        continue;
      }

      // 2) Zero-fee (0đ) policy validation (strictly check Owner-approved provenance for holiday vs grace evidence)
      if (mention.amountVnd === 0) {
        const isHolidayZero = /(?:ngày lễ|lễ|tết|phụ thu lễ|tăng giá.*lễ)/i.test(mention.sentenceLower);
        const isGraceZero = /(?:phát sinh|trễ|muộn|ân hạn|quá giờ|miễn phí giờ)/i.test(mention.sentenceLower) ||
          /(?:0đ phát sinh|phát sinh\s*0đ)/i.test(localAround);
        const holProv = getHolidayPolicyProvenance(context.policyConfig ?? loadActivePricingPolicyConfig());
        const hasHolidayPolicyToolEvidence =
          rawEvidence.length === 0 ||
          activeEntries.some((e) => e.evidenceType === 'POLICY' && e.holidayZeroConfirmed);
        const hasHolidayEvidence =
          holProv.confirmedByOwner && holProv.hasHolidaySurcharge === false && hasHolidayPolicyToolEvidence;
        const hasGraceZeroEvidence =
          activeEntries.some((e) => e.extraHourSubtotalVnd === 0 || (e.scopedRates || []).some((r) => r.amountVnd === 0)) ||
          Boolean(addendum?.late_checkout);
        const validZero = (isHolidayZero && hasHolidayEvidence) || (isGraceZero && hasGraceZeroEvidence);
        if (validZero) {
          verifiedClaims.push(`VERIFIED_ZERO_FEE_POLICY: Valid 0đ fee mention (${mention.raw}).`);
          recordCheck({
            claim_type: 'PRICE',
            raw_text: mention.raw,
            normalized_value: 0,
            status: 'VERIFIED',
            reason: `Verified 0đ ${isHolidayZero ? `holiday policy (${holProv.provenancePath})` : 'grace-period'} mention under active policy V${activeEffectivePolicy}.`,
            matched_evidence_id: isHolidayZero ? holProv.provenancePath : `policy::V${activeEffectivePolicy}::grace_zero`,
          });
        } else {
          recordCheck({
            claim_type: 'PRICE',
            raw_text: mention.raw,
            normalized_value: 0,
            status: 'CONTRADICTED',
            reason: `REJECTED_INVALID_ZERO_PRICE: Stated 0đ (${mention.raw}) lacks confirmed policy/grace provenance.`,
          });
        }
        continue;
      }

      // 3) Price difference / savings delta between two verified evidence values
      if (/(?:chênh lệch|chênh nhau|cao hơn|thấp hơn|rẻ hơn|tiết kiệm|ít hơn|đắt hơn)\s*[^.\n:]*$/i.test(localPre)) {
        const allValidPool = new Set<number>();
        for (const e of activeEntries) {
          if (typeof e.amountVnd === 'number') allValidPool.add(e.amountVnd);
          for (const a of e.alternateAmountsVnd || []) allValidPool.add(a);
        }
        const poolArr = Array.from(allValidPool);
        let matchedDelta = false;
        for (let i = 0; i < poolArr.length; i++) {
          for (let j = i + 1; j < poolArr.length; j++) {
            if (Math.abs(poolArr[i] - poolArr[j]) === mention.amountVnd) {
              matchedDelta = true;
              break;
            }
          }
          if (matchedDelta) break;
        }
        if (matchedDelta) {
          recordCheck({
            claim_type: 'PRICE',
            raw_text: mention.raw,
            normalized_value: mention.amountVnd,
            status: 'VERIFIED',
            reason: `Verified price difference delta (${mention.raw}) across active quote evidence.`,
            matched_evidence_id: activeEntries[0]?.evidenceId || 'quote_delta',
          });
          continue;
        }
      }

      // 4) Hotel rate / quote total / extra-hour surcharge check against scoped activeEntries
      if (activeEntries.length === 0) {
        // Also ignore user-echoed arbitrary question numbers if clearly quoting user back
        const reason = `MISSING_EVIDENCE_PRICE_CLAIM: Stated hotel amount ${mention.raw} (${mention.amountVnd.toLocaleString('vi-VN')}đ) without valid active quote or catalog evidence.`;
        recordCheck({
          claim_type: 'PRICE',
          raw_text: mention.raw,
          normalized_value: mention.amountVnd,
          status: 'MISSING_EVIDENCE',
          reason,
        });
        continue;
      }

      // Determine clause entity scope: category / room / package / duration (inheriting preceding header line on multi-line sub-bullets)
      const linesBefore = text.slice(0, mention.index).split('\n');
      const curLineTrim = (linesBefore[linesBefore.length - 1] || '').trim();
      const prevHeaderCandidate = linesBefore
        .slice(Math.max(0, linesBefore.length - 4), -1)
        .reverse()
        .find((l) => /:\s*$/.test(l.trim()) && l.trim().length > 4);
      const precedingHeader = /^[-*•]/.test(curLineTrim) || !curLineTrim.includes(':') ? prevHeaderCandidate : undefined;
      const clauseScope = this.detectClauseEntityScope(mention, localPre, facilityRooms, precedingHeader);

      // Filter entries applicable to this clause's entity/package
      const quoteEntries = activeEntries.filter((e) => e.evidenceType === 'QUOTE');
      const catalogOrFactsEntries = activeEntries.filter(
        (e) => e.evidenceType === 'CATALOG_SEARCH' || e.evidenceType === 'ROOM_FACTS'
      );
      const policyEntries = activeEntries.filter((e) => e.evidenceType === 'POLICY');

      const matchedEvidenceId = this.findMatchingEvidenceForMention(
        mention,
        clauseScope,
        quoteEntries,
        catalogOrFactsEntries,
        policyEntries
      );

      if (matchedEvidenceId === 'SCOPE_CONTRADICTION') {
        recordCheck({
          claim_type: 'PRICE',
          raw_text: mention.raw,
          normalized_value: mention.amountVnd,
          status: 'CONTRADICTED',
          reason: `REJECTED_PRICE_MISMATCH: Amount ${mention.raw} (${mention.amountVnd.toLocaleString('vi-VN')}đ) contradicts verified ${clauseScope.summary} rates in active evidence.`,
        });
      } else if (matchedEvidenceId === 'MISSING_SCOPED_EVIDENCE') {
        // E.g. active evidence only fetched 'nghi_gio' 4h, while sentence claims 'qua đêm 450.000đ'
        recordCheck({
          claim_type: 'PRICE',
          raw_text: mention.raw,
          normalized_value: mention.amountVnd,
          status: 'MISSING_EVIDENCE',
          reason: `MISSING_EVIDENCE_PRICE_SCOPE: Stated ${mention.raw} for ${clauseScope.summary}, not covered by active valid evidence.`,
        });
      } else {
        // Finding A: Check category / multi-room pricing completeness when advising hourly (>2h) on heterogeneous categories
        const catIncompleteReason = this.checkHeterogeneousCategoryCompleteness(
          text,
          mention,
          clauseScope,
          facilityRooms,
          precedingHeader
        );
        if (catIncompleteReason) {
          recordCheck({
            claim_type: 'PRICE',
            raw_text: mention.raw,
            normalized_value: mention.amountVnd,
            status: 'CONTRADICTED',
            reason: catIncompleteReason,
          });
          continue;
        }
        verifiedClaims.push(`VERIFIED_PRICE_GROUNDED: ${mention.raw} verified by ${matchedEvidenceId}.`);
        evidenceCitations.push(matchedEvidenceId);
        recordCheck({
          claim_type: 'PRICE',
          raw_text: mention.raw,
          normalized_value: mention.amountVnd,
          status: 'VERIFIED',
          reason: `Grounded monetary value ${mention.raw} via ${matchedEvidenceId}.`,
          matched_evidence_id: matchedEvidenceId,
        });
      }
    }
    void userMsgLower;
  }

  private detectClauseEntityScope(
    mention: ParsedVndMention,
    localPre: string,
    facilityRooms: NormalizedRoom[],
    precedingHeader?: string
  ): {
    roomId?: string;
    category?: string;
    stayPackage?: StayType | 'EXTRA_HOUR';
    isBase2hOnly?: boolean;
    explicitTotalHours?: number;
    summary: string;
  } {
    const s = mention.sentenceLower;
    const rawLower = mention.raw.toLowerCase();
    const mRelIdx = Math.max(0, s.indexOf(rawLower));
    // Extract tight sub-clause around this mention delimited by commas, parentheses, semicolons, +, =, or "hoặc"
    const leftBound = Math.max(
      s.lastIndexOf(',', mRelIdx),
      s.lastIndexOf(';', mRelIdx),
      s.lastIndexOf('(', mRelIdx),
      s.lastIndexOf(')', mRelIdx),
      s.lastIndexOf('+', mRelIdx),
      s.lastIndexOf('=', mRelIdx),
      s.lastIndexOf(' hoặc ', mRelIdx),
      s.lastIndexOf(' và ', mRelIdx)
    );
    const rightCandidates = [
      s.indexOf(',', mRelIdx + rawLower.length),
      s.indexOf(';', mRelIdx + rawLower.length),
      s.indexOf(')', mRelIdx + rawLower.length),
      s.indexOf('(', mRelIdx + rawLower.length),
      s.indexOf('+', mRelIdx + rawLower.length),
      s.indexOf('=', mRelIdx + rawLower.length),
      s.indexOf(' hoặc ', mRelIdx + rawLower.length),
      s.indexOf(' và ', mRelIdx + rawLower.length),
    ].filter((x) => x !== -1);
    const rightBound = rightCandidates.length > 0 ? Math.min(...rightCandidates) : s.length;
    const subClause = s.slice(leftBound === -1 ? 0 : leftBound + 1, rightBound).trim();
    const headerSlice = s.slice(0, Math.min(mRelIdx, Math.max(0, s.indexOf(':')))).trim();

    const extractRoomAndCat = (textSeg: string): { roomId?: string; category?: string } => {
      const segNorm = textSeg.replace(/\*/g, '').replace(/\s*[—–-]\s*/g, ' ');
      let rId: string | undefined;
      let cat: string | undefined;
      for (const r of facilityRooms) {
        const rCode = r.ma_phong.split('-')[0].toLowerCase();
        const rName = r.ten_phong.toLowerCase().replace(/^\d+\s*[—–-]\s*/, '').replace(/\s*[—–-]\s*/g, ' ').trim();
        if (
          new RegExp(`(?<![\\p{L}\\d])${rCode}(?![\\p{L}\\d])`, 'iu').test(segNorm) ||
          (rName.length >= 4 && segNorm.includes(rName))
        ) {
          rId = r.ma_phong;
          cat = r.hang;
          break;
        }
      }
      if (!cat) {
        if (/\bstandard\b|tiêu chuẩn/iu.test(segNorm)) cat = 'Standard';
        else if (/\bdeluxe\b/iu.test(segNorm)) cat = 'Deluxe';
        else if (/\bconcept\b/iu.test(segNorm)) cat = 'Concept';
        else if (/\bpremium\b/iu.test(segNorm)) cat = 'Premium';
        else if (/\bvip\b|\bsignature\b/iu.test(segNorm)) cat = 'VIP';
        else if (/\bsuite\b|\bexecutive\b/iu.test(segNorm)) cat = 'Suite';
      }
      return { roomId: rId, category: cat };
    };

    // Priority: 1) tight sub-clause -> 2) line header before ":" -> 3) whole line -> 4) parent bullet header
    let { roomId, category } = extractRoomAndCat(subClause);
    if (!roomId && !category && headerSlice) {
      ({ roomId, category } = extractRoomAndCat(headerSlice));
    }
    if (!roomId && !category) {
      ({ roomId, category } = extractRoomAndCat(s));
    }
    if (!roomId && !category && precedingHeader) {
      ({ roomId, category } = extractRoomAndCat(precedingHeader.toLowerCase()));
    }

    let stayPackage: StayType | 'EXTRA_HOUR' | undefined;
    const afterRaw = s.slice(mRelIdx + rawLower.length, mRelIdx + rawLower.length + 32);
    const isExtraRateClause =
      /\/\s*(?:giờ|gio|h|tiếng|tieng)(?![\p{L}\d])/iu.test(rawLower) ||
      /^\s*\/\s*(?:giờ|gio|h|tiếng|tieng)(?![\p{L}\d])/iu.test(afterRaw) ||
      /(?:phụ thu|thêm giờ|giờ phát sinh|quá giờ|mỗi giờ tiếp theo)[^.\n=]*$/iu.test(localPre) ||
      /\b\d+\s*[x×*]\s*$/iu.test(localPre);

    const detectPkg = (seg: string): StayType | undefined => {
      if (/ngày đêm|ngay dem|cả ngày/iu.test(seg)) return 'ngay_dem';
      if (/qua đêm|qua dem|\/đêm|\/dem/iu.test(seg) && !/nghỉ giờ/iu.test(localPre)) return 'qua_dem';
      if (/nghỉ giờ|nghi gio|\b(?:2|3|4|5|6)\s*(?:giờ|tiếng|h)(?![\p{L}\d])/iu.test(seg)) return 'nghi_gio';
      return undefined;
    };

    const appositivePkgMatch = afterRaw.match(/^\s*\*\*\s*\((?:gói\s+)?(ngày đêm|qua đêm)/iu) ||
      afterRaw.match(/^\s*\((?:gói\s+)?(ngày đêm|qua đêm)/iu);

    if (isExtraRateClause && mention.amountVnd <= 250000) {
      stayPackage = 'EXTRA_HOUR';
    } else if (appositivePkgMatch) {
      stayPackage = /ngày/iu.test(appositivePkgMatch[1]) ? 'ngay_dem' : 'qua_dem';
    } else {
      stayPackage = detectPkg(subClause) ?? detectPkg(s);
    }

    const isBase2hOnly =
      /(?:2\s*(?:giờ|tiếng|h)\s*đầu|trọn gói 2h|giá cơ bản 2|\/2\s*(?:h|giờ|tiếng)(?![\p{L}\d]))/iu.test(
        subClause + ' ' + mention.raw
      ) && !/(?:thêm|phát sinh|cộng|tiếp theo|tiếng sau|giờ sau|phụ thu|phụ phí)/iu.test(subClause);
    const totalDurRegex = /(?<![\p{L}\d])(\d+)\s*(?:giờ|tiếng|h)(?!\s*(?:đầu|dau|thêm|them|phát sinh|phat sinh|tiếp theo|tiep theo|sau))(?![\p{L}\d])/iu;
    const durMatch =
      subClause.match(totalDurRegex) ||
      s.match(totalDurRegex) ||
      (precedingHeader ? precedingHeader.toLowerCase().match(totalDurRegex) : null);
    const explicitTotalHours =
      durMatch && !isBase2hOnly && parseInt(durMatch[1], 10) >= 2 && parseInt(durMatch[1], 10) <= 12
        ? parseInt(durMatch[1], 10)
        : undefined;

    return {
      roomId,
      category,
      stayPackage,
      isBase2hOnly,
      explicitTotalHours,
      summary: `${roomId || category || 'facility'}:${stayPackage || 'any'}${explicitTotalHours ? `(${explicitTotalHours}h)` : ''}`,
    };
  }

  /**
   * Checks whether a heterogeneous category (rooms sharing base_2h but having different extra_hour_rates)
   * has contradictory example rooms or omits a sibling tier when advising >2h hourly at category level.
   */
  private checkHeterogeneousCategoryCompleteness(
    fullText: string,
    mention: ParsedVndMention,
    scope: ReturnType<ClaimLevelValidator['detectClauseEntityScope']>,
    facilityRooms: NormalizedRoom[],
    precedingHeader?: string
  ): string | null {
    if (
      scope.stayPackage === 'qua_dem' ||
      scope.stayPackage === 'ngay_dem' ||
      scope.stayPackage === 'EXTRA_HOUR' ||
      scope.isBase2hOnly ||
      !scope.category ||
      facilityRooms.length === 0
    ) {
      return null;
    }

    const catRooms = facilityRooms.filter(
      (r) =>
        r.hang.toLowerCase() === scope.category!.toLowerCase() &&
        !(r.co_so_ma === 'jacayl-ha-dong' && r.ma_phong.startsWith('401'))
    );
    const extraRates = Array.from(new Set(catRooms.map((r) => r.gia_goc_dataset.gio_phat_sinh_ap_dung))).sort((a, b) => a - b);
    if (extraRates.length <= 1) return null;

    let effectiveTotalHours = scope.explicitTotalHours;
    if (!effectiveTotalHours) {
      // Allow multi-bullet lists whose opening sentence establishes an N-hour stay duration (e.g. "báo giá cho gói 4 tiếng như sau:")
      const introMatch = fullText
        .split('\n')
        .slice(0, 2)
        .join(' ')
        .match(/(?:bảng báo giá|báo giá|mức giá|giá\s+(?:nghỉ|lưu trú)|nghỉ|lưu trú)[^.\n]*?\b([3-9]|1[0-2])\s*(?:giờ|tiếng|h)\b/iu);
      if (introMatch && !/(?:qua đêm|ngày đêm|cả ngày)/iu.test(mention.sentenceLower)) {
        effectiveTotalHours = parseInt(introMatch[1], 10);
      }
    }
    if (!effectiveTotalHours || effectiveTotalHours <= 2) return null;

    const isSubComponent = /(?:phát sinh|thêm|cộng thêm|giờ đầu|2h đầu|tiếp theo)/iu.test(mention.sentenceLower) &&
      mention.amountVnd <= 400000;
    if (isSubComponent) return null;

    // Collect ALL rooms named on the same bullet/sentence or inherited section header
    const sLower = mention.sentenceLower;
    const headerSliceEnd = sLower.indexOf(mention.raw.toLowerCase());
    const baseSpan = headerSliceEnd > 0 ? sLower.slice(0, headerSliceEnd + mention.raw.length + 12) : sLower;
    const relevantSpan = `${baseSpan} ${(precedingHeader || '').toLowerCase()}`
      .replace(/\*/g, '')
      .replace(/\s*[—–-]\s*/g, ' ');
    const citedRooms = catRooms.filter((r) => {
      const code = r.ma_phong.split('-')[0].toLowerCase();
      const title = r.ten_phong.toLowerCase().replace(/^\d+\s*[—–-]\s*/, '').replace(/\s*[—–-]\s*/g, ' ').trim();
      return (
        new RegExp(`(?<![\\p{L}\\d])${code}(?![\\p{L}\\d])`, 'i').test(relevantSpan) ||
        (title.length >= 4 && relevantSpan.includes(title))
      );
    });

    const extraHours = effectiveTotalHours - 2;
    const fullNums = new Set(extractVndMentions(fullText).map((m) => m.amountVnd));

    const expectedTotalFor = (r: NormalizedRoom): number[] => {
      const wkdBase = r.gia_goc_dataset.nghi_gio_2h;
      const totals = [wkdBase + extraHours * r.gia_goc_dataset.gio_phat_sinh_ap_dung];
      if (r.co_so_ma === 'jacayl-ha-dong') {
        const weBase = r.hang === 'Standard' ? 180000 : r.hang === 'Deluxe' ? 315000 : r.hang === 'Concept' ? 449000 : wkdBase;
        if (weBase !== wkdBase) totals.push(weBase + extraHours * r.gia_goc_dataset.gio_phat_sinh_ap_dung);
      }
      return totals;
    };

    const allDistinctCatTotals = Array.from(new Set(catRooms.flatMap((r) => expectedTotalFor(r))));
    if (!allDistinctCatTotals.includes(mention.amountVnd)) return null;
    const mentionsRangeOrBoth =
      /(?:\btừ\s+\d{3}[\d.]*\s*(?:k|đ|vnđ)?\s*(?:–|-|đến|tới)\s*\d{3}|\bdao động\b)/iu.test(fullText) ||
      extraRates.every((rate) => {
        const matchingRoom = catRooms.find((r) => r.gia_goc_dataset.gio_phat_sinh_ap_dung === rate);
        return matchingRoom ? expectedTotalFor(matchingRoom).some((tot) => fullNums.has(tot)) : true;
      });

    // Case 1: Bullet/header explicitly cites multiple rooms from different rate tiers alongside a single price (e.g. "VD: 101 Lồng Chim, 601 Sắc Thái: 599k")
    if (citedRooms.length >= 2) {
      const citedExtraRates = new Set(citedRooms.map((r) => r.gia_goc_dataset.gio_phat_sinh_ap_dung));
      if (citedExtraRates.size > 1 && !mentionsRangeOrBoth) {
        const mismatchedNames = citedRooms
          .filter((r) => !expectedTotalFor(r).includes(mention.amountVnd))
          .map((r) => r.ten_phong);
        if (mismatchedNames.length > 0) {
          return `REJECTED_INCOMPLETE_CATEGORY_PRICING: Single ${effectiveTotalHours}h amount ${mention.raw} contradicts distinct extra-hour tiers for cited rooms [${mismatchedNames.join(', ')}] in heterogeneous category ${scope.category}.`;
        }
      }
    }

    // Case 2: Category-level advisory without citing a single specific room omits sibling price tier
    if (citedRooms.length === 0 && !mentionsRangeOrBoth) {
      return `REJECTED_INCOMPLETE_CATEGORY_PRICING: Category ${scope.category} has multiple ${effectiveTotalHours}h rates [${allDistinctCatTotals.join(', ')}] across rooms; stating sole rate ${mention.raw} omits sibling room tier.`;
    }
    return null;
  }

  private findMatchingEvidenceForMention(
    mention: ParsedVndMention,
    scope: ReturnType<ClaimLevelValidator['detectClauseEntityScope']>,
    quoteEntries: BusinessEvidenceRecord[],
    catalogOrFactsEntries: BusinessEvidenceRecord[],
    policyEntries: BusinessEvidenceRecord[]
  ): string {
    const val = mention.amountVnd;

    // A) Extra hour rate check (also allow multi-hour extra subtotal when text says e.g. "phụ thu 2 tiếng tiếp theo 200.000đ")
    if (scope.stayPackage === 'EXTRA_HOUR') {
      const mentionsMultiHourSubtotal = /\b(?:[2-9]\d?)\s*(?:giờ|tiếng|h)\s*(?:thêm|sau|tiếp theo|phát sinh|quá giờ|cộng)|(?:thêm|phát sinh)\s*(?:[2-9]\d?)\s*(?:giờ|tiếng|h)/iu.test(
        mention.sentenceLower
      );
      const scopedQuotes = quoteEntries.filter(
        (q) =>
          (!scope.roomId || q.roomId === scope.roomId) &&
          (!scope.category || q.category === scope.category)
      );
      const scopedRateMatch = scopedQuotes.find(
        (q) =>
          q.extraHourRateVnd === val ||
          (mentionsMultiHourSubtotal && q.extraHourSubtotalVnd === val) ||
          (q.scopedRates || []).some(
            (r) =>
              (r.role === 'EXTRA_HOUR_RATE' || (mentionsMultiHourSubtotal && r.role === 'EXTRA_HOUR_SUBTOTAL')) &&
              r.amountVnd === val
          )
      );
      if (scopedRateMatch) return scopedRateMatch.evidenceId;

      for (const c of catalogOrFactsEntries) {
        const catTyped = (c.scopedRates || []).find(
          (r) =>
            r.role === 'EXTRA_HOUR_RATE' &&
            r.amountVnd === val &&
            (!scope.roomId || !r.roomId || r.roomId === scope.roomId) &&
            (!scope.category || !r.category || r.category.toLowerCase() === scope.category.toLowerCase())
        );
        if (catTyped) return c.evidenceId;
        const snaps = (c.categoryRateSnapshots || []).filter(
          (sn) => !scope.category || sn.category === scope.category
        );
        if (snaps.some((sn) => sn.extraHourRateVnd === val)) return c.evidenceId;
      }
      for (const p of policyEntries) {
        if (
          (p.scopedRates || []).some(
            (r) =>
              (r.role === 'EXTRA_HOUR_RATE' || r.role === 'POLICY_RATE') &&
              r.amountVnd === val &&
              (!scope.roomId || !r.roomId || r.roomId === scope.roomId) &&
              (!scope.category || !r.category || r.category.toLowerCase() === scope.category.toLowerCase())
          ) ||
          (!p.scopedRates && (p.alternateAmountsVnd || []).includes(val))
        ) {
          return p.evidenceId;
        }
      }
      // Also check any generic catalog snapshots matching room/category extraHourRateVnd
      const extraSnapMatch = this.checkCatalogSnapshots(val, scope, catalogOrFactsEntries);
      if (extraSnapMatch) return extraSnapMatch;

      // If we DO have scoped quotes/policies/catalog for that room/category with a different extraHourRateVnd -> contradiction!
      if (
        scopedQuotes.some((q) => typeof q.extraHourRateVnd === 'number') ||
        policyEntries.some((p) => (p.scopedRates || []).some((r) => r.role === 'EXTRA_HOUR_RATE' || r.role === 'POLICY_RATE'))
      ) {
        return 'SCOPE_CONTRADICTION';
      }
      return 'MISSING_SCOPED_EVIDENCE';
    }

    // B) Match against active QUOTE evidence respecting room/category/stayPackage/duration & typed scopedRates
    if (quoteEntries.length > 0) {
      const entityMatched = quoteEntries.filter(
        (q) =>
          (!scope.roomId || q.roomId === scope.roomId) &&
          (!scope.category || !q.category || q.category.toLowerCase() === scope.category.toLowerCase())
      );

      if (entityMatched.length > 0) {
        for (const q of entityMatched) {
          const sr = q.scopedRates || [];
          if (sr.length > 0) {
            const mentionsExtraSubtotal = /(?:phát sinh|thêm|cộng thêm|\+|tiếp theo|tiếng sau|giờ sau|phụ thu|phụ phí|sau\s*2\s*(?:h|giờ|tiếng))/iu.test(
              mention.sentenceLower
            );
            const matchedTyped = sr.find((r) => {
              if (r.amountVnd !== val) return false;
              if (scope.roomId && r.roomId && r.roomId !== scope.roomId) return false;
              if (scope.category && r.category && r.category.toLowerCase() !== scope.category.toLowerCase()) return false;
              if (scope.stayPackage && scope.stayPackage !== 'EXTRA_HOUR') {
                const allowExtraInBreakdown =
                  r.role === 'EXTRA_HOUR_RATE' &&
                  /\b\d+\s*[x×*]|\bphát sinh\b|\bgiờ thêm\b|\btiếng thêm\b|\/\s*(?:giờ|h)/iu.test(mention.sentenceLower);
                if (!allowExtraInBreakdown && r.stayPackage && r.stayPackage !== 'ALL' && r.stayPackage !== scope.stayPackage) {
                  return false;
                }
              }
              if (scope.isBase2hOnly) {
                return r.role === 'BASE_2H' || (r.role === 'TOTAL' && r.durationHours === 2);
              }
              if (r.role === 'EXTRA_HOUR_SUBTOTAL') return mentionsExtraSubtotal;
              if (scope.explicitTotalHours && scope.stayPackage === 'nghi_gio') {
                if (r.role === 'BASE_2H') return true;
                return !r.durationHours || r.durationHours === scope.explicitTotalHours;
              }
              return true;
            });
            if (matchedTyped) return q.evidenceId;
          }
        }

        const pkgMatched = scope.stayPackage
          ? entityMatched.filter((q) => {
            if (q.stayPackage === scope.stayPackage) return true;
            if ((q.scopedRates || []).some((r) => r.stayPackage === scope.stayPackage)) return true;
            return !q.stayPackage && !(q.scopedRates && q.scopedRates.length > 0);
          })
          : entityMatched;

        if (pkgMatched.length > 0) {
          // Legacy fallback ONLY when structured scopedRates is absent (e.g. unit test bridging ExpectedQuoteInput)
          for (const q of pkgMatched) {
            if (q.scopedRates && q.scopedRates.length > 0) continue;
            const validNums = new Set<number>();
            if (scope.isBase2hOnly) {
              if (typeof q.basePriceVnd === 'number') validNums.add(q.basePriceVnd);
              for (const a of q.alternateAmountsVnd || []) validNums.add(a);
            } else if (scope.explicitTotalHours && typeof q.durationHours === 'number' && q.durationHours === scope.explicitTotalHours) {
              if (typeof q.amountVnd === 'number') validNums.add(q.amountVnd);
              if (typeof q.basePriceVnd === 'number') validNums.add(q.basePriceVnd);
              if (typeof q.extraHourSubtotalVnd === 'number') validNums.add(q.extraHourSubtotalVnd);
              for (const a of q.alternateAmountsVnd || []) validNums.add(a);
            } else {
              if (typeof q.amountVnd === 'number') validNums.add(q.amountVnd);
              if (typeof q.basePriceVnd === 'number') validNums.add(q.basePriceVnd);
              if (typeof q.extraHourRateVnd === 'number') validNums.add(q.extraHourRateVnd);
              if (typeof q.extraHourSubtotalVnd === 'number') validNums.add(q.extraHourSubtotalVnd);
              for (const a of q.alternateAmountsVnd || []) validNums.add(a);
            }
            if (validNums.has(val)) return q.evidenceId;
          }

          // Before declaring SCOPE_CONTRADICTION when text omits stayPackage (e.g. "Standard: 420.000đ" after earlier hourly quote),
          // check whether CATALOG_SEARCH / ROOM_FACTS verifies val for that room/category!
          const catFallbackMatch = this.checkCatalogSnapshots(val, scope, catalogOrFactsEntries);
          if (catFallbackMatch && catFallbackMatch !== 'SCOPE_CONTRADICTION') {
            return catFallbackMatch;
          }

          // If we matched the EXACT room/category AND stayPackage (and duration if hourly total),
          // and the number wasn't found among its valid values (nor in valid catalog snapshots) -> CONTRADICTION!
          const sameDurationChecked =
            !scope.explicitTotalHours ||
            scope.isBase2hOnly ||
            pkgMatched.some(
              (q) =>
                q.durationHours === scope.explicitTotalHours ||
                (q.scopedRates || []).some((r) => r.durationHours === scope.explicitTotalHours)
            );

          if (sameDurationChecked) {
            return 'SCOPE_CONTRADICTION';
          }
        } else if (scope.stayPackage) {
          // Wait: entityMatched had e.g. only nghi_gio, whereas text asks qua_dem!
          // Check catalog/facts snapshots before concluding MISSING_SCOPED_EVIDENCE
          const snapMatch = this.checkCatalogSnapshots(val, scope, catalogOrFactsEntries);
          if (snapMatch) return snapMatch;
          return 'MISSING_SCOPED_EVIDENCE';
        }
      }
    }

    // C) Fall back to active CATALOG_SEARCH / ROOM_FACTS scoped snapshots
    const catMatch = this.checkCatalogSnapshots(val, scope, catalogOrFactsEntries);
    if (catMatch) return catMatch;

    return catalogOrFactsEntries.length > 0 || quoteEntries.length > 0
      ? 'SCOPE_CONTRADICTION'
      : 'MISSING_SCOPED_EVIDENCE';
  }

  private checkCatalogSnapshots(
    val: number,
    scope: ReturnType<ClaimLevelValidator['detectClauseEntityScope']>,
    entries: BusinessEvidenceRecord[]
  ): string | null {
    let sawApplicablePackageData = false;
    for (const ev of entries) {
      const snaps = (ev.categoryRateSnapshots || []).filter(
        (sn) => !scope.category || sn.category.toLowerCase() === scope.category.toLowerCase()
      );
      for (const sn of snaps) {
        const b2h = new Set<number>([...(sn.base2hVnds || []), ...(typeof sn.base2hVnd === 'number' ? [sn.base2hVnd] : [])]);
        const ovn = new Set<number>([...(sn.overnightVnds || []), ...(typeof sn.overnightVnd === 'number' ? [sn.overnightVnd] : [])]);
        const dnt = new Set<number>([...(sn.dayNightVnds || []), ...(typeof sn.dayNightVnd === 'number' ? [sn.dayNightVnd] : [])]);
        const ext = new Set<number>([...(sn.extraHourRateVnds || []), ...(typeof sn.extraHourRateVnd === 'number' ? [sn.extraHourRateVnd] : [])]);
        const hExt = new Set<number>(sn.hourlyExtendedVnds || []);

        if (scope.stayPackage === 'qua_dem') {
          if (ovn.has(val)) return ev.evidenceId;
          if (ovn.size > 0) sawApplicablePackageData = true;
        } else if (scope.stayPackage === 'ngay_dem') {
          if (dnt.has(val)) return ev.evidenceId;
          if (dnt.size > 0) sawApplicablePackageData = true;
        } else if (scope.stayPackage === 'nghi_gio') {
          if (scope.isBase2hOnly || !scope.explicitTotalHours || scope.explicitTotalHours === 2) {
            if (b2h.has(val)) return ev.evidenceId;
          }
          if (scope.explicitTotalHours && scope.explicitTotalHours > 2 && hExt.has(val)) {
            return ev.evidenceId;
          }
          if (b2h.has(val) || ext.has(val) || hExt.has(val)) {
            return ev.evidenceId;
          }
          if (b2h.size > 0 || hExt.size > 0) sawApplicablePackageData = true;
        } else {
          if (b2h.has(val) || ovn.has(val) || dnt.has(val) || ext.has(val) || hExt.has(val)) {
            return ev.evidenceId;
          }
        }
      }
    }
    return sawApplicablePackageData ? 'SCOPE_CONTRADICTION' : null;
  }

  private validateStructuredClaimRefs(
    text: string,
    context: ClaimValidationContext,
    recordCheck: (c: DetailedClaimCheck) => void
  ): void {
    const refs = context.structuredClaimRefs;
    if (!refs || refs.length === 0) return;
    const allEvidence = context.validEvidence || [];
    const activeValid = allEvidence.filter((e) => e.isValid);
    const evidenceMap = new Map<string, BusinessEvidenceRecord>();
    for (const ev of allEvidence) {
      evidenceMap.set(ev.evidenceId, ev);
    }
    const textPrices = new Set(extractVndMentions(text).map((m) => m.amountVnd));

    for (const refId of refs) {
      const exactEv = evidenceMap.get(refId);
      if (exactEv) {
        if (!exactEv.isValid) {
          recordCheck({
            claim_type: 'POLICY',
            raw_text: refId,
            status: 'CONTRADICTED',
            reason: `REJECTED_INVALID_CLAIM_REF: Structured claim_ref "${refId}" is missing or invalidated.`,
          });
          continue;
        }
        if (exactEv.evidenceType === 'QUOTE' && typeof exactEv.amountVnd === 'number' && textPrices.size > 0) {
          const expectedSet = new Set<number>([exactEv.amountVnd, ...(exactEv.alternateAmountsVnd || [])]);
          const hasAnyExpected = Array.from(textPrices).some((p) => expectedSet.has(p));
          if (!hasAnyExpected) {
            recordCheck({
              claim_type: 'PRICE',
              raw_text: refId,
              normalized_value: exactEv.amountVnd,
              status: 'CONTRADICTED',
              reason: `REJECTED_CLAIM_REF_TEXT_MISMATCH: Structured claim_ref "${refId}" expects ${exactEv.amountVnd.toLocaleString('vi-VN')}đ, which mismatches final text prices [${Array.from(textPrices).join(', ')}].`,
            });
          }
        }
        continue;
      }

      // Live LLMs also emit canonical roomId / roomCode in claim_refs when referencing tool-fetched rooms
      const matchingRoomEvs = activeValid.filter(
        (ev) => ev.roomId === refId || ev.roomCode === refId || (ev.catalogRoomIds || []).includes(refId)
      );
      if (matchingRoomEvs.length === 0) {
        recordCheck({
          claim_type: 'POLICY',
          raw_text: refId,
          status: 'CONTRADICTED',
          reason: `REJECTED_INVALID_CLAIM_REF: Structured claim_ref "${refId}" is missing or invalidated.`,
        });
      }
    }
  }

  private validateMediaAttachments(
    text: string,
    urlMatches: string[],
    context: ClaimValidationContext,
    verifiedClaims: string[],
    evidenceCitations: string[],
    recordCheck: (c: DetailedClaimCheck) => void
  ): void {
    const rawImageUrls = urlMatches.filter((u) => /\.(webp|jpg|jpeg|png)(\?|$)/i.test(u));
    const attachedCount = context.deliveredMedia?.length ?? 0;

    if (rawImageUrls.length > 0 && attachedCount === 0) {
      recordCheck({
        claim_type: 'MEDIA',
        raw_text: rawImageUrls[0],
        status: 'CONTRADICTED',
        reason: `MISSING_MEDIA_ATTACHMENT: Response pasted ${rawImageUrls.length} raw room image URL(s) in prose without structured deliveredMedia attachment.`,
      });
      return;
    }

    if (attachedCount > 0) {
      const allCanonical = (context.deliveredMedia || []).every((img) =>
        this.dataset.phong.some((p) => (p.anh || []).some((a) => a.url === img.url))
      );
      if (allCanonical) {
        verifiedClaims.push(`VERIFIED_MEDIA_ATTACHMENTS: ${attachedCount} canonical photo(s) attached.`);
        evidenceCitations.push(`media::attached::${attachedCount}`);
      } else {
        recordCheck({
          claim_type: 'MEDIA',
          raw_text: `${attachedCount} attachments`,
          status: 'CONTRADICTED',
          reason: 'REJECTED_NON_CANONICAL_MEDIA_ATTACHMENT: Attached media URL does not match canonical dataset.',
        });
      }
    } else {
      const claimsPhotosAttached = /gửi kèm hình ảnh|đã gửi.*hình ảnh|album ảnh.*dưới đây|hình ảnh chụp thực tế.*như sau/i.test(text);
      const userMsg = context.userMessage || '';
      const userAskedPhotos =
        /(?:xem\s*(?:hình|ảnh)|gửi[^\n.]*(?<![\p{L}\d])(?:hình|ảnh)(?![\p{L}\d])|cho[^\n.]*xem\s*(?:hình|ảnh)|album\s*ảnh|hình\s*ảnh\s*(?:phòng|thực tế))/iu.test(
          userMsg
        );
      const clarifiesNoPhotosOrAsksWhichRoom =
        /không có.*(?:hình|ảnh|phòng)|chưa có.*(?:hình|ảnh)|không tồn tại|chưa thể gửi ảnh|muốn xem ảnh phòng nào|hạng phòng nào để em gửi/i.test(
          text
        );
      if (claimsPhotosAttached || (userAskedPhotos && !clarifiesNoPhotosOrAsksWhichRoom)) {
        recordCheck({
          claim_type: 'MEDIA',
          raw_text: claimsPhotosAttached ? 'photo_delivery_claim' : 'user_requested_photo_missing',
          status: 'MISSING_EVIDENCE',
          reason: claimsPhotosAttached
            ? 'MISSING_MEDIA_ATTACHMENT: Response states photos are provided below, yet deliveredMedia attachment list is empty.'
            : 'MISSING_MEDIA_ATTACHMENT: Guest explicitly requested room photos, yet get_room_media was not called or media_refs was omitted.',
        });
      }
    }
  }

  private validateTemporalHygiene(
    text: string,
    _lower: string,
    context: ClaimValidationContext,
    recordCheck: (c: DetailedClaimCheck) => void
  ): void {
    if (!context.referenceClock) return;
    const timeMatch = context.referenceClock.match(/T(\d{2}):(\d{2})/);
    if (!timeMatch) return;
    const refHour = timeMatch[1];
    const refMin = timeMatch[2];
    const refClockHHMM = `${refHour}:${refMin}`;
    const userMsg = (context.userMessage || '').toLowerCase();

    // Did the user themselves specify this clock hour (e.g. "14h", "14:00", "2h chiều")?
    const hourNum = parseInt(refHour, 10);
    const pmHour = hourNum > 12 ? hourNum - 12 : hourNum;
    const userStatedRefClock =
      userMsg.includes(refClockHHMM) ||
      new RegExp(`\\b(?:${hourNum}|${pmHour})\\s*(?:h|giờ|g)\\b`, 'i').test(userMsg) ||
      /\bbây giờ\b|\bngay bây giờ\b|\bhiện tại\b/i.test(userMsg);

    if (userStatedRefClock) return;

    // Only flag when reference clock hour is asserted as confirmed guest arrival (e.g. "(từ 14:00 chiều nay)"),
    // NEVER flagging canonical day-night package policy window ("Gói cả ngày (ngày đêm): nhận phòng từ 14:00 hôm nay đến 12:00 trưa hôm sau")
    const sanitizedForPackageWindow = text.replace(
      /(?:gói\s+)?(?:cả ngày|ngày đêm)[^.\n]*?(?:14:00\s+hôm nay[^.\n]*?12:00)/giu,
      ''
    );
    const leakedRefClockPattern = new RegExp(
      `(?:từ|lúc|nhận phòng(?: lúc)?)\\s+${refHour}[:h]${refMin}\\s+(?:chiều nay|hôm nay|sáng nay|tối nay)`,
      'i'
    );
    if (leakedRefClockPattern.test(sanitizedForPackageWindow) && !/\bnếu\b|\btrường hợp\b|\bgiả sử\b/i.test(sanitizedForPackageWindow)) {
      recordCheck({
        claim_type: 'TEMPORAL',
        raw_text: refClockHHMM,
        normalized_value: refClockHHMM,
        status: 'CONTRADICTED',
        reason: `REJECTED_UNCONFIRMED_REFERENCE_CLOCK_ASSERTION: Response locked unconfirmed reference clock (${refClockHHMM}) as guest arrival time without user specifying ${refClockHHMM}.`,
      });
    }
  }

  private validateGroundTruthAndBreakfast(
    lower: string,
    context: ClaimValidationContext,
    verifiedClaims: string[],
    rejectedClaims: string[],
    contradictedClaims: string[],
    evidenceCitations: string[]
  ): void {
    // Facility Address
    if (lower.includes('tt3-c19') || (lower.includes('văn quán') && (lower.includes('địa chỉ') || lower.includes('tại cơ sở') || lower.includes('khu biệt thự')))) {
      const msg = 'REJECTED_UNSOURCED_ADDRESS: Address must strictly use canonical dataset (Ngã ba Phúc La Phùng Hưng), not unapproved "TT3-C19 Văn Quán".';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
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

    // Parking Distance, Location & Fee
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
      const msg = 'REJECTED_UNSOURCED_PARKING_DISTANCE: Parking distance, exact location, or fee is unconfirmed in dataset ("quy_dinh.do_xe").';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    // Floor Assertion
    if (
      (lower.includes('phòng tầng 4') || lower.includes('phong tang 4')) &&
      (lower.includes('hà đông') || lower.includes('ha dong') || context.facility === 'jacayl-ha-dong')
    ) {
      const msg = 'REJECTED_UNCONFIRMED_FLOOR_ASSERTION: Rooms at Ha Dong have null tang_theo_website in dataset; floor must not be asserted.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    // Breakfast Policy Addendum Validation
    const addendum = loadOwnerPolicyAddendums();
    const breakfastServiceConfirmedFalse =
      addendum?.breakfast?.service_available === false ||
      addendum?.breakfast?.separate_service_availability === false ||
      addendum?.breakfast?.separate_service_availability === 'FALSE';

    if (
      (lower.includes('bao gồm bữa sáng') ||
        lower.includes('bao gom bua sang') ||
        lower.includes('bao gồm ăn sáng') ||
        lower.includes('bao gom an sang') ||
        lower.includes('miễn phí bữa sáng') ||
        lower.includes('mien phi bua sang') ||
        lower.includes('miễn phí ăn sáng') ||
        lower.includes('tặng kèm bữa sáng')) &&
      !lower.includes('không bao gồm') &&
      !lower.includes('khong bao gom') &&
      !lower.includes('chưa bao gồm') &&
      !lower.includes('chua bao gom') &&
      !lower.includes('không kèm')
    ) {
      const msg = 'REJECTED_BREAKFAST_INCLUDED_CLAIM: Room rates do not include breakfast across any J Collection property or package.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }

    if (breakfastServiceConfirmedFalse) {
      const affirmsBreakfastService =
        (lower.includes('có phục vụ bữa sáng') ||
          lower.includes('co phuc vu bua sang') ||
          lower.includes('có phục vụ ăn sáng') ||
          lower.includes('co phuc vu an sang') ||
          lower.includes('có bán bữa sáng') ||
          lower.includes('có bán suất sáng') ||
          lower.includes('bán suất ăn sáng riêng')) &&
        !lower.includes('không phục vụ') &&
        !lower.includes('khong phuc vu') &&
        !lower.includes('không bán') &&
        !lower.includes('khong ban') &&
        !lower.includes('không cung cấp') &&
        !lower.includes('khong cung cap') &&
        !lower.includes('không có');

      if (affirmsBreakfastService) {
        const msg = 'REJECTED_BREAKFAST_SERVICE_AVAILABLE_CLAIM: Under Business Policy V1.4.5, J Collection does NOT serve breakfast or sell separate breakfast sets.';
        rejectedClaims.push(msg);
        contradictedClaims.push(msg);
      } else if (
        lower.includes('không phục vụ bữa sáng') ||
        lower.includes('khong phuc vu bua sang') ||
        lower.includes('không phục vụ ăn sáng') ||
        lower.includes('không bán suất sáng') ||
        lower.includes('không bao gồm bữa sáng') ||
        lower.includes('không kèm bữa sáng')
      ) {
        verifiedClaims.push('VERIFIED_BREAKFAST_NOT_SERVED: Matches Owner Directive V1.4.5.');
        evidenceCitations.push('j_collection_business_policy_addendum_v1_4_5.json#breakfast');
      }
    } else if (
      lower.includes('không phục vụ bữa sáng dưới bất kỳ hình thức') ||
      lower.includes('không phục vụ bữa sáng dưới mọi hình thức') ||
      lower.includes('hoàn toàn không có đồ ăn sáng')
    ) {
      const msg = 'REJECTED_BREAKFAST_ABSOLUTE_DENIAL: Separate breakfast service availability is UNKNOWN and must not be categorically denied.';
      rejectedClaims.push(msg);
      contradictedClaims.push(msg);
    }
  }
}
