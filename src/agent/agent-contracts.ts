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

export type GroundingStatus = 'VERIFIED' | 'CONTRADICTED' | 'MISSING_EVIDENCE' | 'NOT_APPLICABLE';

export interface ScopedRateFact {
  factId?: string;
  ref?: string;
  legacyRef?: string;
  sessionId?: string;
  amountVnd: number;
  role: 'TOTAL' | 'BASE_2H' | 'EXTRA_HOUR_RATE' | 'EXTRA_HOUR_SUBTOTAL' | 'PACKAGE_RATE' | 'ALT_21_40' | 'POLICY_RATE';
  propertyId?: CoSoMa;
  roomId?: string;
  category?: string;
  stayPackage?: StayType | 'EXTRA_HOUR' | 'ALL';
  durationHours?: number;
  checkinDatetime?: string;
  checkoutDatetime?: string;
  timeCondition?: string;
  eligible?: boolean;
  isDefaultPolicyRate?: boolean;
  ineligibilityReason?: string;
  isBaseEquivalent?: boolean;
  datasetVersion?: string;
  policyVersion?: string;
}

export interface ImmutableBuildIdentity {
  commit: string;
  branch?: string;
  builtAt?: string;
  buildVersion: string;
  policyVersion?: string;
  binaryRoot?: string;
  isImmutableStamp: boolean;
}

export interface RenderedStructuredRefBinding {
  rawPlaceholder: string;
  ref: string;
  factId?: string;
  sessionId?: string;
  evidenceId: string;
  propertyId: CoSoMa;
  roomId?: string;
  category?: string;
  role: ScopedRateFact['role'] | 'FIELD';
  stayPackage?: StayType | 'EXTRA_HOUR' | 'ALL';
  durationHours?: number;
  timeCondition?: string;
  eligible: boolean;
  datasetVersion: string;
  policyVersion: string;
  amountVnd: number;
  renderedText: string;
}

export interface BusinessEvidenceRecord {
  evidenceId: string;
  sessionId?: string;
  propertyId: CoSoMa;
  roomId?: string;
  roomCode?: string;
  roomName?: string;
  category?: string;
  evidenceType: 'QUOTE' | 'CATALOG_SEARCH' | 'ROOM_FACTS' | 'ROOM_MEDIA' | 'POLICY';
  toolSource: string;
  stayPackage?: StayType | 'ALL';
  amountVnd?: number;
  basePriceVnd?: number;
  extraHourRateVnd?: number;
  extraHourSubtotalVnd?: number;
  alternateAmountsVnd?: number[];
  scopedRates?: ScopedRateFact[];
  fieldRefs?: Record<string, string | number | boolean | null | undefined>;
  eligible?: boolean;
  timeCondition?: string;
  ineligibilityReason?: string;
  catalogRoomIds?: string[];
  roomAmenities?: Record<string, { bon_tam: 'TRUE' | 'FALSE' | 'UNKNOWN'; ghe_tinh_yeu: 'TRUE' | 'FALSE' | 'UNKNOWN' }>;
  holidayZeroConfirmed?: boolean;
  holidayProvenance?: string;
  categoryRateSnapshots?: Array<{
    category: string;
    base2hVnd?: number;
    overnightVnd?: number;
    dayNightVnd?: number;
    extraHourRateVnd?: number;
    base2hVnds?: number[];
    overnightVnds?: number[];
    dayNightVnds?: number[];
    extraHourRateVnds?: number[];
    hourlyExtendedVnds?: number[];
  }>;
  checkinDatetime?: string;
  checkoutDatetime?: string;
  durationHours?: number;
  conditions?: string[];
  effectivePolicyVersion: string;
  datasetVersion: string;
  validityScope: 'SESSION_WHILE_VALID' | 'TURN_LOCAL' | 'CONDITIONAL';
  isValid: boolean;
  invalidatedReason?: string;
  recordedTurn: number;
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
  | 'DEGRADED_DETERMINISTIC_MODE'
  | 'BLOCKED';

export interface LLMTelemetryTrace {
  verificationStatus: LLMVerificationStatus;
  provider: string;
  model: string;
  providerRequestId?: string;
  callCount: number;
  decisionType: string;
  effectivePolicyVersion?: string;
  buildIdentity?: ImmutableBuildIdentity;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  structuredDecisions?: AgentLLMDecision[];
  finalModelResponse?: string;
  fallbackState?: {
    isFallback: boolean;
    fallbackReason?: string;
  };
  protocolMetrics?: {
    schemaRejections: number;
    formatRepairs: number;
    providerFailovers: number;
  };
  telemetryEvents?: {
    evidenceInvalidations: number;
    replanningEvents: number;
    groundingRejections: number;
    repairAttempts: number;
    repairedTurn: boolean;
    finalGroundingBlocked: boolean;
    upstreamApiBlocked: boolean;
  };
}

export interface AgentLLMDecision {
  action: 'CALL_TOOLS' | 'RESPOND_DIRECTLY' | 'CLARIFY' | 'ESCALATE';
  thought_summary: string;
  tool_calls?: Array<{
    tool_name: 'search_rooms' | 'get_room_facts' | 'get_room_media' | 'get_policies' | 'quote_price';
    arguments: Record<string, any>;
  }>;
  claim_refs?: string[];
  media_refs?: string[];
  clarification_question?: string;
  final_response?: string;
}

export interface DecisionStepTrace {
  step: number;
  phase: 'UNDERSTAND' | 'DECIDE' | 'ACT' | 'OBSERVE' | 'REVISE' | 'RESPOND';
  eventType?: 'EVIDENCE_INVALIDATION' | 'REPLANNING' | 'GROUNDING_REJECTION' | 'GROUNDING_REPAIR';
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

export interface RoomPresentationImage {
  url: string;
  caption?: string;
  order?: number;
  label?: string;
  alt?: string | null;
  propertyId?: string;
  roomId?: string;
  roomCode?: string;
  roomName?: string;
}

export interface RoomPresentationBlock {
  propertyId: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  category?: string;
  displayOrder: number;
  description?: string;
  priceSummary?: string;
  quoteRefs?: string[];
  bookingLink?: string;
  images: RoomPresentationImage[];
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
  lastPresentedRooms?: Array<{
    propertyId: string;
    roomId: string;
    roomCode: string;
    roomName: string;
    category?: string;
    hasMedia: boolean;
    order: number;
    summary?: string;
  }>;

  // Verified facts, scoped business evidence & observations
  verifiedFacts: Record<string, Evidence>;
  verifiedBusinessEvidence?: BusinessEvidenceRecord[];
  nextFactSeq?: number;
  mediaEvidenceCache?: Record<string, RoomPresentationBlock>;
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
