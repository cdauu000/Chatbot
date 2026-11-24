import { CoSoMa, RawRoomCategory, StayType, CompositeRoomKey } from '../domain/types.js';
import { PreBookingQuoteResult } from '../pricing/quote-types.js';
import { RoomSearchResult } from '../search/search-types.js';
import { ClaimValidationSummary, HumanEscalationPackage } from '../conversation/conversation-types.js';

export interface ToolCall {
  toolCallId: string;
  toolName: 'search_rooms' | 'get_room_facts' | 'get_room_media' | 'get_policies' | 'quote_price';
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  status: 'SUCCESS' | 'NO_DATA' | 'ERROR' | 'UNAUTHORIZED';
  data: any;
  provenance: string;
  errorMessage?: string;
}

export interface ToolObservation {
  toolName: string;
  arguments: Record<string, any>;
  resultStatus: 'SUCCESS' | 'NO_DATA' | 'ERROR' | 'UNAUTHORIZED';
  summary: string;
  rawResult?: any;
}

export interface Evidence {
  subject: string;
  attribute: string;
  value: any;
  status: 'VERIFIED' | 'DERIVED' | 'ESTIMATE' | 'UNKNOWN';
  sourceCitation: string;
  validForInterval?: string;
}

export interface BusinessClaim {
  claimText: string;
  category: 'PRICE' | 'AVAILABILITY' | 'AMENITY' | 'POLICY' | 'URL' | 'CONTACT';
  evidenceId?: string;
  isValidated: boolean;
  rejectionReason?: string;
}

export interface AgentDecision {
  reasoningSummary: string;
  actionType: 'CALL_TOOLS' | 'RESPOND_DIRECTLY' | 'CLARIFY' | 'ESCALATE';
  proposedToolCalls: ToolCall[];
  directResponseDraft?: string;
  requiresReplan?: boolean;
}

export interface AgentResponse {
  content: string;
  evidenceCitations: string[];
  suggestedActions?: string[];
  escalation?: HumanEscalationPackage;
}

export type LLMVerificationStatus =
  | 'LIVE_LLM_DECISION_VERIFIED'
  | 'DETERMINISTIC_AGENT_FLOW'
  | 'MOCK_AGENT_FLOW'
  | 'PROVIDER_FALLBACK'
  | 'DEGRADED_DETERMINISTIC_MODE';

export interface LLMTelemetryTrace {
  verificationStatus: LLMVerificationStatus;
  provider: string;
  model: string;
  providerRequestId?: string;
  callCount: number;
  decisionType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  fallbackState?: {
    isFallback: boolean;
    fallbackReason?: string;
  };
}

export interface AgentLLMDecision {
  action: 'CALL_TOOLS' | 'RESPOND_DIRECTLY' | 'CLARIFY' | 'ESCALATE';
  thought_summary: string;
  tool_calls?: Array<{
    tool_name: 'search_rooms' | 'get_room_facts' | 'get_room_media' | 'get_policies' | 'quote_price';
    arguments: Record<string, any>;
  }>;
  clarification_question?: string;
  final_response?: string;
}

