import { z } from 'zod';
import { LLMAdapter, ConversationHistoryMessage, ComposeAdvisoryParams } from './llm-adapter.interface.js';
import { ExtractedEntities, IntentType, WorkingMemory } from '../conversation-types.js';
import { AdvisoryComposer } from '../advisory-composer.js';
import { MockLLMAdapter } from './mock-llm-adapter.js';
import { GroqProviderAdapter, GroqProviderConfig } from './groq-provider.js';
import { GeminiProviderAdapter, GeminiProviderConfig } from './gemini-provider.js';
import { LLMProvider, ProviderTelemetry, RateLimitError, ProviderUnavailableError } from './provider-types.js';
import { PIIRedactionLayer, DataClassificationGate } from '../privacy/pii-redaction.js';

export const LLMStructuredOutputSchema = z.object({
  intent: z.preprocess(
    (val) => {
      if (val === 'GET_SPECIFIC_ROOM_PRICE') return 'ASK_SPECIFIC_ROOM_PRICE';
      if (val === 'GET_ROOM_PRICE') return 'ASK_SPECIFIC_ROOM_PRICE';
      return val;
    },
    z.enum([
      'SEARCH_ROOM',
      'GET_ROOM_DETAILS',
      'GET_ROOM_PRICE',
      'GET_PREBOOKING_QUOTE',
      'COMPARE_ROOMS',
      'ASK_AMENITIES',
      'ASK_POLICY',
      'CHANGE_REQUIREMENT',
      'REMOVE_REQUIREMENT',
      'NEGATE_REQUIREMENT',
      'CLEAR_NEGATION',
      'ASK_CHEAPEST_OPTION',
      'ASK_BEST_OPTION',
      'ASK_ROOM_AVAILABILITY',
      'CHECK_ROOM_AVAILABILITY',
      'BROWSE_ROOM_CATEGORIES',
      'BROWSE_ROOMS_BY_CATEGORY',
      'ASK_CATEGORY_PRICE',
      'ASK_SPECIFIC_ROOM_PRICE',
      'REQUEST_ROOM_IMAGES',
      'ASK_PARKING',
      'REQUEST_STAFF_HANDOFF',
      'BOOKING_REQUEST',
      'BOOKING_INTENT',
      'REQUEST_HUMAN',
      'IN_STAY_OPERATIONAL_REQUEST',
      'CHECKOUT_DISPUTE',
      'OUT_OF_SCOPE',
      'CLARIFICATION',
      'GREETING',
      'AI_IDENTITY_INQUIRY',
    ])
  ),
  facility: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.enum(['j-village', 'jacayl-tran-khat-chan', 'jacayl-ha-dong']).optional()
  ),
  room_name: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.string().optional()
  ),
  stay_type: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.enum(['nghi_gio', 'qua_dem', 'ngay_dem']).optional()
  ),
  duration_hours: z.preprocess(
    (val) => (val === '' || val === 0 || val === null ? undefined : val),
    z.number().int().positive().optional()
  ),
  budget: z.preprocess(
    (val) => (val === '' || val === 0 || val === null ? undefined : val),
    z.number().positive().optional()
  ),
  checkin_datetime: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.string().optional()
  ),
  must_have_amenities: z.preprocess(
    (val) => (val === null ? undefined : val),
    z.array(z.string()).optional()
  ),
  removed_requirements: z.preprocess(
    (val) => (val === null ? undefined : val),
    z.array(z.string()).optional()
  ),
  negated_constraints: z.preprocess(
    (val) => (val === null ? undefined : val),
    z.array(z.string()).optional()
  ),
  cleared_negations: z.preprocess(
    (val) => (val === null ? undefined : val),
    z.array(z.string()).optional()
  ),
  confidence: z.preprocess(
    (val) => (val === null || val === undefined ? 0.85 : val),
    z.number().min(0).max(1).default(0.85)
  ),
  missing_information: z.preprocess(
    (val) => (val === null ? undefined : val),
    z.array(z.string()).optional()
  ),
});

export type LLMStructuredOutput = z.infer<typeof LLMStructuredOutputSchema>;

export type GatewayRoutingMode = 'auto' | 'groq' | 'gemini' | 'mock';

