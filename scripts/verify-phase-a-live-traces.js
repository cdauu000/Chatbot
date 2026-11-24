try { process.loadEnvFile(); } catch (e) {}
import { loadRawDataset } from '../dist/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../dist/domain/transformer.js';
import { HadongAgent } from '../dist/agent/hadong-agent.js';
import { GroqProviderAdapter } from '../dist/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../dist/conversation/adapters/gemini-provider.js';
import * as fs from 'fs';
import * as path from 'path';

async function runPhaseALiveTraces() {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);

  const prompt =
    'Anh muốn phòng có bồn tắm ở Hà Đông, ngân sách 750k, thích không gian lãng mạn, muốn nghỉ khoảng 4 tiếng chiều cuối tuần. Nếu loại đẹp nhất vượt tiền thì em giúp anh chọn phương án khác nhé.';

  const results = {
    timestamp: new Date().toISOString(),
    groq: null,
    gemini: null,
  };

  // 1. GROQ LIVE EXECUTION
  console.log('=== RUNNING GROQ LIVE TRACE ===');
  try {
    const groqAdapter = new GroqProviderAdapter({ model: 'openai/gpt-oss-120b' });
    const groqAgent = new HadongAgent(dataset, {
      llmAdapter: groqAdapter,
      strictLiveOnly: true,
    });

    const sessionId = `groq-live-trace-${Date.now()}`;
    const groqTurn = await groqAgent.processTurn(sessionId, prompt, {
      strictLiveOnly: true,
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    results.groq = {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      sessionId,
      verificationStatus: groqTurn.decision_trace.verificationStatus,
      llmTelemetry: groqTurn.decision_trace.llmTelemetry,
      decisionSteps: groqTurn.decision_trace.decisionSteps.map((s) => ({
        step: s.step,
        phase: s.phase,
        thoughtSummary: s.thoughtSummary,
        toolCalls: s.toolCalls || [],
        toolResultsCount: s.toolResults?.length || 0,
      })),
      toolsExecuted: groqTurn.internal_trace.tools_executed,
      customerVisibleResponse: groqTurn.customer_visible_response,
      rejectedClaimsCount: groqTurn.claim_validation?.rejected_claims.length || 0,
    };

    console.log('Groq Live Run SUCCESS:', {
      status: groqTurn.decision_trace.verificationStatus,
      calls: groqTurn.decision_trace.llmTelemetry?.callCount,
      latency: groqTurn.decision_trace.latencyMs,
      tools: groqTurn.internal_trace.tools_executed,
    });
  } catch (err) {
    console.error('Groq Live Run FAILED:', err.message);
    results.groq = { error: err.message };
  }

  // 2. GEMINI LIVE EXECUTION (try models if 503 high demand)
  console.log('\n=== RUNNING GEMINI LIVE TRACE ===');
  const geminiModels = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  for (const model of geminiModels) {
    console.log(`Attempting Gemini model: ${model}...`);
    try {
      const geminiAdapter = new GeminiProviderAdapter({ model });
      const geminiAgent = new HadongAgent(dataset, {
        llmAdapter: geminiAdapter,
        strictLiveOnly: true,
      });

      const sessionId = `gemini-live-trace-${Date.now()}`;
      const geminiTurn = await geminiAgent.processTurn(sessionId, prompt, {
        strictLiveOnly: true,
        referenceClock: '2026-11-28T14:00:00+07:00',
      });

      results.gemini = {
        provider: 'gemini',
        model,
        sessionId,
        verificationStatus: geminiTurn.decision_trace.verificationStatus,
        llmTelemetry: geminiTurn.decision_trace.llmTelemetry,
        decisionSteps: geminiTurn.decision_trace.decisionSteps.map((s) => ({
          step: s.step,
          phase: s.phase,
          thoughtSummary: s.thoughtSummary,
          toolCalls: s.toolCalls || [],
          toolResultsCount: s.toolResults?.length || 0,
        })),
        toolsExecuted: geminiTurn.internal_trace.tools_executed,
        customerVisibleResponse: geminiTurn.customer_visible_response,
        rejectedClaimsCount: geminiTurn.claim_validation?.rejected_claims.length || 0,
      };

      console.log(`Gemini Live Run (${model}) SUCCESS:`, {
        status: geminiTurn.decision_trace.verificationStatus,
        calls: geminiTurn.decision_trace.llmTelemetry?.callCount,
        latency: geminiTurn.decision_trace.latencyMs,
        tools: geminiTurn.internal_trace.tools_executed,
      });
      break;
    } catch (err) {
      console.warn(`Gemini (${model}) failed: ${err.message}`);
      results.gemini = { error: err.message, lastModelAttempted: model };
    }
  }

  const outPath = path.resolve('artifacts/live-traces-phase-a.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nTraces saved to ${outPath}`);
}

runPhaseALiveTraces();
