import { describe, it, expect } from 'vitest';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';

const isLiveTestEnabled = process.env.RUN_REAL_API_TESTS === 'true';

describe.skipIf(!isLiveTestEnabled)('Milestone 3.5 — Real Free API Smoke Tests (Conditional Live Execution)', () => {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  it('Provider A — Groq Free API Smoke Test', async () => {
    const groq = new GroqProviderAdapter();

    if (!groq.isConfigured()) {
      console.log('ℹ️ [SMOKE TEST GROQ]: GROQ_API_KEY is not configured in process.env.');
      console.log('   Status: IMPLEMENTED_NOT_LIVE_VERIFIED');
      console.log('   To verify live Groq API, set GROQ_API_KEY in .env or environment.');
      expect(groq.isConfigured()).toBe(false);
      return;
    }

    console.log(`🚀 [SMOKE TEST GROQ]: Executing real API call to Groq (${groq.modelName})...`);
    const startTime = performance.now();

    try {
      const res = await groq.callChatCompletion([
        {
          role: 'system',
          content: 'You are an NLU parser. Return JSON: {"intent": "GREETING", "confidence": 0.95}',
        },
        { role: 'user', content: 'Xin chào bạn' },
      ]);

      const duration = Math.round(performance.now() - startTime);
      console.log(`✅ [SMOKE TEST GROQ SUCCESS]:`);
      console.log(`   - Model:       ${res.telemetry.model}`);
      console.log(`   - Latency:     ${duration} ms`);
      console.log(`   - Tokens:      Prompt ${res.telemetry.prompt_tokens} | Completion ${res.telemetry.completion_tokens} | Total ${res.telemetry.total_tokens}`);
      console.log(`   - Raw content: ${res.raw_content}`);

      expect(res.raw_content).toBeDefined();
      const parsed = JSON.parse(res.raw_content);
      expect(parsed.intent).toBe('GREETING');

      // Test ListModels
      const models = await groq.listAvailableModels();
      console.log(`   - Available Groq models count: ${models.length}`);
      expect(Array.isArray(models)).toBe(true);
    } catch (err: any) {
      console.warn(`⚠️ [SMOKE TEST GROQ FAILED/RATE_LIMITED]: ${err.message}`);
      // Do not fake PASS if network request genuinely failed
      throw err;
    }
  });

  it('Provider B — Google Gemini Free API Smoke Test', async () => {
    const gemini = new GeminiProviderAdapter();

    if (!gemini.isConfigured()) {
      console.log('ℹ️ [SMOKE TEST GEMINI]: GEMINI_API_KEY is not configured in process.env.');
      console.log('   Status: IMPLEMENTED_NOT_LIVE_VERIFIED');
      console.log('   To verify live Gemini API, set GEMINI_API_KEY in .env or environment.');
      expect(gemini.isConfigured()).toBe(false);
      return;
    }

    console.log(`🚀 [SMOKE TEST GEMINI]: Executing real API call to Gemini (${gemini.modelName})...`);
    const startTime = performance.now();

    try {
      const res = await gemini.callChatCompletion([
        {
          role: 'system',
          content: 'You are an NLU parser. Return JSON: {"intent": "GREETING", "confidence": 0.95}',
        },
        { role: 'user', content: 'Xin chào bạn' },
      ]);

      const duration = Math.round(performance.now() - startTime);
      console.log(`✅ [SMOKE TEST GEMINI SUCCESS]:`);
      console.log(`   - Model:       ${res.telemetry.model}`);
      console.log(`   - Latency:     ${duration} ms`);
      console.log(`   - Tokens:      Prompt ${res.telemetry.prompt_tokens} | Completion ${res.telemetry.completion_tokens} | Total ${res.telemetry.total_tokens}`);
      console.log(`   - Raw content: ${res.raw_content}`);

      expect(res.raw_content).toBeDefined();
      const parsed = JSON.parse(res.raw_content);
      expect(parsed.intent).toBe('GREETING');

      // Test ListModels for Gemini
      const models = await gemini.listAvailableModels();
      console.log(`   - Available Gemini models count: ${models.length}`);
      expect(Array.isArray(models)).toBe(true);
    } catch (err: any) {
      console.warn(`⚠️ [SMOKE TEST GEMINI FAILED/RATE_LIMITED]: ${err.message}`);
      throw err;
    }
  });
});