export interface FreeLLMGatewayConfig {
  mode?: GatewayRoutingMode;
  freeOnlyMode?: boolean;
  groqConfig?: GroqProviderConfig;
  geminiConfig?: GeminiProviderConfig;
  groqAdapter?: GroqProviderAdapter;
  geminiAdapter?: GeminiProviderAdapter;
  mockAdapter?: MockLLMAdapter;
  referenceClock?: string;
}

export interface ProviderHealthStatus {
  name: string;
  configured: boolean;
  model: string;
  isRateLimited: boolean;
  rateLimitCooloffSecRemaining: number;
}

export class FreeLLMGateway implements LLMAdapter {
  public readonly name = 'FreeMultiProviderLLMGateway';
  private static sharedRateLimitUntil: Record<'groq' | 'gemini', number> = { groq: 0, gemini: 0 };
  private static sharedProviderTail: Record<'groq' | 'gemini', Promise<void>> = {
    groq: Promise.resolve(),
    gemini: Promise.resolve(),
  };
  private static sharedActiveWaiters: Record<'groq' | 'gemini', number> = { groq: 0, gemini: 0 };

  private mode: GatewayRoutingMode;
  private freeOnlyMode: boolean;
  private useSharedCoordinator: boolean;

  private groqAdapter: GroqProviderAdapter;
  private geminiAdapter: GeminiProviderAdapter;
  private geminiFallbackAdapter: GeminiProviderAdapter;
  private mockAdapter: MockLLMAdapter;
  private composer: AdvisoryComposer;
  private piiLayer: PIIRedactionLayer;
  private classificationGate: DataClassificationGate;

  // Rate-limit cooloff trackers (timestamp in ms)
  private groqRateLimitUntil: number = 0;
  private geminiRateLimitUntil: number = 0;

  // Last telemetry data
  private lastTelemetry: ProviderTelemetry | null = null;
  private lastFallbackReason: string | null = null;
  private reliabilityMetrics = {
    groq: { calls: 0, successes: 0, http429: 0, http503: 0, otherErrors: 0, promptTokens: 0, completionTokens: 0, totalLatencyMs: 0, queueWaitEvents: 0, totalQueueDelayMs: 0, maxConcurrentWaiters: 0 },
    gemini: { calls: 0, successes: 0, http429: 0, http503: 0, otherErrors: 0, promptTokens: 0, completionTokens: 0, totalLatencyMs: 0, queueWaitEvents: 0, totalQueueDelayMs: 0, maxConcurrentSeen: 0, maxConcurrentWaiters: 0 },
    coordinator: { serializedCalls: 0, totalQueueDelayMs: 0 },
  };

  constructor(config?: FreeLLMGatewayConfig) {
    this.mode = config?.mode ?? (process.env.LLM_PROVIDER as GatewayRoutingMode) ?? 'auto';
    this.freeOnlyMode = config?.freeOnlyMode ?? (process.env.FREE_ONLY_MODE !== 'false');
    // Coordinate quotas centrally across shared .env adapters across properties, keeping injected test mocks isolated
    this.useSharedCoordinator = !config?.groqAdapter && !config?.geminiAdapter;

    this.groqAdapter = config?.groqAdapter ?? new GroqProviderAdapter(config?.groqConfig);
    this.geminiAdapter = config?.geminiAdapter ?? new GeminiProviderAdapter(config?.geminiConfig);
    this.geminiFallbackAdapter = new GeminiProviderAdapter({
      ...config?.geminiConfig,
      model: 'gemini-3.1-flash-lite',
    });
    this.mockAdapter = config?.mockAdapter ?? new MockLLMAdapter(config?.referenceClock);
    this.composer = new AdvisoryComposer();
    this.piiLayer = new PIIRedactionLayer();
    this.classificationGate = new DataClassificationGate();
  }

  public getMode(): GatewayRoutingMode {
    return this.mode;
  }

  public setMode(mode: GatewayRoutingMode): void {
    this.mode = mode;
  }

  public isFreeOnlyMode(): boolean {
    return this.freeOnlyMode;
  }

  public setReferenceClock(clock: string): void {
    this.mockAdapter.setReferenceClock(clock);
  }

  public getTelemetry(): ProviderTelemetry | null {
    return this.lastTelemetry;
  }

