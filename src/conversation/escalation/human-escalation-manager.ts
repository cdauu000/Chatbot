import { CoSoMa } from '../../domain/types.js';
import { HumanEscalationPackage, IntentType } from '../conversation-types.js';
import { PolicyQueryResult } from '../../knowledge/knowledge-types.js';

export class HumanEscalationManager {
  public evaluate(
    intent: IntentType,
    userMessage: string,
    facility: CoSoMa | null,
    facilityPhone?: string,
    policyResult?: PolicyQueryResult | null
  ): HumanEscalationPackage {
    const lower = userMessage.toLowerCase();

    // 1. In-stay Operational Requests
    if (intent === 'IN_STAY_OPERATIONAL_REQUEST') {
      return {
        needed: true,
        reason_code: 'IN_STAY_REQUEST',
        summary: 'Khách hàng đang lưu trú tại phòng cần hỗ trợ dịch vụ trực tiếp (nước, khăn, dọn dẹp, thiết bị).',
        facility: facility ?? undefined,
        contact_channel: facilityPhone ? `Hotline: ${facilityPhone}` : 'Quầy lễ tân cơ sở',
      };
    }

    // 2. Checkout Disputes & Billing Complaints
    if (
      intent === 'CHECKOUT_DISPUTE' ||
      lower.includes('tinh tien sai') ||
      lower.includes('tinh lo') ||
      lower.includes('bat tra them') ||
      (lower.includes('phu thu') && lower.includes('vo ly'))
    ) {
      return {
        needed: true,
        reason_code: 'CHECKOUT_BILLING_DISPUTE',
        summary: 'Khách hàng có khiếu nại hoặc tranh chấp về chi phí/giờ phát sinh tại quầy checkout.',
        facility: facility ?? undefined,
        contact_channel: facilityPhone ? `Hotline Quản lý: ${facilityPhone}` : 'Hotline quản lý cơ sở',
      };
    }

    // 3. Explicit Human Request
    if (intent === 'REQUEST_HUMAN' || lower.includes('gap nhan vien') || lower.includes('gap le tan')) {
      return {
        needed: true,
        reason_code: 'EXPLICIT_HUMAN_REQUEST',
        summary: 'Khách hàng chủ động yêu cầu kết nối trực tiếp với nhân viên hỗ trợ.',
        facility: facility ?? undefined,
        contact_channel: facilityPhone ? `Hotline: ${facilityPhone}` : 'Hotline chăm sóc khách hàng',
      };
    }

    // 4. Policy needing staff verification (e.g. pets, smoking, third person)
    if (policyResult && policyResult.requires_staff_verification) {
      return {
        needed: true,
        reason_code: 'UNVERIFIED_POLICY_INQUIRY',
        summary: `Chính sách ${policyResult.topic} chưa có dữ liệu chính thức, cần lễ tân xác nhận thực tế.`,
        facility: facility ?? undefined,
        contact_channel: facilityPhone ? `Hotline: ${facilityPhone}` : 'Hotline lễ tân',
      };
    }

    return {
      needed: false,
    };
  }
}
