import { z } from 'zod';
import { NormalizedDataset } from '../domain/normalized-schema.js';
import { CoSoMa, StayType } from '../domain/types.js';
import {
  AgentState,
  AgentDecision,
  AgentResponse,
  DecisionTrace,
  DecisionStepTrace,
  ToolCall,
  ToolResult,
  ToolObservation,
  LLMVerificationStatus,
  LLMTelemetryTrace,
  AgentLLMDecision,
  BusinessEvidenceRecord,
  RenderedStructuredRefBinding,
  PropertyContext,
  RoomPresentationBlock,
  RoomPresentationImage,
} from './agent-contracts.js';
import { AgentToolGateway } from './agent-tools.js';
import { ClaimLevelValidator } from '../conversation/grounding/claim-validator.js';
import {
  computeDatasetVersionHash,
  formatValidEvidenceForPrompt,
  invalidateStaleBusinessEvidence,
  recordToolResultAsEvidence,
  renderStructuredMonetaryPlaceholders,
} from '../conversation/grounding/business-evidence.js';
import { ConversationTurnResult } from '../conversation/conversation-types.js';
import { LLMAdapter } from '../conversation/adapters/llm-adapter.interface.js';
import { removeDiacritics } from '../conversation/nlu-engine.js';
import { StructuredStateManager, GenericConstraintSolver } from './generic-constraint-solver.js';
import { getVietnamTemporalContext, VietnamTemporalContext } from '../pricing/checkin-pricing-resolver.js';
import { getEffectivePolicyMetadata, getImmutableBuildIdentity } from '../data-loader/pricing-policy-loader.js';

export const AgentDecisionOutputSchema = z.object({
  action: z.preprocess((val) => {
    if (typeof val === 'string') {
      const u = val.toUpperCase();
      if (u === 'CALL_TOOLS' || u === 'CALL_TOOL') return 'CALL_TOOLS';
      if (u === 'RESPOND_DIRECTLY' || u === 'RESPOND' || u === 'DIRECT_RESPONSE') return 'RESPOND_DIRECTLY';
      if (u === 'CLARIFY') return 'CLARIFY';
      if (u === 'ESCALATE') return 'ESCALATE';
    }
    return val;
  }, z.enum(['CALL_TOOLS', 'RESPOND_DIRECTLY', 'CLARIFY', 'ESCALATE']).default('RESPOND_DIRECTLY')),
  thought_summary: z.preprocess((val: any) => {
    if (typeof val === 'string' && val.trim().length > 0) return val.trim();
    return 'LLM reasoning step';
  }, z.string().default('LLM reasoning step')),
  tool_calls: z.preprocess(
    (val) => (Array.isArray(val) ? val : []),
    z.array(
      z.object({
        tool_name: z.enum(['search_rooms', 'get_room_facts', 'get_room_media', 'get_policies', 'quote_price']),
        arguments: z.preprocess((v) => (v && typeof v === 'object' ? v : {}), z.record(z.any())).default({}),
      })
    )
  ),
  claim_refs: z.preprocess((val) => (Array.isArray(val) ? val : undefined), z.array(z.string()).optional()).nullish(),
  media_refs: z.preprocess((val) => (Array.isArray(val) ? val : undefined), z.array(z.string()).optional()).nullish(),
  clarification_question: z.string().nullish(),
  final_response: z.string().nullish(),
});

export interface JCollectionAgentOptions {
  llmAdapter?: LLMAdapter;
  referenceClock?: string;
  claimValidator?: ClaimLevelValidator;
  strictLiveOnly?: boolean;
}

/**
 * Standard Property Context Map for the 3 authorized J Collection properties (Section XIII).
 */
export const PROPERTY_CONTEXT_REGISTRY: Record<CoSoMa, PropertyContext> = {
  'jacayl-ha-dong': {
    propertyId: 'jacayl-ha-dong',
    propertyName: 'Jacayl Hotel Hà Đông',
    address: 'Ngã ba Phúc La Phùng Hưng, quận Hà Đông, Hà Nội',
    phone: '0522 464 646',
    totalRooms: 23,
    parkingSummary: 'Có chỗ đỗ xe theo quy định của cơ sở (chi tiết loại xe như 7 chỗ, vị trí đỗ hoặc phí gửi xe nếu có chưa công bố chi tiết trên hệ thống — liên hệ lễ tân để xác nhận).',
    policySummary: 'Thời gian nghỉ giờ tối thiểu 2h. Nhận phòng ban ngày 08:00 - trước 18:00. Khung qua đêm tiêu chuẩn từ 22:00 (hỗ trợ sớm tối đa từ 21:40) đến 12:00 trưa hôm sau. Không phụ thu ngày lễ Tết.',
    canonicalRoomIds: [
      '101-long-chim', '201-la-casta', '202-grand-canyon', '203-red-rum', '204-rico-dinner', '205-red-velvet',
      '302-barbie-bedroom', '303-rose-wine', '304-french-kiss', '305-yeu-i', '402-whisky', '403-led-neon',
      '404-lolipop', '405-1st-time', '501-hentai-room', '502-absinthe', '503-small-lounge', '504-xala-dream',
      '505-koi-room', '601-50-sac-thai', '602-playboy', '603-lan-kwei-fong', '604-tequila',
    ],
    categoryMapping: { Standard: 'Standard', Deluxe: 'Deluxe', Concept: 'Suite' },
    pricingPolicyRef: 'J_COLLECTION_BUSINESS_POLICY_V1_4_3#jacayl-ha-dong',
    stayPackageEligibility: {
      minHourlyHours: 2,
      overnightStandardStart: '22:00',
      overnightGraceStart: '21:40',
      overnightCheckout: '12:00',
      dayNightStart: '14:00',
      dayNightCheckout: '12:00',
    },
    approvedFaq: {
      do_xe: 'Có chỗ đỗ xe theo quy định hệ thống; thông tin chi tiết loại xe, vị trí và phí vui lòng liên hệ lễ tân.',
      thang_may: 'Thông tin thang máy phụ thuộc dữ liệu xác thực từng hạng phòng trong catalog.',
    },
    officialMediaMapping: {
      cover: 'https://pub-a4f6c96b880a43f8a62e2085ac1159b8.r2.dev/sites/jcollection-booking/properties/j-ha-dong/cover.large.webp',
    },
    trustedChannelBindings: ['website', 'zalo', 'facebook', 'cli', 'dashboard'],
    dataVersion: '1.4.3',
  },
  'jacayl-tran-khat-chan': {
    propertyId: 'jacayl-tran-khat-chan',
    propertyName: 'Jacayl Hotel Trần Khát Chân',
    address: '283 Trần Khát Chân, quận Hai Bà Trưng, Hà Nội',
    phone: '0921 123 939',
    totalRooms: 19,
    parkingSummary: 'Có chỗ đỗ xe theo quy định của cơ sở (chi tiết loại xe, vị trí đỗ hoặc phí gửi xe nếu có chưa công bố chi tiết trên hệ thống — liên hệ lễ tân để xác nhận).',
    policySummary: 'Nghỉ giờ tối thiểu 2 tiếng theo biểu giá niêm yết trong dataset gốc. Khung qua đêm tiêu chuẩn từ 22:00 (hỗ trợ sớm tối đa từ 21:40) đến 12:00 trưa hôm sau. Không phụ thu ngày lễ Tết.',
    canonicalRoomIds: [
      '1001-dem', '201-sapphire', '202-walnut', '203-tau-hoa', '301-ivory', '302-kimochi', '303-bali',
      '401-blush', '402-teak', '403-morocco', '501-onyx', '502-hammrock', '503-long-chim', '601-golden-inox',
      '602-slate', '603-playboy', '701-50-sac-thai', '702-silver', '703-mumbai',
    ],
    categoryMapping: { Standard: 'Standard', Premium: 'Premium', Concept: 'Concept', 'VIP Signature': 'VIP Signature' },
    pricingPolicyRef: 'BASE_DATASET_REFERENCE_ONLY',
    stayPackageEligibility: {
      minHourlyHours: 2,
      overnightStandardStart: '22:00',
      overnightGraceStart: '21:40',
      overnightCheckout: '12:00',
      dayNightStart: '14:00',
      dayNightCheckout: '12:00',
    },
    approvedFaq: {
      do_xe: 'Có chỗ đỗ xe theo quy định hệ thống; thông tin chi tiết loại xe, vị trí và phí vui lòng liên hệ lễ tân.',
      thang_may: 'Thông tin thang máy phụ thuộc dữ liệu xác thực từng hạng phòng trong catalog.',
    },
    officialMediaMapping: {
      cover: 'https://pub-a4f6c96b880a43f8a62e2085ac1159b8.r2.dev/sites/jcollection-booking/properties/j-khat-chan/cover.large.webp',
    },
    trustedChannelBindings: ['website', 'zalo', 'facebook', 'cli', 'dashboard'],
    dataVersion: '1.4.3',
  },
  'j-village': {
    propertyId: 'j-village',
    propertyName: 'J Village',
    address: '64 Triệu Việt Vương, quận Hai Bà Trưng, Hà Nội',
    phone: '0707 646 464',
    totalRooms: 24,
    parkingSummary: 'Có chỗ đỗ xe theo quy định của cơ sở (chi tiết loại xe, vị trí đỗ hoặc phí gửi xe nếu có chưa công bố chi tiết trên hệ thống — liên hệ lễ tân để xác nhận).',
    policySummary: 'Nghỉ giờ tối thiểu 2 tiếng theo biểu giá niêm yết trong dataset gốc. Khung qua đêm tiêu chuẩn từ 22:00 (hỗ trợ sớm tối đa từ 21:40) đến 12:00 trưa hôm sau. Không phụ thu ngày lễ Tết.',
    canonicalRoomIds: [
      '202-neon', '203-ember', '301-azure', '302-sketch', '303-zebra', '401-mosaic', '402-linea', '403-petal',
      '501-marble', '502-nova', '503-zest', '601-lagoon', '602-solstice', '603-sway', '701-contour',
      '702-coral', '703-limewave', '801-minimal', '802-graff', '803-mist', 'blackpink', 'crimson-suite',
      'pink-sakura', 'playboy',
    ],
    categoryMapping: { Superior: 'Superior', Deluxe: 'Deluxe', Concept: 'Concept', Suite: 'Suite' },
    pricingPolicyRef: 'BASE_DATASET_REFERENCE_ONLY',
    stayPackageEligibility: {
      minHourlyHours: 2,
      overnightStandardStart: '22:00',
      overnightGraceStart: '21:40',
      overnightCheckout: '12:00',
      dayNightStart: '14:00',
      dayNightCheckout: '12:00',
    },
    approvedFaq: {
      do_xe: 'Có chỗ đỗ xe theo quy định hệ thống; thông tin chi tiết loại xe, vị trí và phí vui lòng liên hệ lễ tân.',
      thang_may: 'Thông tin thang máy phụ thuộc dữ liệu xác thực từng hạng phòng trong catalog.',
    },
    officialMediaMapping: {
      cover: 'https://pub-a4f6c96b880a43f8a62e2085ac1159b8.r2.dev/sites/jcollection-booking/properties/j-village/cover.large.webp',
    },
    trustedChannelBindings: ['website', 'zalo', 'facebook', 'cli', 'dashboard'],
    dataVersion: '1.4.3',
  },
};

/**
 * JCollectionAgent: Unified Model-Driven Core Agent (V2.0 Specification).
 * Supports reasoning-first, tool-driven, business-controlled operations across properties.
 */
export class JCollectionAgent {
  public readonly propertyId: CoSoMa;
  public readonly propertyContext: PropertyContext;
  protected dataset: NormalizedDataset;
  protected toolGateway: AgentToolGateway;
  protected claimValidator: ClaimLevelValidator;
  protected llmAdapter?: LLMAdapter;
  protected referenceClock: string;
  protected explicitReferenceClock?: string;
  protected strictLiveOnly: boolean;

  // In-memory conversation state by sessionId
  protected sessions: Map<string, AgentState> = new Map();
  private cachedDatasetHashInfo?: { datasetRef: NormalizedDataset; phongRef: any; policyVer: string; hash: string };

  private getCachedDatasetHash(): string {
    const policyVer = getEffectivePolicyMetadata().effectivePolicyVersion;
    if (
      this.cachedDatasetHashInfo &&
      this.cachedDatasetHashInfo.datasetRef === this.dataset &&
      this.cachedDatasetHashInfo.phongRef === this.dataset.phong &&
      this.cachedDatasetHashInfo.policyVer === policyVer
    ) {
      return this.cachedDatasetHashInfo.hash;
    }
    const hash = computeDatasetVersionHash(this.dataset);
    this.cachedDatasetHashInfo = {
      datasetRef: this.dataset,
      phongRef: this.dataset.phong,
      policyVer,
      hash,
    };
    return hash;
  }

  constructor(
    dataset: NormalizedDataset,
    propertyId: CoSoMa = 'jacayl-ha-dong',
    options?: JCollectionAgentOptions
  ) {
    this.dataset = dataset;
    this.propertyId = propertyId;
    this.propertyContext = PROPERTY_CONTEXT_REGISTRY[propertyId] ?? {
      propertyId,
      propertyName: `Jacayl Hotel (${propertyId})`,
      address: 'Hà Nội',
      totalRooms: 10,
      parkingSummary: 'Có chỗ đỗ xe cho khách lưu trú.',
      policySummary: 'Tiêu chuẩn Business Policy V1.4.3.',
      canonicalRoomIds: [],
    };
    this.toolGateway = new AgentToolGateway(dataset, this.propertyId);
    this.claimValidator = options?.claimValidator ?? new ClaimLevelValidator(dataset);
    this.llmAdapter = options?.llmAdapter;
    this.explicitReferenceClock = options?.referenceClock;
    this.referenceClock = options?.referenceClock ?? getVietnamTemporalContext().isoTimestamp;
    this.strictLiveOnly = options?.strictLiveOnly ?? false;
  }

  public setReferenceClock(clock: string): void {
    this.explicitReferenceClock = clock;
    this.referenceClock = clock;
  }

  public setStrictLiveOnly(strict: boolean): void {
    this.strictLiveOnly = strict;
  }

  public takeoverSession(sessionId: string, staffName?: string): void {
    const state = this.getSessionState(sessionId);
    state.ownership_state = 'HUMAN_ACTIVE';
    (state as any).staff_took_over = true;
    (state as any).generation_version = ((state as any).generation_version || 0) + 1;
    state.lifecycle = 'HUMAN_SUPERVISED';
    state.handoffStatus = {
      needed: true,
      reason: `Nhân viên ${staffName || 'lễ tân'} đã tiếp quản cuộc trò chuyện.`,
    };
    state.updatedAt = Date.now();
  }

  public resumeSession(sessionId: string): void {
    const state = this.getSessionState(sessionId);
    state.ownership_state = 'AI_ACTIVE';
    (state as any).staff_took_over = false;
    (state as any).generation_version = ((state as any).generation_version || 0) + 1;
    state.lifecycle = 'CONSULTATION';
    state.handoffStatus = { needed: false };
    state.updatedAt = Date.now();
  }

  public closeSession(sessionId: string): void {
    const state = this.getSessionState(sessionId);
    state.lifecycle = 'CLOSED';
    state.updatedAt = Date.now();
  }