  public getLastFallbackReason(): string | null {
    return this.lastFallbackReason;
  }

  public getReliabilityMetrics() {
    return JSON.parse(JSON.stringify(this.reliabilityMetrics));
  }

  public getProviderStatus(): {
    activeMode: GatewayRoutingMode;
    freeOnlyMode: boolean;
    groq: ProviderHealthStatus;
    gemini: ProviderHealthStatus;
    mock: ProviderHealthStatus;
  } {
    const now = Date.now();
    const groqCooloff = Math.max(0, Math.ceil((this.groqRateLimitUntil - now) / 1000));
    const geminiCooloff = Math.max(0, Math.ceil((this.geminiRateLimitUntil - now) / 1000));

    return {
      activeMode: this.mode,
      freeOnlyMode: this.freeOnlyMode,
      groq: {
        name: 'Groq Free Tier',
        configured: this.groqAdapter.isConfigured(),
        model: this.groqAdapter.modelName,
        isRateLimited: groqCooloff > 0,
        rateLimitCooloffSecRemaining: groqCooloff,
      },
      gemini: {
        name: 'Google Gemini Free Tier',
        configured: this.geminiAdapter.isConfigured(),
        model: this.geminiAdapter.modelName,
        isRateLimited: geminiCooloff > 0,
        rateLimitCooloffSecRemaining: geminiCooloff,
      },
      mock: {
        name: 'Deterministic Mock Engine',
        configured: true,
        model: 'internal-deterministic-rulebase',
        isRateLimited: false,
        rateLimitCooloffSecRemaining: 0,
      },
    };
  }

  public isConfigured(): boolean {
    if (this.mode === 'mock') return true;
    if (this.mode === 'groq') return this.groqAdapter.isConfigured();
    if (this.mode === 'gemini') return this.geminiAdapter.isConfigured();
    // 'auto' mode is configured if at least one free provider is set up, or defaults to mock
    return this.groqAdapter.isConfigured() || this.geminiAdapter.isConfigured() || true;
  }

