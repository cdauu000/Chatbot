import { describe, it, expect, vi } from 'vitest';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';
import { RateLimitError, AuthenticationError, ProviderUnavailableError } from '../src/conversation/adapters/provider-types.js';

describe('Milestone 3.5 — Google Gemini Free Provider Adapter', () => {
  it('reports configured true only when API key is present', () => {
    const unconfigured = new GeminiProviderAdapter({ apiKey: '' });
    expect(unconfigured.isConfigured()).toBe(false);

    const configured = new GeminiProviderAdapter({ apiKey: 'AIzaSy_test_12345' });
    expect(configured.isConfigured()).toBe(true);
  });

  it('successfully converts messages to Gemini request and parses response', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  intent: 'ASK_POLICY',
                  confidence: 0.9,
                }),
              },
            ],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 85,
        candidatesTokenCount: 22,
        totalTokenCount: 107,
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockGeminiResponse,
      headers: new Headers(),
    });

    const adapter = new GeminiProviderAdapter({
      apiKey: 'AIzaSy_test_key',
      model: 'gemini-2.0-flash',
      fetchFn: mockFetch as any,
    });

    const result = await adapter.callChatCompletion([
      { role: 'system', content: 'You are an NLU parser.' },
      { role: 'user', content: 'Chính sách qua đêm là mấy giờ?' },
    ]);

    expect(result.raw_content).toContain('ASK_POLICY');
    expect(result.telemetry.provider).toBe('gemini');
    expect(result.telemetry.total_tokens).toBe(107);
    expect(result.telemetry.prompt_tokens).toBe(85);
    expect(result.telemetry.completion_tokens).toBe(22);

    // Verify request shape: systemInstruction + contents
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('gemini-2.0-flash:generateContent?key=AIzaSy_test_key');

    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.systemInstruction?.parts?.[0]?.text).toContain('You are an NLU parser');
    expect(calledBody.contents?.[0]?.parts?.[0]?.text).toContain('Chính sách qua đêm');
    expect(calledBody.generationConfig?.responseMimeType).toBe('application/json');
  });

  it('handles HTTP 429 rate limit or RESOURCE_EXHAUSTED', async () => {
    const mockHeaders = new Headers();
    mockHeaders.set('retry-after', '60');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: mockHeaders,
      text: async () => 'Resource has been exhausted (e.g. check quota).',
    });

    const adapter = new GeminiProviderAdapter({
      apiKey: 'AIzaSy_test_key',
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.callChatCompletion([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow(RateLimitError);
  });

  it('handles invalid API key (API_KEY_INVALID) with AuthenticationError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: async () => 'API_KEY_INVALID: API key not valid. Please pass a valid API key.',
    });

    const adapter = new GeminiProviderAdapter({
      apiKey: 'AIzaSy_bad_key',
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.callChatCompletion([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow(AuthenticationError);
  });

  it('defaults to active free model gemini-3.5-flash-lite', () => {
    const adapter = new GeminiProviderAdapter();
    expect(adapter.modelName).toBe('gemini-3.5-flash-lite');
  });

  it('handles HTTP 404 model not found / retired with ProviderUnavailableError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Model gemini-1.5-flash is not found or retired.',
    });

    const adapter = new GeminiProviderAdapter({
      apiKey: 'AIzaSy_test_key',
      model: 'gemini-1.5-flash',
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.callChatCompletion([{ role: 'user', content: 'hello' }])
    ).rejects.toThrow(ProviderUnavailableError);
  });

  it('queries listAvailableModels successfully on 200 OK', async () => {
    const mockListResponse = {
      models: [
        { name: 'models/gemini-3.5-flash-lite' },
        { name: 'models/gemini-3.8-flash' },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockListResponse,
    });

    const adapter = new GeminiProviderAdapter({
      apiKey: 'AIzaSy_test_key',
      fetchFn: mockFetch as any,
    });

    const models = await adapter.listAvailableModels();
    expect(models).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  });
});
