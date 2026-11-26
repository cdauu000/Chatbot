import { NormalizedDataset, NormalizedRoom } from '../domain/normalized-schema.js';
import { CoSoMa, CompositeRoomKey, toCompositeKeyString } from '../domain/types.js';
import { InMemoryRoomSearchEngine } from '../search/in-memory-room-search.js';
import { PreBookingQuoteEngine } from '../pricing/prebooking-quote-engine.js';
import { PreBookingQuoteResult } from '../pricing/quote-types.js';
import { RoomSearchCriteria, RoomSearchResult, ScoredRoomCandidate } from '../search/search-types.js';
import {
  ActionType,
  ConversationTurnResult,
  ExtractedEntities,
  IntentType,
  ShortlistedRoomItem,
  WorkingMemory,
} from './conversation-types.js';
import { MemoryManager } from './memory-manager.js';
import { RoomReferenceResolver } from './reference-resolver.js';
import { AdvisoryComposer, AdvisoryComposerConfig } from './advisory-composer.js';
import { LLMAdapter } from './adapters/llm-adapter.interface.js';
import { MockLLMAdapter } from './adapters/mock-llm-adapter.js';
import { KnowledgeBase } from '../knowledge/knowledge-base.js';
import { PolicyQAEngine } from '../knowledge/policy-qa-engine.js';
import { ClaimLevelValidator, ClaimValidationConfig } from './grounding/claim-validator.js';
import { GroundedAnswerPlanner } from './grounding/grounded-answer-planner.js';
import { HumanEscalationManager } from './escalation/human-escalation-manager.js';
import {
  StayPackageEligibilityResolver,
  StayPackageEligibilityResult,
} from '../pricing/stay-package-eligibility.js';
import { AIConversationPlanner } from './planning/conversation-planner.js';
import { ConversationPlan } from './planning/conversation-plan.js';
import { removeDiacritics } from './nlu-engine.js';
import { GroundedAnswerData } from './grounding/grounded-data.js';
import { HadongAgent } from '../agent/hadong-agent.js';
import { JCollectionAgent } from '../agent/jcollection-agent.js';

export interface ProcessTurnOptions {
  referenceClock?: string;
  messageTimestamp?: string;
  boundPropertyId?: CoSoMa;
  strictLiveOnly?: boolean;
}

export interface OrchestratorOptions {
  memoryManager?: MemoryManager;
  llmAdapter?: LLMAdapter;
  referenceClock?: string;
  composerConfig?: AdvisoryComposerConfig;
  claimValidatorConfig?: ClaimValidationConfig;
}

export class ConversationOrchestrator {
  private dataset: NormalizedDataset;
  private memoryManager: MemoryManager;
  private referenceResolver: RoomReferenceResolver;
  private searchEngine: InMemoryRoomSearchEngine;
  private quoteEngine: PreBookingQuoteEngine;
  private composer: AdvisoryComposer;
  private llmAdapter: LLMAdapter;
  private kb: KnowledgeBase;
  private policyQaEngine: PolicyQAEngine;
  private claimValidator: ClaimLevelValidator;
  private planner: GroundedAnswerPlanner;
  private escalationManager: HumanEscalationManager;
  private stayEligibilityResolver: StayPackageEligibilityResolver;
  private conversationPlanner: AIConversationPlanner;
  private hadongAgent: HadongAgent;
  private agents: Map<CoSoMa, JCollectionAgent>;

  constructor(dataset: NormalizedDataset, options?: OrchestratorOptions) {
    this.dataset = dataset;
    this.memoryManager = options?.memoryManager ?? new MemoryManager();
    this.referenceResolver = new RoomReferenceResolver(dataset);
    this.searchEngine = new InMemoryRoomSearchEngine(dataset);
    this.quoteEngine = new PreBookingQuoteEngine(dataset);
    this.composer = new AdvisoryComposer(options?.composerConfig, dataset);
    this.llmAdapter = options?.llmAdapter ?? new MockLLMAdapter(options?.referenceClock);
    this.kb = new KnowledgeBase(dataset);
    this.policyQaEngine = new PolicyQAEngine(this.kb);
    this.claimValidator = new ClaimLevelValidator(dataset, options?.claimValidatorConfig);
    this.planner = new GroundedAnswerPlanner(dataset);
    this.escalationManager = new HumanEscalationManager();
    this.stayEligibilityResolver = new StayPackageEligibilityResolver();
    this.conversationPlanner = new AIConversationPlanner(dataset, { llmAdapter: this.llmAdapter });
    this.hadongAgent = new HadongAgent(dataset, {
      llmAdapter: this.llmAdapter,
      referenceClock: options?.referenceClock,
      claimValidator: this.claimValidator,
    });
    this.agents = new Map<CoSoMa, JCollectionAgent>();
    this.agents.set('jacayl-ha-dong', this.hadongAgent);
    this.agents.set(
      'jacayl-tran-khat-chan',
      new JCollectionAgent(dataset, 'jacayl-tran-khat-chan', {
        llmAdapter: this.llmAdapter,
        referenceClock: options?.referenceClock,
        claimValidator: this.claimValidator,
      })
    );
    this.agents.set(
      'j-village',
      new JCollectionAgent(dataset, 'j-village', {
        llmAdapter: this.llmAdapter,
        referenceClock: options?.referenceClock,
        claimValidator: this.claimValidator,
      })
    );
  }