  /**
   * Main multi-provider NLU parsing flow with Privacy Gate and Free-Only Routing.
   */
  public async parseIntentAndEntities(
    utterance: string,
    history: ConversationHistoryMessage[],
    memory: WorkingMemory | null,
    referenceClock?: string
  ): Promise<{ intent: IntentType; entities: ExtractedEntities; confidence: number }> {
    const startTime = performance.now();
    this.lastFallbackReason = null;

    // 1. Privacy Gate: Classify and Redact PII
    const classification = this.classificationGate.classify(utterance);
    const { sanitizedText, hasSensitiveData, redactedTypes } = this.piiLayer.redact(utterance);

    // If payload contains unredactable restricted PII, block Free API transmission
    if (classification === 'RESTRICTED_PII_BLOCKED') {
      this.lastFallbackReason = 'PRIVACY_GATE_BLOCKED_RESTRICTED_PII';
      return this.fallbackToMock(utterance, history, memory, referenceClock, startTime, 'privacy-gate-blocked');
    }

    // 2. If explicit mock mode selected, route directly
    if (this.mode === 'mock') {
      return this.fallbackToMock(utterance, history, memory, referenceClock, startTime, 'mode-mock-selected');
    }

    // 3. Build optimized concise NLU Prompt
    const systemPrompt = `You are the NLU parser for J Collection hotel concierge.
You must output ONLY a valid JSON object starting with { and ending with }, without any markdown fences, explanation or other text.
JSON Schema:
{
  "intent": "SEARCH_ROOM" | "GET_ROOM_DETAILS" | "GET_ROOM_PRICE" | "GET_PREBOOKING_QUOTE" | "COMPARE_ROOMS" | "ASK_AMENITIES" | "ASK_POLICY" | "CHANGE_REQUIREMENT" | "REMOVE_REQUIREMENT" | "NEGATE_REQUIREMENT" | "CLEAR_NEGATION" | "ASK_CHEAPEST_OPTION" | "ASK_BEST_OPTION" | "ASK_ROOM_AVAILABILITY" | "CHECK_ROOM_AVAILABILITY" | "BROWSE_ROOM_CATEGORIES" | "BROWSE_ROOMS_BY_CATEGORY" | "ASK_CATEGORY_PRICE" | "ASK_SPECIFIC_ROOM_PRICE" | "REQUEST_ROOM_IMAGES" | "ASK_PARKING" | "REQUEST_STAFF_HANDOFF" | "BOOKING_REQUEST" | "BOOKING_INTENT" | "REQUEST_HUMAN" | "IN_STAY_OPERATIONAL_REQUEST" | "CHECKOUT_DISPUTE" | "OUT_OF_SCOPE" | "CLARIFICATION" | "GREETING" | "AI_IDENTITY_INQUIRY",
  "facility": "j-village" | "jacayl-tran-khat-chan" | "jacayl-ha-dong" | null,
  "room_name": string | null,
  "stay_type": "nghi_gio" | "qua_dem" | "ngay_dem" | null,
  "duration_hours": number | null,
  "budget": number | null,
  "must_have_amenities": string[],
  "removed_requirements": string[],
  "negated_constraints": string[],
  "cleared_negations": string[],
  "confidence": number
}`;

    // Minimize history to maximum 3 turns to optimize Free Tier tokens
    const recentHistory = history.slice(-3).map((h) => ({
      role: h.role,
      content: this.piiLayer.redact(h.content).sanitizedText,
    }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: sanitizedText },
    ];

    // 4. Free-Only Multi-Provider Routing Flow
    // In 'auto' mode: Groq Free -> Gemini Free -> Mock Deterministic
    if (this.mode === 'auto') {
      // 4.1. Try Groq Free
      if (this.groqAdapter.isConfigured() && Date.now() >= this.groqRateLimitUntil) {
        try {
          const res = await this.groqAdapter.callChatCompletion(messages);
          const parsed = this.parseAndValidateOutput(res.raw_content);
          if (parsed) {
            this.lastTelemetry = { ...res.telemetry, is_fallback: false };
            return parsed;
          }
        } catch (err: any) {
          if (err instanceof RateLimitError) {
            this.groqRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
            this.lastFallbackReason = `GROQ_RATE_LIMITED_429 (${err.retryAfterSeconds}s)`;
          } else {
            this.groqRateLimitUntil = Date.now() + 60000;
            this.lastFallbackReason = `GROQ_FAILED: ${err.message}`;
          }
        }
      } else if (this.groqAdapter.isConfigured() && Date.now() < this.groqRateLimitUntil) {
        this.lastFallbackReason = 'GROQ_IN_RATE_LIMIT_COOLOFF';
      }

      // 4.2. Try Gemini Free (if eligible payload)
      if (this.geminiAdapter.isConfigured() && Date.now() >= this.geminiRateLimitUntil) {
        try {
          const res = await this.geminiAdapter.callChatCompletion(messages);
          const parsed = this.parseAndValidateOutput(res.raw_content);
          if (parsed) {
            this.lastTelemetry = { ...res.telemetry, is_fallback: false };
            return parsed;
          }
        } catch (err: any) {
          if (err instanceof RateLimitError) {
            this.geminiRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
            this.lastFallbackReason = `GEMINI_RATE_LIMITED_429 (${err.retryAfterSeconds}s)`;
          } else {
            this.geminiRateLimitUntil = Date.now() + 60000;
            this.lastFallbackReason = `GEMINI_FAILED: ${err.message}`;
          }
        }
      }

      // 4.3. Deterministic Mock Fallback
      return this.fallbackToMock(utterance, history, memory, referenceClock, startTime, this.lastFallbackReason ?? 'AUTO_FALLBACK_TO_DETERMINISTIC');
    }

    // In explicit 'groq' mode
    if (this.mode === 'groq') {
      if (this.groqAdapter.isConfigured() && Date.now() >= this.groqRateLimitUntil) {
        try {
          const res = await this.groqAdapter.callChatCompletion(messages);
          const parsed = this.parseAndValidateOutput(res.raw_content);
          if (parsed) {
            this.lastTelemetry = { ...res.telemetry, is_fallback: false };
            return parsed;
          }
        } catch (err: any) {
          if (err instanceof RateLimitError) {
            this.groqRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
          }
          this.lastFallbackReason = `GROQ_ERROR: ${err.message}`;
        }
      } else {
        this.lastFallbackReason = 'GROQ_NOT_CONFIGURED_OR_RATE_LIMITED';
      }
      return this.fallbackToMock(
        utterance,
        history,
        memory,
        referenceClock,
        startTime,
        this.lastFallbackReason ?? 'GROQ_FALLBACK'
      );
    }

    // In explicit 'gemini' mode
    if (this.mode === 'gemini') {
      if (this.geminiAdapter.isConfigured() && Date.now() >= this.geminiRateLimitUntil) {
        try {
          const res = await this.geminiAdapter.callChatCompletion(messages);
          const parsed = this.parseAndValidateOutput(res.raw_content);
          if (parsed) {
            this.lastTelemetry = { ...res.telemetry, is_fallback: false };
            return parsed;
          }
        } catch (err: any) {
          if (err instanceof RateLimitError) {
            this.geminiRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
          }
          this.lastFallbackReason = `GEMINI_ERROR: ${err.message}`;
        }
      } else {
        this.lastFallbackReason = 'GEMINI_NOT_CONFIGURED_OR_RATE_LIMITED';
      }
      return this.fallbackToMock(
        utterance,
        history,
        memory,
        referenceClock,
        startTime,
        this.lastFallbackReason ?? 'GEMINI_FALLBACK'
      );
    }

    return this.fallbackToMock(utterance, history, memory, referenceClock, startTime, 'UNKNOWN_MODE');
  }

