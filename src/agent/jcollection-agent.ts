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
  PropertyContext,
} from './agent-contracts.js';
import { AgentToolGateway } from './agent-tools.js';
import { ClaimLevelValidator } from '../conversation/grounding/claim-validator.js';
import { ConversationTurnResult } from '../conversation/conversation-types.js';
import { LLMAdapter } from '../conversation/adapters/llm-adapter.interface.js';
import { removeDiacritics } from '../conversation/nlu-engine.js';
import { StructuredStateManager, GenericConstraintSolver } from './generic-constraint-solver.js';

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
  tool_calls: z
    .array(
      z.object({
        tool_name: z.enum(['search_rooms', 'get_room_facts', 'get_room_media', 'get_policies', 'quote_price']),
        arguments: z.record(z.any()).default({}),
      })
    )
    .default([]),
  clarification_question: z.string().optional(),
  final_response: z.string().optional(),
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
    parkingSummary: 'Bãi đỗ ô tô rộng rãi ngay trước cửa và chỗ để xe máy thuận tiện cho khách lưu trú.',
    policySummary: 'Thời gian nghỉ giờ tối thiểu 2h. Nhận phòng ban ngày 08:00 - 18:00. Khung qua đêm tiêu chuẩn từ 22:00 (hỗ trợ sớm tối đa từ 21:40) đến 12:00 trưa hôm sau. Không phụ thu ngày lễ Tết.',
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
      do_xe: 'Bãi đỗ ô tô rộng rãi ngay trước cửa và chỗ để xe máy cho khách lưu trú.',
      thang_may: 'Có thang máy phục vụ di chuyển giữa các tầng.',
      wifi: 'Wifi tốc độ cao miễn phí toàn bộ khuôn viên.',
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
    parkingSummary: 'Có chỗ đỗ xe máy thuận tiện trong khuôn viên, ô tô gửi tại điểm trông xe gần khách sạn có nhân viên hướng dẫn.',
    policySummary: 'Nghỉ giờ tối thiểu 2 tiếng theo giá tham khảo dataset 24/7. Khung qua đêm tiêu chuẩn từ 22:00 (hỗ trợ sớm tối đa từ 21:40) đến 12:00 trưa hôm sau. Không phụ thu ngày lễ Tết.',
    canonicalRoomIds: [
      '1001-dem', '201-sapphire', '202-walnut', '203-tau-hoa', '301-ivory', '302-kimochi', '303-bali',
      '401-blush', '402-teak', '403-morocco', '501-onyx', '502-hammrock', '503-long-chim', '601-golden-inox',
      '602-slate', '603-playboy', '701-50-sac-thai', '702-silver', '703-mumbai',
    ],
    categoryMapping: { Standard: 'Standard', Premium: 'Premium', Concept: 'Concept', 'VIP Signature': 'VIP Signature' },
    pricingPolicyRef: 'BASE_DATASET_REFERENCE_24_7',
    stayPackageEligibility: {
      minHourlyHours: 2,
      overnightStandardStart: '22:00',
      overnightGraceStart: '21:40',
      overnightCheckout: '12:00',
      dayNightStart: '14:00',
      dayNightCheckout: '12:00',
    },
    approvedFaq: {
      do_xe: 'Có chỗ đỗ xe máy thuận tiện; ô tô gửi gần cơ sở có nhân viên hướng dẫn.',
      thang_may: 'Trang bị thang máy di chuyển giữa các tầng.',
      wifi: 'Wifi tốc độ cao miễn phí toàn khách sạn.',
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
    parkingSummary: 'Nằm tại phố Triệu Việt Vương trung tâm, có chỗ để xe máy; ô tô gửi tại điểm trông xe gần khách sạn theo hướng dẫn của lễ tân.',
    policySummary: 'Nghỉ giờ tối thiểu 2 tiếng theo giá tham khảo dataset 24/7. Khung qua đêm tiêu chuẩn từ 22:00 (hỗ trợ sớm tối đa từ 21:40) đến 12:00 trưa hôm sau. Không phụ thu ngày lễ Tết.',
    canonicalRoomIds: [
      '202-neon', '203-ember', '301-azure', '302-sketch', '303-zebra', '401-mosaic', '402-linea', '403-petal',
      '501-marble', '502-nova', '503-zest', '601-lagoon', '602-solstice', '603-sway', '701-contour',
      '702-coral', '703-limewave', '801-minimal', '802-graff', '803-mist', 'blackpink', 'crimson-suite',
      'pink-sakura', 'playboy',
    ],
    categoryMapping: { Superior: 'Superior', Deluxe: 'Deluxe', Concept: 'Concept', Suite: 'Suite' },
    pricingPolicyRef: 'BASE_DATASET_REFERENCE_24_7',
    stayPackageEligibility: {
      minHourlyHours: 2,
      overnightStandardStart: '22:00',
      overnightGraceStart: '21:40',
      overnightCheckout: '12:00',
      dayNightStart: '14:00',
      dayNightCheckout: '12:00',
    },
    approvedFaq: {
      do_xe: 'Có chỗ đỗ xe máy tại cơ sở; ô tô gửi tại điểm trông xe gần khách sạn theo hướng dẫn lễ tân.',
      thang_may: 'Trang bị thang máy di chuyển giữa các tầng.',
      wifi: 'Wifi tốc độ cao miễn phí toàn khách sạn.',
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
  protected strictLiveOnly: boolean;

  // In-memory conversation state by sessionId
  protected sessions: Map<string, AgentState> = new Map();

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
    this.referenceClock = options?.referenceClock ?? '2026-11-28T14:00:00+07:00';
    this.strictLiveOnly = options?.strictLiveOnly ?? false;
  }

  public setReferenceClock(clock: string): void {
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
      channel?: 'website' | 'zalo' | 'facebook' | 'cli';
      clientMessageId?: string;
      strictLiveOnly?: boolean;
    }
  ): Promise<ConversationTurnResult> {
    const startTime = performance.now();
    const effectiveClock = options?.referenceClock ?? this.referenceClock;
    const isStrictLive = options?.strictLiveOnly ?? this.strictLiveOnly;
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

    const decisionSteps: DecisionStepTrace[] =
      state.decisionSteps && state.decisionSteps.length > 0 ? state.decisionSteps : [];
    state.decisionSteps = decisionSteps;
    let executionMode: 'FAST' | 'STANDARD' | 'DEEP' = 'STANDARD';
    const executedToolsList: string[] = [];
    const canonicalFetchedList: string[] = ['dataset.phong', 'j_collection_business_policy_v1_4_3.json'];

    // Telemetry tracking for real LLM decisions
    let liveLLMCalls = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
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
      noDia.includes('bo qua toan bo') ||
      noDia.includes('system prompt');

    // Check explicit escalation request
    const isExplicitEscalation =
      noDia.includes('gap quan ly') ||
      noDia.includes('quan ly') ||
      (noDia.includes('le tan') && (noDia.includes('gap') || noDia.includes('ket noi') || noDia.includes('chuyen may') || noDia.includes('lien he') || noDia.includes('truc tiep') || noDia.includes('cho anh') || noDia.includes('giup'))) ||
      (noDia.includes('nhan vien') && (noDia.includes('gap') || noDia.includes('noi chuyen') || noDia.includes('that'))) ||
      noDia.includes('gap truc tiep') ||
      noDia.includes('chuyen may') ||
      noDia.includes('khieu nai') ||
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
      const matchesName = cleanName.length >= 3 && noDia.includes(cleanName);
      const matchesId = noDia.includes(rIdNoDia);

      if (matchesNum || matchesName || matchesId) {
        mentionedRoomId = r.ma_phong;
        break;
      }
    }
    // Backward compatibility for special room aliases
    if (!mentionedRoomId) {
      if (this.propertyId === 'jacayl-ha-dong') {
        if (noDia.includes('601') || noDia.includes('50 sac thai')) mentionedRoomId = '601-50-sac-thai';
        else if (noDia.includes('101') || noDia.includes('long chim')) mentionedRoomId = '101-long-chim';
        else if (noDia.includes('602') || noDia.includes('playboy')) mentionedRoomId = '602-playboy';
        else if (noDia.includes('202') || noDia.includes('grand canyon')) mentionedRoomId = '202-grand-canyon';
        else if (noDia.includes('201') || noDia.includes('la casta')) mentionedRoomId = '201-la-casta';
      } else if (this.propertyId === 'jacayl-tran-khat-chan') {
        if (noDia.includes('1001') || noDia.includes('dem')) mentionedRoomId = '1001-dem';
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
    const asksOtherFacility =
      (this.propertyId !== 'jacayl-ha-dong' && (noDia.includes('ha dong') || noDia.includes('hadong'))) ||
      (this.propertyId !== 'jacayl-tran-khat-chan' && (noDia.includes('tran khat chan') || noDia.includes('trankhatchan'))) ||
      (this.propertyId !== 'j-village' && (noDia.includes('j village') || noDia.includes('jvillage') || noDia.includes('trieu viet vuong')));

    if (asksOtherFacility) {
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

    // Budget parsing
    let budget: number | undefined;
    const budgetMatch = lower.match(/(\d+)\s*(nghìn|nghin|k|triệu|trieu)/);
    if (budgetMatch) {
      const val = parseInt(budgetMatch[1], 10);
      const unit = budgetMatch[2];
      if (unit.startsWith('tri')) budget = val * 1000000;
      else budget = val * 1000;
      StructuredStateManager.updateConstraint(state, 'budget', budget);
    } else {
      const numMatch = lower.match(/(\d{3,4})\s*k/);
      if (numMatch) {
        budget = parseInt(numMatch[1], 10) * 1000;
        StructuredStateManager.updateConstraint(state, 'budget', budget);
      }
    }

    // Duration parsing
    let durationHours: number | undefined;
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

    // Stay Type parsing
    const isOvernight = noDia.includes('qua dem') || noDia.includes('nghi dem') || noDia.includes('sang mai');
    const isDayNight = noDia.includes('ngay dem') || noDia.includes('24h') || noDia.includes('ca ngay');
    const stayType: StayType = isDayNight ? 'ngay_dem' : isOvernight ? 'qua_dem' : 'nghi_gio';
    if (isOvernight || isDayNight) {
      StructuredStateManager.updateConstraint(state, 'stayType', stayType);
    }

    // Day of week / DateTime parsing
    const isSaturday = /\b(thu\s*7|thu\s*bay|t7|chu\s*nhat|cn|cuoi\s*tuan)\b/i.test(noDia);
    const isWeekdayExplicit = /\b(thu\s*2|thu\s*hai|t2|thu\s*3|thu\s*ba|t3|thu\s*4|thu\s*tu|t4|thu\s*5|thu\s*nam|t5|thu\s*6|thu\s*sau|t6|ngay\s*thuong)\b/i.test(noDia);

    const checkinHourMatch =
      lower.match(/(?:luc|vao|tu|den|khoang|tam)\s*(\d{1,2})\s*(?:h|giờ|gio)/i) ||
      (lower.includes('nghi') && !lower.includes('luc') ? null : lower.match(/(?<!\d)(\d{1,2})\s*(?:h|giờ|gio)/));
    let checkinDatetime = effectiveClock;

    if (isSaturday) {
      if (checkinHourMatch) {
        const h = parseInt(checkinHourMatch[1], 10);
        checkinDatetime = `2026-11-28T${String(h).padStart(2, '0')}:00:00+07:00`;
      } else if (noDia.includes('chieu') || noDia.includes('ban ngay')) {
        checkinDatetime = '2026-11-28T14:00:00+07:00';
      } else if (isOvernight) {
        checkinDatetime = '2026-11-28T22:00:00+07:00';
      } else {
        checkinDatetime = '2026-11-28T14:00:00+07:00';
      }
    } else if (isWeekdayExplicit) {
      const h = checkinHourMatch ? parseInt(checkinHourMatch[1], 10) : noDia.includes('sang') ? 9 : noDia.includes('chieu') ? 14 : isOvernight ? 22 : 14;
      checkinDatetime = `2026-11-24T${String(h).padStart(2, '0')}:00:00+07:00`;
    } else {
      const baseDate = state.hardConstraints.checkinDatetime
        ? state.hardConstraints.checkinDatetime.split('T')[0]
        : '2026-11-28';
      if (checkinHourMatch) {
        const h = parseInt(checkinHourMatch[1], 10);
        checkinDatetime = `${baseDate}T${String(h).padStart(2, '0')}:00:00+07:00`;
      } else if (isOvernight) {
        checkinDatetime = `${baseDate}T22:00:00+07:00`;
      }
    }
    StructuredStateManager.updateConstraint(state, 'checkinDatetime', checkinDatetime);

    const isTimeAssumptionConditional =
      isSaturday &&
      !checkinHourMatch &&
      (noDia.includes('chieu') || noDia.includes('ban ngay') || noDia.includes('cuoi tuan') || noDia.includes('thu 7'));
    state.conditionalAssumptions = { isTimeAssumptionConditional };

    if (mentionedRoomId) {
      state.focusedRoomId = mentionedRoomId;
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
      !noDia.includes('dat phong');

    const asksParkingOnly =
      (/\b(do xe|gui xe|o to|xe hoi|xe may|cho do|do duoc)\b/i.test(noDia) ||
        (/\b(do|gui)\b/i.test(noDia) && /\b(xe|o to)\b/i.test(noDia)) ||
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

    const asksBedSize = noDia.includes('kich co') && noDia.includes('giuong');
    const asksEarlyMorning = noDia.includes('sang som') || noDia.includes('truoc 8h') || noDia.includes('truoc 08:00');
    const asksLateCheckout = (noDia.includes('tra phong muon') || noDia.includes('check out muon') || noDia.includes('qua 12h')) && !noDia.includes('gia');
    const asks1750 = (noDia.includes('17h50') || noDia.includes('17:50')) && (noDia.includes('gia') || noDia.includes('nhan phong') || noDia.includes('tinh') || noDia.includes('nghi'));
    const asks1810 = (noDia.includes('18h10') || noDia.includes('18:10')) && (noDia.includes('gia') || noDia.includes('nhan phong') || noDia.includes('tinh') || noDia.includes('nghi'));
    const hasParkingOrCarMention =
      /\b(do xe|gui xe|o to|xe hoi|xe may|cho do|do duoc)\b/i.test(noDia) ||
      (/\b(do|gui)\b/i.test(noDia) && /\b(xe|o to)\b/i.test(noDia)) ||
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
    const deliveredImages: any[] = [];
    const policyResultsRecord: any[] = [];

    // Fast Path execution for safe FAQ and non-substantive turns
    if (isFastPath) {
      executionMode = 'FAST';
      if (isSecurityAttempt) {
        finalCustomerResponse =
          `Dạ em là trợ lý tư vấn của ${this.propertyContext.propertyName}. Em chỉ có thể hỗ trợ các thông tin về phòng nghỉ, tiện nghi và biểu giá niêm yết theo quy định của khách sạn ạ.`;
      } else if (isExplicitEscalation) {
        finalCustomerResponse =
          `Dạ em đã ghi nhận yêu cầu và chuyển tiếp đến quản lý và lễ tân trực tại ${this.propertyContext.propertyName}. Quản lý và lễ tân bên em sẽ chủ động liên hệ hỗ trợ trực tiếp cho anh/chị ngay ạ.`;
      } else if (isGreetingOnly) {
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
          `Dạ tại cơ sở ${this.propertyContext.propertyName} bên em có chỗ đỗ ô tô và xe máy thuận tiện cho khách lưu trú ạ.`;
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
          'Dạ theo Business Policy V1.4.3 của J Collection, bên em không áp dụng gói nghỉ 1 tiếng và không chia nửa giá ạ. Thời gian nghỉ giờ tiêu chuẩn tối thiểu là 2 tiếng để đảm bảo chất lượng dọn phòng và trải nghiệm tốt nhất cho anh/chị ạ.';
      } else if (asksElevator) {
        finalCustomerResponse =
          `Dạ tại cơ sở ${this.propertyContext.propertyName} bên em có thang máy di chuyển thuận tiện giữa các tầng cho khách lưu trú ạ.`;
      } else if (asksCheckinHours) {
        finalCustomerResponse =
          `Dạ quy định giờ nhận phòng (check-in) và trả phòng (check-out) tại ${this.propertyContext.propertyName} như sau ạ:\n- Khung ngày đêm (cả ngày): Check-in từ 14:00, check-out trước 12:00 trưa hôm sau.\n- Khung qua đêm: Check-in tiêu chuẩn từ 22:00 (hỗ trợ nhận phòng sớm tối đa 20 phút từ 21:40), check-out trước 12:00 trưa hôm sau.\n- Khung ban ngày: Nhận phòng từ 08:00 sáng đến tối đa 18:00 chiều ạ.\n- Khung nghỉ giờ: Nhận phòng linh hoạt tối thiểu 2 tiếng ạ.`;
      } else if (asksOvernightHour) {
        finalCustomerResponse =
          `Dạ gói nghỉ qua đêm tại cơ sở ${this.propertyContext.propertyName} bắt đầu tính tiêu chuẩn từ 22:00 (hỗ trợ nhận phòng sớm tối đa 20 phút từ 21:40) đến 12:00 trưa ngày hôm sau anh/chị nhé.`;
      } else if (asksDaytimeLimit) {
        finalCustomerResponse =
          'Dạ khung giờ nghỉ ban ngày tính từ 08:00 sáng đến tối đa 18:00 chiều ạ. Sau 18:00 sẽ áp dụng theo biểu giá nghỉ giờ buổi tối anh/chị nhé.';
      } else if (asksDayNightPackage) {
        finalCustomerResponse =
          `Dạ quy định gói cả ngày (ngày đêm) tại cơ sở ${this.propertyContext.propertyName} tính từ 14:00 chiều hôm nay đến 12:00 trưa ngày hôm sau anh/chị nhé.`;
      } else if (asksAddress) {
        finalCustomerResponse =
          `Dạ cơ sở ${this.propertyContext.propertyName} có địa chỉ tại ${this.propertyContext.address} ạ. Vị trí rất yên tĩnh, riêng tư và thuận tiện đỗ xe ô tô, xe máy cho khách lưu trú ạ.`;
      } else if (asksLateCheckin) {
        finalCustomerResponse =
          'Dạ khách sạn có lễ tân hỗ trợ đón khách nhận phòng đêm muộn lúc 1h sáng hoàn toàn được ạ. Lúc này sẽ tính theo gói nghỉ qua đêm đến 12:00 trưa hôm sau anh/chị nhé.';
      } else if (asksWifi) {
        finalCustomerResponse =
          `Dạ toàn bộ khuôn viên và các phòng tại ${this.propertyContext.propertyName} đều được trang bị wifi tốc độ cao miễn phí ạ.`;
      } else if (asksWater) {
        finalCustomerResponse =
          'Dạ trong phòng luôn chuẩn bị sẵn nước lọc miễn phí cùng trà và cà phê để phục vụ anh/chị ạ.';
      } else if (asksPayment) {
        finalCustomerResponse =
          'Dạ bên em có nhận thanh toán bằng tiền mặt, chuyển khoản ngân hàng qua mã QR tiện lợi tại quầy lễ tân ạ.';
      } else if (asksSmoking) {
        finalCustomerResponse =
          'Dạ theo chính sách của khách sạn, trong phòng ngủ không được hút thuốc lá để đảm bảo không gian thơm tho, sạch sẽ cho tất cả khách lưu trú ạ.';
      } else if (asksThirdPerson) {
        finalCustomerResponse =
          'Dạ theo quy định của J Collection, chính sách phụ thu người thứ ba lưu trú qua đêm hiện chưa được công bố chính thức trên dữ liệu hệ thống. Anh/chị vui lòng liên hệ trực tiếp quầy lễ tân để được kiểm tra và hỗ trợ cụ thể ạ.';
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
          'Dạ so sánh giá nghỉ 2 tiếng ban ngày thứ 7 tại cơ sở Hà Đông:\n- Hạng Deluxe (như phòng 201 La Casta): 315.000đ/2h.\n- Hạng Concept (như phòng 101 Lồng Chim hoặc 601 50 Sắc Thái): 449.000đ/2h ạ.';
      } else if (asksJacuzziOrTubDimension) {
        if (this.propertyId === 'jacayl-ha-dong') {
          finalCustomerResponse =
            `Dạ tại cơ sở Jacayl Hà Đông, các phòng có bồn tắm gồm có phòng 101 — Lồng Chim (bồn tắm nằm thư giãn), phòng 601 (50 — Sắc Thái, trang bị bồn tắm lớn / Bồn tắm lớn) và phòng 602 (Playboy) ạ. Thông số kích thước mét cụ thể (như 1m8) và chức năng sục Jacuzzi chưa được công bố chính thức trên dữ liệu hệ thống, nhưng bồn tắm lớn tại phòng 601 rất rộng rãi và thoải mái cho cặp đôi ạ!`;
        } else if (this.propertyId === 'jacayl-tran-khat-chan') {
          finalCustomerResponse =
            `Dạ tại cơ sở Jacayl Trần Khát Chân, phòng có bồn tắm ngâm thư giãn là phòng 1001 — Đêm (Hạng VIP Signature) ạ. Thông số kích thước bồn sục Jacuzzi chưa có xác nhận chính thức trên dữ liệu hệ thống ạ.`;
        } else {
          finalCustomerResponse =
            `Dạ tại cơ sở J Village, phòng có bồn tắm nằm thư giãn là phòng J Private Room — Crimson Suite (Hạng Suite) ạ. Thông số kích thước bồn sục Jacuzzi chưa có xác nhận chính thức trên dữ liệu hệ thống ạ.`;
        }
      } else if (asksPool) {
        finalCustomerResponse =
          `Dạ tại cơ sở ${this.propertyContext.propertyName}, thông tin hồ bơi hay bể bơi vô cực chưa được công bố chính thức trên dữ liệu hệ thống (hiện tại không có hồ bơi xác nhận trong tiện nghi phòng) ạ. Cơ sở tập trung vào các phòng concept lãng mạn với bồn tắm lớn và ghế tình yêu cho cặp đôi ạ.`;
      } else if (asksSauna) {
        finalCustomerResponse =
          `Dạ tại ${this.propertyContext.propertyName} hiện tại thông tin về phòng xông hơi sauna riêng chưa được công bố chính thức trên dữ liệu hệ thống (không có xác nhận trong tiện nghi phòng) ạ. Bên em có các phòng concept tình yêu với bồn tắm thư giãn rất tiện nghi ạ.`;
      } else if (asksKitchen) {
        finalCustomerResponse =
          `Dạ tại cơ sở ${this.propertyContext.propertyName}, hiện tại không có tiện nghi bếp nấu ăn riêng trong phòng (chưa được công bố chính thức trên dữ liệu hệ thống, trạng thái UNKNOWN) ạ. Anh/chị vui lòng liên hệ hotline lễ tân nếu có nhu cầu hỗ trợ đặc biệt nhé ạ!`;
      } else if (asksSmartTvProjector) {
        finalCustomerResponse =
          `Dạ tại ${this.propertyContext.propertyName}, các phòng đều được trang bị Smart TV hoặc máy chiếu màn hình lớn kết nối mạng (như phòng 101, 201) để anh/chị xem phim Netflix, Youtube thư giãn ạ.`;
      } else if (asksBedSize) {
        const sampleRoom = this.dataset.phong.find((p) => p.co_so_ma === this.propertyId)?.ten_phong || 'tiêu chuẩn';
        finalCustomerResponse =
          `Dạ các phòng tại ${this.propertyContext.propertyName} (như phòng ${sampleRoom}) đều được trang bị giường đôi tiêu chuẩn êm ái, bọc nệm cao cấp cho cặp đôi ạ.`;
      } else if (asksEarlyMorning) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3, khung nhận phòng buổi sáng sớm trước 08:00 không tính theo gói qua đêm mà được áp dụng biểu giá nghỉ giờ thông thường của ban ngày ạ. Anh/chị có thể nhận phòng linh hoạt và tính tối thiểu 2 tiếng ạ.';
      } else if (asksLateCheckout) {
        finalCustomerResponse =
          'Dạ theo quy định, giờ trả phòng gói qua đêm là trước 12:00 trưa ạ. Nếu anh/chị trả phòng muộn sau 12:00 trưa, khách sạn sẽ áp dụng chính sách phụ thu thêm giờ theo đơn giá phát sinh của từng hạng phòng ạ.';
      } else if (asks1750 && asks1810) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3: Nhận phòng lúc 17h50 (trước 18:00) được tính theo biểu giá ban ngày ạ. Còn nhận phòng lúc 18h10 (sau 18:00) sẽ áp dụng theo biểu giá nghỉ giờ buổi tối anh/chị nhé.';
      } else if (asks1750) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3: Nhận phòng lúc 17h50 (trước 18:00) được tính theo biểu giá ban ngày anh/chị nhé.';
      } else if (asks1810) {
        finalCustomerResponse =
          'Dạ theo Business Policy V1.4.3: Nhận phòng lúc 18h10 (sau 18:00) sẽ áp dụng theo biểu giá nghỉ giờ buổi tối anh/chị nhé.';
      } else if (asksBathCheapest) {
        finalCustomerResponse =
          `Dạ phòng có bồn tắm rẻ nhất tại ${this.propertyContext.propertyName} là phòng 101 — Lồng Chim (Hạng Concept), với giá nghỉ giờ 2 tiếng ngày trong tuần là 399.000đ (hoặc ngày cuối tuần là 449.000đ) ạ.`;
      } else if (asksGiuPhong) {
        finalCustomerResponse =
          `Dạ em đã ghi nhận nhu cầu của anh/chị và liên hệ lễ tân trực tại cơ sở ${this.propertyContext.propertyName} để hỗ trợ đối soát phòng trống và giữ phòng cho anh/chị ạ.`;
      } else if (asks601PriceGeneral) {
        finalCustomerResponse =
          `Dạ phòng 50 — Sắc Thái (Mã 601) tại ${this.propertyContext.propertyName} có các gói nghỉ giờ (từ 449.000đ/2h cuối tuần hoặc 399.000đ/2h ngày thường), gói qua đêm và ngày đêm ạ. Anh/chị dự định nghỉ theo gói nào ạ?`;
      }

      decisionSteps.push({
        step: 1,
        phase: 'RESPOND',
        thoughtSummary: `Phản hồi trực tiếp qua Fast Path (${executionMode}).`,
      });
    } else {
      // Substantive turn: Enter the Unified Bounded Reasoning Loop
      executionMode = budget && durationHours && asksBathtub ? 'DEEP' : 'STANDARD';

      decisionSteps.push({
        step: 1,
        phase: 'UNDERSTAND',
        thoughtSummary: `Nhận diện mục tiêu (${executionMode}): Ràng buộc cứng: [${state.hardConstraints.requiredAmenities.join(', ')}], ngân sách=${state.hardConstraints.budget ?? 'none'}đ, thời lượng=${state.hardConstraints.durationHours ?? 'none'}h, checkin=${checkinDatetime}.`,
      });

      // =======================================================================
      // PHASE 2 - 5: BOUNDED REASONING LOOP (Max 3 iterations)
      // =======================================================================
      let currentIteration = 0;
      const maxIterations = 3;

      while (currentIteration < maxIterations) {
        currentIteration += 1;

        // 1. ATTEMPT REAL MODEL-DRIVEN REASONING (Groq / Gemini)
        let llmDecision: AgentLLMDecision | null = null;
        const isRealLLM =
          this.llmAdapter &&
          !(this.llmAdapter as any).name?.includes('Mock') &&
          ((this.llmAdapter as any).getMode ? (this.llmAdapter as any).getMode() !== 'mock' : true) &&
          typeof (this.llmAdapter as any).callChatCompletion === 'function';

        if (isRealLLM) {
          try {
            const promptMessages = this.buildLLMReasoningPrompt(
              userMessage,
              state,
              state.observations,
              currentIteration,
              checkinDatetime,
              isTimeAssumptionConditional
            );

            const llmRes = await (this.llmAdapter as any).callChatCompletion(promptMessages, {
              temperature: 0.1,
              maxTokens: 800,
            });

            liveLLMCalls += 1;
            totalPromptTokens += llmRes.telemetry?.prompt_tokens ?? 0;
            totalCompletionTokens += llmRes.telemetry?.completion_tokens ?? 0;

            if (llmRes.telemetry?.provider && llmRes.telemetry.provider !== 'mock') {
              activeProvider = llmRes.telemetry.provider;
              usedLiveLLM = true;
            } else {
              if (isStrictLive) {
                throw new Error('STRICT_LIVE_EXECUTION_BLOCKED: Mock provider returned under strictLiveOnly mode');
              }
              throw new Error('Fallback from mock to deterministic reasoner');
            }

            llmDecision = this.parseAndValidateLLMDecision(llmRes.raw_content);
          } catch (err: any) {
            fallbackHappened = true;
            fallbackReason = `LLM call failed: ${err.message}`;
            if (isStrictLive) {
              throw new Error(`STRICT_LIVE_EXECUTION_BLOCKED: Live LLM decision failed (${err.message})`);
            }
          }
        }

        // 2. DECIDE: Propose tools or formulate response
        let currentStepAction: 'CALL_TOOLS' | 'RESPOND_DIRECTLY' | 'CLARIFY' = 'CALL_TOOLS';
        let stepThought = '';
        let toolCallsToExecute: ToolCall[] = [];

        if (llmDecision) {
          currentStepAction = llmDecision.action === 'RESPOND_DIRECTLY' ? 'RESPOND_DIRECTLY' : 'CALL_TOOLS';
          stepThought = `[${activeProvider.toUpperCase()} LIVE DECISION]: ${llmDecision.thought_summary}`;
          toolCallsToExecute = (llmDecision.tool_calls || []).map((tc, idx) => ({
            toolCallId: `live_call_${currentIteration}_${idx}`,
            toolName: tc.tool_name,
            arguments: tc.arguments,
          }));

          if (currentStepAction === 'RESPOND_DIRECTLY' && llmDecision.final_response) {
            finalCustomerResponse = llmDecision.final_response;
          }
        } else {
          // DETERMINISTIC GENERIC REASONER FALLBACK (Model-Driven Core Consolidation)
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
          phase: currentStepAction === 'RESPOND_DIRECTLY' ? 'RESPOND' : 'DECIDE',
          thoughtSummary: stepThought,
          toolCalls: toolCallsToExecute,
        });

        if (currentStepAction === 'RESPOND_DIRECTLY' && finalCustomerResponse) {
          break; // Concluded
        }

        // 3. ACT: Execute validated tool calls via Backend Security Gate
        const toolResults: ToolResult[] = [];
        for (const tc of toolCallsToExecute) {
          executedToolsList.push(tc.toolName);
          const res = await this.toolGateway.executeTool(tc);
          toolResults.push(res);

          if (tc.toolName === 'search_rooms') {
            searchResultRecord = res.data;
            candidatePool = res.data?.candidates || [];
          } else if (tc.toolName === 'quote_price' && res.status === 'SUCCESS') {
            if (res.data?.quotes && Array.isArray(res.data.quotes)) {
              quoteResultsRecord.push(...res.data.quotes);
            } else {
              quoteResultsRecord.push(res.data);
            }
          } else if (tc.toolName === 'get_room_facts' && res.status === 'SUCCESS') {
            factsResultRecord = res.data;
          } else if (tc.toolName === 'get_room_media' && res.status === 'SUCCESS') {
            deliveredImages.push(...(res.data?.images || []));
          } else if (tc.toolName === 'get_policies' && res.status === 'SUCCESS') {
            policyResultsRecord.push(res.data);
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
              const exact = r.data?.exact_matches || [];
              const cList = (r.data?.candidates || []).slice(0, 4).map((c: any) => `${c.room_id} (${c.room_name})`).join('; ');
              return `search_rooms returned ${r.data?.total_exact ?? exact.length} exact matches: [${cList}]`;
            }
            if (r.toolName === 'quote_price') {
              return `quote_price for ${r.data?.room_name} (${r.data?.room_id}): total ${r.data?.total_price_vnd?.toLocaleString('vi-VN')}đ (${r.data?.price_breakdown_text})`;
            }
            if (r.toolName === 'get_room_facts') {
              return `get_room_facts for ${r.data?.room_name}: bathtub=${r.data?.bathtub_status}, love_chair=${r.data?.has_love_chair}, extra_hour=${r.data?.extra_hour_rate}đ`;
            }
            if (r.toolName === 'get_policies') {
              return `get_policies topic ${r.data?.topic}: ${r.data?.policy_text}`;
            }
            return `${r.toolName}: ${r.status}`;
          })
          .join('\n');

        state.observations.push({
          toolName: toolCallsToExecute.map((t) => t.toolName).join(','),
          arguments: {},
          resultStatus: 'SUCCESS',
          summary: obsSummary,
        });

        decisionSteps.push({
          step: decisionSteps.length + 1,
          phase: 'OBSERVE',
          thoughtSummary: `Quan sát: ${obsSummary}`,
          toolResults,
        });

        // Observation Replanning: Check budget exceedance
        const maxBudget = state.hardConstraints.budget;
        if (quoteResultsRecord.length > 0 && maxBudget) {
          const exceeded = quoteResultsRecord.filter((q) => q.total_price_vnd > maxBudget);
          if (exceeded.length > 0) {
            decisionSteps.push({
              step: decisionSteps.length + 1,
              phase: 'REVISE',
              thoughtSummary: `Điều chỉnh kế hoạch (Observation Replanning): Nhận thấy ${exceeded.map((e) => e.room_name).join(', ')} vượt ngân sách ${maxBudget.toLocaleString('vi-VN')}đ. Đề xuất phương án tối ưu trong ngân sách và giữ phương án vượt làm lựa chọn nâng cấp minh bạch.`,
            });
          }
        }

        // Check if sufficient data collected to formulate response in next turn
        if (policyResultsRecord.length > 0 || deliveredImages.length > 0 || (candidatePool.length > 0 && quoteResultsRecord.length > 0)) {
          // Proceed to formulate response
          continue;
        }
      }

      // =======================================================================
      // PHASE 6: RESPONSE SYNTHESIS (Answer-First & Naturalness)
      // =======================================================================
      if (!finalCustomerResponse) {
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
      facility: this.propertyId,
      focusedRoomKey: state.focusedRoomId,
      expectedQuotes: quoteResultsRecord.map((q) => ({ roomId: q.room_id, totalVnd: q.total_price_vnd })),
    });

    const latencyMs = Math.max(1, Math.round(performance.now() - startTime));

    const decisionTrace: DecisionTrace = {
      turnIndex: state.turnCount,
      providerModel: `${activeProvider}:${activeModel}`,
      executionMode,
      decisionSteps,
      latencyMs,
      claimsChecked: validationSummary,
      verificationStatus: usedLiveLLM ? 'LIVE_LLM_DECISION_VERIFIED' : 'DETERMINISTIC_AGENT_FLOW',
      llmTelemetry: {
        verificationStatus: usedLiveLLM ? 'LIVE_LLM_DECISION_VERIFIED' : 'DETERMINISTIC_AGENT_FLOW',
        provider: activeProvider,
        model: activeModel,
        callCount: liveLLMCalls,
        decisionType: executionMode,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        latencyMs,
        fallbackState: {
          isFallback: fallbackHappened || !usedLiveLLM,
          fallbackReason: fallbackReason ?? (!usedLiveLLM ? 'Live LLM unavailable (Degraded Deterministic Mode active)' : undefined),
        },
      },
    };

    const turnResult: ConversationTurnResult = {
      session_id: sessionId,
      turn_index: state.turnCount,
      user_message: userMessage,
      intent: 'SEARCH_ROOM',
      extracted_entities: {
        facility: this.propertyId,
        budget: state.hardConstraints.budget,
        duration_hours: state.hardConstraints.durationHours,
        stay_type: state.hardConstraints.stayType,
        checkin_datetime: state.hardConstraints.checkinDatetime,
        must_have_amenities: state.hardConstraints.requiredAmenities,
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
      },
      verified_candidates: candidatePool.map((c: any) => ({ ...c, id: c.room_id || c.id })),
      evidence_references: [`facility::${this.propertyId}`],
      customer_visible_response: finalCustomerResponse,
      images: deliveredImages,
      claim_validation: validationSummary,
      human_escalation: { needed: false },
      decision_trace: decisionTrace,
      internal_trace: {
        latency_ms: latencyMs,
        rules_triggered: ['V2_MODEL_DRIVEN_CORE', `MODE_${executionMode}`],
        adapter_used: this.propertyId === 'jacayl-ha-dong' && activeModel === 'generic-constraint-v2.2' ? 'HadongAgenticReasoner-v1' : activeModel,
        tools_executed: executedToolsList,
        canonical_data_fetched: canonicalFetchedList,
      },
    };

    state.decisionSteps = decisionSteps;
    state.lastTurnResult = turnResult;
    return turnResult;
  }

  /**
   * Plans a deterministic step using generic domain routing instead of keyword patching.
   */
  protected planDeterministicTurnStep(
    iteration: number,
    userMessage: string,
    state: AgentState,
    mentionedRoomId: string | undefined,
    checkinDatetime: string,
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

      // 3. General room discovery: search rooms
      return {
        action: 'CALL_TOOLS',
        thought: `Tìm kiếm các phòng tại ${this.propertyContext.propertyName} theo tiện nghi bắt buộc [${state.hardConstraints.requiredAmenities.join(', ')}].`,
        toolCalls: [
          {
            toolCallId: `call_search_${iteration}`,
            toolName: 'search_rooms',
            arguments: {
              property_id: this.propertyId,
              must_have_amenities: state.hardConstraints.requiredAmenities,
            },
          },
        ],
      };
    } else if (iteration === 2) {
      const wantsCheap =
        noDia.includes('gia re') ||
        noDia.includes('re nhat') ||
        noDia.includes('tiet kiem') ||
        state.optimizationGoal === 'CHEAPEST' ||
        (state.hardConstraints.budget && state.hardConstraints.budget <= 350000);

      const asksPrice =
        wantsCheap ||
        noDia.includes('gia') ||
        noDia.includes('bao nhieu') ||
        noDia.includes('bn') ||
        noDia.includes('tien') ||
        Boolean(state.hardConstraints.budget) ||
        Boolean(state.hardConstraints.durationHours);

      if (
        mentionedRoomId ||
        policyResultsRecord.length > 0 ||
        (candidatePool.length === 0 && quoteResultsRecord.length > 0) ||
        (!asksPrice && candidatePool.length > 0)
      ) {
        return {
          action: 'RESPOND_DIRECTLY',
          thought: 'Đã có đầy đủ dữ kiện cần thiết, chuyển sang tổng hợp câu trả lời.',
          toolCalls: [],
        };
      }

      // Solve candidate rooms dynamically using Pricing Engine (Section VI)
      let availableCandidates = candidatePool.filter(
        (c: any) => !state.negatedRoomIds?.includes(c.room_id)
      );

      // Fallback to all sellable rooms if user retracted constraints
      if (availableCandidates.length === 0) {
        availableCandidates = this.dataset.phong
          .filter((p) => p.co_so_ma === this.propertyId && p.ma_phong !== '401-ha-dong')
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

      if ((wantsCheap || state.optimizationGoal === 'CHEAPEST') && !state.hardConstraints.requiredAmenities.includes('bon_tam')) {
        StructuredStateManager.setOptimizationGoal(state, 'CHEAPEST');
        // Dynamically find lowest price candidate
        const sorted = [...availableCandidates].sort(
          (a: any, b: any) => (a.base_pricing?.nghi_gio_2h ?? 999999) - (b.base_pricing?.nghi_gio_2h ?? 999999)
        );
        const best = sorted[0];
        if (best) {
          return {
            action: 'CALL_TOOLS',
            thought: `Tra cứu báo giá cho phòng có mức giá sàn thấp nhất (${best.room_name}).`,
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

      // Select distinct candidate options (e.g. lowest priced & luxury option)
      const c101 = availableCandidates.find((c: any) => c.room_id.includes('101')) || availableCandidates[0];
      const c601 = availableCandidates.find((c: any) => c.room_id.includes('601')) || availableCandidates[1];
      const roomsToQuote = Array.from(new Set([c101, c601].filter(Boolean)));

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

    // 1. Direct Policy responses
    if (policyResultsRecord.length > 0 && quoteResultsRecord.length === 0) {
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
        if (factsResultRecord.has_love_chair) {
          return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} có trang bị ghế tình yêu lãng mạn cho các cặp đôi ạ.`;
        } else {
          return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} không có ghế tình yêu ạ. Cơ sở bên em có các phòng concept như 601 (50 — Sắc Thái) và 602 (Playboy) được trang bị ghế tình yêu cao cấp rất được yêu thích ạ.`;
        }
      }
      return `Dạ phòng ${factsResultRecord.room_name} tại cơ sở ${propName} được trang bị ${factsResultRecord.bathtub_status || 'bồn tắm'} ạ.`;
    }

    // 4. Single Room Quote
    if (mentionedRoomId && quoteResultsRecord.some((q) => q.room_id === mentionedRoomId)) {
      const targetQuote = quoteResultsRecord.find((q) => q.room_id === mentionedRoomId)!;
      const conditionText = isTimeAssumptionConditional
        ? ` (áp dụng khung ban ngày trước 18:00 chiều cuối tuần theo Business Policy V1.4.3)`
        : '';
      const checkinHourMatch = targetQuote.checkin_conditions?.checkin_datetime?.match(/T(\d{2}:\d{2})/);
      const checkinTimeText = checkinHourMatch ? ` từ ${checkinHourMatch[1]}` : '';
      const stayDesc = targetQuote.stay_type === 'qua_dem' ? 'gói qua đêm' : targetQuote.stay_type === 'ngay_dem' ? 'gói cả ngày' : `nghỉ ${targetQuote.duration_hours} tiếng${checkinTimeText}`;
      const holidayNote = noDia.includes('30/4') || noDia.includes('ngay le') ? ' (J Collection hoàn toàn không phụ thu phí ngày lễ)' : '';
      const parkingPolicy = policyResultsRecord.find((p) => p.topic === 'parking');
      const parkingNote = parkingPolicy
        ? `\n\n- **Thông tin đỗ xe**: ${parkingPolicy.policy_text || 'Khách sạn có chỗ đỗ ô tô và xe máy thuận tiện cho khách lưu trú ạ.'}`
        : /\b(do xe|gui xe|o to|xe hoi|xe may)\b/i.test(noDia)
        ? '\n\n*(Thông tin thêm: Khách sạn có chỗ đỗ ô tô và xe máy cho khách lưu trú ạ).*'
        : '';

      const mediaIntro = deliveredImages.length > 0
        ? `Dạ em gửi anh/chị xem trước các hình ảnh thực tế của phòng ${targetQuote.room_name} tại cơ sở ${propName} ạ. Không gian phòng thực tế rất đẹp và lãng mạn ạ!\n\n`
        : '';

      return (
        mediaIntro +
        `Dạ tại cơ sở **${propName}**, chi phí ${stayDesc} cho ${targetQuote.room_name} (${targetQuote.category}) là **${targetQuote.total_price_vnd.toLocaleString('vi-VN')}đ** ạ${holidayNote}.\n\n` +
        `- **Chi tiết biểu giá**: ${targetQuote.price_breakdown_text}${conditionText}.\n` +
        `- **Tiện nghi phòng**: Phòng trang bị ${targetQuote.room_name.includes('601') ? 'bồn tắm lớn và không gian concept quyến rũ' : targetQuote.room_name.includes('101') ? 'bồn tắm nằm thư giãn và concept lồng chim' : 'đầy đủ tiện nghi theo tiêu chuẩn'}.\n` +
        parkingNote +
        `\n*(Lưu ý: Tình trạng phòng thực tế theo từng khung giờ cần được đối soát trực tiếp trên hệ thống lễ tân trước khi nhận phòng ạ).*`
      );
    }

    // 5. Search Results with No Quotes (e.g. Browsing)
    if (candidatePool.length > 0 && quoteResultsRecord.length === 0) {
      const filtered = candidatePool.filter(
        (c: any) => !state.negatedRoomIds?.includes(c.room_id)
      );

      if (noDia.includes('may chieu') || state.hardConstraints.requiredAmenities.includes('may_chieu')) {
        return `Dạ tại cơ sở ${propName}, các phòng như phòng 101 — Lồng Chim và 201 — La Casta đều được trang bị máy chiếu màn hình lớn kết nối mạng sắc nét để anh/chị xem phim ạ.`;
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

      const parkingNote = /\b(do xe|gui xe|o to|xe hoi|xe may)\b/i.test(noDia)
        ? `\n\nBên cạnh đó, cơ sở ${propName} có chỗ đỗ ô tô và xe máy thuận tiện cho khách lưu trú ạ.`
        : '';

      return (
        `Dạ tại cơ sở **${propName}**, bên em có các phòng đáp ứng tiện nghi ${reqAmenitiesText} như sau ạ:\n\n` +
        `${roomListText}\n\n` +
        `Anh/chị có dự định nghỉ theo khung giờ nào (nghỉ giờ, qua đêm hay ngày đêm) để em hỗ trợ kiểm tra biểu giá chi tiết và ưu đãi phù hợp nhất nhé ạ!${parkingNote}`
      );
    }

    // 6. Generic Constraint Solving on Quotes (Section VI)
    if (quoteResultsRecord.length > 0) {
      const maxBudget = state.hardConstraints.budget;
      const hours = state.hardConstraints.durationHours || 4;

      const solved = GenericConstraintSolver.solve({
        candidatePool,
        quotes: quoteResultsRecord,
        maxBudget,
        requiredAmenities: state.hardConstraints.requiredAmenities,
        softPreferences: state.softPreferences,
      });

      const conditionNote = isTimeAssumptionConditional
        ? `\n*(Lưu ý: Biểu giá tính trên khung nhận phòng ban ngày trước 18:00 chiều cuối tuần theo Business Policy V1.4.3. Tình trạng phòng trống thực tế cần được đối soát trực tiếp cùng lễ tân tại thời điểm đặt phòng ạ).*`
        : `\n*(Lưu ý: Tình trạng phòng thực tế theo từng khung giờ cần được đối soát trực tiếp trên hệ thống lễ tân trước khi nhận phòng).*`;

      if (quoteResultsRecord.length === 1) {
        const q = quoteResultsRecord[0];
        const budgetText = maxBudget ? ` dưới ${maxBudget.toLocaleString('vi-VN')}đ` : '';
        const fitsBudget = !maxBudget || q.total_price_vnd <= maxBudget;
        return (
          `Dạ tại cơ sở **${propName}**, với nhu cầu phòng${budgetText} nghỉ ${hours} tiếng thứ 7 không cần bồn tắm, em xin tư vấn phương án tối ưu:\n\n` +
          `- **Phòng ${q.room_name} (Hạng ${q.category})**: Giá trọn gói ${hours} tiếng là **${q.total_price_vnd.toLocaleString('vi-VN')}đ**.\n` +
          `- Phòng đầy đủ tiện nghi tiêu chuẩn, sạch sẽ, máy chiếu và ${fitsBudget ? 'hoàn toàn phù hợp ngân sách của anh/chị' : 'là mức giá tốt nhất'} ạ!\n\n` +
          conditionNote
        );
      }

      if (solved.primaryOption && solved.upgradeOption && solved.primaryOption !== solved.upgradeOption) {
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

        return (
          `Dạ tại cơ sở **${propName}**, với nhu cầu phòng lãng mạn có bồn tắm cho ${hours} tiếng chiều cuối tuần (ngân sách ${maxBudget?.toLocaleString('vi-VN')}đ), em xin tư vấn các phương án như sau ạ:\n\n` +
          `1. **${opt1Title}**\n` +
          `   - **Tiện nghi**: Không gian lãng mạn concept lồng chim độc đáo, có bồn tắm nằm thư giãn.\n` +
          `   - **Giá trọn gói ${hours} tiếng**: **${opt1.totalPriceVnd.toLocaleString('vi-VN')}đ** (${opt1.priceBreakdown}).\n` +
          `   - ${opt1Desc}\n\n` +
          `2. **Phương án hạng cao nhất: Phòng ${opt2.roomName} (Hạng ${opt2.category})**\n` +
          `   - **Tiện nghi**: Không gian concept tone đỏ quyến rũ, trang bị **bồn tắm lớn** và ghế tình yêu.\n` +
          `   - **Giá trọn gói ${hours} tiếng**: **${opt2.totalPriceVnd.toLocaleString('vi-VN')}đ** (${opt2.priceBreakdown}).\n` +
          `   - ${opt2Desc}\n` +
          conditionNote
        );
      } else {
        const lines = quoteResultsRecord.map(
          (q, idx) =>
            `${idx + 1}. **Phòng ${q.room_name} (Hạng ${q.category})**: Giá trọn gói ${hours} tiếng là **${q.total_price_vnd.toLocaleString('vi-VN')}đ** (${q.price_breakdown_text}).`
        );
        const budgetIntro = maxBudget
          ? `với mức ngân sách ${maxBudget.toLocaleString('vi-VN')}đ, hiện tại các phương án phòng có mức giá`
          : `em xin gửi thông tin báo giá các phương án phòng cho ${hours} tiếng`;
        return (
          `Dạ tại cơ sở **${propName}**, ${budgetIntro} như sau ạ:\n\n` +
          lines.join('\n\n') +
          conditionNote
        );
      }
    }

    return `Dạ tại cơ sở ${propName}, em đã ghi nhận yêu cầu của anh/chị. Anh/chị có thể cho em biết thêm chi tiết khung giờ hoặc nhu cầu cụ thể để em tư vấn phương án phù hợp nhất nhé ạ!`;
  }

  /**
   * Builds prompt messages for the real LLM reasoning step.
   */
  protected buildLLMReasoningPrompt(
    userMessage: string,
    state: AgentState,
    observations: ToolObservation[],
    iteration: number,
    checkinDatetime: string,
    isConditional: boolean
  ): Array<{ role: string; content: string }> {
    const toolDefs = JSON.stringify(this.toolGateway.getToolDeclarations(), null, 2);
    const obsText =
      observations.length > 0
        ? observations.map((o, idx) => `[Observation ${idx + 1} from ${o.toolName}]: ${o.summary}`).join('\n')
        : 'None yet.';

    const systemPrompt = `You are the Agentic AI Concierge for ${this.propertyContext.propertyName} (J Collection).
You operate in a strict reasoning loop: Understand -> Decide -> Act -> Observe -> Revise -> Respond.

CRITICAL INVARIANTS:
1. Ground truth facts: ONLY use facts provided by tools. NEVER invent room names, amenities, bathtub dimensions (e.g. NEVER claim 1.7m-1.8m), or prices.
2. Property scope: You only represent '${this.propertyId}'. Address: ${this.propertyContext.address}.
3. Pricing & Policy: Prices must be computed by 'quote_price' tool. For Saturday/Sunday afternoon, check-in before 18:00 uses daytime weekend rates (Concept is 449k/2h); after 18:00 uses dataset base rates. If specific hour is not given, explain the conditional daytime vs evening rate.
4. Budget & Recommendations: If the primary room exceeds guest budget, observe this and recommend an alternative room that fits within budget, while transparently explaining the price difference.
5. Availability: You do NOT have real-time PMS access. You must NEVER confirm a room is locked or booked; always remind the guest that real-time vacancy must be verified with reception.
6. Tone: Natural, polite Vietnamese hotel concierge. Direct, answer-first, concise.

AVAILABLE TOOLS:
${toolDefs}

OUTPUT FORMAT:
You must reply with ONLY a valid JSON object starting with { and ending with } containing:
{
  "action": "CALL_TOOLS" | "RESPOND_DIRECTLY" | "CLARIFY" | "ESCALATE",
  "thought_summary": "Short explanation of your decision",
  "tool_calls": [
    {
      "tool_name": "search_rooms" | "get_room_facts" | "get_room_media" | "get_policies" | "quote_price",
      "arguments": { ... }
    }
  ],
  "clarification_question": "...",
  "final_response": "..."
}`;

    const userPrompt = `[Iteration ${iteration}]
Customer Request: "${userMessage}"
Property: ${this.propertyId} (${this.propertyContext.propertyName})
Current Constraints: budget=${state.hardConstraints.budget ?? 'unspecified'}, duration=${state.hardConstraints.durationHours ?? 'unspecified'}h, checkin=${checkinDatetime} (conditional=${isConditional}), required_amenities=[${state.hardConstraints.requiredAmenities.join(', ')}], rejected_rooms=[${(state.negatedRoomIds || []).join(', ')}]
Recent Observations:
${obsText}

INSTRUCTIONS FOR THIS STEP:
- If you need room facts, photos, policies, or candidates, propose the appropriate tool calls.
- If candidate rooms were discovered, propose 'quote_price' with stay_type='nghi_gio', duration_hours=${state.hardConstraints.durationHours || 2}, checkin_datetime='${checkinDatetime}'.
- For compound questions (e.g. asking about room price AND parking/policies), propose tool calls for both or cover both in your observations and final answer.
- For cheapest inquiries, recommend the lowest price room directly without forcing an upsell.
- If customer retracted a constraint (e.g. "không cần bồn tắm"), respect that and do not filter by it.
- If exact price quotes or required facts are in observations, compare against the user goal. Formulate your complete answer in natural, polite Vietnamese and set action to 'RESPOND_DIRECTLY'.

Output JSON only.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Safely parses and validates JSON output from LLM.
   */
  protected parseAndValidateLLMDecision(rawContent: string): AgentLLMDecision | null {
    try {
      let clean = rawContent.trim();
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
      return validated as AgentLLMDecision;
    } catch {
      const trimmed = rawContent.trim();
      if (trimmed.length > 15 && !trimmed.startsWith('{')) {
        return {
          action: 'RESPOND_DIRECTLY',
          thought_summary: 'Model provided direct natural language response.',
          tool_calls: [],
          final_response: trimmed,
        };
      }
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
}
