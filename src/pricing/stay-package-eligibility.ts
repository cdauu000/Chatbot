import { CoSoMa, CompositeRoomKey, StayType } from '../domain/types.js';
import { parseVietnamDateTime } from './checkin-pricing-resolver.js';

export interface StayPackageEligibilityInput {
  facility_id: CoSoMa;
  room_composite_key?: CompositeRoomKey;
  requested_stay_type: StayType;
  requested_checkin_datetime: string; // ISO 8601 string
  requested_checkout_datetime?: string; // ISO 8601 string
  customer_preference_for_immediate_checkin?: boolean;
  stay_until_next_day?: boolean; // e.g. customer wants "đến trưa mai", "đến sáng mai"
  policy_version?: string;
}

export type PackageEligibilityStatus =
  | 'ELIGIBLE'
  | 'ALTERNATIVE_PACKAGE_RECOMMENDED'
  | 'EARLY_CHECKIN_GRACE_APPLIED'
  | 'NEEDS_POLICY_CLARIFICATION';

export type PackageExplanationReasonCode =
  | 'STANDARD_OVERNIGHT_CHECKIN'
  | 'EARLY_OVERNIGHT_WITHIN_20_MIN'
  | 'TOO_EARLY_FOR_OVERNIGHT'
  | 'RECOMMEND_DAY_NIGHT_PACKAGE'
  | 'WAIT_UNTIL_OVERNIGHT_ELIGIBLE'
  | 'UNRESOLVED_STAY_WINDOW';

export interface StayPackageEligibilityResult {
  requested_stay_type: StayType;
  recommended_stay_type: StayType;
  requested_checkin: string; // Normalized ISO string
  effective_checkin: string;
  eligibility_status: PackageEligibilityStatus;
  applied_policy_id: string;
  evidence_references: string[];
  price_source: string;
  explanation_reason_code: PackageExplanationReasonCode;
  customer_explanation: string;
  alternative_option?: {
    stay_type: StayType;
    checkin_time: string;
    description: string;
  };
}

export class StayPackageEligibilityResolver {
  private policyId: string = 'J_COLLECTION_BUSINESS_POLICY_V1_4_3';

