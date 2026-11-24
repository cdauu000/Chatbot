import { describe, it, expect, vi } from 'vitest';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';
import { RateLimitError } from '../src/conversation/adapters/provider-types.js';

describe('Milestone 3.5 — Free Multi-Provider LLM Gateway & Router', () => {
  it('enforces FREE_ONLY_MODE by default', () => {
    const gateway = new FreeLLMGateway();
    expect(gateway.isFreeOnlyMode()).toBe(true);
  });

  it('supports explicit mode switching between mock, groq, gemini, and auto', () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    expect(gateway.getMode()).toBe('mock');

    gateway.setMode('groq');
    expect(gateway.getMode()).toBe('groq');

    gateway.setMode('gemini');
    expect(gateway.getMode()).toBe('gemini');

    gateway.setMode('auto');
    expect(gateway.getMode()).toBe('auto');
  });

  it('reports provider health status for all free providers', () => {
    const gateway = new FreeLLMGateway();
    const status = gateway.getProviderStatus();

    expect(status.groq.name).toContain('Groq');
    expect(status.gemini.name).toContain('Gemini');
    expect(status.mock.name).toContain('Deterministic Mock Engine');
    expect(status.freeOnlyMode).toBe(true);
  });

  it('routes to Groq Free when configured in auto mode', async () => {
    const mockGroqCall = vi.fn().mockResolvedValue({
      raw_content: JSON.stringify({
        intent: 'SEARCH_ROOM',
        facility: 'jacayl-ha-dong',
        confidence: 0.95,
      }),
      telemetry: {
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        prompt_tokens: 100,
        completion_tokens: 30,
        total_tokens: 130,
        latency_ms: 120,
        retries_attempted: 0,
      },
    });

    const mockGroq = new GroqProviderAdapter({ apiKey: 'gsk_key' });
    vi.spyOn(mockGroq, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGroq, 'callChatCompletion').mockImplementation(mockGroqCall);

    const gateway = new FreeLLMGateway({
      mode: 'auto',
      groqAdapter: mockGroq,
    });

    const result = await gateway.parseIntentAndEntities('Tìm phòng ở Hà Đông', [], null);

    expect(result.intent).toBe('SEARCH_ROOM');
    expect(result.entities.facility).toBe('jacayl-ha-dong');
    expect(mockGroqCall).toHaveBeenCalled();

    const telemetry = gateway.getTelemetry();
    expect(telemetry?.provider).toBe('groq');
    expect(telemetry?.total_tokens).toBe(130);
  });

  it('automatically falls back to Gemini when Groq returns 429 Rate Limit', async () => {
    const mockGroq = new GroqProviderAdapter({ apiKey: 'gsk_key' });
    vi.spyOn(mockGroq, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGroq, 'callChatCompletion').mockRejectedValue(new RateLimitError('groq', 30));

    const mockGeminiCall = vi.fn().mockResolvedValue({
      raw_content: JSON.stringify({
        intent: 'ASK_POLICY',
        confidence: 0.9,
      }),
      telemetry: {
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        prompt_tokens: 90,
        completion_tokens: 25,
        total_tokens: 115,
        latency_ms: 150,
        retries_attempted: 0,
      },
    });

    const mockGemini = new GeminiProviderAdapter({ apiKey: 'AIzaSy_key' });
    vi.spyOn(mockGemini, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGemini, 'callChatCompletion').mockImplementation(mockGeminiCall);

    const gateway = new FreeLLMGateway({
      mode: 'auto',
      groqAdapter: mockGroq,
      geminiAdapter: mockGemini,
    });

    const result = await gateway.parseIntentAndEntities('Chính sách trả phòng thế nào?', [], null);

    expect(result.intent).toBe('ASK_POLICY');
    expect(mockGeminiCall).toHaveBeenCalled();

    const telemetry = gateway.getTelemetry();
    expect(telemetry?.provider).toBe('gemini');

    // Verify rate limit cooloff was set on Groq
    const status = gateway.getProviderStatus();
    expect(status.groq.isRateLimited).toBe(true);
    expect(status.groq.rateLimitCooloffSecRemaining).toBeGreaterThan(0);
  });

  it('safely falls back to deterministic Mock when all free providers fail or are unconfigured', async () => {
    const unconfiguredGroq = new GroqProviderAdapter({ apiKey: '' });
    const unconfiguredGemini = new GeminiProviderAdapter({ apiKey: '' });

    const gateway = new FreeLLMGateway({
      mode: 'auto',
      groqAdapter: unconfiguredGroq,
      geminiAdapter: unconfiguredGemini,
    });

    // Utterance with clear deterministic intent
    const result = await gateway.parseIntentAndEntities('Chào em, cho anh hỏi phòng ở J Village', [], null);

    expect(result.intent).toBeDefined();
    const telemetry = gateway.getTelemetry();
    expect(telemetry?.provider).toBe('mock');
    expect(gateway.getLastFallbackReason()).toBeDefined();
  });

  it('sanitizes customer PII before passing messages to LLM providers', async () => {
    let capturedPrompt = '';
    const mockGroqCall = vi.fn().mockImplementation((messages) => {
      capturedPrompt = JSON.stringify(messages);
      return Promise.resolve({
        raw_content: JSON.stringify({ intent: 'BOOKING_INTENT', confidence: 0.9 }),
        telemetry: {
          provider: 'groq',
          model: 'test',
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
          latency_ms: 50,
          retries_attempted: 0,
        },
      });
    });

    const mockGroq = new GroqProviderAdapter({ apiKey: 'gsk_test' });
    vi.spyOn(mockGroq, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGroq, 'callChatCompletion').mockImplementation(mockGroqCall);

    const gateway = new FreeLLMGateway({
      mode: 'auto',
      groqAdapter: mockGroq,
    });

    await gateway.parseIntentAndEntities(
      'Tên tôi là Nguyễn Văn Tuấn, số điện thoại 0912345678 cần đặt phòng.',
      [],
      null
    );

    expect(capturedPrompt).not.toContain('0912345678');
    expect(capturedPrompt).not.toContain('Nguyễn Văn Tuấn');
    expect(capturedPrompt).toContain('[REDACTED_PHONE]');
    expect(capturedPrompt).toContain('[REDACTED_NAME]');
  });

  it('falls back to Mock when provider returns malformed non-JSON response', async () => {
    const mockGroq = new GroqProviderAdapter({ apiKey: 'gsk_test' });
    vi.spyOn(mockGroq, 'isConfigured').mockReturnValue(true);
    vi.spyOn(mockGroq, 'callChatCompletion').mockResolvedValue({
      raw_content: 'Xin chào, đây là văn bản không phải JSON!',
      telemetry: {
        provider: 'groq',
        model: 'test',
        prompt_tokens: 20,
        completion_tokens: 20,
        total_tokens: 40,
        latency_ms: 80,
        retries_attempted: 0,
      },
    });

    const gateway = new FreeLLMGateway({
      mode: 'groq',
      groqAdapter: mockGroq,
    });

    const result = await gateway.parseIntentAndEntities('Tìm phòng 101 Lồng Chim', [], null);

    // Schema validation failed, gracefully recovered via Mock
    expect(result.intent).toBe('SEARCH_ROOM');
    expect(gateway.getTelemetry()?.provider).toBe('mock');
  });

  it('guarantees grounded customer-facing prose via AdvisoryComposer without hallucination', async () => {
    const gateway = new FreeLLMGateway();
    const response = await gateway.composeAdvisoryResponse({
      intent: 'GREETING',
      action: 'GENERAL_GREETING',
      userMessage: 'Xin chào',
      memory: {
        active_facility: null,
        focused_room: null,
        stay_type: 'nghi_gio',
        checkin_datetime: null,
        duration_hours: 2,
        max_budget: null,
        must_have_amenities: [],
        negated_constraints: [],
        shortlisted_rooms: [],
        last_quote_context: null,
        turn_count: 1,
      },
      candidates: [],
    });

    expect(response).toContain('J Collection');
    expect(response).toContain('J Village');
    expect(response).toContain('Trần Khát Chân');
    expect(response).toContain('Hà Đông');
  });
});
