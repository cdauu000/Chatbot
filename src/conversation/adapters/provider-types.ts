/**
 * J Collection AI Concierge - LLM Provider Types & Interfaces
 * Milestone 3.5: Free Multi-Provider LLM API Integration (Groq + Gemini)
 */

export interface ProviderTelemetry {
  provider: 'groq' | 'gemini' | 'mock';
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  http_status?: number;
  retry_after_seconds?: number;
  error?: string;
  retries_attempted: number;
  is_fallback?: boolean;
  rate_limits?: {
    limit_requests?: string | null;
    limit_tokens?: string | null;
    remaining_requests?: string | null;
    remaining_tokens?: string | null;
  };
}

export interface ProviderCallResult {
  raw_content: string;
  telemetry: ProviderTelemetry;
}

export interface LLMProviderOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMProvider {
  readonly providerName: 'groq' | 'gemini' | 'mock';
  readonly modelName: string;
  isConfigured(): boolean;
  callChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: LLMProviderOptions
  ): Promise<ProviderCallResult>;
}

export class RateLimitError extends Error {
  public readonly retryAfterSeconds: number;
  public readonly provider: string;

  constructor(provider: string, retryAfterSeconds: number = 60, message?: string) {
    super(message ?? `Rate limit (HTTP 429) encountered for provider ${provider}. Retry after ${retryAfterSeconds}s.`);
    this.name = 'RateLimitError';
    this.provider = provider;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AuthenticationError extends Error {
  public readonly provider: string;

  constructor(provider: string, message?: string) {
    super(message ?? `Authentication failed (HTTP 401/403) for provider ${provider}. Check API key.`);
    this.name = 'AuthenticationError';
    this.provider = provider;
  }
}

export class ProviderUnavailableError extends Error {
  public readonly provider: string;

  constructor(provider: string, message?: string) {
    super(message ?? `Provider ${provider} is unavailable.`);
    this.name = 'ProviderUnavailableError';
    this.provider = provider;
  }
}