export interface DecisionStepTrace {
  step: number;
  phase: 'UNDERSTAND' | 'DECIDE' | 'ACT' | 'OBSERVE' | 'REVISE' | 'RESPOND';
  thoughtSummary: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface DecisionTrace {
  turnIndex: number;
  providerModel: string;
  executionMode: 'FAST' | 'STANDARD' | 'DEEP';
  decisionSteps: DecisionStepTrace[];
  latencyMs: number;
  claimsChecked: ClaimValidationSummary;
  verificationStatus?: LLMVerificationStatus;
  llmTelemetry?: LLMTelemetryTrace;
}

// ============================================================================
// V2.0 STRUCTURED AGENT STATE SPECIFICATION (SECTION VII)
// ============================================================================

export interface ExplicitUserConstraints {
  budget?: number;
  checkinDatetime?: string;
  durationHours?: number;
  stayType?: StayType;
  requiredAmenities: string[];
  targetRoomId?: string;
  category?: RawRoomCategory;
}

export interface ReferencedEntity {
  type: 'ROOM' | 'PROPERTY' | 'POLICY' | 'AMENITY';
  id: string;
  name?: string;
}

export interface PropertyStayPackageEligibility {
  minHourlyHours: number;
  overnightStandardStart: string;
  overnightGraceStart: string;
  overnightCheckout: string;
  dayNightStart: string;
  dayNightCheckout: string;
}

export interface PropertyContext {
  propertyId: CoSoMa;
  propertyName: string;
  address: string;
  phone?: string;
  totalRooms: number;
  parkingSummary: string;
  policySummary: string;
  canonicalRoomIds: string[];
  categoryMapping?: Record<string, string>;
  pricingPolicyRef?: string;
  stayPackageEligibility?: PropertyStayPackageEligibility;
  approvedFaq?: Record<string, string>;
  officialMediaMapping?: Record<string, string>;
  trustedChannelBindings?: string[];
  dataVersion?: string;
}

export type OptimizationGoal =
  | 'CHEAPEST'
  | 'BEST_BUDGET_FIT'
  | 'AMENITY_MATCH'
  | 'BALANCED_UPGRADE'
  | 'ALL_MATCHING';

export type ConversationActivityType =
  | 'SEARCHING'
  | 'VIEWING_PHOTOS'
  | 'COMPARING_PRICES'
  | 'SELECTING_ROOM'
  | 'MUTATING_REQUIREMENTS'
  | 'CONCLUDED';

export interface StructuredCustomerGoal {
  primaryGoal: string;
  secondaryGoals?: string[];
  optimizationGoal?: OptimizationGoal;
  confirmedFacts?: Record<string, any>;
  preferences?: string[];
  hardConstraints?: ExplicitUserConstraints;
  missingConditions?: string[];
  requestedOutput?: 'SINGLE_CHEAPEST' | 'PRICE_QUOTE' | 'PHOTO_GALLERY' | 'ROOM_CATALOG' | 'POLICY_INFO' | 'ESCALATION';
  ongoingActivity?: ConversationActivityType;
}

export interface RecommendationCandidate {
  roomId: string;
  roomName: string;
  category: RawRoomCategory;
  totalPriceVnd: number;
  priceBreakdown: string;
  confirmedAmenities: string[];
  isWithinBudget: boolean;
  budgetDeltaVnd: number;
  role: 'OPTIMAL_WITHIN_BUDGET' | 'TRANSPARENT_UPGRADE' | 'ALTERNATIVE_OPTION' | 'EXCLUDED';
  justification: string;
}

export interface RecommendationSolveResult {
  primaryOption?: RecommendationCandidate;
  upgradeOption?: RecommendationCandidate;
  alternativeOptions: RecommendationCandidate[];
  allEvaluated: RecommendationCandidate[];
  summary: string;
}

export interface AgentState {
  sessionId: string;
  channel: 'website' | 'zalo' | 'facebook' | 'cli';
  trustedPropertyId: CoSoMa; // Strictly enforced (e.g. 'jacayl-ha-dong')
  guestGoal: string;

  // Explicit user constraints (hard constraints)
  hardConstraints: {
    budget?: number;
    checkinDatetime?: string;
    durationHours?: number;
    stayType?: StayType;
    requiredAmenities: string[];
  };
  explicitConstraints?: ExplicitUserConstraints;

  // Inferred soft preferences
  softPreferences: string[];
  inferredPreferences?: string[];

  // Conditional assumptions (e.g. afternoon check-in before 18:00)
  conditionalAssumptions?: Record<string, any>;

  // Rejected and reinstated room choices
  negatedRoomIds?: string[];
  rejectedChoices?: string[];
  reinstatedChoices?: string[];

  // Active topic & referenced entities
  currentTopic?: string;
  currentActivity?: ConversationActivityType;
  optimizationGoal?: OptimizationGoal;
  referencedEntities?: ReferencedEntity[];
  pendingClarification?: string | null;

  // Active room shortlists & focus
  currentCandidateRoomIds: string[];
  focusedRoomId: string | null;

  // Verified facts & observations
  verifiedFacts: Record<string, Evidence>;
  observations: ToolObservation[];

  // Active valid quote references
  validQuoteReferences?: any[];
  lastQuotes?: any[];

  // Conversational lifecycle & history
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  lifecycle: 'DISCOVERY' | 'CONSULTATION' | 'ROOM_SHORTLIST' | 'BOOKING_GUIDANCE' | 'HUMAN_SUPERVISED' | 'CLOSED';
  ownership_state: 'AI_ACTIVE' | 'HUMAN_ACTIVE' | 'AI_MUTED';
  handoffStatus: { needed: boolean; reason?: string };
  lastClientMessageId?: string;
  lastTurnResult?: any;
  previousConstraints?: any;
  decisionSteps?: DecisionStepTrace[];
  turnCount: number;
  updatedAt: number;
}
