import { CoSoMa, RawRoomCategory } from '../../domain/types.js';

export type ResponseDepth = 'brief' | 'normal' | 'detailed';

export type PlanningGoal =
  | 'ANSWER_DIRECT_FACT'         // Single attribute / Yes-No query (brief, direct, no unsolicited sales)
  | 'ANSWER_POLICY'              // Policy / FAQ inquiry (parking, early check-in, smoking, etc.)
  | 'CONSULT_AND_RECOMMEND'     // Room search, category exploration, preference matching
  | 'COMPARE_ROOMS'              // Explicit comparison between 2+ rooms
  | 'CALCULATE_PRICE'           // Price quote for specific room or category
  | 'SHOW_MEDIA'                // Request photos of a room
  | 'CHECK_AVAILABILITY'        // Live availability check (transparent redirect to reception)
  | 'PROVIDE_BOOKING_GUIDE'     // Direct booking link & hotline guidance
  | 'REQUEST_STAFF_HANDOFF'     // Human escalation / receptionist takeover
  | 'IN_STAY_SERVICE_ROUTING'   // In-stay service request -> direct front desk phone
  | 'CHECKOUT_DISPUTE_ROUTING'  // Billing / checkout dispute -> manager hotline
  | 'CLARIFY_REQUIREMENT'       // Missing critical details (e.g. checkin date for specific quote)
  | 'POLITE_GREETING'           // Greetings
  | 'POLITE_CLOSING'            // Thank you / acknowledgment (polite closing, NO unsolicited room pitch)
  | 'DECLINE_OUT_OF_SCOPE';     // Adversarial, discount negotiation, jailbreak attempt

export type RequiredTool =
  | 'NONE'
  | 'SEARCH_ROOMS'
  | 'QUOTE_ROOM'
  | 'QUOTE_CATEGORY'
  | 'POLICY_LOOKUP'
  | 'MEDIA_LOOKUP'
  | 'ROOM_DETAIL_LOOKUP'
  | 'STAFF_HANDOFF';

export interface ConversationPlan {
  primaryGoal: PlanningGoal;
  secondaryGoals: PlanningGoal[];
  planner_mode?: 'deterministic_fast_path' | 'semantic_context' | 'fallback';

  referencedPropertyId?: CoSoMa | null;
  referencedRoomId?: string | null;     // canonical room id/code, e.g. '601-50-sac-thai'
  referencedCategory?: RawRoomCategory | string | null;

  requestedFacts: string[];             // specific facts asked: e.g. ['bon_tam', 'parking', 'gia', 'anh']
  requiredTools: RequiredTool[];

  needsClarification: boolean;
  clarificationReason?: string;

  responseDepth: ResponseDepth;         // 'brief' (single fact/yes-no), 'normal', 'detailed' (deep consultation)

  isFollowUp: boolean;                  // Continues conversation about previous room/topic
  topicChanged: boolean;                // Shifts to different room, category, or service topic
  clearPreviousRequirements?: boolean;  // Drops historical must-haves when user switches to new query

  confidence: number;
  reasoning?: string;
}
