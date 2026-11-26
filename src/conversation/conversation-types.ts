import { CoSoMa, RawRoomCategory, StayType, CompositeRoomKey } from '../domain/types.js';
import { PreBookingQuoteResult } from '../pricing/quote-types.js';
import { RoomSearchResult } from '../search/search-types.js';
import { ConversationPlan } from './planning/conversation-plan.js';
import { GroundedAnswerData } from './grounding/grounded-data.js';
import { GroundingStatus } from '../agent/agent-contracts.js';

export type IntentType =
  | 'SEARCH_ROOM'
  | 'GET_ROOM_DETAILS'
  | 'GET_ROOM_PRICE'
  | 'GET_PREBOOKING_QUOTE'
  | 'COMPARE_ROOMS'
  | 'ASK_AMENITIES'
  | 'ASK_POLICY'
  | 'CHANGE_REQUIREMENT'
  | 'REMOVE_REQUIREMENT'
  | 'NEGATE_REQUIREMENT'
  | 'CLEAR_NEGATION'
  | 'ASK_CHEAPEST_OPTION'
  | 'ASK_BEST_OPTION'
  | 'ASK_ROOM_AVAILABILITY'
  | 'CHECK_ROOM_AVAILABILITY'
  | 'BROWSE_ROOM_CATEGORIES'
  | 'BROWSE_ROOMS_BY_CATEGORY'
  | 'ASK_CATEGORY_PRICE'
  | 'ASK_SPECIFIC_ROOM_PRICE'
  | 'REQUEST_ROOM_IMAGES'
  | 'ASK_PARKING'
  | 'REQUEST_STAFF_HANDOFF'
  | 'BOOKING_REQUEST'
  | 'BOOKING_INTENT'
  | 'REQUEST_HUMAN'
  | 'IN_STAY_OPERATIONAL_REQUEST'
  | 'CHECKOUT_DISPUTE'
  | 'OUT_OF_SCOPE'
  | 'CLARIFICATION'
  | 'GREETING'
  | 'AI_IDENTITY_INQUIRY';

export type ActionType =
  | 'ANSWER_FROM_VERIFIED_DATA'
  | 'RECOMMEND_ROOMS'
  | 'COMPARE_VERIFIED_ROOMS'
  | 'GET_PREBOOKING_QUOTE'
  | 'ASK_CLARIFICATION'
  | 'PROVIDE_BOOKING_GUIDANCE'
  | 'FLAG_FOR_HUMAN'
  | 'DECLINE_UNVERIFIED_CLAIM'
  | 'ANSWER_AI_IDENTITY'
  | 'ROUTE_IN_STAY_REQUEST'
  | 'ROUTE_CHECKOUT_DISPUTE'
  | 'GENERAL_GREETING'
  | 'ANSWER_AVAILABILITY_TRANSPARENT'
  | 'SHOW_ROOM_CATEGORIES'
  | 'SHOW_ROOMS_BY_CATEGORY'
  | 'QUOTE_CATEGORY_PRICE'
  | 'SHOW_ROOM_IMAGES'
  | 'SHOW_ROOM_DETAIL'
  | 'ANSWER_ROOM_ATTRIBUTE'
  | 'POLITE_CLOSING'
  | 'ANSWER_PARKING_POLICY';

export type RequirementActionType =
  | 'ADD_REQUIREMENT'      // Add constraint to must_have_amenities
  | 'REMOVE_REQUIREMENT'   // Drop constraint from must_have, but do NOT ban the amenity
  | 'NEGATE_REQUIREMENT'   // Actively exclude/ban the amenity (add to negated_constraints)
  | 'REPLACE_REQUIREMENT'; // Un-ban amenity (remove from negated_constraints)

export interface RequirementMutation {
  action: RequirementActionType;
  amenity: string;
}

export interface ExtractedEntities {
  facility?: CoSoMa;
  room_key?: CompositeRoomKey;
  room_name?: string;
  category?: RawRoomCategory;
  budget?: number;
  checkin_date?: string; // YYYY-MM-DD
  checkin_time?: string; // HH:MM
  checkin_datetime?: string; // ISO 8601
  stay_type?: StayType;
  duration_hours?: number;
  must_have_amenities?: string[];
  nice_to_have_amenities?: string[];
  negated_constraints?: string[];     // NEGATE_REQUIREMENT: ban/exclude amenity
  removed_constraints?: string[];     // Legacy / backward-compat alias
  removed_requirements?: string[];    // REMOVE_REQUIREMENT: drop from must-have, do not ban
  cleared_negations?: string[];       // REPLACE_REQUIREMENT: un-ban amenity
  requirement_mutations?: RequirementMutation[];
  target_reference?: string; // "căn thứ hai", "phòng đó", "601"
  style_preference?: string[];
  is_adversarial_or_injection?: boolean;
  is_compound?: boolean;
  compound_intents?: IntentType[];
  asked_parking?: boolean;
  asked_price?: boolean;
  asked_amenities?: boolean;
  asked_availability?: boolean;
}

