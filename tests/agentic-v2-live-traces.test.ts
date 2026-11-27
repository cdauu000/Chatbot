import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';

describe('J Collection — Agentic V2.0 Live LLM Multi-Turn Tracing & Verification', () => {
  let dataset: NormalizedDataset;
  const artifactPath = path.resolve(process.cwd(), 'artifacts', 'live-traces-v2.json');
  const capturedTraces: any[] = [];

  beforeAll(() => {
    try {
      process.loadEnvFile?.();
    } catch {}
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
  });

  // =========================================================================
  // PROVIDER 1: GROQ LIVE REASONING TRACE
  // =========================================================================
  it('Live Provider 1: Groq model-driven reasoning & tool calling trace', async () => {
    const groq = new GroqProviderAdapter();
    if (!groq.isConfigured()) {
      console.log('Skipping live Groq test: GROQ_API_KEY not configured');
      return;
    }

    const agent = new HadongAgent(dataset, {
      llmAdapter: groq,
      strictLiveOnly: false,
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    const sessionId = `live-groq-${Date.now()}`;
    const userPrompt =
      'Anh muốn tìm phòng có bồn tắm ở Hà Đông, nghỉ 4 tiếng chiều thứ Bảy, ngân sách 800 nghìn. Nếu phòng đẹp nhất vượt tiền thì em tìm phương án gần nhất nhé.';

    const result = await agent.processTurn(sessionId, userPrompt, {
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    console.log('\n--- LIVE GROQ REASONING RESPONSE ---');
    console.log(result.customer_visible_response);
    console.log('Verification Status:', result.decision_trace.verificationStatus);
    console.log('Provider Model:', result.decision_trace.providerModel);
    console.log('------------------------------------\n');

    expect(result.customer_visible_response).toBeDefined();
    expect(result.claim_validation?.rejected_claims.length).toBe(0);

    const sanitizedTrace = {
      sessionId,
      provider: 'groq',
      model: result.decision_trace.providerModel,
      verificationStatus: result.decision_trace.verificationStatus,
      latencyMs: result.decision_trace.latencyMs,
      userMessage: userPrompt,
      extractedEntities: result.extracted_entities,
      decisionSteps: result.decision_trace.decisionSteps.map((step) => ({
        step: step.step,
        phase: step.phase,
        thoughtSummary: step.thoughtSummary,
        toolCalls: step.toolCalls?.map((tc) => ({
          toolName: tc.toolName,
          arguments: tc.arguments,
        })),
        toolResults: step.toolResults?.map((tr) => ({
          toolName: tr.toolName,
          status: tr.status,
          provenance: tr.provenance,
        })),
      })),
      toolsExecuted: result.internal_trace.tools_executed,
      customerVisibleResponse: result.customer_visible_response,
      claimValidation: {
        totalClaims: result.claim_validation?.total_claims ?? 0,
        verifiedClaims: result.claim_validation?.verified_claims?.length ?? 0,
        rejectedClaims: result.claim_validation?.rejected_claims?.length ?? 0,
      },
      timestamp: new Date().toISOString(),
    };

    capturedTraces.push(sanitizedTrace);
  });

  // =========================================================================
  // PROVIDER 2: GEMINI LIVE REASONING TRACE
  // =========================================================================
  it('Live Provider 2: Gemini model-driven reasoning & tool calling trace', async () => {
    const gemini = new GeminiProviderAdapter();
    if (!gemini.isConfigured()) {
      console.log('Skipping live Gemini test: GEMINI_API_KEY not configured');
      return;
    }

    const agent = new HadongAgent(dataset, {
      llmAdapter: gemini,
      strictLiveOnly: false,
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    const sessionId = `live-gemini-${Date.now()}`;
    const userPrompt =
      'Anh muốn phòng có bồn tắm ở Hà Đông, ngân sách 750k, thích không gian lãng mạn, nghỉ 4 tiếng chiều cuối tuần.';

    const result = await agent.processTurn(sessionId, userPrompt, {
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    console.log('\n--- LIVE GEMINI REASONING RESPONSE ---');
    console.log(result.customer_visible_response);
    console.log('Verification Status:', result.decision_trace.verificationStatus);
    console.log('Provider Model:', result.decision_trace.providerModel);
    console.log('--------------------------------------\n');

    expect(result.customer_visible_response).toBeDefined();
    expect(result.claim_validation?.rejected_claims.length).toBe(0);

    const sanitizedTrace = {
      sessionId,
      provider: 'gemini',
      model: result.decision_trace.providerModel,
      verificationStatus: result.decision_trace.verificationStatus,
      latencyMs: result.decision_trace.latencyMs,
      userMessage: userPrompt,
      extractedEntities: result.extracted_entities,
      decisionSteps: result.decision_trace.decisionSteps.map((step) => ({
        step: step.step,
        phase: step.phase,
        thoughtSummary: step.thoughtSummary,
        toolCalls: step.toolCalls?.map((tc) => ({
          toolName: tc.toolName,
          arguments: tc.arguments,
        })),
        toolResults: step.toolResults?.map((tr) => ({
          toolName: tr.toolName,
          status: tr.status,
          provenance: tr.provenance,
        })),
      })),
      toolsExecuted: result.internal_trace.tools_executed,
      customerVisibleResponse: result.customer_visible_response,
      claimValidation: {
        totalClaims: result.claim_validation?.total_claims ?? 0,
        verifiedClaims: result.claim_validation?.verified_claims?.length ?? 0,
        rejectedClaims: result.claim_validation?.rejected_claims?.length ?? 0,
      },
      timestamp: new Date().toISOString(),
    };

    capturedTraces.push(sanitizedTrace);

    if (process.env.EXPORT_TEST_ARTIFACTS === 'true') {
      if (!fs.existsSync(path.dirname(artifactPath))) {
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      }
      fs.writeFileSync(artifactPath, JSON.stringify({ traces: capturedTraces }, null, 2), 'utf8');
      console.log(`Live traces exported successfully to: ${artifactPath}`);
    }
  });
});
