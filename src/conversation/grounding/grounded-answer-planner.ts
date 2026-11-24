import { NormalizedDataset } from '../../domain/normalized-schema.js';
import { CoSoMa } from '../../domain/types.js';
import { IntentType, WorkingMemory } from '../conversation-types.js';
import { ScoredRoomCandidate } from '../../search/search-types.js';
import { PreBookingQuoteResult } from '../../pricing/quote-types.js';
import { PolicyQueryResult } from '../../knowledge/knowledge-types.js';

export interface AnswerPlan {
  intent: IntentType;
  facility: CoSoMa | null;
  facility_phone?: string;
  facility_booking_url?: string;
  is_budget_insufficient: boolean;
  budget_explanation?: string;
  unconfirmed_amenities_to_disclaim: string[];
  candidate_recommendations: Array<{
    room_id: string;
    room_name: string;
    category: string;
    total_price_vnd?: number;
    price_breakdown_text?: string;
    booking_link?: string;
    bucket: string;
    confirmed_amenities: string[];
    unconfirmed_amenities: string[];
  }>;
  policy_answer?: string;
  escalation_needed: boolean;
  escalation_reason?: string;
}

export class GroundedAnswerPlanner {
  private dataset: NormalizedDataset;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
  }

  public plan(params: {
    intent: IntentType;
    memory: WorkingMemory;
    candidates: Array<{ item: ScoredRoomCandidate; quote?: PreBookingQuoteResult; bucket?: string }>;
    policyResult?: PolicyQueryResult | null;
  }): AnswerPlan {
    const { intent, memory, candidates, policyResult } = params;

    const facility = memory.active_facility;
    const cs = facility ? this.dataset.co_so.find((c) => c.ma === facility) : null;

    // Check budget sufficiency (Section A3)
    let isBudgetInsufficient = false;
    let budgetExplanation: string | undefined;

    if (memory.max_budget && candidates.length > 0) {
      const minCandidatePrice = Math.min(
        ...candidates
          .map((c) => c.quote?.total_estimate ?? c.item.room.gia_goc_dataset.nghi_gio_2h)
          .filter((p): p is number => p !== undefined && p > 0)
      );

      if (minCandidatePrice > memory.max_budget) {
        isBudgetInsufficient = true;
        const delta = minCandidatePrice - memory.max_budget;
        budgetExplanation = `Ngân sách ${memory.max_budget.toLocaleString('vi-VN')}đ thấp hơn giá thấp nhất hiện có (${minCandidatePrice.toLocaleString('vi-VN')}đ) khoảng ${delta.toLocaleString('vi-VN')}đ.`;
      }
    }

    // Check unconfirmed amenities (Section A2)
    const unconfirmedToDisclaim: string[] = [];
    if (memory.must_have_amenities) {
      for (const am of memory.must_have_amenities) {
        const norm = am.toLowerCase();
        if (norm.includes('máy chiếu') || norm.includes('may chieu')) {
          unconfirmedToDisclaim.push('máy chiếu');
        }
        if (norm.includes('bồn tắm đôi') || norm.includes('bon tam doi') || norm.includes('bon doi')) {
          unconfirmedToDisclaim.push('bồn tắm đôi');
        }
      }
    }

    // Map candidate details
    const candidateRecs = candidates.map((c) => {
      const room = c.item.room;
      const quote = c.quote;

      const confirmedAmenities: string[] = [];
      if (room.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE') confirmedAmenities.push('bồn tắm nằm thư giãn');
      if (room.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE') confirmedAmenities.push('ghế tình yêu');
      if (room.tien_nghi.thang_may?.status === 'CONFIRMED_TRUE') confirmedAmenities.push('thang máy');

      return {
        room_id: room.id,
        room_name: room.ten_phong,
        category: room.hang,
        total_price_vnd: quote?.total_estimate ?? room.gia_goc_dataset.nghi_gio_2h,
        price_breakdown_text: quote?.price_breakdown_text,
        booking_link: room.link_phong ?? cs?.link ?? undefined,
        bucket: c.bucket ?? 'EXACT',
        confirmed_amenities: confirmedAmenities,
        unconfirmed_amenities: unconfirmedToDisclaim,
      };
    });

    // Escalation check
    let escalationNeeded = false;
    let escalationReason: string | undefined;

    if (intent === 'IN_STAY_OPERATIONAL_REQUEST') {
      escalationNeeded = true;
      escalationReason = 'IN_STAY_REQUEST';
    } else if (intent === 'CHECKOUT_DISPUTE') {
      escalationNeeded = true;
      escalationReason = 'CHECKOUT_BILLING_DISPUTE';
    } else if (intent === 'REQUEST_HUMAN') {
      escalationNeeded = true;
      escalationReason = 'EXPLICIT_HUMAN_REQUEST';
    } else if (policyResult?.requires_staff_verification) {
      escalationNeeded = true;
      escalationReason = 'UNVERIFIED_POLICY_INQUIRY';
    }

    return {
      intent,
      facility,
      facility_phone: cs?.dien_thoai ?? undefined,
      facility_booking_url: cs?.link ?? undefined,
      is_budget_insufficient: isBudgetInsufficient,
      budget_explanation: budgetExplanation,
      unconfirmed_amenities_to_disclaim: unconfirmedToDisclaim,
      candidate_recommendations: candidateRecs,
      policy_answer: policyResult?.answer_text,
      escalation_needed: escalationNeeded,
      escalation_reason: escalationReason,
    };
  }
}