export interface ShortlistedRoomItem {
  key: CompositeRoomKey;
  name: string;
  category: RawRoomCategory;
  price?: number;
  bucket: 'EXACT' | 'PARTIAL' | 'ALTERNATIVE' | 'UNVERIFIED';
}

export interface WorkingMemory {
  session_id: string;
  active_facility: CoSoMa | null;
  focused_room: CompositeRoomKey | null;
  shortlisted_rooms: ShortlistedRoomItem[];
  stay_type: StayType;
  checkin_datetime: string | null;
  duration_hours: number | null;
  max_budget: number | null;
  must_have_amenities: string[];
  nice_to_have_amenities: string[];
  negated_constraints: string[];
  preferred_styles: string[];
  recent_references: Array<{ key: CompositeRoomKey; mentioned_at_turn: number }>;
  last_quote_context: PreBookingQuoteResult | null;
  conversation_lifecycle:
    | 'DISCOVERY'
    | 'CONSULTATION'
    | 'ROOM_SHORTLIST'
    | 'BOOKING_GUIDANCE'
    | 'HUMAN_SUPERVISED'
    | 'CLOSED';
  ownership_state: 'AI_ACTIVE' | 'HUMAN_ACTIVE' | 'AI_MUTED';
  pending_clarification: string | null;
  created_at: number;
  updated_at: number;
  turn_count: number;
  target_category?: RawRoomCategory;

  // Contextual Memory Enhancements (Section VI)
  active_topic?: string | null;
  previous_topic?: string | null;
  confirmed_constraints?: string[];
  current_turn_requirements?: string[];
  unresolved_requests?: string[];
  topic_history?: Array<{
    turn: number;
    topic: string;
    focused_room?: CompositeRoomKey | null;
    target_category?: RawRoomCategory;
  }>;
}

export interface DetailedClaimCheck {
  claim_type: 'PRICE' | 'ROOM' | 'POLICY' | 'URL' | 'HOTLINE' | 'AMENITY' | 'BOOKING' | 'MEDIA' | 'TEMPORAL';
  raw_text: string;
  normalized_value?: string | number;
  status: GroundingStatus;
  reason: string;
  matched_evidence_id?: string;
}

export interface ClaimValidationSummary {
  total_claims: number;
  verified_claims: string[];
  disclaimed_claims: string[];
  rejected_claims: string[];
  evidence_citations: string[];
  grounding_status?: GroundingStatus;
  missing_evidence_claims?: string[];
  contradicted_claims?: string[];
  claim_checks?: DetailedClaimCheck[];
}

export interface HumanEscalationPackage {
  needed: boolean;
  reason_code?:
    | 'IN_STAY_REQUEST'
    | 'CHECKOUT_BILLING_DISPUTE'
    | 'UNVERIFIED_POLICY_INQUIRY'
    | 'EXPLICIT_HUMAN_REQUEST'
    | 'REPEATED_CONFUSION'
    | 'CUSTOM_NEGOTIATION';
  summary?: string;
  facility?: CoSoMa;
  contact_channel?: string;
}

import { RoomPresentationBlock, RoomPresentationImage } from '../agent/agent-contracts.js';

export interface ConversationTurnResult {
  session_id: string;
  turn_index: number;
  user_message: string;
  intent: IntentType;
  extracted_entities: ExtractedEntities;
  updated_state: WorkingMemory;
  missing_information: string[];
  chosen_action: ActionType;
  tool_results: {
    search_result?: RoomSearchResult;
    quote_results?: PreBookingQuoteResult[];
    delivered_images?: RoomPresentationImage[];
    room_presentations?: RoomPresentationBlock[];
    facts_result?: any;
    policy_results?: Array<{ topic: string; answer: string; source: string; status: string }>;
  };
  verified_candidates: Array<{
    id: string;
    name: string;
    price_text?: string;
    bucket: string;
    notes?: string;
    unverified_amenities?: string[];
    booking_link?: string;
  }>;
  evidence_references: string[];
  customer_visible_response: string;
  plan?: ConversationPlan;
  grounded_data?: GroundedAnswerData;
  images?: RoomPresentationImage[];
  room_presentations?: RoomPresentationBlock[];
  claim_validation?: ClaimValidationSummary;
  human_escalation?: HumanEscalationPackage;
  decision_trace?: any;
  internal_trace: {
    latency_ms: number;
    rules_triggered: string[];
    adapter_used: string;
    escalated_to_human?: boolean;
    applied_policy_id?: string;
    planner_mode?: 'deterministic_fast_path' | 'semantic_context' | 'fallback';
    confidence?: number;
    routing_reason?: string;
    entity_reference?: string;
    tools_executed?: string[];
    canonical_data_fetched?: string[];
    response_depth?: 'brief' | 'normal' | 'detailed';
  };
}