  /**
   * Parse JSON output and validate against Zod schema.
   */
  private parseAndValidateOutput(rawContent: string): { intent: IntentType; entities: ExtractedEntities; confidence: number } | null {
    try {
      // Handle markdown code fences or surrounding text
      let cleanJson = rawContent.trim();
      const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanJson = jsonMatch[0];
      }

      const parsed = JSON.parse(cleanJson);
      const validated = LLMStructuredOutputSchema.parse(parsed);

      const entities: ExtractedEntities = {
        facility: validated.facility ?? undefined,
        room_name: validated.room_name ?? undefined,
        stay_type: validated.stay_type ?? undefined,
        duration_hours: validated.duration_hours ?? undefined,
        budget: validated.budget ?? undefined,
        must_have_amenities: validated.must_have_amenities ?? undefined,
        removed_requirements: validated.removed_requirements ?? undefined,
        negated_constraints: validated.negated_constraints ?? undefined,
        cleared_negations: validated.cleared_negations ?? undefined,
      };

      return {
        intent: validated.intent as IntentType,
        entities,
        confidence: validated.confidence,
      };
    } catch (err: any) {
      this.lastFallbackReason = `OUTPUT_PARSE_ERROR: ${err.message}`;
      return null;
    }
  }

  /**
   * Safe Fallback to Deterministic MockLLMAdapter.
   */
  private async fallbackToMock(
    utterance: string,
    history: ConversationHistoryMessage[],
    memory: WorkingMemory | null,
    referenceClock: string | undefined,
    startTime: number,
    reason: string
  ): Promise<{ intent: IntentType; entities: ExtractedEntities; confidence: number }> {
    const result = await this.mockAdapter.parseIntentAndEntities(utterance, history, memory, referenceClock);
    const latency = Math.round(performance.now() - startTime);

    this.lastTelemetry = {
      provider: 'mock',
      model: 'internal-deterministic-engine',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      latency_ms: latency,
      error: reason,
      retries_attempted: 0,
      is_fallback: true,
    };

    return result;
  }

  /**
   * Compose customer-facing prose: always grounded deterministically via AdvisoryComposer.
   */
  public async composeAdvisoryResponse(params: ComposeAdvisoryParams): Promise<string> {
    return this.composer.compose(params);
  }

  /**
   * Direct Chat Completion for Agentic Multi-Step Reasoning.
   * V3.0 FINAL Default Auto Order (FREE_ONLY_MODE=true):
   *   Primary: Gemini 3.5 Flash-Lite -> Secondary: Groq Qwen 3.8 27B -> Additional Fallback: Gemini 3.1 Flash-Lite -> Mock (unless strict).
   * Shared in-process queue/cooldown coordinates concurrent property sessions on shared free-tier provider quotas.
   */
  public async callChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: any
  ): Promise<{ raw_content: string; telemetry: any }> {
    const allowMockFallback = options?.allowMockFallback !== false;
    const excludeProviders: string[] = Array.isArray(options?.excludeProviders) ? options.excludeProviders : [];
    const errors: string[] = [];

    const getRateLimitUntil = (prov: 'groq' | 'gemini') => {
      const local = prov === 'groq' ? this.groqRateLimitUntil : this.geminiRateLimitUntil;
      return this.useSharedCoordinator ? Math.max(local, FreeLLMGateway.sharedRateLimitUntil[prov]) : local;
    };

    const setRateLimitUntil = (prov: 'groq' | 'gemini', untilMs: number) => {
      if (prov === 'groq') this.groqRateLimitUntil = Math.max(this.groqRateLimitUntil, untilMs);
      else this.geminiRateLimitUntil = Math.max(this.geminiRateLimitUntil, untilMs);
      if (this.useSharedCoordinator) {
        FreeLLMGateway.sharedRateLimitUntil[prov] = Math.max(FreeLLMGateway.sharedRateLimitUntil[prov], untilMs);
      }
    };

    const runWithCentralQuotaQueue = async <T>(prov: 'groq' | 'gemini', fn: () => Promise<T>): Promise<{ result: T; queueDelayMs: number }> => {
      if (!this.useSharedCoordinator) {
        const res = await fn();
        return { result: res, queueDelayMs: 0 };
      }
      const enqueueAt = Date.now();
      FreeLLMGateway.sharedActiveWaiters[prov] += 1;
      const waiters = FreeLLMGateway.sharedActiveWaiters[prov];
      const m = this.reliabilityMetrics[prov];
      if (waiters > m.maxConcurrentWaiters) m.maxConcurrentWaiters = waiters;

      const prevTail = FreeLLMGateway.sharedProviderTail[prov];
      let releaseCurrent!: () => void;
      FreeLLMGateway.sharedProviderTail[prov] = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      });

      await prevTail;
      const queueDelayMs = Date.now() - enqueueAt;
      if (queueDelayMs > 5) {
        m.queueWaitEvents += 1;
        m.totalQueueDelayMs += queueDelayMs;
      }
      this.reliabilityMetrics.coordinator.serializedCalls += 1;
      this.reliabilityMetrics.coordinator.totalQueueDelayMs += queueDelayMs;
      try {
        const result = await fn();
        return { result, queueDelayMs };
      } finally {
        FreeLLMGateway.sharedActiveWaiters[prov] = Math.max(0, FreeLLMGateway.sharedActiveWaiters[prov] - 1);
        releaseCurrent();
      }
    };

    let geminiKeyRateLimitedThisTurn = false;

    const tryGroq = async () => {
      if (excludeProviders.includes('groq')) return null;
      if (!this.groqAdapter.isConfigured()) {
        errors.push('groq:not_configured');
        return null;
      }
      const limitUntil = getRateLimitUntil('groq');
      if (Date.now() < limitUntil) {
        const rem = Math.ceil((limitUntil - Date.now()) / 1000);
        errors.push(`groq:rate_limited(${rem}s)`);
        return null;
      }
      this.reliabilityMetrics.groq.calls += 1;
      try {
        const { result: r, queueDelayMs } = await runWithCentralQuotaQueue('groq', () =>
          this.groqAdapter.callChatCompletion(messages, options)
        );
        this.reliabilityMetrics.groq.successes += 1;
        this.reliabilityMetrics.groq.promptTokens += r.telemetry?.prompt_tokens ?? 0;
        this.reliabilityMetrics.groq.completionTokens += r.telemetry?.completion_tokens ?? 0;
        this.reliabilityMetrics.groq.totalLatencyMs += r.telemetry?.latency_ms ?? 0;
        return { ...r, telemetry: { ...r.telemetry, queue_delay_ms: queueDelayMs } };
      } catch (err: any) {
        if (err instanceof RateLimitError) {
          this.reliabilityMetrics.groq.http429 += 1;
          setRateLimitUntil('groq', Date.now() + err.retryAfterSeconds * 1000);
          errors.push(`groq:429(${err.retryAfterSeconds}s)`);
        } else {
          if (String(err.message).includes('HTTP 503')) this.reliabilityMetrics.groq.http503 += 1;
          else this.reliabilityMetrics.groq.otherErrors += 1;
          errors.push(`groq:${err.message}`);
        }
        return null;
      }
    };

    const tryGeminiAdapter = async (adapter: GeminiProviderAdapter, label: string, isAdditionalFallback: boolean) => {
      if (excludeProviders.includes('gemini')) return null;
      if (!adapter.isConfigured()) {
        if (!isAdditionalFallback) errors.push('gemini:not_configured');
        return null;
      }
      if (isAdditionalFallback && geminiKeyRateLimitedThisTurn) {
        // Same-key quota is shared across Gemini models; do not mask shared 429 quota exhaustion
        return null;
      }
      const limitUntil = getRateLimitUntil('gemini');
      if (Date.now() < limitUntil) {
        if (!isAdditionalFallback) {
          const rem = Math.ceil((limitUntil - Date.now()) / 1000);
          errors.push(`gemini:rate_limited(${rem}s)`);
        }
        return null;
      }
      this.reliabilityMetrics.gemini.calls += 1;
      try {
        const { result: r, queueDelayMs } = await runWithCentralQuotaQueue('gemini', () =>
          adapter.callChatCompletion(messages, options)
        );
        this.reliabilityMetrics.gemini.successes += 1;
        this.reliabilityMetrics.gemini.promptTokens += r.telemetry?.prompt_tokens ?? 0;
        this.reliabilityMetrics.gemini.completionTokens += r.telemetry?.completion_tokens ?? 0;
        this.reliabilityMetrics.gemini.totalLatencyMs += r.telemetry?.latency_ms ?? 0;
        return {
          ...r,
          telemetry: { ...r.telemetry, queue_delay_ms: queueDelayMs, is_fallback: r.telemetry?.is_fallback || isAdditionalFallback },
        };
      } catch (err: any) {
        if (err instanceof RateLimitError) {
          geminiKeyRateLimitedThisTurn = true;
          this.reliabilityMetrics.gemini.http429 += 1;
          setRateLimitUntil('gemini', Date.now() + err.retryAfterSeconds * 1000);
          errors.push(`${label}:429(${err.retryAfterSeconds}s)`);
        } else {
          if (String(err.message).includes('HTTP 503')) this.reliabilityMetrics.gemini.http503 += 1;
          else this.reliabilityMetrics.gemini.otherErrors += 1;
          errors.push(`${label}:${err.message}`);
        }
        return null;
      }
    };

    const tryGeminiPrimary = () => tryGeminiAdapter(this.geminiAdapter, 'gemini', false);
    const tryGeminiFallback = () =>
      this.geminiAdapter.modelName === 'gemini-3.1-flash-lite'
        ? Promise.resolve(null)
        : tryGeminiAdapter(this.geminiFallbackAdapter, 'gemini-fallback', true);

    if (this.mode === 'groq') {
      const res = await tryGroq();
      if (res) return res;
    } else if (this.mode === 'gemini') {
      const res = await tryGeminiPrimary();
      if (res) return res;
      const fb = await tryGeminiFallback();
      if (fb) return fb;
    } else if (this.mode === 'mock') {
      if (!allowMockFallback) {
        throw new ProviderUnavailableError('mock', 'Gateway is configured in mock mode while strict live execution was requested.');
      }
      return this.mockAdapter.callChatCompletion(messages, options);
    } else {
      // V3.0 FINAL Auto Order: Primary Gemini 3.5 -> Secondary Groq Qwen 3.8 27B -> Fallback Gemini 3.1
      const order =
        options?.preferredProvider === 'groq'
          ? [tryGroq, tryGeminiPrimary, tryGeminiFallback]
          : [tryGeminiPrimary, tryGroq, tryGeminiFallback];
      for (const runner of order) {
        const res = await runner();
        if (res) return res;
      }
    }

    const reason = errors.join('; ') || 'No configured live LLM providers succeeded';
    this.lastFallbackReason = reason;

    if (!allowMockFallback) {
      throw new ProviderUnavailableError('auto', `LIVE_LLM_UNAVAILABLE: ${reason}`);
    }

    const mockRes = await this.mockAdapter.callChatCompletion(messages, options);
    return {
      ...mockRes,
      telemetry: {
        ...mockRes.telemetry,
        error: reason,
        is_fallback: true,
      },
    };
  }
}
