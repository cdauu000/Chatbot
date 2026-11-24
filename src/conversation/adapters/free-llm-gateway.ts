import { z } from 'zod';
import { LLMAdapter, ConversationHistoryMessage, ComposeAdvisoryParams } from './llm-adapter.interface.js';
import { ExtractedEntities, IntentType, WorkingMemory } from '../conversation-types.js';
import { AdvisoryComposer } from '../advisory-composer.js';
import { MockLLMAdapter } from './mock-llm-adapter.js';
import { GroqProviderAdapter, GroqProviderConfig } from './groq-provider.js';
import { GeminiProviderAdapter, GeminiProviderConfig } from './gemini-provider.js';
import { LLMProvider, ProviderTelemetry, RateLimitError } from './provider-types.js';
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
  private mode: GatewayRoutingMode;
  private freeOnlyMode: boolean;

  private groqAdapter: GroqProviderAdapter;
  private geminiAdapter: GeminiProviderAdapter;
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

  constructor(config?: FreeLLMGatewayConfig) {
    this.mode = config?.mode ?? (process.env.LLM_PROVIDER as GatewayRoutingMode) ?? 'auto';
    this.freeOnlyMode = config?.freeOnlyMode ?? (process.env.FREE_ONLY_MODE !== 'false');

    this.groqAdapter = config?.groqAdapter ?? new GroqProviderAdapter(config?.groqConfig);
    this.geminiAdapter = config?.geminiAdapter ?? new GeminiProviderAdapter(config?.geminiConfig);
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
   * Auto routes Groq Free -> Gemini Free -> Mock Fallback.
   */
  public async callChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: any
  ): Promise<{ raw_content: string; telemetry: any }> {
    // 1. If explicit groq mode
    if (this.mode === 'groq') {
      if (this.groqAdapter.isConfigured() && Date.now() >= this.groqRateLimitUntil) {
        try {
          return await this.groqAdapter.callChatCompletion(messages, options);
        } catch (err: any) {
          if (err instanceof RateLimitError) {
            this.groqRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
          }
        }
      }
      return this.mockAdapter.callChatCompletion(messages, options);
    }

    // 2. If explicit gemini mode
    if (this.mode === 'gemini') {
      if (this.geminiAdapter.isConfigured() && Date.now() >= this.geminiRateLimitUntil) {
        try {
          return await this.geminiAdapter.callChatCompletion(messages, options);
        } catch (err: any) {
          if (err instanceof RateLimitError) {
            this.geminiRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
          }
        }
      }
      return this.mockAdapter.callChatCompletion(messages, options);
    }

    // 3. If explicit mock mode
    if (this.mode === 'mock') {
      return this.mockAdapter.callChatCompletion(messages, options);
    }

    // 4. In 'auto' mode: try Groq -> then Gemini -> then Mock
    if (this.groqAdapter.isConfigured() && Date.now() >= this.groqRateLimitUntil) {
      try {
        return await this.groqAdapter.callChatCompletion(messages, options);
      } catch (err: any) {
        if (err instanceof RateLimitError) {
          this.groqRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
        } else {
          this.groqRateLimitUntil = Date.now() + 60000;
        }
      }
    }

    if (this.geminiAdapter.isConfigured() && Date.now() >= this.geminiRateLimitUntil) {
      try {
        return await this.geminiAdapter.callChatCompletion(messages, options);
      } catch (err: any) {
        if (err instanceof RateLimitError) {
          this.geminiRateLimitUntil = Date.now() + err.retryAfterSeconds * 1000;
        } else {
          this.geminiRateLimitUntil = Date.now() + 60000;
        }
      }
    }

    return this.mockAdapter.callChatCompletion(messages, options);
  }
}