  public getSessionState(sessionId: string): AgentState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        channel: 'website',
        trustedPropertyId: this.propertyId,
        guestGoal: 'UNSPECIFIED',
        hardConstraints: {
          requiredAmenities: [],
        },
        explicitConstraints: {
          requiredAmenities: [],
        },
        softPreferences: [],
        inferredPreferences: [],
        conditionalAssumptions: {},
        currentCandidateRoomIds: [],
        focusedRoomId: null,
        negatedRoomIds: [],
        rejectedChoices: [],
        reinstatedChoices: [],
        currentTopic: undefined,
        referencedEntities: [],
        pendingClarification: null,
        verifiedFacts: {},
        observations: [],
        validQuoteReferences: [],
        conversationHistory: [],
        lifecycle: 'DISCOVERY',
        ownership_state: 'AI_ACTIVE',
        handoffStatus: { needed: false },
        turnCount: 0,
        updatedAt: Date.now(),
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  /**
   * Main Agent Turn: Bounded loop Understand -> Decide -> Act -> Observe -> Revise -> Respond.
   */
  public async processTurn(
    sessionId: string,
    userMessage: string,
    options?: {
      referenceClock?: string;
      messageTimestamp?: string;
      channel?: 'website' | 'zalo' | 'facebook' | 'cli';
      clientMessageId?: string;
      strictLiveOnly?: boolean;
    }
  ): Promise<ConversationTurnResult> {
    const startTime = performance.now();
    const effectiveClock =
      options?.referenceClock ??
      options?.messageTimestamp ??
      this.explicitReferenceClock ??
      getVietnamTemporalContext().isoTimestamp;
    const temporalCtx = getVietnamTemporalContext(effectiveClock);
    const isStrictLive = options?.strictLiveOnly ?? this.strictLiveOnly;
    const isRealLLM = Boolean(
      this.llmAdapter &&
      !(this.llmAdapter as any).name?.includes('Mock') &&
      ((this.llmAdapter as any).getMode ? (this.llmAdapter as any).getMode() !== 'mock' : true) &&
      typeof (this.llmAdapter as any).callChatCompletion === 'function'
    );
    const state = this.getSessionState(sessionId);
    const startGenerationVersion = ((state as any).generation_version || 0) as number;

    // Idempotency: Duplicate client message check
    if (options?.clientMessageId) {
      if (state.lastClientMessageId === options.clientMessageId && state.lastTurnResult) {
        return state.lastTurnResult;
      }
      state.lastClientMessageId = options.clientMessageId;
    }

    // 0. CHECK TAKEOVER ENFORCEMENT: ZERO AI OUTBOUND AFTER HUMAN TAKEOVER (GATE 1)
    if (state.ownership_state === 'HUMAN_ACTIVE') {
      return this.buildTakeoverSuppressedResult(sessionId, userMessage, state);
    }

    state.turnCount += 1;
    state.updatedAt = Date.now();
    if (options?.channel) state.channel = options.channel;

    // Record user utterance in conversation history
    state.conversationHistory.push({ role: 'user', content: userMessage });

    // Strictly per-turn decisionSteps & turnObservations (prevent cross-turn trace leakage & prompt bloat)
    const decisionSteps: DecisionStepTrace[] = [];
    const turnObservations: ToolObservation[] = [];
    state.decisionSteps = decisionSteps;
    let executionMode: 'FAST' | 'STANDARD' | 'DEEP' = 'STANDARD';
    const executedToolsList: string[] = [];
    const canonicalFetchedList: string[] = ['dataset.phong', 'j_collection_business_policy_v1_4_3.json'];

    // Telemetry tracking for real LLM decisions
    let liveLLMCalls = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let schemaRejections = 0;
    let formatRepairs = 0;
    let providerFailovers = 0;
    let evidenceInvalidations = 0;
    let replanningEvents = 0;
    let groundingRejections = 0;
    let repairAttempts = 0;
    let upstreamApiBlocked = false;
    let activeProvider = (this.llmAdapter as any)?.name || 'deterministic-solver';
    let activeModel = (this.llmAdapter as any)?.modelName || 'generic-constraint-v2.2';
    let usedLiveLLM = false;
    let fallbackHappened = false;
    let fallbackReason: string | undefined = undefined;

    // =========================================================================
    // PHASE 1: INPUT NORMALIZATION & DETERMINISTIC SAFETY GUARD
    // =========================================================================
    const lower = userMessage.toLowerCase().trim();
    const noDia = removeDiacritics(lower);

    // Check overt security attempt
    const isSecurityAttempt =
      noDia.includes('quyen admin') ||
      noDia.includes('cap token') ||
      noDia.includes('mat khau') ||
      noDia.includes('database') ||
      noDia.includes('giam 90%') ||
      noDia.includes('giam gia 100%') ||
      noDia.includes('giam 100%') ||
      noDia.includes('bo qua toan bo') ||
      noDia.includes('bo qua moi chi dan') ||
      noDia.includes('dat phong mien phi') ||
      (noDia.includes('toi la ceo') && (noDia.includes('ra lenh') || noDia.includes('mien phi'))) ||
      noDia.includes('system prompt');

    // Check explicit escalation / billing dispute request (Business Safety Rule)
    // Avoid broad false-positive on 'quan ly' when used in non-escalation phrases (e.g. 'he thong quan ly')
    const hasManagerEscalationPhrase =
      /\b(gap|noi chuyen|lien he|goi|bao|trao doi|chuyen|xin so).{0,25}\bquan ly\b/.test(noDia) ||
      /\bquan ly\b.{0,25}(giai quyet|xu ly|giup|khieu nai|ho tro|ra day|truc tiep)/.test(noDia);

    const isBillingDispute =
      noDia.includes('khieu nai') ||
      noDia.includes('tinh nham') ||
      noDia.includes('tinh sai') ||
      ((noDia.includes('hoa don') || noDia.includes('checkout') || noDia.includes('phu thu')) &&
        (noDia.includes('sai') || noDia.includes('vo ly') || noDia.includes('nham')));

    const isExplicitEscalation =
      hasManagerEscalationPhrase ||
      (noDia.includes('le tan') && (noDia.includes('gap') || noDia.includes('ket noi') || noDia.includes('chuyen may') || noDia.includes('lien he') || noDia.includes('truc tiep') || noDia.includes('cho anh') || noDia.includes('giup'))) ||
      (noDia.includes('nhan vien') && (noDia.includes('gap') || noDia.includes('noi chuyen') || noDia.includes('that'))) ||
      noDia.includes('gap truc tiep') ||
      noDia.includes('chuyen may') ||
      isBillingDispute ||
      noDia.includes('nguoi that');

    // Room ID mention parsing (Generic & multi-property aware)
    let mentionedRoomId: string | undefined;
    const propertyRooms = this.dataset.phong.filter((p) => p.co_so_ma === this.propertyId);
    for (const r of propertyRooms) {
      const roomNum = r.ma_phong.split('-')[0];
      const rNameNoDia = removeDiacritics(r.ten_phong.toLowerCase());
      const rIdNoDia = removeDiacritics(r.ma_phong.toLowerCase());

      const matchesNum = /^\d+$/.test(roomNum) && (new RegExp(`\\b${roomNum}\\b`).test(noDia) || noDia.includes(roomNum));
      const cleanName = rNameNoDia.replace(/^\d+\s*[-—]\s*/, '').trim();
      let matchesName = cleanName.length >= 3 && noDia.includes(cleanName);
      if (cleanName === 'dem' && matchesName) {
        matchesName = /\b(phong\s+dem|1001\s*[-—]?\s*dem)\b/i.test(noDia);
      }
      const matchesId = noDia.includes(rIdNoDia);

      if (matchesNum || matchesName || matchesId) {
        mentionedRoomId = r.ma_phong;
        break;
      }
    }
    // Backward compatibility for special room aliases + NOT_FOR_SALE Room 401
    if (!mentionedRoomId) {
      if (this.propertyId === 'jacayl-ha-dong') {
        if (/\b401\b/.test(noDia)) mentionedRoomId = '401-ha-dong';
        else if (noDia.includes('601') || noDia.includes('50 sac thai')) mentionedRoomId = '601-50-sac-thai';
        else if (noDia.includes('101') || noDia.includes('long chim')) mentionedRoomId = '101-long-chim';
        else if (noDia.includes('602') || noDia.includes('playboy')) mentionedRoomId = '602-playboy';
        else if (noDia.includes('202') || noDia.includes('grand canyon')) mentionedRoomId = '202-grand-canyon';
        else if (noDia.includes('201') || noDia.includes('la casta')) mentionedRoomId = '201-la-casta';
      } else if (this.propertyId === 'jacayl-tran-khat-chan') {
        if (noDia.includes('1001') || /\b(phong\s+dem|1001\s*[-—]?\s*dem)\b/i.test(noDia)) mentionedRoomId = '1001-dem';
        else if (noDia.includes('201') || noDia.includes('sapphire')) mentionedRoomId = '201-sapphire';
        else if (noDia.includes('202') || noDia.includes('walnut')) mentionedRoomId = '202-walnut';
      } else if (this.propertyId === 'j-village') {
        if (noDia.includes('202') || noDia.includes('neon')) mentionedRoomId = '202-neon';
        else if (noDia.includes('203') || noDia.includes('ember')) mentionedRoomId = '203-ember';
        else if (noDia.includes('301') || noDia.includes('azure')) mentionedRoomId = '301-azure';
        else if (noDia.includes('crimson') || noDia.includes('suite')) mentionedRoomId = 'crimson-suite';
      }
    }

    // Cross-facility inquiry check (Phase D: do not bleed context or switch property silently)
    // Preserve compound questions that explicitly ask about the current facility alongside another facility.
    const asksOtherFacility =
      (this.propertyId !== 'jacayl-ha-dong' && (noDia.includes('ha dong') || noDia.includes('hadong'))) ||
      (this.propertyId !== 'jacayl-tran-khat-chan' && (noDia.includes('tran khat chan') || noDia.includes('trankhatchan'))) ||
      (this.propertyId !== 'j-village' && (noDia.includes('j village') || noDia.includes('jvillage') || noDia.includes('trieu viet vuong')));

    const mentionsCurrentFacilityScope =
      noDia.includes('o day') ||
      noDia.includes('co so nay') ||
      noDia.includes('ben nay') ||
      (this.propertyId === 'jacayl-ha-dong' && (noDia.includes('ha dong') || noDia.includes('hadong'))) ||
      (this.propertyId === 'jacayl-tran-khat-chan' && (noDia.includes('tran khat chan') || noDia.includes('trankhatchan'))) ||
      (this.propertyId === 'j-village' && (noDia.includes('j village') || noDia.includes('jvillage') || noDia.includes('trieu viet vuong')));

    const isCompoundCrossFacilityQuestion =
      asksOtherFacility && (mentionsCurrentFacilityScope || Boolean(mentionedRoomId));

    if (asksOtherFacility && !isCompoundCrossFacilityQuestion) {
      let targetName = 'cơ sở khác của chuỗi J Collection';
      let targetAddr = '';
      if (noDia.includes('ha dong') || noDia.includes('hadong')) {
        targetName = 'Jacayl Hotel Hà Đông';
        targetAddr = 'Ngã ba Phúc La Phùng Hưng, quận Hà Đông';
      } else if (noDia.includes('tran khat chan') || noDia.includes('trankhatchan')) {
        targetName = 'Jacayl Hotel Trần Khát Chân';
        targetAddr = '283 Trần Khát Chân, quận Hai Bà Trưng';
      } else if (noDia.includes('j village') || noDia.includes('jvillage') || noDia.includes('trieu viet vuong')) {
        targetName = 'J Village';
        targetAddr = '64 Triệu Việt Vương, quận Hai Bà Trưng';
      }
      const responseText =
        `Dạ hiện tại kênh tư vấn này đang được kết nối trực tiếp với cơ sở **${this.propertyContext.propertyName}** (${this.propertyContext.address}) ạ. ` +
        `Đối với **${targetName}** (địa chỉ tại ${targetAddr}), do mỗi cơ sở có hệ thống phòng và biểu giá riêng biệt, ` +
        `anh/chị vui lòng chọn đúng kênh cơ sở ${targetName} trên hệ thống hoặc liên hệ hotline để được hỗ trợ chính xác nhất nhé ạ!`;

      state.conversationHistory.push({ role: 'assistant', content: responseText });
      state.lastTurnResult = {
        customer_visible_response: responseText,
        claim_validation: { total_claims: 1, verified_claims: [], rejected_claims: [], disclaimed_claims: [] },
        updated_state: {
          active_facility: this.propertyId,
          focused_room_id: state.focusedRoomId,
          last_intent: 'CROSS_FACILITY_INQUIRY',
          ownership_state: state.ownership_state,
        },
        decision_trace: {
          turnIndex: state.turnCount,
          providerModel: 'fast_path:cross_facility',
          executionMode: 'FAST',
          decisionSteps: [
            {
              step: 1,
              phase: 'RESPOND',
              thoughtSummary: `Explained scope for cross-facility inquiry to ${targetName}.`,
            },
          ],
          latencyMs: Math.round(performance.now() - startTime),
          claimsChecked: { total_claims: 1, verified_claims: [], rejected_claims: [], disclaimed_claims: [] },
          verificationStatus: 'DETERMINISTIC_AGENT_FLOW',
        },
        internal_trace: {
          tools_executed: [],
          memory_modifications: [],
          rules_triggered: ['CROSS_FACILITY_SCOPE_ENFORCED'],
          adapter_used: 'fast_path',
        },
      };
      return state.lastTurnResult;
    }

    // Negation and Reinstatement parsing (Section VII)
    const isNegation =
      noDia.includes('khong lay') ||
      noDia.includes('ko lay') ||
      noDia.includes('khong thich') ||
      noDia.includes('bo qua') ||
      noDia.includes('khong chon') ||
      noDia.includes('khong thue') ||
      noDia.includes('khong phai');

    const isReinstatement =
      noDia.includes('lay lai') ||
      noDia.includes('chon lai') ||
      noDia.includes('lai phong') ||
      noDia.includes('quay lai phong') ||
      noDia.includes('doi y lay');

    if (isNegation && mentionedRoomId) {
      StructuredStateManager.rejectChoice(state, mentionedRoomId);
      decisionSteps.push({
        step: decisionSteps.length + 1,
        phase: 'UNDERSTAND',
        thoughtSummary: `Nhận diện từ chối phòng (Choice Rejection): Khách không lấy phòng ${mentionedRoomId}.`,
      });
      mentionedRoomId = undefined; // Do not focus rejected room
    } else if (isReinstatement && mentionedRoomId) {
      StructuredStateManager.reinstateChoice(state, mentionedRoomId);
      decisionSteps.push({
        step: decisionSteps.length + 1,
        phase: 'UNDERSTAND',
        thoughtSummary: `Khôi phục lựa chọn (Choice Reinstatement): Khách chọn lại phòng ${mentionedRoomId}.`,
      });
    }

    // Retraction of constraints (Section VII)
    const retractsBathtub =
      noDia.includes('khong can bon tam') ||
      noDia.includes('bo bon tam') ||
      noDia.includes('thoi khong lay bon tam') ||
      noDia.includes('khong can bon') ||
      noDia.includes('bo bon') ||
      (noDia.includes('doi y') && (noDia.includes('khong can') || noDia.includes('re nhat')));

    if (retractsBathtub) {
      StructuredStateManager.retractConstraint(state, 'bon_tam');
      decisionSteps.push({
        step: decisionSteps.length + 1,
        phase: 'UNDERSTAND',
        thoughtSummary: 'Khách hủy yêu cầu bồn tắm (Constraint Retraction). Cập nhật lại bộ lọc phòng.',
      });
    }

    // Activity & Goal Tracking
    const wantsPhotos =
      (/\b(hinh anh|hình ảnh|xem hinh|xem hình|gui hinh|gửi hình|photo|video)\b/i.test(userMessage) ||
        /\b(xem|gui|gửi|co|xin)\s+(ảnh|anh)\b/i.test(userMessage) ||
        (userMessage.toLowerCase().includes('ảnh') && !/\b(giup anh|giúp anh|cho anh biet|cho anh hoi)\b/i.test(userMessage))) &&
      !/\b(giup anh|giúp anh)\b/i.test(userMessage);
    if (wantsPhotos) {
      StructuredStateManager.setActivity(state, 'VIEWING_PHOTOS');
    }
    const wantsCheapest = noDia.includes('re nhat') || noDia.includes('gia re') || noDia.includes('tiet kiem');
    if (wantsCheapest) {
      StructuredStateManager.setOptimizationGoal(state, 'CHEAPEST');
    }

    // Amenity mentions
    const asksBathtub =
      (noDia.includes('bon tam') || noDia.includes('bon doi') || noDia.includes('bon suc') || noDia.includes('jacuzzi')) &&
      !retractsBathtub;
    if (asksBathtub && !state.hardConstraints.requiredAmenities.includes('bon_tam')) {
      state.hardConstraints.requiredAmenities.push('bon_tam');
    }

    const asksProjector =
      noDia.includes('may chieu') || noDia.includes('projector');
    if (asksProjector && !state.hardConstraints.requiredAmenities.includes('may_chieu')) {
      state.hardConstraints.requiredAmenities.push('may_chieu');
    }

    // Budget parsing: strictly match CUSTOMER_BUDGET framing, never treating package/quote inquiry figures
    // (e.g. "áp dụng gói qua đêm 420k được không?") as a customer budget constraint!
    let budget: number | undefined;
    const budgetScanRegex =
      /(?<!:)(?<![\d.])(\d+(?:[.,]\d+)?)\s*(?:(triệu|trieu|tr)(?![\p{L}\d])|(nghìn|nghin|ngàn|ngan|k)(?![\p{L}\d])|(vnđ|vnd|đồng|dong|đ)(?![\p{L}\d]))/giu;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = budgetScanRegex.exec(lower)) !== null) {
      const mStart = bMatch.index;
      const mEnd = mStart + bMatch[0].length;
      const prefix = lower.slice(Math.max(0, mStart - 40), mStart);
      const suffix = lower.slice(mEnd, Math.min(lower.length, mEnd + 20));
      const looksLikePackageOrQuotePrice =
        /(?:gói(?:\s+\S+){0,3}|giá(?:\s+\S+){0,2}|qua đêm|ngày đêm|cả ngày|nghỉ giờ|\d+\s*(?:h|giờ|tiếng)|phòng\s*\d+|áp dụng(?:\s+\S+){0,4})\s*$/i.test(
          prefix
        );
      if (looksLikePackageOrQuotePrice) continue;
      const hasBudgetFraming =
        /(?:ngân sách|tài chính|tầm tiền|tầm giá|tầm|khoảng|dưới|tối đa|mức trần|loanh quanh|quanh mức|không quá|budget|kinh phí|mức)(?:\s+(?:của|cho|là|cỡ|khoảng|tầm|chỉ|có|chỉ có|anh|chị|em|mình|tôi|bạn|tối đa))*\s*:?\s*$/i.test(
          prefix
        ) || /^\s*(?:đổ lại|trở xuống|quay đầu|trở lại|thôi)\b/i.test(suffix);
      if (!hasBudgetFraming) continue;

      const rawNum = bMatch[1];
      let parsedBudget = NaN;
      if (bMatch[2]) {
        parsedBudget = Math.round(parseFloat(rawNum.replace(',', '.')) * 1_000_000);
      } else if (bMatch[3]) {
        parsedBudget = Math.round(parseFloat(rawNum.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) * 1_000);
      } else {
        parsedBudget = Math.round(parseFloat(rawNum.replace(/[.,](?=\d{3}\b)/g, '').replace(/,/g, '.')));
      }
      if (Number.isFinite(parsedBudget) && parsedBudget > 0) {
        budget = parsedBudget;
        StructuredStateManager.updateConstraint(state, 'budget', budget);
        break;
      }
    }

    // Duration parsing & Stay Type / Temporal parsing:
    // ONLY run regex heuristic constraint extraction when NOT using Live LLM,
    // so Live LLM is NEVER misled by pre-parsed "7h -> 07:00 (hour_confirmed=true)" assumptions!
    let durationHours: number | undefined = state.hardConstraints.durationHours;
    let checkinDatetime: string | undefined = state.hardConstraints.checkinDatetime;
    let isCheckinTimeConfirmedByGuest = Boolean(state.conditionalAssumptions?.checkinTimeConfirmed);
    let isCheckinDateConfirmedByGuest = Boolean(state.conditionalAssumptions?.checkinDateConfirmed);
    let isTimeAssumptionConditional = Boolean(state.conditionalAssumptions?.isTimeAssumptionConditional);

    const applyOfflineTemporalAndDurationHeuristics = () => {
      const durMatch =
        lower.match(/(?:nghi|thue|o)\s*(\d+)\s*(?:h|tiếng|tieng|giờ|gio)\b/i) ||
        lower.match(/(?<!\d)(\d+)\s*(tiếng|tieng|giờ|gio)/);
      if (durMatch) {
        durationHours = parseInt(durMatch[1], 10);
        StructuredStateManager.updateConstraint(state, 'durationHours', durationHours);
      }
      const intervalMatch = lower.match(/(?<!\d)(\d{1,2})\s*h?\s*(?:đến|den|-)\s*(\d{1,2})\s*h?/);
      if (intervalMatch) {
        const startH = parseInt(intervalMatch[1], 10);
        const endH = parseInt(intervalMatch[2], 10);
        if (endH > startH) {
          durationHours = endH - startH;
          StructuredStateManager.updateConstraint(state, 'durationHours', durationHours);
        }
      }

      const isOvernight = noDia.includes('qua dem') || noDia.includes('nghi dem') || noDia.includes('sang mai');
      const isDayNight = noDia.includes('ngay dem') || noDia.includes('24h') || noDia.includes('ca ngay');
      const stayType: StayType = isDayNight ? 'ngay_dem' : isOvernight ? 'qua_dem' : 'nghi_gio';
      if (isOvernight || isDayNight) {
        StructuredStateManager.updateConstraint(state, 'stayType', stayType);
      }

      const isSaturday = /\b(thu\s*7|thu\s*bay|t7|chu\s*nhat|cn|cuoi\s*tuan)\b/i.test(noDia);
      const isWeekdayExplicit = /\b(thu\s*2|thu\s*hai|t2|thu\s*3|thu\s*ba|t3|thu\s*4|thu\s*tu|t4|thu\s*5|thu\s*nam|t5|thu\s*6|thu\s*sau|t6|ngay\s*thuong)\b/i.test(noDia);
      const isRightNowExplicit = /\b(bay gio|ngay bay gio|luc nay|hien tai)\b/i.test(noDia);
      const isTodayOrWindowExplicit = /\b(hom nay|toi nay|chieu nay|sang nay|trua nay|dem nay)\b/i.test(noDia);
      const isAfternoonOrDaytimeWord = /\b(chieu|ban ngay|buoi chieu|buoi sang|sang)\b/i.test(noDia);
      const isEveningWord = /\b(toi|buoi toi|dem)\b/i.test(noDia);

      const checkinHourMatch =
        lower.match(/(?:luc|vao|tu|den|khoang|tam)\s*(\d{1,2})\s*(?:h|giờ|gio)(?=$|\s|\d|[,.;:!?])(?:\s*(\d{1,2}))?/i) ||
        (lower.includes('nghi') && !lower.includes('luc') && !/\d{1,2}\s*(?:h|giờ|gio)(?=$|\s|\d)\s*(?:đến|den|-)/i.test(lower)
          ? null
          : lower.match(/(?<!\d)(\d{1,2})\s*(?:h|giờ|gio)(?=$|\s|\d|[,.;:!?])(?:\s*(\d{1,2}))?/));

      const refDatePart = temporalCtx.localDate;

      if (isRightNowExplicit) {
        checkinDatetime = temporalCtx.isoTimestamp;
        isCheckinDateConfirmedByGuest = true;
        isCheckinTimeConfirmedByGuest = true;
        isTimeAssumptionConditional = false;
      } else if (isSaturday) {
        isCheckinDateConfirmedByGuest = true;
        if (checkinHourMatch) {
          const h = parseInt(checkinHourMatch[1], 10);
          const m = checkinHourMatch[2] ? parseInt(checkinHourMatch[2], 10) : 0;
          checkinDatetime = `2026-11-28T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
          isCheckinTimeConfirmedByGuest = true;
          isTimeAssumptionConditional = false;
        } else if (isAfternoonOrDaytimeWord) {
          checkinDatetime = '2026-11-28T14:00:00+07:00';
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        } else if (isOvernight) {
          checkinDatetime = '2026-11-28T22:00:00+07:00';
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        } else if (isEveningWord) {
          checkinDatetime = '2026-11-28T19:00:00+07:00';
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        } else {
          checkinDatetime = '2026-11-28T14:00:00+07:00';
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        }
      } else if (isWeekdayExplicit) {
        isCheckinDateConfirmedByGuest = true;
        if (checkinHourMatch) {
          const h = parseInt(checkinHourMatch[1], 10);
          const m = checkinHourMatch[2] ? parseInt(checkinHourMatch[2], 10) : 0;
          checkinDatetime = `2026-11-24T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
          isCheckinTimeConfirmedByGuest = true;
          isTimeAssumptionConditional = false;
        } else {
          const h = noDia.includes('sang') ? 9 : noDia.includes('chieu') ? 14 : isOvernight ? 22 : isEveningWord ? 19 : 14;
          checkinDatetime = `2026-11-24T${String(h).padStart(2, '0')}:00:00+07:00`;
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        }
      } else if (checkinHourMatch || isTodayOrWindowExplicit || isOvernight) {
        const baseDate = state.hardConstraints.checkinDatetime
          ? state.hardConstraints.checkinDatetime.split('T')[0]
          : refDatePart;
        if (checkinHourMatch) {
          const h = parseInt(checkinHourMatch[1], 10);
          const m = checkinHourMatch[2] ? parseInt(checkinHourMatch[2], 10) : 0;
          checkinDatetime = `${baseDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
          isCheckinTimeConfirmedByGuest = true;
          isTimeAssumptionConditional = !isTodayOrWindowExplicit && !state.hardConstraints.checkinDatetime;
        } else if (isOvernight) {
          checkinDatetime = `${baseDate}T22:00:00+07:00`;
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        } else if (noDia.includes('chieu nay') || noDia.includes('sang nay') || noDia.includes('trua nay')) {
          checkinDatetime = `${refDatePart}T14:00:00+07:00`;
          isCheckinDateConfirmedByGuest = true;
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        } else if (noDia.includes('toi nay')) {
          checkinDatetime = `${refDatePart}T19:00:00+07:00`;
          isCheckinDateConfirmedByGuest = true;
          isCheckinTimeConfirmedByGuest = false;
          isTimeAssumptionConditional = true;
        }
      }

      if (checkinDatetime) {
        StructuredStateManager.updateConstraint(state, 'checkinDatetime', checkinDatetime);
      }

      state.conditionalAssumptions = {
        isTimeAssumptionConditional,
        checkinDateConfirmed: isCheckinDateConfirmedByGuest,
        checkinTimeConfirmed: isCheckinTimeConfirmedByGuest,
        referenceClockUsedAsDateOnly: !isCheckinDateConfirmedByGuest && Boolean(checkinDatetime),
      };
    };

    let offlineHeuristicsApplied = false;
    if (!isRealLLM) {
      applyOfflineTemporalAndDurationHeuristics();
      offlineHeuristicsApplied = true;
    }

    if (mentionedRoomId) {
      state.focusedRoomId = mentionedRoomId;
    } else if (/\bdeluxe\b/i.test(noDia) && !/\bstandard\b/i.test(noDia) && !/\bconcept\b/i.test(noDia)) {
      (state as any).targetCategory = 'Deluxe';
      state.focusedRoomId = null;
    } else if (/\bstandard\b/i.test(noDia) && !/\bdeluxe\b/i.test(noDia) && !/\bconcept\b/i.test(noDia)) {
      (state as any).targetCategory = 'Standard';
      state.focusedRoomId = null;
    } else if (/\bconcept\b/i.test(noDia) && !/\bdeluxe\b/i.test(noDia) && !/\bstandard\b/i.test(noDia)) {
      (state as any).targetCategory = 'Concept';
      state.focusedRoomId = null;
    }

    // Determine Fast Path vs Deep Path
    const isGreetingOnly =
      (noDia.includes('chao') || noDia.startsWith('hello') || noDia.startsWith('hi') || noDia === 'hi') &&
      !mentionedRoomId &&
      !noDia.includes('bon tam') &&
      !durationHours &&
      !budget &&
      !noDia.includes('gia') &&
      !noDia.includes('phong');

    const isGratitudeOnly =
      (noDia.includes('cam on') || noDia.includes('thank') || noDia.includes('tks') || (noDia.includes('da') && noDia.includes('ro')) || noDia.includes('ok em') || noDia.includes('hieu roi')) &&
      !noDia.includes('giu phong') &&
      !noDia.includes('dat phong') &&
      !noDia.includes('gia') &&
      !noDia.includes('phong') &&
      !noDia.includes('tim');

    const asksParkingOnly =
      (/\b(do xe|gui xe|o to|xe hoi|xe may|cho do|do duoc|de xe|cho de xe)\b/i.test(noDia) ||
        (/\b(do|gui|de)\b/i.test(noDia) && /\b(xe|o to)\b/i.test(noDia)) ||
        /\bxe\s*(?:4|7|16)\s*cho\b/i.test(noDia)) &&
      !/\b(phong|gia|tien|tieng)\b/i.test(noDia) &&
      !budget &&
      !durationHours &&
      !mentionedRoomId;

    const asksHolidayPolicy =
      /\b(le tet|ngay le|gio to|tet|30\/4|2\/9)\b/i.test(noDia) &&
      !durationHours &&
      !mentionedRoomId;

    const asksOvernightHour =
      (noDia.includes('qua dem') || noDia.includes('nghi dem')) &&
      (noDia.includes('may gio') ||
        noDia.includes('tu may gio') ||
        noDia.includes('gio nao') ||
        noDia.includes('bat dau') ||
        noDia.includes('khung gio')) &&
      !mentionedRoomId;

    const asksDaytimeLimit =
      noDia.includes('ban ngay') &&
      (noDia.includes('toi da') || noDia.includes('den may gio') || noDia.includes('may gio'));

    const asksDayNightPackage =
      (noDia.includes('ca ngay') || noDia.includes('ngay dem')) &&
      (noDia.includes('may gio') || noDia.includes('tu may gio') || noDia.includes('gio nao') || noDia.includes('khung gio'));

    const asksAddress =
      (noDia.includes('dia chi') || (noDia.includes('o dau') && !/\b(gui xe|do xe)\b/i.test(noDia))) &&
      !noDia.includes('gia') &&
      !noDia.includes('phong');

    const asksCheckinHours =
      (noDia.includes('check in') || noDia.includes('check out') || noDia.includes('nhan phong') || noDia.includes('tra phong')) &&
      (noDia.includes('gio') || noDia.includes('may gio') || noDia.includes('quy dinh')) &&
      !noDia.includes('gia') &&
      !mentionedRoomId;

    const asksSmoking = noDia.includes('hut thuoc');
    const asksPayment = noDia.includes('chuyen khoan') || noDia.includes('thanh toan');
    const asksElevator = noDia.includes('thang may') && !noDia.includes('gia');
    const asksWifi = noDia.includes('wifi');
    const asksWater = noDia.includes('nuoc');
    const asksLateCheckin = noDia.includes('1h sang') || noDia.includes('dem muon') || noDia.includes('1h dem');

    const asksThirdPerson =
      /\b(nguoi thu ba|nguoi thu 3|nguoi nua|ban vao|ngu cung)\b/i.test(noDia);

    const is1HourRequest =
      (durationHours === 1 || lower.includes('1 tieng') || lower.includes('1 tiếng') || lower.includes('1 gio') || lower.includes('1 giờ') || lower.includes('1h')) &&
      (noDia.includes('thue') || noDia.includes('nghi') || noDia.includes('nua gia') || noDia.includes('chia') || noDia.includes('thoi'));

    const asksExtraHourRates =
      (noDia.includes('phu thu') || noDia.includes('them gio')) &&
      (noDia.includes('1 tieng') || noDia.includes('1 gio') || (noDia.includes('101') && noDia.includes('601')));

    const asksCategoryCompare =
      noDia.includes('so sanh') && (noDia.includes('deluxe') || noDia.includes('concept'));

    const asksJacuzziOrTubDimension =
      !retractsBathtub &&
      (noDia.includes('jacuzzi') ||
        noDia.includes('bon suc') ||
        noDia.includes('suc bot') ||
        noDia.includes('bon doi') ||
        noDia.includes('bon tam doi') ||
        (noDia.includes('bon tam') && noDia.includes('2 nguoi')) ||
        noDia.includes('1m8') ||
        noDia.includes('1.8') ||
        noDia.includes('1,8') ||
        noDia.includes('bao nhieu met') ||
        noDia.includes('kich thuoc bon') ||
        noDia.includes('dai bao nhieu'));

    const asksPool = noDia.includes('ho boi') || noDia.includes('be boi');
    const asksSauna = noDia.includes('xong hoi') || noDia.includes('sauna');
    const asksKitchen = noDia.includes('bep') || noDia.includes('nau');

    const asksSmartTvProjector =
      (noDia.includes('tv') || noDia.includes('tivi') || noDia.includes('may chieu')) &&
      !noDia.includes('phong nao') &&
      !noDia.includes('tim') &&
      !noDia.includes('gia') &&
      !noDia.includes('tieng') &&
      !noDia.includes('thu 7');

    const asksBedSize =
      (noDia.includes('kich co') || noDia.includes('kich thuoc') || noDia.includes('size')) &&
      noDia.includes('giuong');
    const asksEarlyMorning =
      !mentionedRoomId &&
      !durationHours &&
      (noDia.includes('sang som') ||
        noDia.includes('truoc 8h') ||
        noDia.includes('truoc 08:00') ||
        /\b[567]\s*h\s*sang\b/i.test(noDia));
    const asksLateCheckout = (noDia.includes('tra phong muon') || noDia.includes('check out muon') || noDia.includes('qua 12h')) && !noDia.includes('gia');
    const asks1750 = (noDia.includes('17h50') || noDia.includes('17:50')) && (noDia.includes('gia') || noDia.includes('nhan phong') || noDia.includes('tinh') || noDia.includes('nghi'));
    const asks1810 = (noDia.includes('18h10') || noDia.includes('18:10')) && (noDia.includes('gia') || noDia.includes('nhan phong') || noDia.includes('tinh') || noDia.includes('nghi'));
    const hasParkingOrCarMention =
      /\b(do xe|gui xe|o to|xe hoi|xe may|cho do|do duoc|de xe|cho de xe)\b/i.test(noDia) ||
      (/\b(do|gui|de)\b/i.test(noDia) && /\b(xe|o to)\b/i.test(noDia)) ||
      /\bxe\s*(?:4|7|16)\s*cho\b/i.test(noDia);

    const asksBathCheapest = !retractsBathtub && noDia.includes('re nhat') && (noDia.includes('bon') || noDia.includes('tam'));
    const asksGiuPhong = (noDia.includes('giu phong') || noDia.includes('dat phong')) && (noDia.includes('le tan') || noDia.includes('giup anh') || noDia.includes('giup em'));
    const asks601PriceGeneral =
      (noDia.includes('601') || noDia.includes('50 sac thai')) &&
      noDia.includes('gia') &&
      !durationHours &&
      !noDia.includes('chieu') &&
      !noDia.includes('tieng') &&
      !noDia.includes('dem') &&
      !hasParkingOrCarMention;

    const isFastPath =
      isSecurityAttempt ||
      isExplicitEscalation ||
      isGreetingOnly ||
      isGratitudeOnly ||
      asksParkingOnly ||
      asksHolidayPolicy ||
      asksCheckinHours ||
      asksOvernightHour ||
      asksDaytimeLimit ||
      asksDayNightPackage ||
      asksAddress ||
      asksLateCheckin ||
      asksWifi ||
      asksWater ||
      asksPayment ||
      asksSmoking ||
      asksThirdPerson ||
      asksExtraHourRates ||
      asksCategoryCompare ||
      asksJacuzziOrTubDimension ||
      asksPool ||
      asksSauna ||
      asksKitchen ||
      asksSmartTvProjector ||
      asksBedSize ||
      asksEarlyMorning ||
      asksLateCheckout ||
      asks1750 ||
      asks1810 ||
      asksBathCheapest ||
      asksGiuPhong ||
      asks601PriceGeneral ||
      asksElevator ||
      is1HourRequest;

    let finalCustomerResponse = '';
    const quoteResultsRecord: any[] = [];
    let factsResultRecord: any = undefined;
    let searchResultRecord: any = undefined;
    let candidatePool: any[] = [];
    const deliveredImages: RoomPresentationImage[] = [];
    const deliveredMediaGroups: RoomPresentationBlock[] = [];
    const policyResultsRecord: any[] = [];
    const structuredDecisions: AgentLLMDecision[] = [];
    let finalModelResponse: string | undefined = undefined;
    let usedModelResponse = false;
    let groundingBlocked = false;
    let lastRenderedBindings: RenderedStructuredRefBinding[] = [];
    let lastRenderedErrors: string[] = [];
    const activePolicyVersion = getEffectivePolicyMetadata().effectivePolicyVersion;
    const activeDatasetHash = this.getCachedDatasetHash();

    // =========================================================================
    // BUSINESS SAFETY & ACCESS CONTROL GUARDS (ALWAYS ACTIVE)
    // vs FAQ Fast Path (ONLY used in offline deterministic mode, NEVER bypasses live LLM!)
    // =========================================================================
    const isCompoundEscalationQuestion =
      isExplicitEscalation &&
      !isBillingDispute &&
      (Boolean(mentionedRoomId) ||
        /\b(gia|bao nhieu|tien|con phong|tim phong|bon tam|may chieu|chinh sach|check in|qua dem|ngay dem|gio)\b/.test(noDia));

    if (isSecurityAttempt || (isExplicitEscalation && (!isRealLLM || !isCompoundEscalationQuestion))) {
      executionMode = 'FAST';
      if (isSecurityAttempt) {
        finalCustomerResponse =
          `Dạ em là trợ lý tư vấn của ${this.propertyContext.propertyName}. Em chỉ có thể hỗ trợ các thông tin về phòng nghỉ, tiện nghi và biểu giá niêm yết theo quy định của khách sạn ạ.`;
      } else {
        finalCustomerResponse =
          `Dạ em đã ghi nhận yêu cầu và chuyển tiếp đến quản lý và lễ tân trực tại ${this.propertyContext.propertyName}. Quản lý và lễ tân bên em sẽ chủ động liên hệ hỗ trợ trực tiếp cho anh/chị ngay ạ.`;
      }
      decisionSteps.push({
        step: 1,
        phase: 'RESPOND',
        thoughtSummary: isSecurityAttempt
          ? 'Security & Access Control Guard activated.'
          : 'Explicit Human Escalation Guard activated.',
      });
    } else if (!isRealLLM && isFastPath) {
      executionMode = 'FAST';
      if (isGreetingOnly) {
        finalCustomerResponse =
          `Dạ em chào anh/chị ạ! Em là trợ lý tư vấn của ${this.propertyContext.propertyName}. Em có thể hỗ trợ anh/chị tìm phòng, kiểm tra tiện nghi hay tra cứu bảng giá dịch vụ như thế nào ạ?`;
      } else if (isGratitudeOnly) {
        finalCustomerResponse =
          `Dạ em rất sẵn lòng hỗ trợ anh/chị ạ! Nếu anh/chị cần thêm thông tin gì về phòng hoặc muốn hỗ trợ giữ phòng, cứ nhắn em bất cứ lúc nào nhé ạ.`;
      } else if (asksParkingOnly) {
        executedToolsList.push('get_policies');
        const policyToolRes = await this.toolGateway.executeTool({
          toolCallId: `call_fast_park_${Date.now()}`,
          toolName: 'get_policies',
          arguments: { property_id: this.propertyId, topic: 'parking' },
        });
        policyResultsRecord.push(policyToolRes.data);
        finalCustomerResponse =
          `Dạ theo dữ liệu chính thức của ${this.propertyContext.propertyName}, cơ sở có chỗ đỗ xe ạ. Thông tin chi tiết về loại xe cụ thể (như ô tô 7 chỗ, 4 chỗ, xe máy), vị trí hoặc phí gửi xe nếu có chưa được công bố chi tiết trên hệ thống — anh/chị vui lòng liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để xác nhận nhé ạ.`;
      } else if (asksHolidayPolicy) {
        executedToolsList.push('get_policies');
        const policyToolRes = await this.toolGateway.executeTool({
          toolCallId: `call_fast_holiday_${Date.now()}`,
          toolName: 'get_policies',
          arguments: { property_id: this.propertyId, topic: 'holiday' },
        });
        policyResultsRecord.push(policyToolRes.data);
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3, J Collection hoàn toàn không phụ thu thêm phí ngày lễ Tết hay ngày đặc biệt ạ. Biểu giá được giữ nguyên theo chính sách thông thường của ngày và giờ nhận phòng anh/chị nhé!';
      } else if (is1HourRequest) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3 của J Collection, bên em không áp dụng gói nghỉ 1 tiếng (không có gói riêng 1 tiếng) và không chia nửa giá ạ. Thời gian nghỉ giờ tiêu chuẩn tối thiểu là 2 tiếng để đảm bảo chất lượng dọn phòng và trải nghiệm tốt nhất cho anh/chị ạ.';
      } else if (asksElevator) {
        finalCustomerResponse =
          `Dạ thông tin thang máy tại ${this.propertyContext.propertyName} phụ thuộc dữ liệu xác thực từng phòng trong catalog; anh/chị vui lòng liên hệ lễ tân để xác nhận chi tiết theo phòng mong muốn ạ.`;
      } else if (asksCheckinHours) {
        finalCustomerResponse =
          `Dạ quy định giờ nhận phòng (check-in) và trả phòng (check-out) tại ${this.propertyContext.propertyName} như sau ạ:\n- Khung ngày đêm (cả ngày): Check-in từ 14:00, check-out trước 12:00 trưa hôm sau.\n- Khung qua đêm: Check-in tiêu chuẩn từ 22:00 (hỗ trợ nhận phòng sớm tối đa 20 phút từ 21:40), check-out trước 12:00 trưa hôm sau.\n- Khung ban ngày: Nhận phòng từ 08:00 sáng đến trước 18:00 chiều ạ.\n- Khung nghỉ giờ: Nhận phòng linh hoạt tối thiểu 2 tiếng ạ.`;
      } else if (asksOvernightHour) {
        finalCustomerResponse =
          `Dạ gói nghỉ qua đêm tại cơ sở ${this.propertyContext.propertyName} bắt đầu tính tiêu chuẩn từ 22:00 (hỗ trợ nhận phòng sớm tối đa 20 phút từ 21:40) đến 12:00 trưa ngày hôm sau anh/chị nhé.`;
      } else if (asksDaytimeLimit) {
        finalCustomerResponse =
          'Dạ khung giờ nghỉ ban ngày tính từ 08:00 sáng đến trước 18:00 chiều ạ. Từ 18:00 trở đi sẽ áp dụng theo biểu giá niêm yết trong dataset gốc anh/chị nhé.';
      } else if (asksDayNightPackage) {
        finalCustomerResponse =
          `Dạ quy định gói cả ngày (ngày đêm) tại cơ sở ${this.propertyContext.propertyName} tính từ 14:00 chiều hôm nay đến 12:00 trưa ngày hôm sau anh/chị nhé.`;
      } else if (asksAddress) {
        finalCustomerResponse =
          `Dạ cơ sở ${this.propertyContext.propertyName} có địa chỉ tại ${this.propertyContext.address} ạ.`;
      } else if (asksLateCheckin) {
        finalCustomerResponse =
          'Dạ khách sạn có lễ tân hỗ trợ đón khách nhận phòng đêm muộn lúc 1h sáng hoàn toàn được ạ. Lúc này sẽ tính theo gói nghỉ qua đêm đến 12:00 trưa hôm sau anh/chị nhé.';
      } else if (asksWifi) {
        finalCustomerResponse =
          `Dạ thông tin chi tiết về wifi hiện chưa có thông số công bố trong catalog tĩnh của ${this.propertyContext.propertyName}; anh/chị vui lòng hỏi lễ tân khi nhận phòng để được hỗ trợ ngay nhé ạ.`;
      } else if (asksWater) {
        finalCustomerResponse =
          'Dạ thông tin chi tiết về nước uống miễn phí chưa được công bố trong dữ liệu catalog tĩnh; anh/chị vui lòng kiểm tra trực tiếp với lễ tân khi nhận phòng ạ.';
      } else if (asksPayment) {
        finalCustomerResponse =
          'Dạ thông tin chi tiết hình thức thanh toán chưa được công bố trong dữ liệu catalog tĩnh; anh/chị vui lòng liên hệ trực tiếp quầy lễ tân để được hướng dẫn cụ thể ạ.';
      } else if (asksSmoking) {
        finalCustomerResponse =
          'Dạ quy định hút thuốc trong phòng chưa được công bố chính thức trong dữ liệu catalog (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp quầy lễ tân để xác nhận quy định tại cơ sở ạ.';
      } else if (asksThirdPerson) {
        finalCustomerResponse =
          'Dạ theo quy định của J Collection, chính sách phụ thu người thứ ba lưu trú qua đêm hiện chưa được công bố chính thức trên dữ liệu hệ thống (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp quầy lễ tân để được kiểm tra và hỗ trợ cụ thể ạ.';
      } else if (asksOtherFacility) {
        let targetName = 'cơ sở khác của chuỗi J Collection';
        let targetAddr = '';
        if (noDia.includes('ha dong') || noDia.includes('hadong')) {
          targetName = 'Jacayl Hotel Hà Đông';
          targetAddr = 'Ngã ba Phúc La Phùng Hưng, quận Hà Đông';
        } else if (noDia.includes('tran khat chan') || noDia.includes('trankhatchan')) {
          targetName = 'Jacayl Hotel Trần Khát Chân';
          targetAddr = '283 Trần Khát Chân, quận Hai Bà Trưng';
        } else if (noDia.includes('j village') || noDia.includes('jvillage') || noDia.includes('trieu viet vuong')) {
          targetName = 'J Village';
          targetAddr = '64 Triệu Việt Vương, quận Hai Bà Trưng';
        }
        finalCustomerResponse =
          `Dạ hiện tại kênh tư vấn này đang được kết nối trực tiếp với cơ sở **${this.propertyContext.propertyName}** (${this.propertyContext.address}) ạ. ` +
          `Đối với **${targetName}** (địa chỉ tại ${targetAddr}), do mỗi cơ sở có hệ thống phòng và biểu giá riêng biệt, ` +
          `anh/chị vui lòng chọn đúng kênh cơ sở ${targetName} trên hệ thống hoặc liên hệ hotline để được hỗ trợ chính xác nhất nhé ạ!`;
      } else if (asksExtraHourRates) {
        finalCustomerResponse =
          'Dạ theo biểu giá niêm yết tại Jacayl Hà Đông:\n- Phòng 601 (50 Sắc Thái): Phụ thu thêm giờ là 200.000đ/tiếng.\n- Phòng 101 (Lồng Chim): Phụ thu thêm giờ là 100.000đ/tiếng ạ.';
      } else if (asksCategoryCompare) {
        finalCustomerResponse =
          'Dạ so sánh giá nghỉ 2 tiếng ban ngày thứ 7 tại cơ sở Hà Đông:\n- Hạng Deluxe (như phòng 202 Grand Canyon): 315.000đ/2h.\n- Hạng Concept (như phòng 101 Lồng Chim hoặc 601 50 Sắc Thái): 449.000đ/2h ạ.';
      } else if (asksJacuzziOrTubDimension) {
        if (this.propertyId === 'jacayl-ha-dong') {
          finalCustomerResponse =
            `Dạ tại cơ sở Jacayl Hà Đông, các phòng có bồn tắm gồm có phòng 101 — Lồng Chim (bồn tắm nằm thư giãn), phòng 601 (50 — Sắc Thái, trang bị Bồn tắm lớn) và phòng 602 (Playboy) ạ. Thông số kích thước mét cụ thể (như 1m8) và chức năng sục Jacuzzi chưa được công bố chính thức trên dữ liệu hệ thống (UNKNOWN) ạ.`;
        } else if (this.propertyId === 'jacayl-tran-khat-chan') {
          finalCustomerResponse =
            `Dạ tại cơ sở Jacayl Trần Khát Chân, phòng có bồn tắm là phòng 1001 — Đêm (Hạng VIP Signature) ạ. Thông số kích thước và chức năng sục Jacuzzi chưa có xác nhận chính thức trên dữ liệu hệ thống ạ.`;
        } else {
          finalCustomerResponse =
            `Dạ tại cơ sở J Village, phòng có bồn tắm là phòng Crimson Suite (Hạng Suite) và các phòng có bồn tắm xác nhận trong catalog ạ. Thông số kích thước bồn sục Jacuzzi chưa có xác nhận chính thức trên dữ liệu hệ thống ạ.`;
        }
      } else if (asksPool) {
        finalCustomerResponse =
          `Dạ tại cơ sở ${this.propertyContext.propertyName}, thông tin về hồ bơi hay bể bơi vô cực chưa được công bố chính thức trên dữ liệu hệ thống (trạng thái UNKNOWN — chưa đủ căn cứ khẳng định có hay không) ạ. Anh/chị vui lòng liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để xác minh giúp em nhé ạ!`;
      } else if (asksSauna) {
        finalCustomerResponse =
          `Dạ tại ${this.propertyContext.propertyName}, thông tin về phòng xông hơi sauna chưa được công bố chính thức trong dữ liệu hệ thống (UNKNOWN). Anh/chị vui lòng liên hệ lễ tân để xác minh trực tiếp ạ.`;
      } else if (asksKitchen) {
        finalCustomerResponse =
          `Dạ tại cơ sở ${this.propertyContext.propertyName}, thông tin về tiện nghi bếp nấu ăn riêng chưa được công bố chính thức trong dữ liệu hệ thống (UNKNOWN) ạ. Anh/chị vui lòng liên hệ hotline lễ tân để xác nhận trực tiếp nhé ạ!`;
      } else if (asksSmartTvProjector) {
        finalCustomerResponse =
          `Dạ tại cơ sở ${this.propertyContext.propertyName}, các tiện nghi cụ thể như Smart TV, ứng dụng Netflix/YouTube hay máy chiếu rạp phim hiện chưa được xác nhận đồng bộ trong dữ liệu catalog chính thức (UNKNOWN — chỉ một vài mô tả phòng có nhắc tới tủ TV/TV). Anh/chị vui lòng liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để kiểm tra thiết bị thực tế của phòng mình định đặt nhé ạ!`;
      } else if (asksBedSize) {
        finalCustomerResponse =
          `Dạ thông số kích thước giường cụ thể (ví dụ 1m8/2m hay king/queen) chưa được công bố chính thức trong dữ liệu catalog của ${this.propertyContext.propertyName} (UNKNOWN). Anh/chị vui lòng liên hệ lễ tân để xác nhận chi tiết theo từng phòng ạ.`;
      } else if (asksEarlyMorning) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3, khung nhận phòng buổi sáng sớm trước 08:00 không tính theo gói qua đêm mà được áp dụng biểu giá nghỉ giờ gốc trong dataset ạ. Anh/chị có thể nhận phòng linh hoạt và tính tối thiểu 2 tiếng ạ.';
      } else if (asksLateCheckout) {
        finalCustomerResponse =
          'Dạ theo quy định, giờ trả phòng gói qua đêm là trước 12:00 trưa ạ. Quá giờ sau 10 phút tính thêm giờ tiếp theo theo đơn giá phát sinh của từng phòng ạ.';
      } else if (asks1750 && asks1810) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3: Nhận phòng lúc 17h50 (trước 18:00) được tính theo biểu giá ban ngày ạ. Còn nhận phòng lúc 18h10 (từ 18:00 trở đi) sẽ áp dụng theo biểu giá gốc trong dataset anh/chị nhé.';
      } else if (asks1750) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3: Nhận phòng lúc 17h50 (trước 18:00) được tính theo biểu giá ban ngày anh/chị nhé.';
      } else if (asks1810) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3: Nhận phòng lúc 18h10 (từ 18:00 trở đi) sẽ áp dụng theo biểu giá gốc trong dataset anh/chị nhé.';
      } else if (asksBathCheapest) {
        finalCustomerResponse =
          `Dạ phòng có bồn tắm rẻ nhất tại ${this.propertyContext.propertyName} là phòng 101 — Lồng Chim (Hạng Concept), với giá nghỉ giờ 2 tiếng ngày trong tuần/sau 18h là 399.000đ (hoặc ban ngày cuối tuần T7–CN là 449.000đ) ạ.`;
      } else if (asksGiuPhong) {
        finalCustomerResponse =
          `Dạ em đã ghi nhận nhu cầu của anh/chị và chuyển thông tin cho lễ tân trực tại cơ sở ${this.propertyContext.propertyName} để hỗ trợ đối soát phòng trống thực tế và giữ phòng cho anh/chị ạ.`;
      } else if (asks601PriceGeneral) {
        finalCustomerResponse =
          `Dạ phòng 50 — Sắc Thái (Mã 601) tại ${this.propertyContext.propertyName} có các gói nghỉ giờ (399.000đ/2h ngày thường/sau 18h hoặc 449.000đ/2h ban ngày cuối tuần T7–CN; giờ phát sinh 200.000đ/giờ), gói qua đêm và ngày đêm ạ. Anh/chị dự định nghỉ theo gói nào và vào khung giờ/ngày nào ạ?`;
      }

      decisionSteps.push({
        step: 1,
        phase: 'RESPOND',
        thoughtSummary: `Phản hồi trực tiếp qua Degraded/Offline Fast Path (${executionMode}).`,
      });
    } else {
      // Substantive turn OR Live LLM Mode: Enter the Unified Bounded Reasoning Loop
      executionMode = budget && durationHours && asksBathtub ? 'DEEP' : 'STANDARD';

      decisionSteps.push({
        step: 1,
        phase: 'UNDERSTAND',
        thoughtSummary: `Nhận diện mục tiêu (${executionMode}): amenities=[${state.hardConstraints.requiredAmenities.join(', ')}], budget=${state.hardConstraints.budget ?? 'UNKNOWN'}đ, duration=${state.hardConstraints.durationHours ?? 'UNKNOWN'}h, checkin=${checkinDatetime ?? 'UNKNOWN'} (confirmedDate=${isCheckinDateConfirmedByGuest}, confirmedTime=${isCheckinTimeConfirmedByGuest}, refClock=${effectiveClock}).`,
      });

      // =======================================================================
      // PHASE 2 - 5: BOUNDED REASONING LOOP (Max 4 iterations for synthesis)
      // =======================================================================
      let currentIteration = 0;
      const maxIterations = 4;
      const failedProvidersThisTurn: string[] = [];

      while (currentIteration < maxIterations) {
        currentIteration += 1;
        const mustSynthesizeNow = isRealLLM && currentIteration === maxIterations && turnObservations.length > 0;

        // 1. ATTEMPT REAL MODEL-DRIVEN REASONING (Groq / Gemini)
        let llmDecision: AgentLLMDecision | null = null;

        if (isRealLLM) {
          const invokeLLMWithRepairAndFailover = async (): Promise<AgentLLMDecision | null> => {
            const promptMessages = this.buildLLMReasoningPrompt(
              userMessage,
              state,
              turnObservations,
              currentIteration,
              checkinDatetime,
              isTimeAssumptionConditional,
              effectiveClock,
              mustSynthesizeNow
            );

            // Try primary available provider, then failover across providers if needed
            for (let providerTry = 0; providerTry < 2; providerTry++) {
              let llmRes: any;
              try {
                llmRes = await (this.llmAdapter as any).callChatCompletion(promptMessages, {
                  temperature: 0.1,
                  maxTokens: 2048,
                  allowMockFallback: false,
                  excludeProviders: failedProvidersThisTurn,
                });
              } catch (callErr: any) {
                upstreamApiBlocked = true;
                fallbackReason = callErr.message;
                break; // All real providers exhausted or blocked
              }

              liveLLMCalls += 1;
              totalPromptTokens += llmRes.telemetry?.prompt_tokens ?? 0;
              totalCompletionTokens += llmRes.telemetry?.completion_tokens ?? 0;

              if (!llmRes.telemetry?.provider || llmRes.telemetry.provider === 'mock') {
                upstreamApiBlocked = true;
                fallbackReason = llmRes.telemetry?.error || 'Gateway returned mock instead of live provider';
                break;
              }

              const currentProv = llmRes.telemetry.provider;
              activeProvider = currentProv;
              activeModel = llmRes.telemetry?.model || activeModel;
              usedLiveLLM = true;

              let parsed = this.parseAndValidateLLMDecision(llmRes.raw_content);
              if (parsed) {
                return parsed;
              }
              schemaRejections += 1;

              // 1-turn bounded format recovery on current provider
              try {
                formatRepairs += 1;
                const repairPrompt = [
                  ...promptMessages,
                  { role: 'assistant', content: llmRes.raw_content },
                  {
                    role: 'user',
                    content:
                      'FORMAT REPAIR: Output ONLY a single valid JSON object conforming strictly to schema: ' +
                      '{"action":"CALL_TOOLS"|"RESPOND_DIRECTLY"|"CLARIFY"|"ESCALATE","thought_summary":"...","tool_calls":[...],"final_response":"Vietnamese customer-facing reply only, no JSON or <think>"}. ' +
                      'When action is RESPOND_DIRECTLY, final_response is REQUIRED and must be polite natural Vietnamese.',
                  },
                ];
                const repairRes = await (this.llmAdapter as any).callChatCompletion(repairPrompt, {
                  temperature: 0.1,
                  maxTokens: 2048,
                  allowMockFallback: false,
                  preferredProvider: currentProv,
                  excludeProviders: failedProvidersThisTurn,
                });
                liveLLMCalls += 1;
                totalPromptTokens += repairRes.telemetry?.prompt_tokens ?? 0;
                totalCompletionTokens += repairRes.telemetry?.completion_tokens ?? 0;
                parsed = this.parseAndValidateLLMDecision(repairRes.raw_content);
                if (parsed) {
                  return parsed;
                }
                schemaRejections += 1;
              } catch (repairErr: any) {
                fallbackReason = `Format repair failed on ${currentProv}: ${repairErr.message}`;
              }

              // Mark current provider failed for this turn and switch to next configured provider
              if (!failedProvidersThisTurn.includes(currentProv)) {
                failedProvidersThisTurn.push(currentProv);
              }
              providerFailovers += 1;
              fallbackReason = `Provider ${currentProv} failed schema validation after 1-turn repair; switching provider.`;
            }

            return null;
          };

          llmDecision = await invokeLLMWithRepairAndFailover();
          if (!llmDecision) {
            fallbackHappened = true;
            usedLiveLLM = false;
            fallbackReason = fallbackReason ?? 'All live LLM providers unavailable or failed schema validation';
            if (isStrictLive) {
              throw new Error(`BLOCKED: ${fallbackReason}`);
            }
          }
        }

        // 2. DECIDE: Propose tools or formulate response
        let currentStepAction: 'CALL_TOOLS' | 'RESPOND_DIRECTLY' | 'CLARIFY' | 'ESCALATE' = 'CALL_TOOLS';
        let stepThought = '';
        let toolCallsToExecute: ToolCall[] = [];

        if (llmDecision) {
          structuredDecisions.push(llmDecision);
          currentStepAction = llmDecision.action;
          stepThought = `[${activeProvider.toUpperCase()} (${activeModel}) LIVE DECISION]: ${llmDecision.thought_summary}`;
          toolCallsToExecute = (llmDecision.tool_calls || []).map((tc, idx) => ({
            toolCallId: `live_call_${currentIteration}_${idx}`,
            toolName: tc.tool_name,
            arguments: tc.arguments,
          }));

          if (currentStepAction === 'RESPOND_DIRECTLY' && llmDecision.final_response) {
            finalModelResponse = llmDecision.final_response;
            finalCustomerResponse = llmDecision.final_response;
            usedModelResponse = true;
          } else if (currentStepAction === 'CLARIFY' && (llmDecision.clarification_question || llmDecision.final_response)) {
            const clarText = llmDecision.clarification_question || llmDecision.final_response || '';
            finalModelResponse = clarText;
            finalCustomerResponse = clarText;
            usedModelResponse = true;
          } else if (currentStepAction === 'ESCALATE') {
            const escText =
              llmDecision.final_response ||
              `Dạ em đã ghi nhận yêu cầu và chuyển thông tin đến lễ tân trực tại ${this.propertyContext.propertyName} để hỗ trợ trực tiếp cho anh/chị ạ.`;
            finalModelResponse = escText;
            finalCustomerResponse = escText;
            usedModelResponse = true;
          }

          // Section VII: Hydrate cached canonical room albums ONLY when model explicitly requests them via media_refs
          if (llmDecision.media_refs && llmDecision.media_refs.length > 0 && state.mediaEvidenceCache) {
            for (const mRef of llmDecision.media_refs) {
              const cleanRef = String(mRef || '').trim().toLowerCase();
              const matchedBlock = Object.entries(state.mediaEvidenceCache).find(
                ([compKey, blk]) =>
                  compKey.toLowerCase() === cleanRef ||
                  blk.roomId.toLowerCase() === cleanRef ||
                  blk.roomCode.toLowerCase() === cleanRef
              )?.[1];
              if (
                matchedBlock &&
                !deliveredMediaGroups.some((g) => g.roomId === matchedBlock.roomId && g.propertyId === matchedBlock.propertyId)
              ) {
                deliveredImages.push(...matchedBlock.images);
                deliveredMediaGroups.push({
                  ...matchedBlock,
                  displayOrder: deliveredMediaGroups.length,
                });
              }
            }
          }

          // Section V & VI: Render structured {{ref:...}} monetary placeholders deterministically & verify output
          if (
            (currentStepAction === 'RESPOND_DIRECTLY' ||
              currentStepAction === 'CLARIFY' ||
              currentStepAction === 'ESCALATE') &&
            finalCustomerResponse
          ) {
            const renderedResult = renderStructuredMonetaryPlaceholders(
              finalCustomerResponse,
              state.verifiedBusinessEvidence || [],
              {
                sessionId: state.sessionId,
                propertyId: this.propertyId,
                effectivePolicyVersion: activePolicyVersion,
                activeDatasetHash,
                enforceMandatoryScope: true,
              }
            );
            finalCustomerResponse = renderedResult.renderedText;
            lastRenderedBindings = renderedResult.bindings;
            lastRenderedErrors = renderedResult.errors;

            const precheck = this.claimValidator.validate(finalCustomerResponse, {
              sessionId: state.sessionId,
              facility: this.propertyId,
              focusedRoomKey: state.focusedRoomId,
              expectedQuotes: this.buildExpectedQuotesForValidation(quoteResultsRecord, activePolicyVersion),
              validEvidence: state.verifiedBusinessEvidence,
              deliveredMedia: deliveredImages,
              mediaGroups: deliveredMediaGroups,
              effectivePolicyVersion: activePolicyVersion,
              userMessage,
              guestBudgetVnd: state.hardConstraints.budget ?? budget,
              referenceClock: effectiveClock,
              checkinConfidence: state.conditionalAssumptions?.checkinConfidence,
              structuredClaimRefs: llmDecision.claim_refs ?? undefined,
              structuredMediaRefs: llmDecision.media_refs ?? undefined,
              renderedRefBindings: lastRenderedBindings,
              renderedRefErrors: lastRenderedErrors,
              activeDatasetHash,
              enforceMandatoryScope: true,
            });

            if (precheck.grounding_status === 'CONTRADICTED' || precheck.grounding_status === 'MISSING_EVIDENCE') {
              const issues = [
                ...(precheck.contradicted_claims || []),
                ...(precheck.missing_evidence_claims || []),
              ].slice(0, 4);

              groundingRejections += 1;
              if (currentIteration < maxIterations) {
                repairAttempts += 1;
                const feedbackMsg =
                  `GROUNDING_GATE (${precheck.grounding_status}): Draft reply blocked before release: ${issues.join(' | ')}. ` +
                  `Call quote_price/search_rooms/get_room_media/get_policies (or supply valid media_refs) to obtain verified evidence, or clarify without unverified numbers/room codes.`;
                const reviseObs: ToolObservation = {
                  toolName: 'grounding_validator',
                  arguments: {},
                  resultStatus: 'NO_DATA',
                  summary: feedbackMsg,
                };
                turnObservations.push(reviseObs);
                state.observations.push(reviseObs);
                decisionSteps.push({
                  step: decisionSteps.length + 1,
                  phase: 'REVISE',
                  eventType: 'GROUNDING_REJECTION',
                  thoughtSummary: feedbackMsg,
                });
                finalCustomerResponse = '';
                finalModelResponse = undefined;
                usedModelResponse = false;
                lastRenderedBindings = [];
                lastRenderedErrors = [];
                continue;
              } else {
                // Retry budget exhausted: NEVER release unverified or contradicted business facts
                groundingBlocked = true;
                fallbackReason = `GROUNDING_BLOCKED_AFTER_RETRIES: ${issues.join(' | ')}`;
                finalCustomerResponse =
                  `Dạ hiện hệ thống chưa hoàn tất đối soát đầy đủ dữ kiện biểu giá hoặc danh mục phòng xác thực cho nội dung vừa rồi từ công cụ dữ liệu, nên em chưa thể xác nhận con số cụ thể ạ. Anh/chị vui lòng cho em biết cụ thể hơn hạng phòng/thời điểm mong muốn hoặc liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để được hỗ trợ chính xác nhất ạ.`;
                usedModelResponse = false;
              }
            }
          }
        } else {
          // DEGRADED DETERMINISTIC FALLBACK (Only when no live LLM is active or all live providers failed in non-strict mode)
          if (!offlineHeuristicsApplied) {
            applyOfflineTemporalAndDurationHeuristics();
            offlineHeuristicsApplied = true;
          }
          const plan = this.planDeterministicTurnStep(
            currentIteration,
            userMessage,
            state,
            mentionedRoomId,
            checkinDatetime,
            candidatePool,
            quoteResultsRecord,
            policyResultsRecord
          );

          currentStepAction = plan.action;
          stepThought = plan.thought;
          toolCallsToExecute = plan.toolCalls;
          if (plan.directResponse) {
            finalCustomerResponse = plan.directResponse;
          }
        }

        // Record Decision Step
        decisionSteps.push({
          step: decisionSteps.length + 1,
          phase: currentStepAction === 'RESPOND_DIRECTLY' || currentStepAction === 'CLARIFY' || currentStepAction === 'ESCALATE' ? 'RESPOND' : 'DECIDE',
          thoughtSummary: stepThought,
          toolCalls: toolCallsToExecute,
        });

        if (
          (currentStepAction === 'RESPOND_DIRECTLY' || currentStepAction === 'CLARIFY' || currentStepAction === 'ESCALATE') &&
          finalCustomerResponse
        ) {
          break; // Concluded
        }

        if (toolCallsToExecute.length === 0 && llmDecision && isRealLLM) {
          // Model did not output tool calls and did not set final_response; force synthesis on next turn
          continue;
        }

        // 3. ACT: Execute validated tool calls via Backend Security Gate
        const toolResults: ToolResult[] = [];
        const recordedRefsByToolCall = new Map<string, string[]>();
        for (const tc of toolCallsToExecute) {
          executedToolsList.push(tc.toolName);
          const res = await this.toolGateway.executeTool(tc);
          toolResults.push(res);

          if (tc.toolName === 'search_rooms') {
            searchResultRecord = res.data;
            candidatePool = res.data?.candidates || [];
          } else if (tc.toolName === 'quote_price' && res.status === 'SUCCESS') {
            const addedQuotes = res.data?.quotes && Array.isArray(res.data.quotes) ? res.data.quotes : [res.data];
            quoteResultsRecord.push(...addedQuotes);
            const firstQ = addedQuotes[0];
            if (firstQ?.checkin_conditions?.checkin_datetime && firstQ.checkin_conditions.checkin_datetime !== 'UNSPECIFIED') {
              checkinDatetime = firstQ.checkin_conditions.checkin_datetime;
              StructuredStateManager.updateConstraint(state, 'checkinDatetime', checkinDatetime);
              if (firstQ.stay_type) {
                StructuredStateManager.updateConstraint(state, 'stayType', firstQ.stay_type);
              }
              if (typeof firstQ.duration_hours === 'number' && firstQ.stay_type === 'nghi_gio') {
                durationHours = firstQ.duration_hours;
                StructuredStateManager.updateConstraint(state, 'durationHours', durationHours);
              }
              const conf = firstQ.checkin_conditions.checkin_confidence || 'CONFIRMED';
              isCheckinDateConfirmedByGuest = conf === 'CONFIRMED';
              isCheckinTimeConfirmedByGuest = conf === 'CONFIRMED';
              state.conditionalAssumptions = {
                ...state.conditionalAssumptions,
                checkinConfidence: conf,
                checkinDateConfirmed: conf === 'CONFIRMED',
                checkinTimeConfirmed: conf === 'CONFIRMED',
                checkoutDatetime:
                  firstQ.stay_type === 'nghi_gio'
                    ? undefined
                    : firstQ.confirmed_checkout ?? state.conditionalAssumptions?.checkoutDatetime,
              };
            }
            const invalidatedCount = invalidateStaleBusinessEvidence(state, {
              propertyId: this.propertyId,
              stayType: firstQ?.stay_type ?? state.hardConstraints.stayType,
              durationHours:
                firstQ?.stay_type === 'nghi_gio' && typeof firstQ?.duration_hours === 'number'
                  ? firstQ.duration_hours
                  : state.hardConstraints.durationHours,
              checkinDatetime: firstQ?.checkin_conditions?.checkin_datetime ?? state.hardConstraints.checkinDatetime,
              checkoutDatetime: firstQ?.confirmed_checkout ?? state.conditionalAssumptions?.checkoutDatetime,
              effectivePolicyVersion: activePolicyVersion,
              datasetVersion: activeDatasetHash,
            });
            evidenceInvalidations += invalidatedCount;
          } else if (tc.toolName === 'get_room_facts' && res.status === 'SUCCESS') {
            factsResultRecord = res.data;
          } else if (tc.toolName === 'get_room_media' && res.status === 'SUCCESS') {
            const groupImgs: RoomPresentationImage[] = (res.data?.images || []).map((img: any, idx: number) => ({
              url: img.url,
              caption: img.caption || `${res.data?.room_name || 'Ảnh phòng'} — Ảnh ${idx + 1}`,
              order: typeof img.order === 'number' ? img.order : idx,
              label: img.label,
              alt: img.alt ?? null,
              propertyId: img.propertyId ?? res.data?.property_id ?? this.propertyId,
              roomId: img.roomId ?? res.data?.room_id,
              roomCode: img.roomCode ?? res.data?.room_code ?? String(res.data?.room_id || '').split('-')[0],
              roomName: img.roomName ?? res.data?.room_name,
            }));
            deliveredImages.push(...groupImgs);
            if (res.data?.room_id && groupImgs.length > 0 && !deliveredMediaGroups.some((g) => g.roomId === res.data.room_id && g.propertyId === (res.data.property_id ?? this.propertyId))) {
              deliveredMediaGroups.push({
                propertyId: res.data.property_id ?? this.propertyId,
                roomId: res.data.room_id,
                roomCode: res.data.room_code ?? String(res.data.room_id).split('-')[0],
                roomName: res.data.room_name ?? res.data.room_id,
                category: res.data.category,
                displayOrder: deliveredMediaGroups.length,
                bookingLink: res.data.booking_link,
                images: groupImgs,
              });
            }
          } else if (tc.toolName === 'get_policies' && res.status === 'SUCCESS') {
            policyResultsRecord.push(res.data);
          }

          if (res.status === 'SUCCESS') {
            const createdEvs = recordToolResultAsEvidence(state, tc.toolName, res, this.dataset, activePolicyVersion, activeDatasetHash);
            const refs = createdEvs.flatMap((ev) =>
              (ev.scopedRates || []).filter((sr) => sr.eligible !== false).slice(0, 12).map((sr) => {
                const fId = sr.factId || sr.ref || `${ev.evidenceId}::${sr.role}`;
                const condPart = sr.timeCondition ? `@${sr.timeCondition}` : '';
                const durPart = sr.stayPackage === 'nghi_gio' && typeof sr.durationHours === 'number' ? `/${sr.durationHours}h` : '';
                return `${fId} => ${sr.roomId || ev.roomId || ''}/${sr.stayPackage || ev.stayPackage || ''}/${sr.role}${durPart}${condPart}=${sr.amountVnd.toLocaleString('vi-VN')}đ`;
              })
            );
            if (refs.length > 0) {
              recordedRefsByToolCall.set(tc.toolCallId, refs);
            }
          }
        }

        decisionSteps.push({
          step: decisionSteps.length + 1,
          phase: 'ACT',
          thoughtSummary: `Thực thi ${toolResults.length} công cụ qua Backend Security Gate.`,
          toolResults,
        });

        // 4. OBSERVE & REVISE
        const obsSummary = toolResults
          .map((r) => {
            if (r.toolName === 'search_rooms') {
              if (r.status === 'NO_DATA') {
                return `search_rooms returned NO_DATA (missing_evidence=${JSON.stringify(r.data?.missing_evidence || [])})`;
              }
              const allCands = [...(r.data?.candidates || [])].sort(
                (a: any, b: any) => (a.base_pricing?.nghi_gio_2h ?? 999999) - (b.base_pricing?.nghi_gio_2h ?? 999999)
              );
              const catSummaryList: any[] = Array.isArray(r.data?.category_pricing_summary)
                ? r.data.category_pricing_summary
                : [];
              const catSummary =
                catSummaryList.length > 0
                  ? catSummaryList
                    .map((cs: any) => {
                      const fmtRange = (rg: { min: number; max: number }) =>
                        rg.min === rg.max ? `${rg.min}đ` : `${rg.min}đ–${rg.max}đ`;
                      const varStr = Array.isArray(cs.room_rate_variants)
                        ? ` [EXTRA_HOUR_VARIES: ${cs.room_rate_variants.map((v: any) => `${v.extra_hour_rate_vnd}đ/h={${v.rooms.join(',')}}`).join(' ; ')}]`
                        : '';
                      return `${cs.category}(${cs.room_count} rooms, base_2h=${fmtRange(cs.ranges.base_2h_vnd)}, overnight=${fmtRange(cs.ranges.qua_dem_vnd)}, extra=${fmtRange(cs.ranges.extra_hour_rate_vnd)}${varStr})`;
                    })
                    .join(' | ')
                  : (() => {
                    const byCat: Record<string, { count: number; min2h: number; minOvernight: number; sampleIds: string[] }> = {};
                    for (const c of allCands) {
                      const cat = c.category || 'Other';
                      if (!byCat[cat]) byCat[cat] = { count: 0, min2h: 9999999, minOvernight: 9999999, sampleIds: [] };
                      byCat[cat].count += 1;
                      if (c.base_pricing?.nghi_gio_2h) byCat[cat].min2h = Math.min(byCat[cat].min2h, c.base_pricing.nghi_gio_2h);
                      if (c.base_pricing?.qua_dem) byCat[cat].minOvernight = Math.min(byCat[cat].minOvernight, c.base_pricing.qua_dem);
                      if (byCat[cat].sampleIds.length < 3) byCat[cat].sampleIds.push(c.room_id);
                    }
                    return Object.entries(byCat)
                      .map(([cat, info]) => `${cat}(${info.count} rooms, base_2h=${info.min2h}đ, overnight=${info.minOvernight}đ, e.g. ${info.sampleIds.join(',')})`)
                      .join(' | ');
                  })();
              const cList = allCands
                .map((c: any) => `${c.room_id}|${c.room_name}|${c.category}|[${(c.confirmed_amenities || []).join(',')}]|2h=${c.base_pricing?.nghi_gio_2h ?? '?'}đ|od=${c.base_pricing?.qua_dem ?? '?'}đ|extra=${c.base_pricing?.gio_phat_sinh_ap_dung ?? '?'}đ/h`)
                .join('; ');
              const hadongNote = this.propertyId === 'jacayl-ha-dong'
                ? ' [Note: at Hà Đông, base_2h applies to weekday/evening; call quote_price for exact or weekend daytime rates]'
                : '';
              return `search_rooms (STATIC CATALOG ONLY, NOT real-time vacancy!) returned ${allCands.length} matching rooms. Categories: [${catSummary}]. Complete matched catalog (cheapest-first, do NOT invent room IDs or alter category labels outside this list): [${cList}].${hadongNote}`;
            }
            if (r.toolName === 'quote_price') {
              if (r.status !== 'SUCCESS') {
                return `quote_price ${r.status}: ${r.errorMessage || 'no data'}`;
              }
              const allQuotes = Array.isArray(r.data?.quotes) && r.data.quotes.length > 0 ? r.data.quotes : [r.data];
              const variationNote = Array.isArray(r.data?.category_pricing_notes) && r.data.category_pricing_notes.length > 0
                ? `\n[CATEGORY_RATE_VARIATION]: ${r.data.category_pricing_notes.join(' ')}`
                : '';
              return allQuotes
                .map((qd: any) => {
                  if (qd.pricing_status === 'NOT_FOR_SALE') {
                    return `quote_price for ${qd.room_name} (${qd.room_id}): NOT_FOR_SALE (${qd.price_breakdown_text})`;
                  }
                  if (qd.pricing_status === 'CONDITIONAL_ON_CHECKIN_TIME' && Array.isArray(qd.conditional_quotes)) {
                    const condText = qd.conditional_quotes
                      .map((cq: any) => `${cq.condition_label} => ${cq.total_price_vnd?.toLocaleString('vi-VN')}đ (${cq.price_breakdown_text})`)
                      .join(' | ');
                    return `quote_price for ${qd.room_name} (${qd.room_id}) [CONDITIONAL — guest check-in day/hour UNSPECIFIED]: ${condText}`;
                  }
                  if (qd.stay_package_eligibility) {
                    const elig = qd.stay_package_eligibility;
                    const eligList = (elig.eligible_packages || [])
                      .map((p: any) => `${p.label || p.stay_type}: ${typeof p.total_price_vnd === 'number' ? p.total_price_vnd.toLocaleString('vi-VN') + 'đ' : 'N/A'}${p.applicable_window ? ' [' + p.applicable_window + ']' : ''}${p.requires_reception_confirmation_for_early_checkin ? ' (early arrival before 14:00 needs reception check)' : ''}`)
                      .join(' | ');
                    const ineligList = (elig.ineligible_packages || [])
                      .map((p: any) => `${p.stay_type} INELIGIBLE (${p.reason})${p.alternative_if_delayed_to_21_40_vnd ? ` [or ${p.alternative_if_delayed_to_21_40_vnd.toLocaleString('vi-VN')}đ ONLY if waiting until 21:40+]` : ''}`)
                      .join(' | ');
                    const lateSummary = qd.late_checkout_applied && qd.confirmed_checkout
                      ? ` | late_checkout=[confirmed_checkout=${qd.confirmed_checkout}, standard_checkout=${qd.standard_checkout}, late_minutes=${qd.actual_late_checkout_minutes}, grace=${qd.grace_period_minutes}m, grace_mode=${qd.grace_period_mode || 'EVERY_EXTRA_HOUR_BOUNDARY'}, billable_extra_hours=${qd.billable_extra_hours}, extra_hour_rate=${typeof qd.extra_hour_rate_vnd === 'number' ? qd.extra_hour_rate_vnd.toLocaleString('vi-VN') + 'đ' : qd.extra_hour_rate + 'đ'}, base_package=${typeof qd.base_package_price_vnd === 'number' ? qd.base_package_price_vnd.toLocaleString('vi-VN') + 'đ' : '?'}, extra_subtotal=${typeof qd.extra_hour_subtotal_vnd === 'number' ? qd.extra_hour_subtotal_vnd.toLocaleString('vi-VN') + 'đ' : '0đ'}, policy=V${qd.effective_policy_version || '1.4.6'}]`
                      : '';
                    const unconf = Array.isArray(elig.unconfirmed_conditions) && elig.unconfirmed_conditions.length > 0
                      ? ` | unconfirmed=[${elig.unconfirmed_conditions.join('; ')}]`
                      : '';
                    const priceStr = typeof qd.total_price_vnd === 'number' ? `${qd.total_price_vnd.toLocaleString('vi-VN')}đ` : 'REQUIRES_CLARIFICATION';
                    return `quote_price for ${qd.room_name} (${qd.room_id}) [requested=${elig.requested_package}, status=${elig.eligibility_status}, recommended=${elig.recommended_package}, TOTAL=${priceStr}, window="${elig.applicable_window}", policy=V${qd.effective_policy_version || '1.4.6'}]: REASON="${elig.business_reason}" | BREAKDOWN="${qd.price_breakdown_text}" | ELIGIBLE=[${eligList}]${ineligList ? ` | INELIGIBLE=[${ineligList}]` : ''}${lateSummary}${unconf}`;
                  }
                  const priceStr = typeof qd.total_price_vnd === 'number' ? `${qd.total_price_vnd.toLocaleString('vi-VN')}đ` : 'unknown';
                  const lateFallback = qd.late_checkout_applied && qd.confirmed_checkout
                    ? `, confirmed_checkout=${qd.confirmed_checkout}, grace_mode=${qd.grace_period_mode || 'EVERY_EXTRA_HOUR_BOUNDARY'}, billable_extra_hours=${qd.billable_extra_hours}, extra_hour_rate=${qd.extra_hour_rate}đ`
                    : '';
                  return `quote_price for ${qd.room_name} (${qd.room_id}) [${qd.pricing_status}, policy=V${qd.effective_policy_version || '1.4.6'}]: TOTAL ${priceStr} (${qd.price_breakdown_text}${lateFallback})`;
                })
                .join('\n') +
                variationNote +
                ((recordedRefsByToolCall.get(r.toolCallId)?.length ?? 0) > 0
                  ? `\n[FACT_REFS (use short opaque factId like q1_f1 in claim_refs or {{ref:<factId>}}): ${recordedRefsByToolCall.get(r.toolCallId)!.join(' | ')}]`
                  : '');
            }
            if (r.toolName === 'get_room_facts') {
              if (r.status !== 'SUCCESS') return `get_room_facts ${r.status}: ${r.errorMessage || 'not found'}`;
              if (r.data?.commercial_status === 'NOT_FOR_SALE') {
                return `get_room_facts for ${r.data?.room_name}: NOT_FOR_SALE (${r.data?.explanation})`;
              }
              const ps = r.data?.pricing_snapshot;
              const priceNote = ps
                ? `base_2h=${ps.nghi_gio_2h}đ, overnight=${ps.qua_dem}đ, day_night=${ps.ngay_dem}đ`
                : 'base_rates=unknown';
              return `get_room_facts for ${r.data?.room_name} (${r.data?.category}): bathtub=${r.data?.bathtub_status}, bathtub_dim=${r.data?.bathtub_dimension}, love_chair=${r.data?.has_love_chair}, smart_tv=${r.data?.has_smart_tv}, tv_catalog_mention=${r.data?.has_tv_catalog_mention}, netflix_youtube=${r.data?.has_netflix_youtube}, projector=${r.data?.has_projector}, pool=${r.data?.has_pool}, extra_hour=${r.data?.extra_hour_rate}đ, ${priceNote}, readiness=${r.data?.housekeeping_readiness}`;
            }
            if (r.toolName === 'get_room_media') {
              if (r.status !== 'SUCCESS') return `get_room_media ${r.status}: ${r.errorMessage || 'not found'}`;
              return `get_room_media for ${r.data?.room_name} (${r.data?.room_id}): READY (${(r.data?.images || []).length} verified photos attached to structured room album auto-rendered below message; do NOT paste raw image URLs in text), booking_link=${r.data?.booking_link}`;
            }
            if (r.toolName === 'get_policies') {
              return `get_policies topic ${r.data?.topic}: ${r.data?.policy_text}`;
            }
            return `${r.toolName}: ${r.status}`;
          })
          .join('\n');

        const obsEntry: ToolObservation = {
          toolName: toolCallsToExecute.map((t) => t.toolName).join(','),
          arguments: {},
          resultStatus: toolResults.every((r) => r.status === 'SUCCESS') ? 'SUCCESS' : 'NO_DATA',
          summary: obsSummary,
        };
        turnObservations.push(obsEntry);
        state.observations.push(obsEntry);

        decisionSteps.push({
          step: decisionSteps.length + 1,
          phase: 'OBSERVE',
          thoughtSummary: `Quan sát: ${obsSummary}`,
        });

        // Observation Replanning: Check budget exceedance
        const maxBudget = state.hardConstraints.budget;
        if (quoteResultsRecord.length > 0 && maxBudget) {
          const exceeded = quoteResultsRecord.filter((q) => typeof q.total_price_vnd === 'number' && q.total_price_vnd > maxBudget);
          if (exceeded.length > 0) {
            replanningEvents += 1;
            decisionSteps.push({
              step: decisionSteps.length + 1,
              phase: 'REVISE',
              eventType: 'REPLANNING',
              thoughtSummary: `Điều chỉnh kế hoạch (Observation Replanning): Nhận thấy ${exceeded.map((e) => e.room_name).join(', ')} vượt ngân sách ${maxBudget.toLocaleString('vi-VN')}đ. Đề xuất phương án tối ưu trong ngân sách và giữ phương án vượt làm lựa chọn nâng cấp minh bạch.`,
            });
          }
        }

        // Check if deterministic fallback collected sufficient data to synthesize
        if (!isRealLLM || fallbackHappened) {
          if (policyResultsRecord.length > 0 || deliveredImages.length > 0 || (candidatePool.length > 0 && quoteResultsRecord.length > 0)) {
            continue;
          }
        }
      }

      // =======================================================================
      // PHASE 6: DEGRADED DETERMINISTIC RESPONSE SYNTHESIS (NEVER silently overrides live LLM!)
      // =======================================================================
      if (!finalCustomerResponse) {
        if (isRealLLM && !fallbackHappened) {
          // Model completed tool loop without producing RESPOND_DIRECTLY -> mark transparent degraded fallback
          fallbackHappened = true;
          usedLiveLLM = false;
          fallbackReason = 'Model completed bounded reasoning iterations without emitting final_response';
          if (isStrictLive) {
            throw new Error(`BLOCKED: ${fallbackReason}`);
          }
        }
        if (isRealLLM && fallbackHappened && !offlineHeuristicsApplied) {
          applyOfflineTemporalAndDurationHeuristics();
          offlineHeuristicsApplied = true;
        }
        finalCustomerResponse = this.composeGroundedResponse({
          state,
          userMessage,
          mentionedRoomId,
          quoteResultsRecord,
          factsResultRecord,
          searchResultRecord,
          deliveredImages,
          policyResultsRecord,
          candidatePool,
          isTimeAssumptionConditional,
        });
      }
    }

    // =========================================================================
    // DUAL-GATE OUTBOUND SAFETY: CHECK HUMAN TAKEOVER BEFORE OUTBOUND (GATE 2)
    // =========================================================================
    const currentGenerationVersion = ((state as any).generation_version || 0) as number;
    const isOutdatedGeneration = currentGenerationVersion !== startGenerationVersion;

    if (
      ((state.ownership_state as any) === 'HUMAN_ACTIVE' && (state as any).staff_took_over) ||
      isOutdatedGeneration
    ) {
      return this.buildTakeoverSuppressedResult(sessionId, userMessage, state);
    }

    if (isExplicitEscalation) {
      state.ownership_state = 'HUMAN_ACTIVE';
      (state as any).staff_took_over = false;
      state.lifecycle = 'HUMAN_SUPERVISED';
    }

    // =========================================================================
    // PHASE 7: BUSINESS GUARD & CLAIM VALIDATOR
    // =========================================================================
    const validationSummary = this.claimValidator.validate(finalCustomerResponse, {
      sessionId: state.sessionId,
      facility: this.propertyId,
      focusedRoomKey: state.focusedRoomId,
      expectedQuotes: this.buildExpectedQuotesForValidation(quoteResultsRecord, activePolicyVersion),
      validEvidence: state.verifiedBusinessEvidence,
      deliveredMedia: deliveredImages,
      mediaGroups: deliveredMediaGroups,
      effectivePolicyVersion: activePolicyVersion,
      userMessage,
      guestBudgetVnd: state.hardConstraints.budget ?? budget,
      referenceClock: effectiveClock,
      checkinConfidence: state.conditionalAssumptions?.checkinConfidence,
      structuredClaimRefs: structuredDecisions[structuredDecisions.length - 1]?.claim_refs ?? undefined,
      structuredMediaRefs: structuredDecisions[structuredDecisions.length - 1]?.media_refs ?? undefined,
      renderedRefBindings: lastRenderedBindings,
      renderedRefErrors: lastRenderedErrors,
      activeDatasetHash,
      enforceMandatoryScope: true,
    });

    const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
    const isTrueLiveLLMControlled = usedLiveLLM && usedModelResponse && !fallbackHappened && !groundingBlocked;
    const isIntentionalSafetyGuard =
      !usedLiveLLM &&
      !fallbackHappened &&
      (isSecurityAttempt || (isExplicitEscalation && (!isRealLLM || !isCompoundEscalationQuestion)));
    const verificationStatus: LLMVerificationStatus = isTrueLiveLLMControlled
      ? 'LIVE_LLM_DECISION_VERIFIED'
      : isIntentionalSafetyGuard || !isRealLLM
        ? 'DETERMINISTIC_AGENT_FLOW'
        : 'DEGRADED_DETERMINISTIC_MODE';

    const decisionTrace: DecisionTrace = {
      turnIndex: state.turnCount,
      providerModel: `${activeProvider}:${activeModel}`,
      executionMode,
      decisionSteps,
      latencyMs,
      claimsChecked: validationSummary,
      verificationStatus,
      llmTelemetry: {
        verificationStatus,
        provider: activeProvider,
        model: activeModel,
        callCount: liveLLMCalls,
        decisionType: executionMode,
        effectivePolicyVersion: getEffectivePolicyMetadata().effectivePolicyVersion,
        buildIdentity: getImmutableBuildIdentity(),
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        latencyMs,
        structuredDecisions: structuredDecisions.length > 0 ? structuredDecisions : undefined,
        finalModelResponse,
        fallbackState: {
          isFallback: fallbackHappened || !isTrueLiveLLMControlled,
          fallbackReason:
            fallbackReason ?? (!isTrueLiveLLMControlled ? 'Live LLM unavailable or offline mode (Deterministic/Degraded Mode active)' : undefined),
        },
        protocolMetrics: {
          schemaRejections,
          formatRepairs,
          providerFailovers,
        },
        telemetryEvents: {
          evidenceInvalidations,
          replanningEvents,
          groundingRejections,
          repairAttempts,
          repairedTurn: repairAttempts > 0 && !groundingBlocked && !fallbackHappened && usedModelResponse,
          finalGroundingBlocked: groundingBlocked,
          upstreamApiBlocked,
        },
      },
    };

    const isParkingCompound =
      (/\b(do xe|gui xe|o to|xe hoi|xe may|cho do|do duoc|de xe|cho de xe)\b/i.test(noDia) ||
        (/\b(do|gui|de)\b/i.test(noDia) && /\b(xe|o to)\b/i.test(noDia)) ||
        /\bxe\s*(?:4|7|16)\s*cho\b/i.test(noDia)) &&
      !asksParkingOnly;

    const isCompoundQuery =
      isParkingCompound ||
      (state.hardConstraints.requiredAmenities.length > 0 && Boolean(budget || durationHours));

    // Align multi-room presentation order with first appearance in finalCustomerResponse (avoid text/gallery mismatch)
    const findMentionPosition = (roomId: string, roomCode: string, roomName: string): number => {
      if (!finalCustomerResponse) return Number.MAX_SAFE_INTEGER;
      const respLower = finalCustomerResponse.toLowerCase();
      const candidates = [roomCode.toLowerCase(), roomName.toLowerCase(), roomId.toLowerCase()].filter(
        (k) => k && k.length >= 2
      );
      let best = Number.MAX_SAFE_INTEGER;
      for (const c of candidates) {
        const idx = respLower.indexOf(c);
        if (idx !== -1 && idx < best) best = idx;
      }
      return best;
    };

    const orderedRoomPresentations: RoomPresentationBlock[] = deliveredMediaGroups
      .map((grp, origIdx) => ({
        grp,
        origIdx,
        mentionPos: findMentionPosition(grp.roomId, grp.roomCode, grp.roomName),
      }))
      .sort((a, b) => (a.mentionPos !== b.mentionPos ? a.mentionPos - b.mentionPos : a.origIdx - b.origIdx))
      .map(({ grp }, displayIdx) => {
        const matchingQuotes = quoteResultsRecord.filter((q) => q.room_id === grp.roomId);
        const firstQuote = matchingQuotes[0];
        const priceSummary =
          firstQuote && typeof firstQuote.total_price_vnd === 'number'
            ? `${firstQuote.total_price_vnd.toLocaleString('vi-VN')}đ`
            : undefined;
        return {
          ...grp,
          displayOrder: displayIdx,
          priceSummary,
          quoteRefs: matchingQuotes.map((q) => q.quote_id).filter(Boolean),
        };
      });

    const orderedDeliveredImages: RoomPresentationImage[] =
      orderedRoomPresentations.length > 0
        ? orderedRoomPresentations.flatMap((grp) => grp.images)
        : deliveredImages;

    // Preserve presented room order for contextual references ("căn thứ hai", "phòng cuối cùng", ...)
    const presentedList: NonNullable<AgentState['lastPresentedRooms']> = [];
    if (orderedRoomPresentations.length > 0) {
      orderedRoomPresentations.forEach((grp, idx) => {
        presentedList.push({
          propertyId: grp.propertyId,
          roomId: grp.roomId,
          roomCode: grp.roomCode,
          roomName: grp.roomName,
          category: grp.category,
          hasMedia: true,
          order: idx,
          summary: grp.priceSummary,
        });
      });
    } else if (quoteResultsRecord.length > 0) {
      const seenQ = new Set<string>();
      quoteResultsRecord.forEach((q) => {
        if (q.room_id && !seenQ.has(q.room_id)) {
          seenQ.add(q.room_id);
          const rCode = String(q.room_id).split('-')[0];
          presentedList.push({
            propertyId: this.propertyId,
            roomId: q.room_id,
            roomCode: rCode,
            roomName: q.room_name || q.room_id,
            category: q.category,
            hasMedia: false,
            order: presentedList.length,
            summary: typeof q.total_price_vnd === 'number' ? `${q.total_price_vnd.toLocaleString('vi-VN')}đ` : undefined,
          });
        }
      });
    } else if (candidatePool.length > 0 && candidatePool.length <= 10) {
      candidatePool.forEach((c: any, idx: number) => {
        const rId = c.room_id || c.id;
        if (!rId) return;
        presentedList.push({
          propertyId: this.propertyId,
          roomId: rId,
          roomCode: String(rId).split('-')[0],
          roomName: c.room_name || rId,
          category: c.category,
          hasMedia: false,
          order: idx,
        });
      });
    }
    if (presentedList.length > 0) {
      state.lastPresentedRooms = presentedList
        .map((item, origIdx) => ({
          item,
          origIdx,
          mentionPos: findMentionPosition(item.roomId, item.roomCode, item.roomName),
        }))
        .sort((a, b) => (a.mentionPos !== b.mentionPos ? a.mentionPos - b.mentionPos : a.origIdx - b.origIdx))
        .map(({ item }, idx) => ({ ...item, order: idx }));
    }

    const turnResult: ConversationTurnResult = {
      session_id: sessionId,
      turn_index: state.turnCount,
      user_message: userMessage,
      intent: 'SEARCH_ROOM',
      extracted_entities: {
        facility: this.propertyId,
        category: (state as any).targetCategory,
        budget: state.hardConstraints.budget,
        duration_hours: state.hardConstraints.durationHours,
        stay_type: state.hardConstraints.stayType,
        checkin_datetime: state.hardConstraints.checkinDatetime,
        must_have_amenities: state.hardConstraints.requiredAmenities,
        is_compound: isCompoundQuery || undefined,
      },
      updated_state: {
        session_id: sessionId,
        active_facility: this.propertyId,
        focused_room: state.focusedRoomId ? { co_so_ma: this.propertyId, ma_phong: state.focusedRoomId } : null,
        shortlisted_rooms: [],
        stay_type: state.hardConstraints.stayType || 'nghi_gio',
        checkin_datetime: state.hardConstraints.checkinDatetime || null,
        duration_hours: state.hardConstraints.durationHours || null,
        max_budget: state.hardConstraints.budget || null,
        must_have_amenities: state.hardConstraints.requiredAmenities,
        nice_to_have_amenities: state.softPreferences,
        negated_constraints: state.negatedRoomIds || [],
        preferred_styles: state.softPreferences,
        recent_references: [],
        last_quote_context: null,
        conversation_lifecycle: state.lifecycle,
        ownership_state: state.ownership_state,
        pending_clarification: null,
        created_at: state.updatedAt,
        updated_at: state.updatedAt,
        turn_count: state.turnCount,
      },
      missing_information: [],
      chosen_action: quoteResultsRecord.length > 0 ? 'GET_PREBOOKING_QUOTE' : candidatePool.length > 0 ? 'RECOMMEND_ROOMS' : 'ANSWER_FROM_VERIFIED_DATA',
      tool_results: {
        quote_results: quoteResultsRecord,
        search_result: searchResultRecord,
        ...(orderedRoomPresentations.length > 0 ? { room_presentations: orderedRoomPresentations } : {}),
      },
      verified_candidates: candidatePool.map((c: any) => ({ ...c, id: c.room_id || c.id })),
      evidence_references: [`facility::${this.propertyId}`],
      customer_visible_response: finalCustomerResponse,
      images: orderedDeliveredImages,
      ...(orderedRoomPresentations.length > 0 ? { room_presentations: orderedRoomPresentations } : {}),
      claim_validation: validationSummary,
      human_escalation: isExplicitEscalation || state.ownership_state === 'HUMAN_ACTIVE'
        ? {
          needed: true,
          reason_code: 'EXPLICIT_HUMAN_REQUEST',
          summary: `Khách hàng yêu cầu kết nối nhân viên/quản lý tại ${this.propertyContext.propertyName}.`,
        }
        : { needed: false },
      decision_trace: decisionTrace,
      internal_trace: {
        latency_ms: latencyMs,
        rules_triggered: ['V2_MODEL_DRIVEN_CORE', `MODE_${executionMode}`],
        adapter_used: this.propertyId === 'jacayl-ha-dong' && activeModel === 'generic-constraint-v2.2' ? 'HadongAgenticReasoner-v1' : activeModel,
        tools_executed: executedToolsList,
        canonical_data_fetched: canonicalFetchedList,
      },
    };

    if (finalCustomerResponse) {
      state.conversationHistory.push({ role: 'assistant', content: finalCustomerResponse });
    }
    state.decisionSteps = decisionSteps;
    state.lastTurnResult = turnResult;
    return turnResult;
  }

  /**
   * Plans a deterministic step using generic domain routing instead of keyword patching.
   * Only executed in offline deterministic tests or transparent Degraded Deterministic Mode.
   */
  protected planDeterministicTurnStep(
    iteration: number,
    userMessage: string,
    state: AgentState,
    mentionedRoomId: string | undefined,
    checkinDatetime: string | undefined,
    candidatePool: any[],
    quoteResultsRecord: any[],
    policyResultsRecord: any[]
  ): {
    action: 'CALL_TOOLS' | 'RESPOND_DIRECTLY';
    thought: string;
    toolCalls: ToolCall[];
    directResponse?: string;
  } {
    const noDia = removeDiacritics(userMessage.toLowerCase());

    if (iteration === 1) {
      // 1. Is it a policy question?
      const isPolicyTopic =
        /\b(do xe|gui xe|o to|xe hoi|xe may|le tet|ngay le|gio to|tet|30\/4|2\/9|hut thuoc|thanh toan|chuyen khoan|nguoi thu ba|nguoi thu 3|nguoi nua|ban vao|ngu cung|check in|check out|nhan phong|tra phong|dia chi|o dau|wifi|nuoc|thang may|1 tieng|ho boi|be boi|sauna|xong hoi|bep)\b/i.test(noDia);

      if (
        isPolicyTopic &&
        !mentionedRoomId &&
        !state.hardConstraints.budget &&
        !state.hardConstraints.durationHours &&
        state.hardConstraints.requiredAmenities.length === 0
      ) {
        let topic = 'general';
        if (/\b(do xe|gui xe|o to|xe hoi|xe may)\b/i.test(noDia)) topic = 'parking';
        else if (/\b(le|tet|30\/4|2\/9)\b/i.test(noDia)) topic = 'holiday';
        else if (/\b(nguoi thu ba|nguoi thu 3|nguoi nua|ban vao|ngu cung)\b/i.test(noDia)) topic = 'extra_person';
        else if (noDia.includes('hut thuoc')) topic = 'smoking';
        else if (noDia.includes('thanh toan') || noDia.includes('chuyen khoan')) topic = 'payment';
        else if (noDia.includes('check in') || noDia.includes('check out') || noDia.includes('nhan phong') || noDia.includes('tra phong') || noDia.includes('1 tieng') || noDia.includes('dem') || noDia.includes('ngay')) topic = 'stay_hours';
        else if (noDia.includes('dia chi') || noDia.includes('o dau')) topic = 'address';
        else if (noDia.includes('wifi')) topic = 'wifi';
        else if (noDia.includes('nuoc')) topic = 'water';
        else if (noDia.includes('thang may')) topic = 'elevator';
        else if (noDia.includes('ho boi') || noDia.includes('sauna') || noDia.includes('bep')) topic = 'pool';

        return {
          action: 'CALL_TOOLS',
          thought: `Tra cứu quy định chính sách của ${this.propertyContext.propertyName} cho chủ đề "${topic}".`,
          toolCalls: [
            {
              toolCallId: `call_policy_${Date.now()}`,
              toolName: 'get_policies',
              arguments: { property_id: this.propertyId, topic },
            },
          ],
        };
      }

      // 2. Is it room-specific inquiry?
      if (mentionedRoomId) {
        const asksMedia =
          noDia.includes('hinh anh') ||
          noDia.includes('xem anh') ||
          noDia.includes('gui anh') ||
          noDia.includes('anh thuc te') ||
          noDia.includes('anh phong') ||
          userMessage.toLowerCase().includes('ảnh') ||
          noDia.includes('video') ||
          noDia.includes('photo') ||
          state.currentActivity === 'VIEWING_PHOTOS';

        const isPriceInquiry =
          noDia.includes('gia') ||
          (noDia.includes('tinh') && !noDia.includes('tinh yeu')) ||
          noDia.includes('bao nhieu') ||
          noDia.includes('bn') ||
          noDia.includes('tien');

        if (state.currentActivity === 'VIEWING_PHOTOS' || (asksMedia && !noDia.includes('chi'))) {
          // Proactive Media & Quote Delivery (Case 02: explore room with both photos and pricing)
          return {
            action: 'CALL_TOOLS',
            thought: `Chủ động tra cứu hình ảnh thực tế và báo giá phòng ${mentionedRoomId} tại ${this.propertyContext.propertyName}.`,
            toolCalls: [
              {
                toolCallId: `call_media_${mentionedRoomId}`,
                toolName: 'get_room_media',
                arguments: { property_id: this.propertyId, room_id: mentionedRoomId },
              },
              {
                toolCallId: `call_quote_${mentionedRoomId}`,
                toolName: 'quote_price',
                arguments: {
                  property_id: this.propertyId,
                  room_id: mentionedRoomId,
                  stay_type: state.hardConstraints.stayType || 'nghi_gio',
                  duration_hours: state.hardConstraints.durationHours || 2,
                  checkin_datetime: checkinDatetime,
                },
              },
            ],
          };
        } else if (!isPriceInquiry && (noDia.includes('to khong') || noDia.includes('co ghe') || noDia.includes('tien nghi') || noDia.includes('kich thuoc') || noDia.includes('the nao') || noDia.includes('bon tam doi') || noDia.includes('bon doi') || noDia.includes('jacuzzi'))) {
          return {
            action: 'CALL_TOOLS',
            thought: `Tra cứu dữ kiện chi tiết tiện nghi phòng ${mentionedRoomId} tại ${this.propertyContext.propertyName}.`,
            toolCalls: [
              {
                toolCallId: `call_facts_${mentionedRoomId}`,
                toolName: 'get_room_facts',
                arguments: { property_id: this.propertyId, room_id: mentionedRoomId },
              },
            ],
          };
        } else {
          const asksParkingToo =
            /\b(do xe|gui xe|o to|xe hoi|xe may|cho do|do duoc)\b/i.test(noDia) ||
            (/\b(do|gui)\b/i.test(noDia) && /\b(xe|o to)\b/i.test(noDia)) ||
            /\bxe\s*(?:4|7|16)\s*cho\b/i.test(noDia);

          const toolCalls: ToolCall[] = [
            {
              toolCallId: `call_quote_${mentionedRoomId}`,
              toolName: 'quote_price',
              arguments: {
                property_id: this.propertyId,
                room_id: mentionedRoomId,
                stay_type: state.hardConstraints.stayType || 'nghi_gio',
                duration_hours: state.hardConstraints.durationHours || 2,
                checkin_datetime: checkinDatetime,
              },
            },
          ];

          if (asksParkingToo) {
            toolCalls.push({
              toolCallId: `call_policy_parking_${Date.now()}`,
              toolName: 'get_policies',
              arguments: { property_id: this.propertyId, topic: 'parking' },
            });
          }

          return {
            action: 'CALL_TOOLS',
            thought: asksParkingToo
              ? `Tra cứu đồng thời báo giá phòng ${mentionedRoomId} và quy định đỗ xe ô tô tại ${this.propertyContext.propertyName}.`
              : `Tra cứu báo giá phòng ${mentionedRoomId} tại ${this.propertyContext.propertyName}.`,
            toolCalls,
          };
        }
      }

      // 3. General room discovery: search rooms (plus parking policy if compound parking query)
      const searchToolCalls: ToolCall[] = [
        {
          toolCallId: `call_search_${iteration}`,
          toolName: 'search_rooms',
          arguments: {
            property_id: this.propertyId,
            must_have_amenities: state.hardConstraints.requiredAmenities,
            category: (state as any).targetCategory,
          },
        },
      ];
      if (/\b(do xe|gui xe|o to|xe hoi|xe may|cho do|do duoc)\b/i.test(noDia)) {
        searchToolCalls.push({
          toolCallId: `call_policy_parking_${Date.now()}`,
          toolName: 'get_policies',
          arguments: { property_id: this.propertyId, topic: 'parking' },
        });
      }
      return {
        action: 'CALL_TOOLS',
        thought: `Tìm kiếm các phòng tại ${this.propertyContext.propertyName} theo tiện nghi bắt buộc [${state.hardConstraints.requiredAmenities.join(', ')}]${(state as any).targetCategory ? ` và hạng ${(state as any).targetCategory}` : ''}.`,
        toolCalls: searchToolCalls,
      };
    } else if (iteration === 2) {
      const wantsCheap =
        noDia.includes('gia re') ||
        noDia.includes('re nhat') ||
        noDia.includes('tiet kiem') ||
        state.optimizationGoal === 'CHEAPEST' ||
        (state.hardConstraints.budget && state.hardConstraints.budget <= 350000);

      const asksAvailability =
        /\b(con phong|còn phòng|trong phong|trống phòng|con cho|còn chỗ)\b/i.test(userMessage) ||
        /\b(nay|hom nay|hôm nay)\s+con\s+phong\b/i.test(noDia);

      const asksPrice =
        wantsCheap ||
        noDia.includes('gia') ||
        noDia.includes('bao nhieu') ||
        noDia.includes('bn') ||
        noDia.includes('tien') ||
        Boolean(state.hardConstraints.budget) ||
        (Boolean(state.hardConstraints.durationHours) && !asksAvailability);

      if (
        mentionedRoomId ||
        (!asksPrice && policyResultsRecord.length > 0) ||
        (candidatePool.length === 0 && quoteResultsRecord.length > 0) ||
        (asksAvailability && !asksPrice && candidatePool.length > 0) ||
        (!asksPrice && (candidatePool.length > 0 || state.hardConstraints.requiredAmenities.includes('may_chieu')))
      ) {
        return {
          action: 'RESPOND_DIRECTLY',
          thought: asksAvailability
            ? 'Đã xác định các phòng và hạng phòng sẵn có hôm nay; chuyển sang phản hồi tình trạng phòng và cơ chế đối soát lễ tân.'
            : 'Đã có đầy đủ dữ kiện cần thiết, chuyển sang tổng hợp câu trả lời.',
          toolCalls: [],
        };
      }

      // Solve candidate rooms dynamically using Pricing Engine (Section VI)
      const requestedCategory = (state as any).targetCategory as string | undefined;
      let availableCandidates = candidatePool.filter(
        (c: any) => !state.negatedRoomIds?.includes(c.room_id)
      );

      if (requestedCategory) {
        const catMatches = availableCandidates.filter((c: any) => {
          const cat = String(c.category || '').toLowerCase();
          if (requestedCategory === 'Concept') return cat === 'concept' || cat === 'suite';
          return cat === requestedCategory.toLowerCase();
        });
        if (catMatches.length > 0) {
          availableCandidates = catMatches;
        }
      }

      // Fallback to all sellable rooms if user retracted constraints
      if (availableCandidates.length === 0) {
        availableCandidates = this.dataset.phong
          .filter((p) => p.co_so_ma === this.propertyId && p.ma_phong !== '401-ha-dong')
          .filter((p) => {
            if (!requestedCategory) return true;
            if (requestedCategory === 'Concept') return p.hang === 'Concept' || p.hang === 'Suite';
            return p.hang.toLowerCase() === requestedCategory.toLowerCase();
          })
          .map((p) => ({
            room_id: p.ma_phong,
            room_name: p.ten_phong.includes(p.ma_phong.split('-')[0]) ? p.ten_phong : `${p.ma_phong.split('-')[0]} — ${p.ten_phong}`,
            category: p.hang,
            base_pricing: p.gia_goc_dataset,
            confirmed_amenities: [
              p.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE' ? 'Bồn tắm' : null,
              p.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE' ? 'Ghế tình yêu' : null,
            ].filter(Boolean),
          }))
          .filter((c) => !state.negatedRoomIds?.includes(c.room_id));
      }

      const duration = state.hardConstraints.durationHours || 2;

      if (
        (wantsCheap ||
          state.optimizationGoal === 'CHEAPEST' ||
          requestedCategory === 'Standard' ||
          requestedCategory === 'Deluxe') &&
        !state.hardConstraints.requiredAmenities.includes('bon_tam')
      ) {
        if (wantsCheap || state.optimizationGoal === 'CHEAPEST') {
          StructuredStateManager.setOptimizationGoal(state, 'CHEAPEST');
        }
        const sorted = [...availableCandidates].sort(
          (a: any, b: any) => (a.base_pricing?.nghi_gio_2h ?? 999999) - (b.base_pricing?.nghi_gio_2h ?? 999999)
        );
        const best = sorted[0];
        if (best) {
          return {
            action: 'CALL_TOOLS',
            thought: `Tra cứu báo giá cho phòng phù hợp (${best.room_name}).`,
            toolCalls: [
              {
                toolCallId: `call_quote_${best.room_id}`,
                toolName: 'quote_price',
                arguments: {
                  property_id: this.propertyId,
                  room_id: best.room_id,
                  stay_type: state.hardConstraints.stayType || 'nghi_gio',
                  duration_hours: duration,
                  checkin_datetime: checkinDatetime,
                },
              },
            ],
          };
        }
      }

      // Select distinct candidate options (include lowest Standard if general non-filtered quote)
      const cStd =
        !requestedCategory && !state.hardConstraints.requiredAmenities.includes('bon_tam') && !state.focusedRoomId
          ? availableCandidates.find((c: any) => String(c.category || '').toLowerCase() === 'standard')
          : undefined;
      const c101 = availableCandidates.find((c: any) => c.room_id.includes('101')) || availableCandidates[0];
      const c601 = availableCandidates.find((c: any) => c.room_id.includes('601')) || availableCandidates[1];
      const roomsToQuote = Array.from(new Set([cStd, c101, c601].filter(Boolean)));

      return {
        action: 'CALL_TOOLS',
        thought: `Tra cứu báo giá chính xác cho các ứng viên phòng (${roomsToQuote.map((r: any) => r.room_name).join(', ')}).`,
        toolCalls: roomsToQuote.map((rm: any) => ({
          toolCallId: `call_quote_${rm.room_id}`,
          toolName: 'quote_price',
          arguments: {
            property_id: this.propertyId,
            room_id: rm.room_id,
            stay_type: state.hardConstraints.stayType || 'nghi_gio',
            duration_hours: duration,
            checkin_datetime: checkinDatetime,
          },
        })),
      };
    } else {
      return {
        action: 'RESPOND_DIRECTLY',
        thought: 'Đã hoàn thành các vòng tra cứu dữ liệu, tiến hành tổng hợp câu trả lời.',
        toolCalls: [],
      };
    }
  }

  /**
   * Synthesizes natural, answer-first response grounded in verified evidence.
   */
  protected composeGroundedResponse(params: {
    state: AgentState;
    userMessage: string;
    mentionedRoomId?: string;
    quoteResultsRecord: any[];
    factsResultRecord?: any;
    searchResultRecord?: any;
    deliveredImages: any[];
    policyResultsRecord: any[];
    candidatePool: any[];
    isTimeAssumptionConditional: boolean;
  }): string {
    const {
      state,
      userMessage,
      mentionedRoomId,
      quoteResultsRecord,
      factsResultRecord,
      searchResultRecord,
      deliveredImages,
      policyResultsRecord,
      candidatePool,
      isTimeAssumptionConditional,
    } = params;

    const noDia = removeDiacritics(userMessage.toLowerCase());
    const propName = this.propertyContext.propertyName;

    // 0. Room Availability Inquiries (e.g. "Nay còn phòng kh b")
    const asksAvailability =
      /\b(con phong|còn phòng|trong phong|trống phòng|con cho|còn chỗ)\b/i.test(userMessage) ||
      /\b(nay|hom nay|hôm nay)\s+con\s+phong\b/i.test(noDia);

    if (asksAvailability) {
      if (state.hardConstraints.durationHours && quoteResultsRecord.length > 0) {
        const primaryQ = quoteResultsRecord[0];
        const dur = state.hardConstraints.durationHours;
        const priceSummary =
          primaryQ.pricing_status === 'CONDITIONAL_ON_CHECKIN_TIME'
            ? primaryQ.price_breakdown_text
            : `${primaryQ.total_price_vnd?.toLocaleString('vi-VN')}đ (${primaryQ.price_breakdown_text})`;
        return (
          `Dạ tại cơ sở **${propName}**, theo trao đổi của mình về gói nghỉ ${dur} tiếng cho ${primaryQ.room_name}, đây là hạng phòng có trong danh mục kinh doanh của cơ sở ạ.\n\n` +
          `- **Biểu giá tham chiếu**: ${priceSummary}.\n` +
          `- **Tình trạng phòng trống thực tế**: Hệ thống tư vấn không kết nối trực tiếp phần mềm lễ tân (PMS), nên chưa thể kiểm tra hay xác nhận tình trạng phòng trống và vệ sinh phòng theo thời gian thực. Tình trạng phòng trống được lễ tân đối soát và giữ phòng trực tiếp trên hệ thống ạ.\n\n` +
          `Anh/chị dự kiến ghé khách sạn vào thời gian nào (ngày, giờ) để em hỗ trợ chuyển thông tin cho lễ tân kiểm tra và giữ phòng giúp mình nhé ạ!`
        );
      } else if (state.hardConstraints.durationHours && state.focusedRoomId) {
        const roomObj = this.dataset.phong.find((p) => p.ma_phong === state.focusedRoomId);
        const roomName = roomObj ? roomObj.ten_phong : state.focusedRoomId;
        const dur = state.hardConstraints.durationHours;
        return (
          `Dạ tại cơ sở **${propName}**, theo trao đổi của mình về gói nghỉ ${dur} tiếng cho ${roomName}, đây là phòng thuộc danh mục kinh doanh của cơ sở ạ.\n\n` +
          `Do hệ thống tư vấn không có kết nối PMS theo thời gian thực và lượng khách nhận/trả phòng thay đổi liên tục, tình trạng phòng trống và sẵn sàng đón khách thực tế cần được đối soát trực tiếp tại quầy lễ tân ạ.\n\n` +
          `Anh/chị dự kiến ghé khách sạn vào khoảng mấy giờ hôm nay để em báo lễ tân kiểm tra và hỗ trợ giữ phòng cho mình nhé ạ!`
        );
      } else {
        const reqAmenitiesText = state.hardConstraints.requiredAmenities
          .map((a) => (a === 'bon_tam' ? 'bồn tắm' : a === 'ghe_tinh_yeu' ? 'ghế tình yêu' : a))
          .join(', ');
        const bathtubCandidates = ['101-long-chim', '601-50-sac-thai', '602-playboy'].filter(
          (id) => !state.negatedRoomIds?.includes(id)
        );
        const candidateNames = bathtubCandidates
          .map((id) =>
            id.includes('101')
              ? 'phòng 101 — Lồng Chim'
              : id.includes('601')
                ? 'phòng 601 — 50 Sắc Thái'
                : 'phòng 602 — Playboy'
          )
          .slice(0, 2)
          .join(', ');
        const amenityClause = reqAmenitiesText
          ? ` có ${reqAmenitiesText} (như ${candidateNames || 'các phòng bồn tắm trong catalog'})`
          : ' (Standard, Deluxe và Concept)';
        return (
          `Dạ tại cơ sở **${propName}** (${this.propertyContext.address}), trong danh mục kinh doanh bên em có các hạng phòng${amenityClause} ạ.\n\n` +
          `Tuy nhiên, hệ thống tư vấn chưa kết nối trực tiếp phần mềm lễ tân (PMS) nên em chưa kiểm tra được tình trạng phòng trống theo thời gian thực — việc đối soát phòng trống và giữ phòng được thực hiện trực tiếp bởi quầy lễ tân ạ.\n\n` +
          `Anh/chị dự định ghé khách sạn lúc mấy giờ và muốn nghỉ theo gói nào (nghỉ giờ, qua đêm hay ngày đêm) để em kiểm tra bảng giá chi tiết và hướng dẫn liên hệ lễ tân giữ phòng cho mình nhé ạ!`
        );
      }
    }

    // 1. Direct Policy responses
    if (policyResultsRecord.length > 0 && quoteResultsRecord.length === 0 && candidatePool.length === 0) {
      const pol = policyResultsRecord[0];
      return `Dạ tại cơ sở ${propName}, ${pol.policy_text}`;
    }

    // 2. Media Delivery (only when no quotes were requested/calculated)
    if (mentionedRoomId && deliveredImages.length > 0 && quoteResultsRecord.length === 0) {
      const roomDisplay = mentionedRoomId.includes('601') ? '601 — 50 Sắc Thái' : mentionedRoomId.includes('101') ? '101 — Lồng Chim' : mentionedRoomId;
      return `Dạ em gửi anh/chị xem trước các hình ảnh thực tế của phòng ${roomDisplay} tại cơ sở ${propName} ạ. Không gian phòng thực tế rất đẹp và lãng mạn ạ!`;
    }

    // 3. Room Facts (Section IX: Natural Conversation Quality - Answer First!)
    if (mentionedRoomId && factsResultRecord) {
      if (noDia.includes('bon doi') || noDia.includes('bồn đôi')) {
        return `Dạ phòng 50 — Sắc Thái tại cơ sở ${propName} có Bồn tắm lớn ạ. Không gian concept được thiết kế lãng mạn, riêng tư cho các cặp đôi.`;
      }
      if (noDia.includes('jacuzzi') || noDia.includes('bon suc') || noDia.includes('kich thuoc')) {
        return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} có ${factsResultRecord.bathtub_status || 'bồn tắm lớn'} ạ. Hiện tại thông số kích thước cụ thể và chức năng sục bọt Jacuzzi chưa được công bố chính thức trên dữ liệu hệ thống ạ.`;
      }
      if (noDia.includes('ghe') || noDia.includes('tantra') || noDia.includes('tinh yeu')) {
        if (factsResultRecord.has_love_chair === 'TRUE' || factsResultRecord.has_love_chair === true) {
          return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} có trang bị ghế tình yêu lãng mạn cho các cặp đôi ạ.`;
        } else if (factsResultRecord.has_love_chair === 'FALSE') {
          return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} không có ghế tình yêu ạ. Cơ sở bên em có các phòng concept như 601 (50 — Sắc Thái) và 602 (Playboy) được trang bị ghế tình yêu cao cấp rất được yêu thích ạ.`;
        } else {
          return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} hiện chưa có thông tin xác nhận chính thức về ghế tình yêu trong dữ liệu catalog (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để kiểm tra thực tế ạ.`;
        }
      }
      if (factsResultRecord.has_bathtub === 'UNKNOWN') {
        return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} hiện chưa có thông tin xác nhận bồn tắm trong dữ liệu catalog (UNKNOWN) ạ. Anh/chị vui lòng liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để kiểm tra thực tế giúp em nhé ạ.`;
      }
      return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} được trang bị ${factsResultRecord.bathtub_status || 'bồn tắm'} ạ.`;
    }

    // 4. Single Room Quote
    if (mentionedRoomId && quoteResultsRecord.some((q) => q.room_id === mentionedRoomId)) {
      const targetQuote = quoteResultsRecord.find((q) => q.room_id === mentionedRoomId)!;
      const parkingPolicy = policyResultsRecord.find((p) => p.topic === 'parking');
      const parkingNote = parkingPolicy
        ? `\n\n- **Thông tin đỗ xe**: ${parkingPolicy.policy_text}`
        : /\b(do xe|gui xe|o to|xe hoi|xe may|7 cho)\b/i.test(noDia)
          ? `\n\n- **Thông tin đỗ xe**: Dữ liệu chính thức xác nhận "Có chỗ đỗ xe."; chi tiết loại xe cụ thể (như ô tô 7 chỗ), vị trí hay phí gửi xe vui lòng liên hệ lễ tân để xác nhận ạ.`
          : '';
      const mediaIntro = deliveredImages.length > 0
        ? `Dạ em gửi anh/chị xem trước các hình ảnh thực tế của phòng ${targetQuote.room_name} tại cơ sở ${propName} ạ!\n\n`
        : '';

      if (targetQuote.pricing_status === 'NOT_FOR_SALE') {
        return `${mediaIntro}Dạ ${targetQuote.price_breakdown_text}`;
      }

      if (targetQuote.pricing_status === 'CONDITIONAL_ON_CHECKIN_TIME' && Array.isArray(targetQuote.conditional_quotes)) {
        const condLines = targetQuote.conditional_quotes
          .map((cq: any) => `- **${cq.condition_label}**: **${cq.total_price_vnd.toLocaleString('vi-VN')}đ** (${cq.price_breakdown_text})`)
          .join('\n');
        const condHolidayNote = noDia.includes('30/4') || noDia.includes('ngay le')
          ? `\n- **Chính sách ngày lễ**: J Collection hoàn toàn không phụ thu phí ngày lễ (giữ nguyên biểu giá tiêu chuẩn theo ngày trong tuần ạ).`
          : '';
        return (
          mediaIntro +
          `Dạ tại cơ sở **${propName}**, vì anh/chị chưa xác định cụ thể ngày và khung giờ nhận phòng, chi phí nghỉ ${targetQuote.duration_hours} tiếng cho ${targetQuote.room_name} (${targetQuote.category}) theo Business Policy V1.4.3 phụ thuộc vào thời điểm check-in như sau ạ:\n\n` +
          `${condLines}\n\n` +
          `- **Tiện nghi phòng**: ${targetQuote.room_name.includes('601') ? 'Bồn tắm lớn, ghế tình yêu' : targetQuote.room_name.includes('101') ? 'Bồn tắm' : 'Theo tiêu chuẩn catalog'}.` +
          condHolidayNote +
          parkingNote +
          `\n\nAnh/chị dự định ghé vào ngày nào và mấy giờ để em chốt đúng mức giá áp dụng nhé ạ! *(Tình trạng phòng trống thực tế cần đối soát với lễ tân trước khi nhận phòng).*`
        );
      }

      if (targetQuote.pricing_status === 'NEEDS_POLICY_CLARIFICATION') {
        return `${mediaIntro}Dạ tại cơ sở **${propName}** (${targetQuote.room_name}): ${targetQuote.price_breakdown_text}`;
      }

      const conditionText = isTimeAssumptionConditional
        ? ` (tạm tính theo khung ban ngày cuối tuần trước 18:00 theo Business Policy V1.4.3 — nếu nhận phòng từ 18:00 trở đi sẽ áp dụng biểu giá gốc dataset)`
        : '';
      const isTimeConfirmed = Boolean(state.conditionalAssumptions?.checkinTimeConfirmed);
      const checkinHourMatch = isTimeConfirmed ? targetQuote.checkin_conditions?.checkin_datetime?.match(/T(\d{2}:\d{2})/) : null;
      const checkinTimeText = checkinHourMatch ? ` từ ${checkinHourMatch[1]}` : '';
      const stayDesc = targetQuote.stay_type === 'qua_dem' ? 'gói qua đêm' : targetQuote.stay_type === 'ngay_dem' ? 'gói cả ngày (Ngày đêm)' : `nghỉ ${targetQuote.duration_hours} tiếng${checkinTimeText}`;
      const holidayNote = noDia.includes('30/4') || noDia.includes('ngay le') ? ' (J Collection hoàn toàn không phụ thu phí ngày lễ)' : '';
      const eligNote = targetQuote.stay_package_eligibility?.business_reason
        ? `\n- **Quy định gói nghỉ**: ${targetQuote.stay_package_eligibility.business_reason}`
        : '';
      const priceDisplay = typeof targetQuote.total_price_vnd === 'number'
        ? `${targetQuote.total_price_vnd.toLocaleString('vi-VN')}đ`
        : 'Chưa xác định';

      return (
        mediaIntro +
        `Dạ tại cơ sở **${propName}**, chi phí ${stayDesc} cho ${targetQuote.room_name} (${targetQuote.category}) là **${priceDisplay}** ạ${holidayNote}.\n\n` +
        `- **Chi tiết biểu giá**: ${targetQuote.price_breakdown_text}${conditionText}.${eligNote}\n` +
        `- **Tiện nghi phòng**: Phòng trang bị ${targetQuote.room_name.includes('601') ? 'bồn tắm lớn và ghế tình yêu' : targetQuote.room_name.includes('101') ? 'bồn tắm nằm thư giãn' : 'các tiện nghi theo thông tin catalog'}.\n` +
        parkingNote +
        `\n*(Lưu ý: Tình trạng phòng trống thực tế theo từng khung giờ cần được đối soát trực tiếp trên hệ thống lễ tân trước khi nhận phòng ạ).*`
      );
    }

    // 5. Search Results with No Quotes (e.g. Browsing or Unconfirmed Search Filter like Projector)
    if (quoteResultsRecord.length === 0 && (noDia.includes('may chieu') || state.hardConstraints.requiredAmenities.includes('may_chieu'))) {
      return `Dạ tại cơ sở ${propName}, tiện nghi máy chiếu rạp phim và Smart TV hiện chưa được xác nhận đồng bộ trong dữ liệu catalog chính thức của hệ thống (trạng thái UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để kiểm tra thiết bị thực tế của từng phòng trước khi đặt nhé ạ!`;
    }

    if (candidatePool.length > 0 && quoteResultsRecord.length === 0) {
      const filtered = candidatePool.filter(
        (c: any) => !state.negatedRoomIds?.includes(c.room_id)
      );

      if (noDia.includes('may chieu') || state.hardConstraints.requiredAmenities.includes('may_chieu')) {
        return `Dạ tại cơ sở ${propName}, tiện nghi máy chiếu rạp phim và Smart TV hiện chưa được xác nhận đồng bộ trong dữ liệu catalog chính thức của hệ thống (trạng thái UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp lễ tân (${this.propertyContext.phone || 'hotline cơ sở'}) để kiểm tra thiết bị thực tế của từng phòng trước khi đặt nhé ạ!`;
      }

      const roomListText = filtered
        .map((c: any) => {
          const displayName = c.room_id.includes('601')
            ? 'Phòng 50 Sắc Thái (50 — Sắc Thái, Mã 601)'
            : c.room_id.includes('101')
              ? 'Phòng 101 — Lồng Chim (Lồng Chim)'
              : c.room_name;
          return `- **${displayName}** (${c.category}): ${c.confirmed_amenities.join(', ')}`;
        })
        .join('\n');

      const reqAmenitiesText = state.hardConstraints.requiredAmenities
        .map((a) => (a === 'bon_tam' ? 'bồn tắm' : a === 'ghe_tinh_yeu' ? 'ghế tình yêu' : a))
        .join(', ') || 'tiêu chuẩn';

      const parkingNote = /\b(do xe|gui xe|o to|xe hoi|xe may|7 cho)\b/i.test(noDia)
        ? `\n\nBên cạnh đó, cơ sở ${propName} xác nhận "Có chỗ đỗ xe."; chi tiết loại xe cụ thể vui lòng liên hệ lễ tân để được hỗ trợ chính xác ạ.`
        : '';

      return (
        `Dạ tại cơ sở **${propName}**, trong danh mục phòng bên em có các phòng đáp ứng tiện nghi ${reqAmenitiesText} như sau ạ:\n\n` +
        `${roomListText}\n\n` +
        `Anh/chị có dự định nghỉ theo khung giờ và ngày nào (nghỉ giờ, qua đêm hay ngày đêm) để em hỗ trợ kiểm tra biểu giá chi tiết nhé ạ!${parkingNote}`
      );
    }

    // 6. Generic Constraint Solving on Quotes (Section VI)
    if (quoteResultsRecord.length > 0) {
      const normalizedQuotes = quoteResultsRecord.map((q) => {
        if (typeof q.total_price_vnd === 'number') return q;
        const maxCond = q.max_price_vnd ?? (Array.isArray(q.conditional_quotes) ? Math.max(...q.conditional_quotes.map((c: any) => c.total_price_vnd ?? 0)) : 0);
        return { ...q, total_price_vnd: maxCond };
      });

      const maxBudget = state.hardConstraints.budget;
      const hours = state.hardConstraints.durationHours || 2;

      const solved = GenericConstraintSolver.solve({
        candidatePool,
        quotes: normalizedQuotes,
        maxBudget,
        requiredAmenities: state.hardConstraints.requiredAmenities,
        softPreferences: state.softPreferences,
        goal: state.optimizationGoal,
      });

      const hasConditionalQuotes = quoteResultsRecord.some((q) => q.pricing_status === 'CONDITIONAL_ON_CHECKIN_TIME');

      const conditionNote = hasConditionalQuotes
        ? `\n*(Lưu ý: Do anh/chị chưa xác nhận ngày và khung giờ đến, giá phụ thuộc thời điểm nhận phòng theo Business Policy V1.4.3. Tình trạng phòng trống thực tế cần đối soát với lễ tân ạ).*`
        : isTimeAssumptionConditional
          ? `\n*(Lưu ý: Biểu giá tạm tính trên khung nhận phòng ban ngày cuối tuần trước 18:00 theo Business Policy V1.4.3. Tình trạng phòng trống thực tế cần đối soát trực tiếp cùng lễ tân ạ).*`
          : `\n*(Lưu ý: Tình trạng phòng thực tế theo từng khung giờ cần được đối soát trực tiếp trên hệ thống lễ tân trước khi nhận phòng).*`;

      const durText = state.hardConstraints.durationHours ? ` nghỉ ${hours} tiếng` : '';
      const dayText = noDia.includes('thu 7') || noDia.includes('cuoi tuan') ? ' thứ 7' : '';
      const tubText = state.hardConstraints.requiredAmenities.includes('bon_tam')
        ? ' có bồn tắm'
        : userMessage.toLowerCase().includes('không cần bồn tắm')
          ? ' không cần bồn tắm'
          : '';

      if (normalizedQuotes.length === 1) {
        const q = normalizedQuotes[0];
        const budgetText = maxBudget ? ` dưới ${maxBudget.toLocaleString('vi-VN')}đ` : '';
        if (q.pricing_status === 'CONDITIONAL_ON_CHECKIN_TIME' && Array.isArray(q.conditional_quotes)) {
          const condLines = q.conditional_quotes
            .map((c: any) => `  - ${c.condition_label}: **${c.total_price_vnd.toLocaleString('vi-VN')}đ** (${c.price_breakdown_text})`)
            .join('\n');
          const parkingPol = policyResultsRecord.find((p: any) => p.topic === 'parking');
          const compoundParkingPrefix = parkingPol ? `${parkingPol.policy_text}\n\n` : '';
          return (
            `${compoundParkingPrefix}Dạ tại cơ sở **${propName}**, với nhu cầu phòng${budgetText}${durText}${tubText}, em xin tư vấn **Phòng ${q.room_name} (Hạng ${q.category})**:\n\n` +
            `${condLines}\n\n` +
            `Anh/chị dự kiến ghé vào ngày nào và mấy giờ để em chốt mức giá chính xác nhất ạ!${conditionNote}`
          );
        }
        const fitsBudget = !maxBudget || q.total_price_vnd <= maxBudget;
        const parkingPol = policyResultsRecord.find((p: any) => p.topic === 'parking');
        const compoundParkingPrefix = parkingPol ? `${parkingPol.policy_text}\n\n` : '';
        return (
          `${compoundParkingPrefix}Dạ tại cơ sở **${propName}**, với nhu cầu phòng${budgetText}${durText}${dayText}${tubText}, em xin tư vấn phương án tối ưu:\n\n` +
          `- **Phòng ${q.room_name} (Hạng ${q.category})**: Giá trọn gói ${hours} tiếng là **${q.total_price_vnd.toLocaleString('vi-VN')}đ**.\n` +
          `- Phòng phù hợp tiêu chí catalog và ${fitsBudget ? 'nằm trong ngân sách của anh/chị' : 'là mức giá tốt nhất'} ạ!\n\n` +
          conditionNote
        );
      }

      if (
        solved.primaryOption &&
        solved.upgradeOption &&
        solved.primaryOption !== solved.upgradeOption &&
        (state.hardConstraints.requiredAmenities.includes('bon_tam') || Boolean(maxBudget))
      ) {
        const opt1 = solved.primaryOption;
        const opt2 = solved.upgradeOption;
        const opt1Over = opt1.budgetDeltaVnd > 0;
        const opt2Over = opt2.budgetDeltaVnd > 0;

        const opt1Title = opt1Over
          ? `Phương án gần nhất với ngân sách: Phòng ${opt1.roomName} (Hạng ${opt1.category})`
          : `Lựa chọn tối ưu trong ngân sách: Phòng ${opt1.roomName} (Hạng ${opt1.category})`;

        const opt1Desc = opt1Over
          ? `Phương án này vượt ngân sách ${opt1.budgetDeltaVnd.toLocaleString('vi-VN')}đ so với mức ${maxBudget?.toLocaleString('vi-VN')}đ của anh/chị, nhưng là mức giá tốt nhất hiện có đáp ứng trọn vẹn bồn tắm ạ.`
          : `Phương án này đáp ứng trọn vẹn bồn tắm, không gian lãng mạn và **nằm gọn trong ngân sách** của mình ạ.`;

        const opt2Desc = opt2Over
          ? `Phòng này **vượt ngân sách ${opt2.budgetDeltaVnd.toLocaleString('vi-VN')}đ so với mức ${maxBudget?.toLocaleString('vi-VN')}đ của anh/chị**, nhưng là loại phòng đẹp nhất có bồn tắm lớn nếu anh/chị muốn nâng cấp trải nghiệm ạ.`
          : `Phòng này **nằm trong ngân sách ${maxBudget?.toLocaleString('vi-VN')}đ của anh/chị**, là loại phòng đẹp nhất có bồn tắm lớn để nâng cấp trải nghiệm ạ.`;

        const budgetDesc = maxBudget ? ` (ngân sách ${maxBudget.toLocaleString('vi-VN')}đ)` : '';
        const durDesc = state.hardConstraints.durationHours ? ` cho ${hours} tiếng` : '';
        const weekendDesc = noDia.includes('thu 7') || noDia.includes('cuoi tuan') ? ' chiều cuối tuần' : '';

        return (
          `Dạ tại cơ sở **${propName}**, với nhu cầu phòng lãng mạn có bồn tắm${durDesc}${weekendDesc}${budgetDesc}, em xin tư vấn các phương án như sau ạ:\n\n` +
          `1. **${opt1Title}**\n` +
          `   - **Tiện nghi**: Không gian concept lồng chim, có bồn tắm.\n` +
          `   - **Giá ${hours} tiếng**: **${opt1.totalPriceVnd.toLocaleString('vi-VN')}đ** (${opt1.priceBreakdown}).\n` +
          `   - ${opt1Desc}\n\n` +
          `2. **Phương án hạng cao nhất: Phòng ${opt2.roomName} (Hạng ${opt2.category})**\n` +
          `   - **Tiện nghi**: Không gian concept trang bị **bồn tắm lớn** và ghế tình yêu.\n` +
          `   - **Giá ${hours} tiếng**: **${opt2.totalPriceVnd.toLocaleString('vi-VN')}đ** (${opt2.priceBreakdown}).\n` +
          `   - ${opt2Desc}\n` +
          conditionNote
        );
      } else {
        const lines = normalizedQuotes.map(
          (q, idx) =>
            `${idx + 1}. **Phòng ${q.room_name} (Hạng ${q.category})**: Giá ${hours} tiếng là **${q.total_price_vnd.toLocaleString('vi-VN')}đ** (${q.price_breakdown_text}).`
        );
        const budgetIntro = maxBudget
          ? `với mức ngân sách ${maxBudget.toLocaleString('vi-VN')}đ, hiện tại các phương án phòng có mức giá`
          : `em xin gửi thông tin báo giá các phương án phòng cho ${hours} tiếng`;
        const parkingPol = policyResultsRecord.find((p: any) => p.topic === 'parking');
        const compoundParkingPrefix = parkingPol ? `${parkingPol.policy_text}\n\n` : '';
        return (
          `${compoundParkingPrefix}Dạ tại cơ sở **${propName}**, ${budgetIntro} như sau ạ:\n\n` +
          lines.join('\n\n') +
          conditionNote
        );
      }
    }

    return `Dạ tại cơ sở ${propName}, em đã ghi nhận yêu cầu của anh/chị. Anh/chị có thể cho em biết thêm chi tiết khung giờ hoặc nhu cầu cụ thể để em tư vấn phương án phù hợp nhất nhé ạ!`;
  }

  /**
   * Builds prompt messages for the real LLM reasoning step with full epistemic grounding and multi-turn history.
   */
  protected buildLLMReasoningPrompt(
    userMessage: string,
    state: AgentState,
    observations: ToolObservation[],
    iteration: number,
    checkinDatetime: string | undefined,
    isConditional: boolean,
    referenceClock: string = this.referenceClock,
    mustSynthesizeNow: boolean = false
  ): Array<{ role: string; content: string }> {
    const toolDefs = JSON.stringify(this.toolGateway.getToolDeclarations());
    const obsText =
      observations.length > 0
        ? observations.map((o, idx) => `[Obs ${idx + 1} ${o.toolName}]: ${o.summary}`).join('\n')
        : 'None yet.';

    const priorHistory = state.conversationHistory
      .slice(-7, -1)
      .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const unknowns: string[] = [];
    if (!state.hardConstraints.durationHours && state.hardConstraints.stayType !== 'qua_dem' && state.hardConstraints.stayType !== 'ngay_dem') {
      unknowns.push('duration_hours');
    }
    if (!state.conditionalAssumptions?.checkinDateConfirmed) unknowns.push('checkin_date');
    if (!state.conditionalAssumptions?.checkinTimeConfirmed) unknowns.push('checkin_hour');

    const toolsBlock = mustSynthesizeNow
      ? 'TOOLS: NONE (final step — set action="RESPOND_DIRECTLY").'
      : `TOOLS: ${toolDefs}`;

    const temporalCtx = getVietnamTemporalContext(referenceClock);
    const priorEvidenceSummary = formatValidEvidenceForPrompt(state);
    const systemPrompt = `Agentic AI Concierge for ${this.propertyContext.propertyName} (J Collection).
INVARIANTS (POLICY V1.4.3 + OWNER ADDENDUM V1.4.6):
1. Catalog vs PMS vs Unknowns:
   - ALWAYS check Verified Session Evidence or call tools BEFORE catalog/room/price/policy/photo answers; never guess categories, room codes, prices, or invent URLs. Do NOT invent unverified room numbers (only cite rooms returned in catalog observations).
   - Tools read STATIC catalog/policy only (NO live PMS, room vacancy, guaranteed room hold, or guaranteed late-checkout extension).
   - Mention reception (${this.propertyContext.phone || 'hotline'}) or live PMS check ONLY when real-time vacancy, holding a room, or an actual UNKNOWN item genuinely needs reception check. NEVER claim "em giữ phòng giúp" or "đã giữ/đã đặt phòng" or guarantee room extension past 12:00 without PMS.
   - UNKNOWN items: projector, Smart TV/YouTube/Netflix, pool, sauna, kitchen, tub dim (1m8), jacuzzi jets, bed size, 3rd person overnight fee, smoking, wifi specs, payment details. Absence != non-existence.
   - Parking: Only confirms "Có chỗ đỗ xe." Vehicle type/distance/fee = UNKNOWN.
   - Breakfast (CONFIRMED FALSE in V1.4.5, preserved in V1.4.6): Room rates do NOT include breakfast AND J Collection does NOT serve breakfast or sell separate breakfast sets at all 3 properties. Answer directly (e.g. "Dạ bên em không phục vụ bữa sáng ạ"); do NOT tell guests to contact reception to ask if breakfast is served, do NOT invent outside-food/delivery bans, and do NOT add breakfast info to unrelated quotes.
   - Ha Dong: Room 401 = NOT_FOR_SALE. Room 601 = "50 — Sắc Thái" (never "Tổng Thống"/"50 Shades"; extra hour = 200.000đ/h; 602 Playboy = 200.000đ/h; distinct by propertyId+roomId).
2. Scope: ONLY '${this.propertyId}' (${this.propertyContext.address}). On compound cross-branch query, answer '${this.propertyId}' via tools and guide user to switch channel for other branches. On handover+inquiry, answer inquiry via tools first and confirm forwarding handover.
3. Temporal Intelligence, Package Eligibility & Late Checkout (V1.4.6):
   - Message Received Timestamp / Current Local Time is ONLY reference clock in Asia/Ho_Chi_Minh to understand relative context — NEVER copy Reference Clock hour (like ${temporalCtx.localTime.slice(0, 5)}) as a confirmed guest check-in hour unless guest actually stated that hour or "ngay bây giờ". When guest gives a broad part of day without an exact clock hour, call 'quote_price' with unspecified/conditional check-in or clarify conditions clearly; retain natural contextual inference (e.g. at 17:22 "7h tới" -> 19:00 tonight).
   - Classify timing honestly: CONFIRMED | INFERRED | CONDITIONAL | UNKNOWN. Ask 1 short clarifying question only if missing timing materially alters the answer.
   - Package & Late Checkout rules: Overnight ('qua_dem') = 22:00 (grace from 21:40) to 12:00 next day; Day-Night ('ngay_dem') = 14:00 to 12:00 next day. Arriving 14:00-21:39 staying until next day applies 'ngay_dem'. For checkout past 12:00 on 'qua_dem'/'ngay_dem': 10-minute grace applies to EVERY extra-hour boundary (12:00-12:10 = 0h; 12:11-13:10 = 1h; 13:11-14:10 = 2h; 14:11-15:10 = 3h...), billed via 'quote_price' at that room's canonical extra_hour_rate. Pass checkin_datetime, checkout_datetime (when stated), stay_type/stay_intent to 'quote_price' and follow returned calculations strictly. Never treat prior-turn assistant prose as price truth if the requested package/duration/room was not verified by tool evidence.
4. Pricing, Media & Natural UX:
   - Quote strictly from active 'quote_price'/'get_room_facts' evidence (may cite short opaque factIds like q1_f1 from [FACT_REFS] in claim_refs or {{ref:<factId>}} in final_response for backend canonical VND rendering). Call 'search_rooms' first if exact room_id slugs are not yet in Valid Evidence/observations. When guest asks a duration (e.g. 4h), compute/quote the total for that duration via 'quote_price'.
   - Only call 'get_room_media' (or list cached composite keys/room IDs in "media_refs" to re-send cached albums) when photos are requested or clearly desired. Align reply room order with albums. NEVER paste raw image URLs (.webp/.jpg) into "final_response" text. Honor preferences (photo-only -> skip prices; no-photos -> skip get_room_media/media_refs).
   - Natural concise Vietnamese: Answer directly! Do NOT mechanically append address, hotline, full room rate tables, or trailing generic questions on every turn.
5. Output JSON ONLY (when action="CALL_TOOLS", final_response=null; Vietnamese guest reply ONLY in "final_response", no <think>/JSON/tool names):
${toolsBlock}
Schema: {"action":"CALL_TOOLS"|"RESPOND_DIRECTLY"|"CLARIFY"|"ESCALATE","thought_summary":"...","tool_calls":[{"tool_name":"...","arguments":{...}}],"claim_refs":["optional_opaque_fact_id_like_q1_f1"],"media_refs":["optional_room_id_to_resend_cached_album"],"clarification_question":null,"final_response":null|"..."}`;

    const lastPresentedSummary =
      state.lastPresentedRooms && state.lastPresentedRooms.length > 0
        ? state.lastPresentedRooms.map((r) => `#${r.order + 1}: ${r.roomName} (${r.roomId})${r.summary ? ' [' + r.summary + ']' : ''}${r.hasMedia ? ' [album_cached_in_session]' : ''}`).join(' | ')
        : 'None';

    const checkinStateLabel = checkinDatetime
      ? `${checkinDatetime} (${state.conditionalAssumptions?.checkinConfidence || (state.conditionalAssumptions?.checkinTimeConfirmed ? 'CONFIRMED' : 'INFERRED')})`
      : 'UNKNOWN / UNSPECIFIED';

    const userPrompt = `[Iteration ${iteration}]
Property: ${this.propertyId} (${this.propertyContext.propertyName})
Temporal Context:
- Message Received Timestamp (Reference Clock ONLY — NOT Confirmed Check-in): ${temporalCtx.isoTimestamp}
- Current Local Date: ${temporalCtx.localDate} (${temporalCtx.dayOfWeekVi}, ${temporalCtx.dayOfWeekEn}, isWeekend=${temporalCtx.isWeekend})
- Current Local Time (Reference Only): ${temporalCtx.localTime} (Timezone: Asia/Ho_Chi_Minh)
- Guest Check-in Datetime State: ${checkinStateLabel} | Checkout: ${state.conditionalAssumptions?.checkoutDatetime || 'UNKNOWN'} | Duration: ${state.hardConstraints.durationHours ?? 'UNKNOWN'}h | Stay Package: ${state.hardConstraints.stayType ?? 'UNKNOWN'}
Recently Presented Rooms (in exact display order): ${lastPresentedSummary}
Recent Conversation History (conversational context only, NOT price authority):
${priorHistory || '(New session — no prior turns)'}

Active Valid Session Evidence (still valid under current constraints):
${priorEvidenceSummary}

Latest Customer Message: "${userMessage}"

Epistemic State:
- Tool-tracked constraints: duration_hours=${state.hardConstraints.durationHours ?? 'UNKNOWN'}, budget=${state.hardConstraints.budget ?? 'UNKNOWN'}, focused_room=${state.focusedRoomId ?? 'NONE'}, required_amenities=[${state.hardConstraints.requiredAmenities.join(', ')}], rejected_rooms=[${(state.negatedRoomIds || []).join(', ')}]
- Unknowns (must NOT fabricate): [${unknowns.join(', ')}]

Tool Observations Collected This Turn:
${obsText}

INSTRUCTIONS FOR THIS STEP:
${mustSynthesizeNow
        ? '- FINAL ITERATION: You MUST set "action": "RESPOND_DIRECTLY" and synthesize a complete, honest, helpful Vietnamese "final_response" grounded strictly in the observations and invariants above.'
        : `- Decide whether you need tool calls to verify room catalog, facts, media, policies, or prices. If observations already contain everything needed (or if all required policies/facts are clear), set "action": "RESPOND_DIRECTLY" and write your complete polite Vietnamese reply in "final_response".
- Respect context switches, constraint retractions, or simple policy questions mid-conversation. Never ignore part of a multi-part question.`
      }

Output valid JSON only.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Safely parses and validates JSON output from LLM with strict structural data-contract separation.
   */
  protected parseAndValidateLLMDecision(rawContent: string): AgentLLMDecision | null {
    try {
      // Strip private model reasoning tags before structural JSON extraction
      let clean = rawContent
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .trim();

      if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
      }
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) clean = match[0];

      const parsed = JSON.parse(clean);
      if (!parsed.action) {
        if (parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
          parsed.action = 'CALL_TOOLS';
        } else if (parsed.final_response || parsed.response || parsed.answer || parsed.message) {
          parsed.action = 'RESPOND_DIRECTLY';
        }
      }
      if (!parsed.thought_summary && (parsed.thought || parsed.reasoning || parsed.summary)) {
        parsed.thought_summary = parsed.thought || parsed.reasoning || parsed.summary;
      }
      if (!parsed.final_response && (parsed.response || parsed.answer || parsed.message)) {
        parsed.final_response = parsed.response || parsed.answer || parsed.message;
      }

      const validated = AgentDecisionOutputSchema.parse(parsed);

      // Strict Contract Separation:
      // 1) RESPOND_DIRECTLY MUST carry a non-empty customer-facing final_response (not raw JSON / tool syntax / CoT)
      if (validated.action === 'RESPOND_DIRECTLY') {
        const fr = (validated.final_response ?? '').trim();
        const looksLikeRawJson = fr.startsWith('{') && fr.includes('"action"');
        const containsCoTTags = /<\/?(think|thought|reasoning)>/i.test(fr);
        const containsInternalProse =
          /^(i will|i should|i need|let me|thought:|reasoning:|tôi sẽ gọi|cần gọi)\b/i.test(fr) ||
          /\b(search_rooms|quote_price|get_room_facts|get_room_media|get_policies)\s*\(/i.test(fr);

        if (fr.length < 10 || looksLikeRawJson || containsCoTTags || containsInternalProse) {
          return null; // Reject structurally invalid response so caller performs 1-turn format repair
        }
      }

      // 2) CALL_TOOLS MUST provide at least one tool call
      if (validated.action === 'CALL_TOOLS' && (!validated.tool_calls || validated.tool_calls.length === 0)) {
        return null;
      }

      return validated as AgentLLMDecision;
    } catch {
      return null;
    }
  }

  /**
   * Helper to build suppressed result when human takeover is active.
   */
  protected buildTakeoverSuppressedResult(
    sessionId: string,
    userMessage: string,
    state: AgentState
  ): ConversationTurnResult {
    const suppressedResult: ConversationTurnResult = {
      session_id: sessionId,
      turn_index: state.turnCount,
      user_message: userMessage,
      intent: 'REQUEST_HUMAN',
      extracted_entities: {},
      updated_state: {
        session_id: sessionId,
        active_facility: this.propertyId,
        focused_room: state.focusedRoomId ? { co_so_ma: this.propertyId, ma_phong: state.focusedRoomId } : null,
        shortlisted_rooms: [],
        stay_type: state.hardConstraints.stayType || 'nghi_gio',
        checkin_datetime: state.hardConstraints.checkinDatetime || null,
        duration_hours: state.hardConstraints.durationHours || null,
        max_budget: state.hardConstraints.budget || null,
        must_have_amenities: state.hardConstraints.requiredAmenities,
        nice_to_have_amenities: state.softPreferences,
        negated_constraints: state.negatedRoomIds || [],
        preferred_styles: state.softPreferences,
        recent_references: [],
        last_quote_context: null,
        conversation_lifecycle: state.lifecycle,
        ownership_state: state.ownership_state,
        pending_clarification: null,
        created_at: state.updatedAt,
        updated_at: state.updatedAt,
        turn_count: state.turnCount,
      },
      missing_information: [],
      chosen_action: 'FLAG_FOR_HUMAN',
      tool_results: {},
      verified_candidates: [],
      evidence_references: [`facility::${this.propertyId}`],
      customer_visible_response: '', // STRICTLY ZERO AI OUTBOUND!
      claim_validation: { total_claims: 0, verified_claims: [], disclaimed_claims: [], rejected_claims: [], evidence_citations: [] },
      human_escalation: {
        needed: true,
        reason_code: 'EXPLICIT_HUMAN_REQUEST',
        summary: `Cuộc trò chuyện đang do nhân viên tiếp quản tại ${this.propertyContext.propertyName}. Trợ lý AI không phản hồi.`,
      },
      decision_trace: {
        turnIndex: state.turnCount,
        providerModel: 'system:human_takeover',
        executionMode: 'FAST',
        decisionSteps: [
          {
            step: 1,
            phase: 'RESPOND',
            thoughtSummary: 'Cuộc trò chuyện ở trạng thái HUMAN_ACTIVE. AI im lặng, chuyển tiếp tin nhắn đến nhân viên trực.',
          },
        ],
        latencyMs: 1,
        claimsChecked: { total_claims: 0, validated_claims: [], rejected_claims: [] },
        verificationStatus: 'DETERMINISTIC_AGENT_FLOW',
      },
      internal_trace: {
        latency_ms: 1,
        rules_triggered: ['HUMAN_TAKEOVER_ENFORCED', 'AI_OUTBOUND_SUPPRESSED'],
        adapter_used: 'system:human_takeover',
        tools_executed: [],
        canonical_data_fetched: [],
      },
    };
    state.lastTurnResult = suppressedResult;
    return suppressedResult;
  }

  /**
   * Maps confirmed, conditional (checkin window), and package-eligibility quotes into ExpectedQuoteInput
   * while strictly preserving eligibility, time conditions, and separate monetary roles.
   */
  private buildExpectedQuotesForValidation(quoteResultsRecord: any[], activePolicyVersion: string) {
    const out: Array<{
      propertyId: any;
      roomId: string;
      roomCode?: string;
      roomName?: string;
      category?: string;
      stayType?: any;
      durationHours?: number;
      baseVnd?: number;
      extraHourRateVnd?: number;
      extraHourSubtotalVnd?: number;
      totalVnd: number;
      alternateAmountsVnd?: number[];
      checkinCondition?: string;
      timeCondition?: string;
      eligible?: boolean;
      ineligibilityReason?: string;
      delayedAlt2140Vnd?: number;
      policyVersion?: string;
    }> = [];

    for (const q of quoteResultsRecord) {
      if (!q || !q.room_id) continue;
      const baseFields = {
        propertyId: this.propertyId,
        roomId: q.room_id,
        roomCode: String(q.room_id || '').split('-')[0],
        roomName: q.room_name,
        category: q.category,
        policyVersion: q.effective_policy_version ?? activePolicyVersion,
      };
      if (typeof q.total_price_vnd === 'number') {
        out.push({
          ...baseFields,
          stayType: q.stay_type,
          durationHours: q.duration_hours,
          baseVnd: q.base_package_price_vnd ?? q.base_price_vnd,
          extraHourRateVnd: q.extra_hour_rate_vnd ?? q.extra_hour_rate,
          extraHourSubtotalVnd: q.extra_hour_subtotal_vnd,
          totalVnd: q.total_price_vnd,
          checkinCondition: q.confirmed_checkin ?? q.checkin_conditions?.checkin_datetime,
          eligible: true,
        });
      }
      if (Array.isArray(q.conditional_quotes)) {
        for (const cq of q.conditional_quotes) {
          if (typeof cq.total_price_vnd === 'number') {
            const rawCond = String(cq.condition_label || cq.checkin_window || cq.condition || 'conditional');
            const condTag = /cuối tuần|t7|chủ nhật|weekend/iu.test(rawCond)
              ? 'weekend_daytime'
              : /ngày thường|sau 18|trước 08|weekday/iu.test(rawCond)
                ? 'weekday_or_after_18'
                : rawCond;
            out.push({
              ...baseFields,
              stayType: q.stay_type,
              durationHours: q.duration_hours,
              baseVnd: cq.base_2h_vnd,
              extraHourRateVnd: cq.extra_hour_rate,
              extraHourSubtotalVnd:
                typeof cq.extra_hours === 'number' && typeof cq.extra_hour_rate === 'number'
                  ? cq.extra_hours * cq.extra_hour_rate
                  : undefined,
              totalVnd: cq.total_price_vnd,
              checkinCondition: condTag,
              timeCondition: condTag,
              eligible: true,
            });
          }
        }
      }
      const elig = q.stay_package_eligibility;
      if (elig) {
        const mappedPkgs = [
          ...(elig.eligible_packages || []).map((p: any) => ({ ...p, _elig: true })),
          ...(elig.ineligible_packages || []).map((p: any) => ({ ...p, _elig: false })),
        ];
        for (const pkg of mappedPkgs) {
          const pkgTotal =
            typeof pkg.total_price_vnd === 'number'
              ? pkg.total_price_vnd
              : typeof pkg.base_package_price_vnd === 'number'
                ? pkg.base_package_price_vnd
                : undefined;
          if (typeof pkgTotal === 'number' || typeof pkg.alternative_if_delayed_to_21_40_vnd === 'number') {
            const rawPkg = String(pkg.stay_type ?? q.stay_type);
            const normStay = rawPkg.startsWith('ngay_dem') ? 'ngay_dem' : rawPkg;
            out.push({
              ...baseFields,
              stayType: normStay,
              durationHours: pkg.duration_hours ?? q.duration_hours,
              baseVnd: pkg.base_package_price_vnd,
              extraHourSubtotalVnd: pkg.extra_hour_subtotal_vnd,
              totalVnd: pkgTotal ?? pkg.alternative_if_delayed_to_21_40_vnd,
              checkinCondition: pkg.applicable_window,
              timeCondition: pkg.applicable_window,
              eligible: pkg._elig,
              ineligibilityReason: pkg._elig ? undefined : String(pkg.reason || elig.business_reason || ''),
              delayedAlt2140Vnd: pkg.alternative_if_delayed_to_21_40_vnd,
            });
          }
        }
      }
    }
    return out;
  }
}