  public getHadongAgent(): HadongAgent {
    return this.hadongAgent;
  }

  public getAgent(propertyId: CoSoMa): JCollectionAgent | undefined {
    return this.agents.get(propertyId);
  }

  public getConversationPlanner(): AIConversationPlanner {
    return this.conversationPlanner;
  }

  public getStayEligibilityResolver(): StayPackageEligibilityResolver {
    return this.stayEligibilityResolver;
  }

  public getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  public getSearchEngine(): InMemoryRoomSearchEngine {
    return this.searchEngine;
  }

  public getQuoteEngine(): PreBookingQuoteEngine {
    return this.quoteEngine;
  }

  public getKnowledgeBase(): KnowledgeBase {
    return this.kb;
  }

  public getPolicyQaEngine(): PolicyQAEngine {
    return this.policyQaEngine;
  }

  public getClaimValidator(): ClaimLevelValidator {
    return this.claimValidator;
  }

  public setReferenceClock(clock: string): void {
    if ('setReferenceClock' in this.llmAdapter && typeof (this.llmAdapter as any).setReferenceClock === 'function') {
      (this.llmAdapter as any).setReferenceClock(clock);
    }
  }

  /**
   * Main multi-turn conversation loop.
   */
  public async processTurn(
    sessionId: string,
    userMessage: string,
    optionsOrClock?: string | ProcessTurnOptions,
    propertyId?: CoSoMa
  ): Promise<ConversationTurnResult> {
    const startTime = performance.now();
    const rulesTriggered: string[] = [];
    const toolsExecuted: string[] = [];
    const canonicalDataFetched: string[] = [];

    let referenceClock: string | undefined;
    let messageTimestamp: string | undefined;
    let boundPropertyId: CoSoMa | undefined;

    if (typeof optionsOrClock === 'string') {
      referenceClock = optionsOrClock;
      if (propertyId) boundPropertyId = propertyId;
    } else if (optionsOrClock && typeof optionsOrClock === 'object') {
      referenceClock = optionsOrClock.referenceClock;
      messageTimestamp = optionsOrClock.messageTimestamp;
      boundPropertyId = optionsOrClock.boundPropertyId ?? propertyId;
    } else if (propertyId) {
      boundPropertyId = propertyId;
    }

    if (referenceClock) {
      this.setReferenceClock(referenceClock);
    }

    // 1. Retrieve or initialize Working Memory
    let memory = this.memoryManager.getSession(sessionId);

    // Server-Side Property Context Binding: If boundPropertyId supplied, bind immediately to memory if not set
    if (boundPropertyId && !memory.active_facility) {
      this.memoryManager.updateSlots(sessionId, { active_facility: boundPropertyId });
      memory = this.memoryManager.getSession(sessionId);
    }

    // Feature Flag: CONVERSATION_ENGINE=legacy|agentic (default: agentic for V2.2)
    const engineMode = process.env.CONVERSATION_ENGINE || 'agentic';
    if (engineMode === 'agentic') {
      const lower = removeDiacritics(userMessage.toLowerCase());
      const detectedFacility: CoSoMa | undefined =
        lower.includes('tran khat chan') || lower.includes('trankhatchan')
          ? 'jacayl-tran-khat-chan'
          : lower.includes('j village') || lower.includes('jvillage') || lower.includes('trieu viet vuong')
          ? 'j-village'
          : lower.includes('ha dong') || lower.includes('hadong')
          ? 'jacayl-ha-dong'
          : undefined;

      const targetProperty: CoSoMa =
        boundPropertyId ||
        memory.active_facility ||
        detectedFacility ||
        'jacayl-ha-dong';

      const agent = this.agents.get(targetProperty) || this.hadongAgent;
      if (!memory.active_facility) {
        this.memoryManager.updateSlots(sessionId, { active_facility: targetProperty });
      }
      return agent.processTurn(sessionId, userMessage, {
        referenceClock,
        messageTimestamp,
        strictLiveOnly:
          (typeof optionsOrClock === 'object' ? optionsOrClock?.strictLiveOnly : undefined) ??
          (process.env.STRICT_LIVE_ONLY === 'true'),
      });
    }

    // 2. Parse intent and entities
    const parseResult = await this.llmAdapter.parseIntentAndEntities(
      userMessage,
      [],
      memory,
      referenceClock
    );
    const { intent, entities } = parseResult;
    rulesTriggered.push(`NLU_INTENT_${intent}`);

    // 3. M3 A1 Semantic Fix: Handle Requirements Actions (Remove vs Negate vs Clear)
    if (entities.removed_requirements && entities.removed_requirements.length > 0) {
      for (const removed of entities.removed_requirements) {
        this.memoryManager.removeRequirement(sessionId, removed);
        rulesTriggered.push(`REMOVE_REQUIREMENT_${removed}`);
      }
    } else if (entities.removed_constraints && entities.removed_constraints.length > 0) {
      for (const removed of entities.removed_constraints) {
        this.memoryManager.removeRequirement(sessionId, removed);
        rulesTriggered.push(`REMOVE_REQUIREMENT_${removed}`);
      }
    }

    if (entities.negated_constraints && entities.negated_constraints.length > 0) {
      for (const negated of entities.negated_constraints) {
        this.memoryManager.negateRequirement(sessionId, negated);
        rulesTriggered.push(`NEGATE_REQUIREMENT_${negated}`);
      }
    }

    if (entities.cleared_negations && entities.cleared_negations.length > 0) {
      for (const cleared of entities.cleared_negations) {
        this.memoryManager.clearNegation(sessionId, cleared);
        rulesTriggered.push(`CLEAR_NEGATION_${cleared}`);
      }
    }

    memory = this.memoryManager.getSession(sessionId);

    // 4. Resolve room references (e.g. "căn thứ hai", "phòng 101", "phòng rẻ hơn")
    let resolvedKey: CompositeRoomKey | undefined;
    const userNoDia = removeDiacritics(userMessage.toLowerCase());
    const isDecliningRoom =
      userNoDia.includes('thoi khong') ||
      userNoDia.includes('khong thue') ||
      userNoDia.includes('xem phong khac') ||
      userNoDia.includes('khong lay');

    const effectiveFacility: CoSoMa | null = entities.facility || memory.active_facility || boundPropertyId || null;
    const refResult = isDecliningRoom
      ? null
      : this.referenceResolver.resolve(userMessage, {
          ...memory,
          active_facility: effectiveFacility,
        });

    if (refResult?.matched_key) {
      resolvedKey = refResult.matched_key;
      entities.room_key = resolvedKey;
      rulesTriggered.push(`RESOLVED_REF_${refResult.resolution_type}`);
    } else if (entities.room_name && !isDecliningRoom) {
      const rName = entities.room_name.toLowerCase().trim();
      const targetFacility = entities.facility || memory.active_facility || boundPropertyId;
      const matched = this.dataset.phong.find((p) => {
        const matchesFacility = !targetFacility || p.co_so_ma === targetFacility;
        const pMa = p.ma_phong.toLowerCase();
        const pTen = p.ten_phong.toLowerCase();
        return (
          matchesFacility &&
          (pMa === rName || pMa.startsWith(`${rName}-`) || pTen.includes(rName))
        );
      });
      if (matched) {
        resolvedKey = { co_so_ma: matched.co_so_ma, ma_phong: matched.ma_phong };
        entities.room_key = resolvedKey;
      }
    }

    // 5. Update Memory Slots (Targeted update, preserves other slots)
    const slotUpdates: Partial<WorkingMemory> = {};
    if (entities.facility) {
      slotUpdates.active_facility = entities.facility;
    } else if (boundPropertyId && !memory.active_facility) {
      slotUpdates.active_facility = boundPropertyId;
    }
    if (isDecliningRoom) {
      slotUpdates.focused_room = null;
    } else if (resolvedKey) {
      slotUpdates.focused_room = resolvedKey;
    }
    if (entities.stay_type) slotUpdates.stay_type = entities.stay_type;
    if (entities.checkin_datetime) {
      slotUpdates.checkin_datetime = entities.checkin_datetime;
    } else if (entities.checkin_time) {
      const baseDate = (memory.checkin_datetime ?? referenceClock ?? '2026-11-28T10:00:00+07:00').split('T')[0];
      slotUpdates.checkin_datetime = `${baseDate}T${entities.checkin_time}:00+07:00`;
    }
    if (entities.duration_hours) slotUpdates.duration_hours = entities.duration_hours;
    if (entities.budget) slotUpdates.max_budget = entities.budget;

    // Category update: If new category requested, verify if current focused_room matches
    if (entities.category) {
      slotUpdates.target_category = entities.category;
      if (memory.focused_room && !resolvedKey) {
        const curRoom = this.dataset.phong.find(
          (p) => p.co_so_ma === memory.focused_room?.co_so_ma && p.ma_phong === memory.focused_room?.ma_phong
        );
        if (curRoom && curRoom.hang !== entities.category) {
          slotUpdates.focused_room = null;
        }
      }
    }

    // Merge must-have amenities (only adding new ones)
    if (entities.must_have_amenities && entities.must_have_amenities.length > 0) {
      const mergedAmenities = Array.from(
        new Set([...memory.must_have_amenities, ...entities.must_have_amenities])
      );
      slotUpdates.must_have_amenities = mergedAmenities;
    }

    this.memoryManager.updateSlots(sessionId, slotUpdates);
    memory = this.memoryManager.getSession(sessionId);

    // Room Detail / Focused Room Resolution (Pre-resolved for planning & action determination)
    const roomToFindKey = resolvedKey ?? memory.focused_room;
    let matchedRoomForDetail = roomToFindKey
      ? this.dataset.phong.find((p) => p.co_so_ma === roomToFindKey.co_so_ma && p.ma_phong === roomToFindKey.ma_phong)
      : undefined;

    if (!matchedRoomForDetail && entities.room_name) {
      const rName = entities.room_name.toLowerCase().trim();
      const targetFacility = entities.facility || memory.active_facility || boundPropertyId;
      matchedRoomForDetail = this.dataset.phong.find((p) => {
        const matchesFac = !targetFacility || p.co_so_ma === targetFacility;
        const pMa = p.ma_phong.toLowerCase();
        const pTen = p.ten_phong.toLowerCase();
        return (
          matchesFac &&
          (pMa === rName || pMa.startsWith(`${rName}-`) || pTen.includes(rName))
        );
      });
    }

    // 6. Policy QA Inquiry Evaluation
    const policyResult = this.policyQaEngine.answer(userMessage, memory.active_facility ?? undefined);
    if (policyResult) {
      rulesTriggered.push(`POLICY_MATCH_${policyResult.topic}`);
      toolsExecuted.push('POLICY_LOOKUP');
      canonicalDataFetched.push('business_policy_v1_4_3.json', 'knowledge_base');
    }

    // 6b. AI Conversation Planner (Sections III, IV, VI)
    const plan = await this.conversationPlanner.plan(
      userMessage,
      memory,
      entities,
      boundPropertyId,
      referenceClock
    );
    rulesTriggered.push(`PLAN_PRIMARY_${plan.primaryGoal}`);
    rulesTriggered.push(`PLAN_DEPTH_${plan.responseDepth}`);
    if (plan.requiredTools) {
      toolsExecuted.push(...plan.requiredTools.filter((t) => t !== 'NONE'));
    }

    // Contextual Memory Invalidation / Retraction on topic shift
    if (plan.topicChanged && plan.clearPreviousRequirements) {
      this.memoryManager.invalidateContext(sessionId, {
        clearRequirements: true,
        clearShortlist: true,
      });
      this.memoryManager.updateSlots(sessionId, { focused_room: null });
      memory = this.memoryManager.getSession(sessionId);
    }
    this.memoryManager.recordTopicTransition(
      sessionId,
      plan.primaryGoal,
      plan.referencedRoomId ? resolvedKey : undefined,
      plan.referencedCategory as any
    );
    memory = this.memoryManager.getSession(sessionId);

    // 7. Determine Action
    let chosenAction: ActionType = 'RECOMMEND_ROOMS';
    let missingInfo: string[] = [];

    if (policyResult?.topic === 'NON_COMMERCIAL_ROOM_401_HA_DONG' || policyResult?.topic === 'CANONICAL_ROOM_IDENTITY_601') {
      chosenAction = 'ANSWER_FROM_VERIFIED_DATA';
      rulesTriggered.push('RULE_CANONICAL_ROOM_IDENTITY');
      canonicalDataFetched.push('room_business_registry', 'dataset.phong');
    } else if (entities.is_adversarial_or_injection || plan.primaryGoal === 'DECLINE_OUT_OF_SCOPE') {
      chosenAction = 'DECLINE_UNVERIFIED_CLAIM';
      rulesTriggered.push('RULE_ADVERSARIAL_BLOCKED');
    } else if (plan.primaryGoal === 'POLITE_CLOSING') {
      chosenAction = 'POLITE_CLOSING';
      rulesTriggered.push('RULE_NATURAL_POLITE_CLOSING');
    } else if (intent === 'AI_IDENTITY_INQUIRY') {
      chosenAction = 'ANSWER_AI_IDENTITY';
      rulesTriggered.push('RULE_HONEST_AI_IDENTITY');
    } else if (intent === 'IN_STAY_OPERATIONAL_REQUEST' || plan.primaryGoal === 'IN_STAY_SERVICE_ROUTING') {
      chosenAction = 'ROUTE_IN_STAY_REQUEST';
      rulesTriggered.push('RULE_IN_STAY_REFUSAL_HOTLINE');
    } else if (intent === 'CHECKOUT_DISPUTE' || plan.primaryGoal === 'CHECKOUT_DISPUTE_ROUTING') {
      chosenAction = 'DECLINE_UNVERIFIED_CLAIM';
      rulesTriggered.push('RULE_CHECKOUT_DISPUTE_REFERRED');
    } else if (intent === 'BOOKING_INTENT' || intent === 'BOOKING_REQUEST' || plan.primaryGoal === 'PROVIDE_BOOKING_GUIDE') {
      chosenAction = 'PROVIDE_BOOKING_GUIDANCE';
      rulesTriggered.push('RULE_NO_FAKE_BOOKING_CONFIRMATION');
    } else if (intent === 'CHECK_ROOM_AVAILABILITY' || intent === 'ASK_ROOM_AVAILABILITY' || plan.primaryGoal === 'CHECK_AVAILABILITY') {
      chosenAction = 'ANSWER_AVAILABILITY_TRANSPARENT';
      rulesTriggered.push('RULE_LIVE_AVAILABILITY_TRANSPARENT_ESCALATION');
    } else if (
      intent === 'ASK_PARKING' ||
      (plan.primaryGoal === 'ANSWER_POLICY' && plan.requestedFacts.includes('parking')) ||
      (plan.primaryGoal === 'CALCULATE_PRICE' && plan.requestedFacts.includes('parking'))
    ) {
      chosenAction = 'ANSWER_PARKING_POLICY';
      rulesTriggered.push('RULE_PARKING_POLICY_STANDALONE');
      toolsExecuted.push('POLICY_LOOKUP');
      if (plan.primaryGoal === 'CALCULATE_PRICE') {
        toolsExecuted.push('QUOTE_CATEGORY', 'CALCULATE_PRICE_QUOTE');
        canonicalDataFetched.push('business_policy_v1_4_3.json');
      }
    } else if (plan.primaryGoal === 'ANSWER_DIRECT_FACT' && (matchedRoomForDetail || plan.referencedRoomId)) {
      chosenAction = 'ANSWER_ROOM_ATTRIBUTE';
      rulesTriggered.push('RULE_NATURAL_ROOM_ATTRIBUTE');
      toolsExecuted.push('ROOM_DETAIL_LOOKUP');
      canonicalDataFetched.push('dataset.phong');
    } else if (intent === 'BROWSE_ROOM_CATEGORIES') {
      chosenAction = 'SHOW_ROOM_CATEGORIES';
      rulesTriggered.push('RULE_BROWSE_ROOM_CATEGORIES');
    } else if (intent === 'BROWSE_ROOMS_BY_CATEGORY') {
      chosenAction = 'SHOW_ROOMS_BY_CATEGORY';
      rulesTriggered.push('RULE_BROWSE_ROOMS_BY_CATEGORY');
    } else if (
      (intent === 'ASK_CATEGORY_PRICE' || plan.primaryGoal === 'CALCULATE_PRICE') &&
      !matchedRoomForDetail &&
      !entities.checkin_time &&
      !entities.duration_hours &&
      !(entities.must_have_amenities && entities.must_have_amenities.length > 0) &&
      memory.stay_type !== 'qua_dem'
    ) {
      chosenAction = 'QUOTE_CATEGORY_PRICE';
      rulesTriggered.push('RULE_QUOTE_CATEGORY_PRICE');
      toolsExecuted.push('QUOTE_CATEGORY', 'CALCULATE_PRICE_QUOTE');
      canonicalDataFetched.push('business_policy_v1_4_3.json');
    } else if (intent === 'ASK_SPECIFIC_ROOM_PRICE') {
      chosenAction = 'GET_PREBOOKING_QUOTE';
      rulesTriggered.push('RULE_QUOTE_SPECIFIC_ROOM');
      toolsExecuted.push('QUOTE_ROOM', 'CALCULATE_PRICE_QUOTE');
      canonicalDataFetched.push('room.gia_goc_dataset', 'business_policy_v1_4_3.json');
    } else if (intent === 'REQUEST_ROOM_IMAGES' || plan.primaryGoal === 'SHOW_MEDIA') {
      chosenAction = 'SHOW_ROOM_IMAGES';
      rulesTriggered.push('RULE_SHOW_ROOM_IMAGES');
      toolsExecuted.push('MEDIA_LOOKUP');
      canonicalDataFetched.push('dataset.phong.hinh_anh');
    } else if (intent === 'REQUEST_STAFF_HANDOFF' || intent === 'REQUEST_HUMAN' || plan.primaryGoal === 'REQUEST_STAFF_HANDOFF') {
      chosenAction = 'FLAG_FOR_HUMAN';
      rulesTriggered.push('RULE_CUSTOMER_REQUEST_STAFF_HANDOFF');
      toolsExecuted.push('STAFF_HANDOFF');
    } else if (intent === 'COMPARE_ROOMS' || plan.primaryGoal === 'COMPARE_ROOMS') {
      chosenAction = 'COMPARE_VERIFIED_ROOMS';
      rulesTriggered.push('RULE_COMPARE_GROUNDED_ROOMS');
    } else if (plan.primaryGoal === 'ANSWER_POLICY' || intent === 'ASK_POLICY' || (policyResult && intent !== 'SEARCH_ROOM')) {
      chosenAction = 'ANSWER_FROM_VERIFIED_DATA';
      rulesTriggered.push('RULE_POLICY_GROUNDED_ANSWER');
    } else if (intent === 'SEARCH_ROOM') {
      chosenAction = 'RECOMMEND_ROOMS';
    } else if (intent === 'GREETING' || plan.primaryGoal === 'POLITE_GREETING') {
      chosenAction = 'GENERAL_GREETING';
    } else if (intent === 'OUT_OF_SCOPE') {
      chosenAction = 'DECLINE_UNVERIFIED_CLAIM';
      rulesTriggered.push('RULE_OUT_OF_SCOPE_DECLINED');
    } else {
      chosenAction = 'RECOMMEND_ROOMS';
    }

    // 8. Search & Quote Engine Execution
    const candidates: Array<{
      item: ScoredRoomCandidate;
      quote?: PreBookingQuoteResult;
      bucket?: string;
    }> = [];
    let searchResult: RoomSearchResult | undefined;
    const quotesList: PreBookingQuoteResult[] = [];

    // Business Policy V1.4.3: Stay Package Eligibility Resolution
    let packageEligibility: StayPackageEligibilityResult | undefined;
    if (memory.checkin_datetime && memory.active_facility) {
      const userMsgLower = userMessage.toLowerCase();
      const stayUntilNextDay =
        memory.stay_type === 'qua_dem' ||
        userMsgLower.includes('trưa mai') ||
        userMsgLower.includes('sáng mai') ||
        userMsgLower.includes('hôm sau') ||
        userMsgLower.includes('nghỉ đêm') ||
        userMsgLower.includes('đến mai');

      packageEligibility = this.stayEligibilityResolver.resolve({
        facility_id: memory.active_facility,
        requested_stay_type: memory.stay_type,
        requested_checkin_datetime: memory.checkin_datetime,
        stay_until_next_day: stayUntilNextDay,
      });

      rulesTriggered.push(`STAY_ELIGIBILITY_${packageEligibility.eligibility_status}`);
    }

    const effectiveStayType = packageEligibility ? packageEligibility.recommended_stay_type : memory.stay_type;

    // Intent-Scoped Output & Context Control:
    // Only search/quote for search, compare, specific quote or booking guidance when appropriate.
    // STRICTLY NEVER run search for pure parking, availability, categories, images, greeting, or simple policy.
    const userMsgLowerSearch = userMessage.toLowerCase();
    const hasRoomSearchInUtterance =
      intent === 'SEARCH_ROOM' ||
      (entities.must_have_amenities && entities.must_have_amenities.length > 0) ||
      ((userMsgLowerSearch.includes('gia') || userMsgLowerSearch.includes('thuê') || userMsgLowerSearch.includes('thue')) &&
        (userMsgLowerSearch.includes('tieng') || userMsgLowerSearch.includes('tiếng') || userMsgLowerSearch.includes('gio') || userMsgLowerSearch.includes('giờ')));

    const isSingleFactOrPassiveAction =
      chosenAction === 'POLITE_CLOSING' ||
      chosenAction === 'ANSWER_ROOM_ATTRIBUTE' ||
      chosenAction === 'ANSWER_PARKING_POLICY' ||
      chosenAction === 'SHOW_ROOM_IMAGES' ||
      chosenAction === 'ANSWER_AVAILABILITY_TRANSPARENT' ||
      chosenAction === 'GENERAL_GREETING' ||
      chosenAction === 'DECLINE_UNVERIFIED_CLAIM' ||
      chosenAction === 'ROUTE_IN_STAY_REQUEST' ||
      chosenAction === 'FLAG_FOR_HUMAN';

    const shouldRunSearch =
      !isSingleFactOrPassiveAction &&
      (chosenAction === 'RECOMMEND_ROOMS' ||
        chosenAction === 'COMPARE_VERIFIED_ROOMS' ||
        chosenAction === 'PROVIDE_BOOKING_GUIDANCE' ||
        chosenAction === 'GET_PREBOOKING_QUOTE' ||
        (chosenAction === 'ANSWER_FROM_VERIFIED_DATA' && hasRoomSearchInUtterance && intent !== 'ASK_PARKING')) &&
      intent !== 'ASK_PARKING';

    const effectiveDurationHours =
      effectiveStayType === 'nghi_gio'
        ? Math.max(2, memory.duration_hours ?? 2)
        : (memory.duration_hours ?? 1);

    if (shouldRunSearch) {
      toolsExecuted.push('SEARCH_ROOMS');
      canonicalDataFetched.push('dataset.phong');
      const criteria: RoomSearchCriteria = {
        co_so_ma: memory.active_facility ?? undefined,
        hang: entities.category ?? memory.target_category ?? undefined,
        stay_type: effectiveStayType,
        duration_hours: effectiveDurationHours,
        checkin_datetime: memory.checkin_datetime ?? undefined,
        max_budget: memory.max_budget ?? undefined,
        negated_constraints: memory.negated_constraints,
      };

      // Map amenities to criteria supported by RoomSearchCriteria ('bon_tam' | 'ghe_tinh_yeu' | 'thang_may')
      if (memory.must_have_amenities && memory.must_have_amenities.length > 0) {
        const mappedAmenities: Array<'bon_tam' | 'ghe_tinh_yeu' | 'thang_may'> = [];
        for (const am of memory.must_have_amenities) {
          const normAm = am.toLowerCase();
          if (normAm.includes('bồn tắm') || normAm.includes('bon tam')) mappedAmenities.push('bon_tam');
          if (normAm.includes('ghế tình yêu') || normAm.includes('ghe tinh yeu') || normAm.includes('tantra'))
            mappedAmenities.push('ghe_tinh_yeu');
          if (normAm.includes('thang máy') || normAm.includes('thang may')) mappedAmenities.push('thang_may');
        }
        if (mappedAmenities.length > 0) {
          criteria.must_have_amenities = Array.from(new Set(mappedAmenities));
        }
      }

      searchResult = this.searchEngine.search(criteria);

      const rawCandidates: Array<{ item: ScoredRoomCandidate; bucket: string }> = [];

      // If user specified an explicit room in the current turn, prioritize only that room
      if (entities.room_name && matchedRoomForDetail) {
        rawCandidates.push({
          item: {
            room: matchedRoomForDetail,
            bucket: 'EXACT',
            match_reasons: ['Phòng khách chỉ định'],
            unmet_soft_preferences: [],
            alternative_variances: [],
            unverified_reasons: [],
          },
          bucket: 'EXACT',
        });
      } else {
        // If user has focused room, prioritize it
        if (memory.focused_room) {
          const focused = this.dataset.phong.find(
            (p) =>
              p.co_so_ma === memory.focused_room?.co_so_ma &&
              p.ma_phong === memory.focused_room?.ma_phong
          );
          if (focused) {
            rawCandidates.push({
              item: {
                room: focused,
                bucket: 'EXACT',
                match_reasons: ['Phòng khách đang chọn'],
                unmet_soft_preferences: [],
                alternative_variances: [],
                unverified_reasons: [],
              },
              bucket: 'EXACT',
            });
          }
        }

        // Add exact matches
        for (const item of searchResult.buckets.exact_matches) {
          if (!rawCandidates.some((c) => c.item.room.ma_phong === item.room.ma_phong && c.item.room.co_so_ma === item.room.co_so_ma)) {
            rawCandidates.push({ item, bucket: 'EXACT' });
          }
        }

        // Add partial matches
        for (const item of searchResult.buckets.partial_matches) {
          if (!rawCandidates.some((c) => c.item.room.ma_phong === item.room.ma_phong && c.item.room.co_so_ma === item.room.co_so_ma)) {
            rawCandidates.push({ item, bucket: 'PARTIAL' });
          }
        }

        // Add alternative matches
        for (const item of searchResult.buckets.alternative_suggestions) {
          if (!rawCandidates.some((c) => c.item.room.ma_phong === item.room.ma_phong && c.item.room.co_so_ma === item.room.co_so_ma)) {
            rawCandidates.push({ item, bucket: 'ALTERNATIVE' });
          }
        }
      }

      // If customer is specifically inquiring about a focused room or asking for its quote, isolate quotation to that room
      const isFocusedRoomQuery =
        (plan.primaryGoal === 'CALCULATE_PRICE' || chosenAction === 'GET_PREBOOKING_QUOTE') &&
        (Boolean(matchedRoomForDetail) || Boolean(memory.focused_room));

      const selected = isFocusedRoomQuery ? rawCandidates.slice(0, 1) : rawCandidates.slice(0, 4);

      for (const candidate of selected) {
        const quote = this.quoteEngine.getQuote({
          co_so_ma: candidate.item.room.co_so_ma,
          ma_phong: candidate.item.room.ma_phong,
          stay_type: effectiveStayType,
          duration_hours: effectiveDurationHours,
          checkin_datetime: memory.checkin_datetime ?? undefined,
        });

        quotesList.push(quote);
        candidates.push({
          item: candidate.item,
          quote,
          bucket: candidate.bucket,
        });
      }

      // Update Working Memory Shortlist & focused room
      const shortlistItems: ShortlistedRoomItem[] = candidates.map((c) => ({
        key: { co_so_ma: c.item.room.co_so_ma, ma_phong: c.item.room.ma_phong },
        name: c.item.room.ten_phong,
        category: c.item.room.hang,
        price: c.quote?.total_estimate ?? c.item.room.gia_goc_dataset.nghi_gio_2h,
        bucket: c.bucket as any,
      }));

      const nextFocusedRoom = isDecliningRoom
        ? null
        : (memory.focused_room ??
          (candidates.length > 0
            ? { co_so_ma: candidates[0].item.room.co_so_ma, ma_phong: candidates[0].item.room.ma_phong }
            : null));

      this.memoryManager.updateShortlist(sessionId, shortlistItems, nextFocusedRoom);
      memory = this.memoryManager.getSession(sessionId);

      if (quotesList.length > 0) {
        memory.last_quote_context = quotesList[0];
      }
    }

    // 9. Image retrieval & Room Detail Resolution (Section E & Canonical Dataset)
    let deliveredImages: Array<{ url: string; alt?: string | null; roomName: string; caption?: string }> | undefined;
    if ((intent === 'REQUEST_ROOM_IMAGES' || chosenAction === 'SHOW_ROOM_IMAGES') && plan.primaryGoal !== 'CALCULATE_PRICE') {
      if (matchedRoomForDetail && matchedRoomForDetail.anh && matchedRoomForDetail.anh.length > 0) {
        deliveredImages = matchedRoomForDetail.anh.map((img) => ({
          url: img.url,
          alt: img.alt ?? `${matchedRoomForDetail!.ten_phong} - ${img.nhan}`,
          roomName: matchedRoomForDetail!.ten_phong,
          caption: `Ảnh ${img.nhan} — ${matchedRoomForDetail!.ten_phong}`,
        }));
      }
    }

    // 10. Grounded Answer Plan (Section D1)
    const answerPlan = this.planner.plan({
      intent,
      memory,
      candidates,
      policyResult,
    });

    // 10b. Build Structured Grounded Data (Section VII)
    const groundedData: GroundedAnswerData = {
      plan,
      facility: memory.active_facility,
      focusedRoom: matchedRoomForDetail,
      verifiedRoomIds: candidates.map((c) => c.item.room.id),
      verifiedRoomNames: candidates.map((c) => c.item.room.ten_phong),
      candidateRooms: candidates,
      verifiedFacts: [],
      pricingResults: quotesList,
      policyResults: policyResult ? [policyResult] : [],
      mediaReferences: (deliveredImages || []).map((img) => ({
        url: img.url,
        alt: img.alt,
        roomName: img.roomName,
        caption: img.caption,
        source: 'canonical_dataset_room_anh',
      })),
      unconfirmedAmenitiesToDisclaim: answerPlan.unconfirmed_amenities_to_disclaim,
      isBudgetInsufficient: answerPlan.is_budget_insufficient,
      budgetExplanation: answerPlan.budget_explanation,
    };

    // 11. Compose Customer-Visible Response
    const responseText = this.composer.compose(
      {
        intent,
        action: chosenAction,
        userMessage,
        memory,
        candidates,
        policyAnswer:
          chosenAction === 'ANSWER_FROM_VERIFIED_DATA' || intent === 'ASK_POLICY'
            ? policyResult?.answer_text
            : undefined,
        missingInformation: missingInfo,
        referenceClock,
        packageEligibility,
        roomDetail: matchedRoomForDetail,
        plan,
        groundedData,
      },
      answerPlan
    );

    // 12. Claim-Level Validation (Section D2)
    const claimValidation = this.claimValidator.validate(responseText, {
      facility: memory.active_facility,
      focusedRoomKey: memory.focused_room ? toCompositeKeyString(memory.focused_room.co_so_ma, memory.focused_room.ma_phong) : null,
      requestedAmenities: memory.must_have_amenities,
    });

    // 13. Human Escalation Evaluation (Section F)
    const humanEscalation = this.escalationManager.evaluate(
      intent,
      userMessage,
      memory.active_facility,
      answerPlan.facility_phone,
      policyResult
    );

    // 14. Format Candidates for Output
    const verifiedCandidatesFormatted = candidates.map((c) => {
      const room = c.item.room;
      const quote = c.quote;
      let priceText = 'Chưa xác định';
      if (quote && quote.total_estimate) {
        priceText = `${quote.total_estimate.toLocaleString('vi-VN')}đ`;
      } else if (room.gia_goc_dataset?.nghi_gio_2h) {
        priceText = `từ ${room.gia_goc_dataset.nghi_gio_2h.toLocaleString('vi-VN')}đ`;
      }
      return {
        id: toCompositeKeyString(room.co_so_ma, room.ma_phong),
        name: room.ten_phong,
        price_text: priceText,
        bucket: c.bucket ?? 'EXACT',
        notes: c.item.match_reasons.join(', ') || undefined,
        booking_link: room.link_phong ?? answerPlan.facility_booking_url,
      };
    });

    // 15. Evidence References
    const evidenceReferences: string[] = [];
    if (memory.active_facility) {
      evidenceReferences.push(`cs::${memory.active_facility}`);
    }
    for (const c of candidates) {
      evidenceReferences.push(`phong::${c.item.room.co_so_ma}::${c.item.room.ma_phong}`);
    }
    if (quotesList.length > 0 && quotesList[0].policy_id) {
      evidenceReferences.push(`policy::${quotesList[0].policy_id}`);
    }
    if (policyResult) {
      evidenceReferences.push(...policyResult.source_citations);
    }

    const latencyMs = Math.round(performance.now() - startTime);

    return {
      session_id: sessionId,
      turn_index: memory.turn_count,
      user_message: userMessage,
      intent,
      plan,
      grounded_data: groundedData,
      extracted_entities: entities,
      updated_state: memory,
      missing_information: missingInfo,
      chosen_action: chosenAction,
      images: deliveredImages,
      tool_results: {
        search_result: searchResult,
        quote_results: quotesList,
        delivered_images: deliveredImages,
        policy_results: policyResult
          ? [
              {
                topic: policyResult.topic,
                answer: policyResult.answer_text,
                source: policyResult.source_citations.join(', '),
                status: policyResult.verification_status,
              },
            ]
          : undefined,
      },
      verified_candidates: verifiedCandidatesFormatted,
      evidence_references: Array.from(new Set(evidenceReferences)),
      customer_visible_response: responseText,
      claim_validation: claimValidation,
      human_escalation: humanEscalation,
      internal_trace: {
        latency_ms: latencyMs,
        rules_triggered: rulesTriggered,
        adapter_used: this.llmAdapter.name,
        escalated_to_human: humanEscalation.needed,
        applied_policy_id: quotesList[0]?.policy_id ?? 'J_COLLECTION_PRICING_POLICY_V1_4_3',
        planner_mode: plan.planner_mode ?? 'semantic_context',
        confidence: plan.confidence,
        routing_reason: plan.reasoning,
        entity_reference:
          plan.referencedRoomId ??
          (plan.referencedCategory as string) ??
          (plan.referencedPropertyId as string) ??
          undefined,
        tools_executed: Array.from(new Set(toolsExecuted)),
        canonical_data_fetched: Array.from(new Set(canonicalDataFetched)),
        response_depth: plan.responseDepth,
      },
    };
  }
}
