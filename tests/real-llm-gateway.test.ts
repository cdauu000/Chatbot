import { describe, it, expect } from 'vitest';
import {
  RealLLMGateway,
  LLMStructuredOutputSchema,
} from '../src/conversation/adapters/real-llm-gateway.js';

describe('Milestone 3 - C. Real LLM Gateway & Structured Output', () => {
  it('reports unconfigured status when no API key is provided', () => {
    const gateway = new RealLLMGateway({ apiKey: '' });
    expect(gateway.isConfigured()).toBe(false);
  });

  it('throws REAL_LLM_NOT_CONFIGURED when called without API key', async () => {
    const gateway = new RealLLMGateway({ apiKey: '' });
    await expect(
      gateway.parseIntentAndEntities('Tìm phòng cho anh', [], null)
    ).rejects.toThrow('REAL_LLM_NOT_CONFIGURED');
  });

  it('redacts sensitive API key from logs and strings', () => {
    const apiKey = 'sk-secret-test-key-1234567890';
    const gateway = new RealLLMGateway({ apiKey });
    const logMessage = `Request failed using authorization Bearer ${apiKey} at endpoint.`;
    const redacted = gateway.redactSensitive(logMessage);

    expect(redacted).not.toContain(apiKey);
    expect(redacted).toContain('[REDACTED_API_KEY]');
  });

  it('validates LLM structured output schema with Zod', () => {
    const validJson = {
      intent: 'SEARCH_ROOM',
      facility: 'jacayl-ha-dong',
      stay_type: 'nghi_gio',
      duration_hours: 3,
      must_have_amenities: ['bồn tắm'],
      confidence: 0.95,
    };

    const parsed = LLMStructuredOutputSchema.parse(validJson);
    expect(parsed.intent).toBe('SEARCH_ROOM');
    expect(parsed.facility).toBe('jacayl-ha-dong');
    expect(parsed.duration_hours).toBe(3);

    // Invalid intent rejects schema
    const invalidJson = {
      intent: 'INVALID_UNKNOWN_INTENT_CODE',
      confidence: 0.5,
    };
    expect(() => LLMStructuredOutputSchema.parse(invalidJson)).toThrow();
  });
});
