import { describe, it, expect, vi } from 'vitest';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { RateLimitError, AuthenticationError, ProviderUnavailableError } from '../src/conversation/adapters/provider-types.js';

describe('Milestone 3.5 — Groq Free Provider Adapter', () => {
  it('reports configured true only when API key is present', () => {
    const unconfigured = new GroqProviderAdapter({ apiKey: '' });
    expect(unconfigured.isConfigured()).toBe(false);

    const configured = new GroqProviderAdapter({ apiKey: 'gsk_test_12345' });
    expect(configured.isConfigured()).toBe(true);
  });

  it('successfully calls Groq and parses telemetry on 200 OK', async () => {
    const mockJson = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: 'SEARCH_ROOM',
              facility: 'jacayl-ha-dong',
              duration_hours: 2,
              confidence: 0.95,
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 35,
        total_tokens: 155,
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockJson,
      headers: new Headers(),
    });

    const adapter = new GroqProviderAdapter({
      apiKey: 'gsk_valid_key',
      fetchFn: mockFetch as any,
    });

    const result = await adapter.callChatCompletion([
      { role: 'user', content: 'Tìm phòng tại Hà Đông' },
    ]);

    expect(result.raw_content).toContain('SEARCH_ROOM');
    expect(result.telemetry.provider).toBe('groq');
    expect(result.telemetry.total_tokens).toBe(155);
    expect(result.telemetry.prompt_tokens).toBe(120);
    expect(result.telemetry.completion_tokens).toBe(35);
    expect(result.telemetry.latency_ms).toBeGreaterThanOrEqual(0);

    // Verify request shape sent to Groq
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk_valid_key',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('handles HTTP 429 rate limit with Retry-After header', async () => {
    const mockHeaders = new Headers();
    mockHeaders.set('retry-after', '45');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: mockHeaders,
      text: async () => 'Rate limit exceeded: tokens per minute (TPM)',
    });

    const adapter = new GroqProviderAdapter({
      apiKey: 'gsk_valid_key',
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.callChatCompletion([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow(RateLimitError);

    try {
      await adapter.callChatCompletion([{ role: 'user', content: 'hello' }]);
    } catch (err: any) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.retryAfterSeconds).toBe(45);
      expect(err.provider).toBe('groq');
    }
  });

  it('handles HTTP 401/403 invalid API key without infinite retry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => 'Invalid API Key',
    });

    const adapter = new GroqProviderAdapter({
      apiKey: 'gsk_invalid_key',
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.callChatCompletion([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow(AuthenticationError);

    // Should fail immediately without retrying 401
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles network timeout gracefully', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const adapter = new GroqProviderAdapter({
      apiKey: 'gsk_test',
      timeoutMs: 50,
      maxRetries: 0,
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.callChatCompletion([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow(/timed out/);
  });

  it('redacts API key from error messages', () => {
    const key = 'gsk_super_secret_key_12345';
    const adapter = new GroqProviderAdapter({ apiKey: key });
    const rawError = `Failed request with key ${key} at https://api.groq.com`;
    const redacted = adapter.redactKey(rawError);

    expect(redacted).not.toContain(key);
    expect(redacted).toContain('[REDACTED_GROQ_KEY]');
  });

  it('queries listAvailableModels successfully on 200 OK', async () => {
    const mockModelsResponse = {
      data: [
        { id: 'openai/gpt-oss-20b' },
        { id: 'llama-3.3-70b-versatile' },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockModelsResponse,
    });

    const adapter = new GroqProviderAdapter({
      apiKey: 'gsk_test',
      fetchFn: mockFetch as any,
    });

    const models = await adapter.listAvailableModels();
    expect(models).toEqual(['openai/gpt-oss-20b', 'llama-3.3-70b-versatile']);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk_test',
        }),
      })
    );
  });
});
