import {
  LLMProvider,
  LLMProviderOptions,
  ProviderCallResult,
  RateLimitError,
  AuthenticationError,
  ProviderUnavailableError,
} from './provider-types.js';

export interface GeminiProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

export class GeminiProviderAdapter implements LLMProvider {
  public readonly providerName = 'gemini' as const;
  public readonly modelName: string;
  private apiKey?: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private fetchFn: typeof fetch;

  constructor(config?: GeminiProviderConfig) {
    this.apiKey = config?.apiKey ?? process.env.GEMINI_API_KEY;
    // Active Free Tier model: gemini-3.5-flash-lite (gemini-1.5/2.0 have been retired)
    this.modelName = config?.model ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
    this.baseUrl =
      config?.baseUrl ??
      process.env.GEMINI_BASE_URL ??
      'https://generativelanguage.googleapis.com/v1beta/models';
    this.timeoutMs = config?.timeoutMs ?? parseInt(process.env.LLM_TIMEOUT_MS ?? '15000', 10);
    this.maxRetries = config?.maxRetries ?? 1; // Limit retries to preserve free quota
    this.fetchFn = config?.fetchFn ?? fetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public redactKey(text: string): string {
    if (!this.apiKey) return text;
    return text.replaceAll(this.apiKey, '[REDACTED_GEMINI_KEY]');
  }

  /**
   * Queries Google ListModels API to discover and verify active available models.
   */
  public async listAvailableModels(): Promise<string[]> {
    if (!this.isConfigured()) {
      throw new AuthenticationError('gemini', 'GEMINI_API_KEY is not configured.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
    try {
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError('gemini', `HTTP ${response.status}: Invalid or unauthorized Gemini API key.`);
      }

      if (response.status === 429) {
        throw new RateLimitError('gemini', 60, 'Gemini Free Tier quota exhausted on ListModels.');
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new ProviderUnavailableError('gemini', `ListModels failed HTTP ${response.status}: ${this.redactKey(errText)}`);
      }

      const data: any = await response.json();
      const models: any[] = data.models ?? [];
      return models.map((m) => (m.name ?? '').replace(/^models\//, ''));
    } catch (err: any) {
      if (err instanceof AuthenticationError || err instanceof RateLimitError) {
        throw err;
      }
      throw new ProviderUnavailableError('gemini', `Error listing Gemini models: ${this.redactKey(err.message)}`);
    }
  }

  public async callChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: LLMProviderOptions
  ): Promise<ProviderCallResult> {
    if (!this.isConfigured()) {
      throw new AuthenticationError('gemini', 'GEMINI_API_KEY is not configured.');
    }

    const timeout = options?.timeoutMs ?? this.timeoutMs;
    const maxTokens = options?.maxTokens ?? 600;
    const temperature = options?.temperature ?? 0.1;

    // Separate system messages from conversational contents
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemInstruction =
      systemMessages.length > 0
        ? { parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }] }
        : undefined;

    const contents = conversationMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // If no conversational contents (only system), add dummy user prompt
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Please process request.' }] });
    }

    const requestBody = {
      contents,
      systemInstruction,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    };

    let attempt = 0;
    let lastError: Error | null = null;
    const startTime = performance.now();
    const endpoint = `${this.baseUrl}/${this.modelName}:generateContent?key=${this.apiKey}`;

    while (attempt <= this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle Rate Limits (HTTP 429 / RESOURCE_EXHAUSTED)
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
          throw new RateLimitError('gemini', Number.isFinite(retryAfterSec) ? retryAfterSec : 60);
        }

        // Handle Auth / Key Errors (HTTP 400 with API_KEY_INVALID, or 403)
        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationError('gemini', `HTTP ${response.status}: Invalid or unauthorized Gemini API key.`);
        }

        // Handle Deprecated / Not Found Models (HTTP 404)
        if (response.status === 404) {
          throw new ProviderUnavailableError('gemini', `HTTP 404: Model ${this.modelName} not found or retired on Gemini API.`);
        }

        if (!response.ok) {
          const errBody = await response.text();
          if (errBody.includes('API_KEY_INVALID') || errBody.includes('PERMISSION_DENIED')) {
            throw new AuthenticationError('gemini', `Gemini authentication error: ${this.redactKey(errBody)}`);
          }
          if (errBody.includes('RESOURCE_EXHAUSTED')) {
            throw new RateLimitError('gemini', 60, 'Gemini Free Tier quota exhausted.');
          }
          throw new ProviderUnavailableError('gemini', `HTTP ${response.status}: ${this.redactKey(errBody)}`);
        }

        const data: any = await response.json();
        const candidate = data.candidates?.[0];
        const content = candidate?.content?.parts?.[0]?.text;

        if (!content) {
          throw new Error('Gemini returned an empty candidate content.');
        }

        const latency = Math.round(performance.now() - startTime);

        return {
          raw_content: content,
          telemetry: {
            provider: 'gemini',
            model: this.modelName,
            prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
            completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
            latency_ms: latency,
            http_status: response.status,
            retries_attempted: attempt - 1,
            is_fallback: false,
          },
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        if (err instanceof RateLimitError || err instanceof AuthenticationError) {
          throw err;
        }

        if (err.name === 'AbortError') {
          lastError = new Error(`Gemini API call timed out after ${timeout}ms.`);
        }

        if (attempt <= this.maxRetries) {
          await new Promise((res) => setTimeout(res, attempt * 300));
        }
      }
    }

    throw lastError ?? new ProviderUnavailableError('gemini', 'Failed to communicate with Gemini API.');
  }
}