  /**
   * Deterministically resolves stay package eligibility based on Owner-Confirmed Business Policy V1.4.3.
   */
  public resolve(input: StayPackageEligibilityInput): StayPackageEligibilityResult {
    const dtParts = parseVietnamDateTime(input.requested_checkin_datetime);
    const requestedCheckinIso = dtParts ? dtParts.isoNormalized : input.requested_checkin_datetime;

    const requestedStayType = input.requested_stay_type;
    const isStayingOvernight = requestedStayType === 'qua_dem' || Boolean(input.stay_until_next_day);

    if (!dtParts) {
      return {
        requested_stay_type: requestedStayType,
        recommended_stay_type: requestedStayType,
        requested_checkin: requestedCheckinIso,
        effective_checkin: requestedCheckinIso,
        eligibility_status: 'NEEDS_POLICY_CLARIFICATION',
        applied_policy_id: this.policyId,
        evidence_references: ['Invalid datetime string'],
        price_source: 'POLICY_UNRESOLVED',
        explanation_reason_code: 'UNRESOLVED_STAY_WINDOW',
        customer_explanation: 'Thời gian nhận phòng không hợp lệ.',
      };
    }

    const { hour, minute } = dtParts;
    const totalMinutes = hour * 60 + minute;

    // 1. Hourly stay (nghi_gio) without overnight intention
    if (requestedStayType === 'nghi_gio' && !input.stay_until_next_day) {
      return {
        requested_stay_type: 'nghi_gio',
        recommended_stay_type: 'nghi_gio',
        requested_checkin: requestedCheckinIso,
        effective_checkin: requestedCheckinIso,
        eligibility_status: 'ELIGIBLE',
        applied_policy_id: this.policyId,
        evidence_references: [
          'Business Policy V1.4.3: Gói nghỉ giờ tối thiểu 2 giờ đầu theo timestamp check-in',
        ],
        price_source: 'room.gia.nghi_gio_2h',
        explanation_reason_code: 'STANDARD_OVERNIGHT_CHECKIN',
        customer_explanation: 'Áp dụng gói nghỉ giờ (tối thiểu 2 tiếng).',
      };
    }

    // 2. Day-Night requested directly (ngay_dem)
    if (requestedStayType === 'ngay_dem') {
      if (totalMinutes < 840 && totalMinutes >= 360) {
        // e.g. 13:00 - before standard 14:00 check-in
        return {
          requested_stay_type: 'ngay_dem',
          recommended_stay_type: 'ngay_dem',
          requested_checkin: requestedCheckinIso,
          effective_checkin: requestedCheckinIso,
          eligibility_status: 'NEEDS_POLICY_CLARIFICATION',
          applied_policy_id: this.policyId,
          evidence_references: [
            'Business Policy V1.4.3: Gói ngày đêm tiêu chuẩn nhận phòng từ 14:00 đến 12:00 trưa hôm sau',
          ],
          price_source: 'POLICY_UNRESOLVED',
          explanation_reason_code: 'UNRESOLVED_STAY_WINDOW',
          customer_explanation:
            'Dạ khung giờ nhận phòng gói Ngày Đêm tiêu chuẩn bắt đầu từ 14:00. Khách sạn chưa có chính sách tự động nhận phòng sớm trước 14:00 trên hệ thống, anh/chị vui lòng liên hệ trực tiếp lễ tân để kiểm tra tình trạng phòng trống thực tế nhé ạ!',
        };
      }

      return {
        requested_stay_type: 'ngay_dem',
        recommended_stay_type: 'ngay_dem',
        requested_checkin: requestedCheckinIso,
        effective_checkin: requestedCheckinIso,
        eligibility_status: 'ELIGIBLE',
        applied_policy_id: this.policyId,
        evidence_references: [
          'Business Policy V1.4.3: Gói ngày đêm tiêu chuẩn nhận phòng từ 14:00 đến 12:00 hôm sau',
        ],
        price_source: 'room.gia.ngay_dem',
        explanation_reason_code: 'STANDARD_OVERNIGHT_CHECKIN',
        customer_explanation:
          'Khung giờ nhận phòng gói Ngày Đêm hợp lệ (14:00 hôm trước đến 12:00 hôm sau).',
      };
    }

    // 3. Overnight stay intention (qua_dem or staying until next day/trưa mai)
    if (isStayingOvernight) {
      // 3.1. Standard overnight: from 22:00 onwards or late night (totalMinutes >= 1320 || totalMinutes < 360)
      if (totalMinutes >= 1320 || totalMinutes < 360) {
        return {
          requested_stay_type: 'qua_dem',
          recommended_stay_type: 'qua_dem',
          requested_checkin: requestedCheckinIso,
          effective_checkin: requestedCheckinIso,
          eligibility_status: 'ELIGIBLE',
          applied_policy_id: this.policyId,
          evidence_references: [
            'Business Policy V1.4.3: Gói qua đêm tiêu chuẩn từ 22:00 đến 12:00 hôm sau',
          ],
          price_source: 'room.gia.qua_dem',
          explanation_reason_code: 'STANDARD_OVERNIGHT_CHECKIN',
          customer_explanation:
            'Thời gian nhận phòng nằm trong khung giờ nghỉ qua đêm tiêu chuẩn (từ 22:00 đến 12:00 trưa hôm sau).',
        };
      }

      // 3.2. Early overnight within 20-minute grace window: 21:40 <= T <= 21:59 (1300 <= totalMinutes < 1320)
      if (totalMinutes >= 1300 && totalMinutes < 1320) {
        return {
          requested_stay_type: 'qua_dem',
          recommended_stay_type: 'qua_dem',
          requested_checkin: requestedCheckinIso,
          effective_checkin: requestedCheckinIso,
          eligibility_status: 'EARLY_CHECKIN_GRACE_APPLIED',
          applied_policy_id: this.policyId,
          evidence_references: [
            'Business Policy V1.4.3: Hỗ trợ khách nhận phòng qua đêm sớm tối đa 20 phút (từ 21:40)',
          ],
          price_source: 'room.gia.qua_dem',
          explanation_reason_code: 'EARLY_OVERNIGHT_WITHIN_20_MIN',
          customer_explanation:
            'Dạ khung giờ qua đêm tiêu chuẩn bắt đầu từ 22:00, tuy nhiên bên em có chính sách hỗ trợ nhận phòng sớm tối đa 20 phút (từ 21:40) vẫn áp dụng trọn gói giá qua đêm ạ.',
        };
      }

      // 3.3. Check-in between 20:30 and 21:39 (1230 <= totalMinutes < 1300)
      if (totalMinutes >= 1230 && totalMinutes < 1300) {
        const dateStr = requestedCheckinIso.split('T')[0];
        const alternativeCheckinIso = `${dateStr}T21:40:00+07:00`;
        return {
          requested_stay_type: 'qua_dem',
          recommended_stay_type: 'ngay_dem',
          requested_checkin: requestedCheckinIso,
          effective_checkin: requestedCheckinIso,
          eligibility_status: 'ALTERNATIVE_PACKAGE_RECOMMENDED',
          applied_policy_id: this.policyId,
          evidence_references: [
            'Business Policy V1.4.3: Khách nhận phòng trước 21:40 (20:30-21:39) nếu nhận ngay áp dụng giá ngày đêm',
            'Giới hạn nhận phòng qua đêm sớm tối đa 20 phút (mốc sớm nhất 21:40)',
          ],
          price_source: 'room.gia.ngay_dem',
          explanation_reason_code: 'TOO_EARLY_FOR_OVERNIGHT',
          customer_explanation:
            `Dạ khung giờ nghỉ qua đêm áp dụng từ 22:00 (hỗ trợ nhận sớm tối đa từ 21:40). Do anh/chị cần nhận phòng ngay lúc ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} và ở đến hôm sau, bên em xin tư vấn gói Ngày Đêm (14:00 - 12:00 hôm sau) ạ. Hoặc nếu anh/chị có thể đợi nhận phòng từ 21:40 thì sẽ được áp dụng giá gói Qua Đêm tiết kiệm hơn nhé ạ!`,
          alternative_option: {
            stay_type: 'qua_dem',
            checkin_time: alternativeCheckinIso,
            description: 'Đổi giờ nhận sang 21:40 để áp dụng giá gói Qua Đêm',
          },
        };
      }

      // 3.4. Check-in before 20:30 (14:00 <= totalMinutes < 1230, e.g. 19:00, 20:00, 20:29)
      if (totalMinutes >= 840 && totalMinutes < 1230) {
        const dateStr = requestedCheckinIso.split('T')[0];
        const alternativeCheckinIso = `${dateStr}T21:40:00+07:00`;
        return {
          requested_stay_type: 'qua_dem',
          recommended_stay_type: 'ngay_dem',
          requested_checkin: requestedCheckinIso,
          effective_checkin: requestedCheckinIso,
          eligibility_status: 'ALTERNATIVE_PACKAGE_RECOMMENDED',
          applied_policy_id: this.policyId,
          evidence_references: [
            'Business Policy V1.4.3: Khách muốn check-in trước 20:30 và có nhu cầu nghỉ qua đêm phải được tư vấn giá ngày đêm',
          ],
          price_source: 'room.gia.ngay_dem',
          explanation_reason_code: 'TOO_EARLY_FOR_OVERNIGHT',
          customer_explanation:
            `Dạ khung giờ nghỉ qua đêm tại J Collection bắt đầu từ 22:00 (hỗ trợ nhận sớm nhất từ 21:40). Do anh/chị có nhu cầu nhận phòng từ lúc ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} và ở đến trưa mai, bên em xin tư vấn giá gói Ngày Đêm (14:00 đến 12:00 hôm sau) ạ. Nếu muốn áp dụng mức giá gói Qua Đêm, anh/chị có thể dời giờ nhận phòng sang từ 21:40 nhé ạ!`,
          alternative_option: {
            stay_type: 'qua_dem',
            checkin_time: alternativeCheckinIso,
            description: 'Đổi giờ nhận sang 21:40 để áp dụng giá gói Qua Đêm',
          },
        };
      }

      // 3.5. Before 14:00 (totalMinutes < 840 && totalMinutes >= 360, e.g. 13:00)
      return {
        requested_stay_type: 'qua_dem',
        recommended_stay_type: 'ngay_dem',
        requested_checkin: requestedCheckinIso,
        effective_checkin: requestedCheckinIso,
        eligibility_status: 'NEEDS_POLICY_CLARIFICATION',
        applied_policy_id: this.policyId,
        evidence_references: [
          'Business Policy V1.4.3: Khách cần nhận 13:00 cho gói ngày đêm: khách sạn không tự xác nhận được nhận sớm; cần policy clarification',
        ],
        price_source: 'POLICY_UNRESOLVED',
        explanation_reason_code: 'UNRESOLVED_STAY_WINDOW',
        customer_explanation:
          'Dạ khung giờ nhận phòng gói Ngày Đêm tiêu chuẩn bắt đầu từ 14:00. Khách sạn chưa có chính sách tự động nhận phòng sớm trước 14:00 trên hệ thống, anh/chị vui lòng liên hệ trực tiếp lễ tân để kiểm tra tình trạng phòng trống thực tế nhé ạ!',
      };
    }

    // Default fallback
    return {
      requested_stay_type: requestedStayType,
      recommended_stay_type: requestedStayType,
      requested_checkin: requestedCheckinIso,
      effective_checkin: requestedCheckinIso,
      eligibility_status: 'ELIGIBLE',
      applied_policy_id: this.policyId,
      evidence_references: ['Default stay type policy'],
      price_source: 'BASE_DATASET_REFERENCE',
      explanation_reason_code: 'STANDARD_OVERNIGHT_CHECKIN',
      customer_explanation: 'Gói lưu trú hợp lệ.',
    };
  }
}
