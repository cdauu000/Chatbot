import {
  LLMProvider,
  LLMProviderOptions,
  ProviderCallResult,
  RateLimitError,
  AuthenticationError,
  ProviderUnavailableError,
} from './provider-types.js';

export interface GroqProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

export class GroqProviderAdapter implements LLMProvider {
  public readonly providerName = 'groq' as const;
  public readonly modelName: string;
  private apiKey?: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private fetchFn: typeof fetch;

  constructor(config?: GroqProviderConfig) {
    this.apiKey = config?.apiKey ?? process.env.GROQ_API_KEY;
    this.modelName = config?.model ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';
    this.baseUrl = config?.baseUrl ?? process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1';
    this.timeoutMs = config?.timeoutMs ?? parseInt(process.env.LLM_TIMEOUT_MS ?? '15000', 10);
    this.maxRetries = config?.maxRetries ?? 1; // Limit retries to preserve free quota
    this.fetchFn = config?.fetchFn ?? fetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public redactKey(text: string): string {
    if (!this.apiKey) return text;
    return text.replaceAll(this.apiKey, '[REDACTED_GROQ_KEY]');
  }

  /**
   * Queries Groq ListModels API to discover and verify active available models.
   */
  public async listAvailableModels(): Promise<string[]> {
    if (!this.isConfigured()) {
      throw new AuthenticationError('groq', 'GROQ_API_KEY is not configured.');
    }

    try {
      const response = await this.fetchFn(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError('groq', `HTTP ${response.status}: Invalid or unauthorized Groq API key.`);
      }

      if (response.status === 429) {
        throw new RateLimitError('groq', 60, 'Groq Free Tier quota exhausted on ListModels.');
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new ProviderUnavailableError('groq', `ListModels failed HTTP ${response.status}: ${this.redactKey(errText)}`);
      }

      const data: any = await response.json();
      const models: any[] = data.data ?? [];
      return models.map((m) => m.id);
    } catch (err: any) {
      if (err instanceof AuthenticationError || err instanceof RateLimitError) {
        throw err;
      }
      throw new ProviderUnavailableError('groq', `Error listing Groq models: ${this.redactKey(err.message)}`);
    }
  }

  public async callChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: LLMProviderOptions
  ): Promise<ProviderCallResult> {
    if (!this.isConfigured()) {
      throw new AuthenticationError('groq', 'GROQ_API_KEY is not configured.');
    }

    const timeout = options?.timeoutMs ?? this.timeoutMs;
    const maxTokens = options?.maxTokens ?? 600;
    const temperature = options?.temperature ?? 0.1;

    let attempt = 0;
    let lastError: Error | null = null;
    const startTime = performance.now();

    while (attempt <= this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const hasJsonWord = messages.some((m) => m.content.toLowerCase().includes('json'));
        const requestBody: any = {
          model: this.modelName,
          messages,
          temperature,
          max_tokens: maxTokens,
        };
        if (hasJsonWord) {
          requestBody.response_format = { type: 'json_object' };
        }

        const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle Rate Limits (HTTP 429)
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
          throw new RateLimitError('groq', Number.isFinite(retryAfterSec) ? retryAfterSec : 60);
        }

        // Handle Auth Errors (HTTP 401 / 403)
        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationError('groq', `HTTP ${response.status}: Invalid or unauthorized Groq API key.`);
        }

        // Handle Server Errors (HTTP 5xx)
        if (!response.ok) {
          const errBody = await response.text();
          throw new ProviderUnavailableError('groq', `HTTP ${response.status}: ${this.redactKey(errBody)}`);
        }

        const data: any = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
          throw new Error('Groq returned an empty response content.');
        }

        const latency = Math.round(performance.now() - startTime);

        return {
          raw_content: content,
          telemetry: {
            provider: 'groq',
            model: this.modelName,
            prompt_tokens: data.usage?.prompt_tokens ?? 0,
            completion_tokens: data.usage?.completion_tokens ?? 0,
            total_tokens: data.usage?.total_tokens ?? 0,
            latency_ms: latency,
            http_status: response.status,
            retries_attempted: attempt - 1,
            is_fallback: false,
          },
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        // If rate limit or authentication error, do not retry blindly
        if (err instanceof RateLimitError || err instanceof AuthenticationError) {
          throw err;
        }

        if (err.name === 'AbortError') {
          lastError = new Error(`Groq API call timed out after ${timeout}ms.`);
        }

        if (attempt <= this.maxRetries) {
          await new Promise((res) => setTimeout(res, attempt * 300));
        }
      }
    }

    throw lastError ?? new ProviderUnavailableError('groq', 'Failed to communicate with Groq API.');
  }
}
