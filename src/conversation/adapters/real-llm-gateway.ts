import { z } from 'zod';
import { LLMAdapter, ConversationHistoryMessage, ComposeAdvisoryParams } from './llm-adapter.interface.js';
import { ExtractedEntities, IntentType, WorkingMemory } from '../conversation-types.js';
import { AdvisoryComposer } from '../advisory-composer.js';

export const LLMStructuredOutputSchema = z.object({
  intent: z.enum([
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
    'BOOKING_INTENT',
    'REQUEST_HUMAN',
    'IN_STAY_OPERATIONAL_REQUEST',
    'CHECKOUT_DISPUTE',
    'OUT_OF_SCOPE',
    'CLARIFICATION',
    'GREETING',
    'AI_IDENTITY_INQUIRY',
  ]),
  facility: z.enum(['j-village', 'jacayl-tran-khat-chan', 'jacayl-ha-dong']).optional(),
  room_name: z.string().optional(),
  stay_type: z.enum(['nghi_gio', 'qua_dem', 'ngay_dem']).optional(),
  duration_hours: z.number().int().positive().optional(),
  budget: z.number().positive().optional(),
  checkin_datetime: z.string().optional(),
  must_have_amenities: z.array(z.string()).optional(),
  removed_requirements: z.array(z.string()).optional(),
  negated_constraints: z.array(z.string()).optional(),
  cleared_negations: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).default(0.85),
  missing_information: z.array(z.string()).optional(),
});

export type LLMStructuredOutput = z.infer<typeof LLMStructuredOutputSchema>;

export interface RealLLMGatewayConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface LLMTelemetry {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  retry_count: number;
  provider: string;
  model: string;
}

export class RealLLMGateway implements LLMAdapter {
  public readonly name = 'RealLLMGateway';
  private config: RealLLMGatewayConfig;
  private composer: AdvisoryComposer;
  private telemetry: LLMTelemetry | null = null;

  constructor(config?: RealLLMGatewayConfig) {
    this.config = {
      apiKey: config?.apiKey ?? process.env.LLM_API_KEY,
      baseUrl: config?.baseUrl ?? process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      model: config?.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
      timeoutMs: config?.timeoutMs ?? parseInt(process.env.LLM_TIMEOUT_MS ?? '8000', 10),
      maxRetries: config?.maxRetries ?? 2,
    };
    this.composer = new AdvisoryComposer();
  }

  public isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.apiKey.trim().length > 0);
  }

  public getTelemetry(): LLMTelemetry | null {
    return this.telemetry;
  }

  /**
   * Redacts sensitive information like API keys from logs and messages.
   */
  public redactSensitive(text: string): string {
    if (!this.config.apiKey) return text;
    return text.replaceAll(this.config.apiKey, '[REDACTED_API_KEY]');
  }

  /**
   * Provider-agnostic API call with timeout and retries.
   */
  private async callProviderWithRetry(messages: Array<{ role: string; content: string }>): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('REAL_LLM_NOT_CONFIGURED: No API key provided.');
    }

    let attempt = 0;
    let lastError: Error | null = null;
    const startTime = performance.now();

    while (attempt <= (this.config.maxRetries ?? 2)) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            temperature: 0.1,
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`HTTP ${response.status}: ${this.redactSensitive(errBody)}`);
        }

        const data: any = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
          throw new Error('Empty response content from LLM provider.');
        }

        // Record telemetry
        this.telemetry = {
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          total_tokens: data.usage?.total_tokens ?? 0,
          latency_ms: Math.round(performance.now() - startTime),
          retry_count: attempt - 1,
          provider: this.config.baseUrl ?? 'openai-compatible',
          model: this.config.model ?? 'unknown',
        };

        return content;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;
        if (err.name === 'AbortError') {
          lastError = new Error(`LLM call timed out after ${this.config.timeoutMs}ms.`);
        }
        // Wait exponential backoff before retry: 200ms, 400ms...
        if (attempt <= (this.config.maxRetries ?? 2)) {
          await new Promise((res) => setTimeout(res, attempt * 200));
        }
      }
    }

    throw lastError ?? new Error('Failed to communicate with LLM provider.');
  }

  public async parseIntentAndEntities(
    utterance: string,
    history: ConversationHistoryMessage[],
    memory: WorkingMemory | null,
    referenceClock?: string
  ): Promise<{ intent: IntentType; entities: ExtractedEntities; confidence: number }> {
    if (!this.isConfigured()) {
      throw new Error('REAL_LLM_NOT_CONFIGURED');
    }

    const systemPrompt = `You are the NLU parser for J Collection hotel concierge.
Extract user intent and entities into JSON.
Return JSON matching schema:
{
  "intent": one of IntentType,
  "facility": "j-village" | "jacayl-tran-khat-chan" | "jacayl-ha-dong" or omitted,
  "room_name": string or omitted,
  "stay_type": "nghi_gio" | "qua_dem" | "ngay_dem" or omitted,
  "duration_hours": integer >= 1 or omitted,
  "budget": number or omitted,
  "must_have_amenities": string[] or omitted,
  "removed_requirements": string[] or omitted,
  "negated_constraints": string[] or omitted,
  "cleared_negations": string[] or omitted,
  "confidence": number between 0 and 1
}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: utterance },
    ];

    const rawJson = await this.callProviderWithRetry(messages);
    const parsed = JSON.parse(rawJson);
    const validated = LLMStructuredOutputSchema.parse(parsed);

    const entities: ExtractedEntities = {
      facility: validated.facility,
      room_name: validated.room_name,
      stay_type: validated.stay_type,
      duration_hours: validated.duration_hours,
      budget: validated.budget,
      must_have_amenities: validated.must_have_amenities,
      removed_requirements: validated.removed_requirements,
      negated_constraints: validated.negated_constraints,
      cleared_negations: validated.cleared_negations,
    };

    return {
      intent: validated.intent as IntentType,
      entities,
      confidence: validated.confidence,
    };
  }

  public async composeAdvisoryResponse(params: ComposeAdvisoryParams): Promise<string> {
    // Grounded deterministic composition enforces Vietnamese receptionist persona & verified facts
    return this.composer.compose(params);
  }
}
