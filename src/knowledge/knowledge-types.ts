import { CoSoMa } from '../domain/types.js';

export type KnowledgeTopic =
  | 'FACILITY_INFO'
  | 'ROOM_INFO'
  | 'AMENITY_INFO'
  | 'PRICING_POLICY'
  | 'STAY_TYPE_POLICY'
  | 'OPERATIONAL_BOUNDARY'
  | 'CONTACT_AND_BOOKING'
  | 'UNKNOWN_UNCONFIRMED_REGISTRY';

export type KnowledgeScope = 'GLOBAL' | 'FACILITY' | 'ROOM';

export type VerificationStatus = 'CONFIRMED' | 'UNCONFIRMED' | 'UNKNOWN';

export interface KnowledgeItem {
  id: string;
  topic: KnowledgeTopic;
  scope: KnowledgeScope;
  facility_id?: CoSoMa;
  room_id?: string; // ma_phong
  key: string;
  source_reference: string;
  verification_status: VerificationStatus;
  version: string;
  effective_conditions?: {
    days_of_week_iso?: number[];
    time_window?: string;
    stay_type?: string;
  };
  original_value: string;
  normalized_value: unknown;
  guidance_for_assistant: string;
}

export interface PolicyQueryResult {
  topic: string;
  matched_items: KnowledgeItem[];
  answer_text: string;
  verification_status: VerificationStatus;
  source_citations: string[];
  requires_staff_verification: boolean;
}
