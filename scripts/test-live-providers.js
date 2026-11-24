try { process.loadEnvFile(); } catch (e) {}
import { GroqProviderAdapter } from '../dist/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../dist/conversation/adapters/gemini-provider.js';

async function testLive() {
  console.log('Testing Groq live...');
  try {
    const groq = new GroqProviderAdapter({ model: 'openai/gpt-oss-120b' });
    const gRes = await groq.callChatCompletion([
      { role: 'system', content: 'Output JSON only' },
      { role: 'user', content: 'Output json {"status": "ok"}' },
    ]);
    console.log('Groq Success:', gRes.telemetry, gRes.raw_content);
  } catch (err) {
    console.error('Groq Failed:', err.message);
  }

  console.log('Testing Gemini live...');
  try {
    const gemini = new GeminiProviderAdapter({ model: 'gemini-3.5-flash-lite' });
    const mRes = await gemini.callChatCompletion([
      { role: 'system', content: 'Output JSON only' },
      { role: 'user', content: 'Output json {"status": "ok"}' },
    ]);
    console.log('Gemini Success:', mRes.telemetry, mRes.raw_content);
  } catch (err) {
    console.error('Gemini Failed:', err.message);
  }
}

testLive();
