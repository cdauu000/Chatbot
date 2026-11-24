import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { TranKhatChanAgent } from '../src/agent/trankhatchan-agent.js';
import { JVillageAgent } from '../src/agent/jvillage-agent.js';

describe('J Collection — Agentic V2.1 Multi-Property Tracing & Verification', () => {
  let dataset: NormalizedDataset;
  const artifactPath = path.resolve(process.cwd(), 'artifacts', 'live-traces-v2-1-multiproperty.json');
  const capturedTraces: any[] = [];

  beforeAll(() => {
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
  });

  // 1. PROPERTY 1: JACAYL HÀ ĐÔNG TRACE
  it('Property 1: Jacayl Hà Đông model-driven reasoning & tool calling trace', async () => {
    const agent = new HadongAgent(dataset);
    const sessionId = `trace-hd-${Date.now()}`;
    const userPrompt = 'Tìm giúp anh phòng có bồn tắm ở Hà Đông, nghỉ 4 tiếng chiều thứ Bảy, ngân sách 800k nhé.';

    const result = await agent.processTurn(sessionId, userPrompt, {
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    expect(result.customer_visible_response).toBeDefined();
    expect(result.customer_visible_response).toContain('Jacayl Hotel Hà Đông');

    capturedTraces.push({
      propertyId: 'jacayl-ha-dong',
      propertyName: 'Jacayl Hotel Hà Đông',
      sessionId,
      userMessage: userPrompt,
      executionMode: result.decision_trace.executionMode,
      toolsExecuted: result.internal_trace.tools_executed,
      customerVisibleResponse: result.customer_visible_response,
      claimValidation: {
        totalClaims: result.claim_validation?.total_claims ?? 0,
        verifiedClaims: result.claim_validation?.verified_claims?.length ?? 0,
        rejectedClaims: result.claim_validation?.rejected_claims?.length ?? 0,
      },
      latencyMs: result.decision_trace.latencyMs,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. PROPERTY 2: JACAYL TRẦN KHÁT CHÂN TRACE
  it('Property 2: Jacayl Trần Khát Chân model-driven reasoning & tool calling trace', async () => {
    const agent = new TranKhatChanAgent(dataset);
    const sessionId = `trace-tkc-${Date.now()}`;
    const userPrompt = 'Chào em, cơ sở Trần Khát Chân có phòng VIP nào đặc biệt có bồn tắm ngâm không? Báo giá giúp anh 2 tiếng nhé.';

    const result = await agent.processTurn(sessionId, userPrompt, {
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    expect(result.customer_visible_response).toBeDefined();
    expect(result.customer_visible_response).toContain('Trần Khát Chân');

    capturedTraces.push({
      propertyId: 'jacayl-tran-khat-chan',
      propertyName: 'Jacayl Hotel Trần Khát Chân',
      sessionId,
      userMessage: userPrompt,
      executionMode: result.decision_trace.executionMode,
      toolsExecuted: result.internal_trace.tools_executed,
      customerVisibleResponse: result.customer_visible_response,
      claimValidation: {
        totalClaims: result.claim_validation?.total_claims ?? 0,
        verifiedClaims: result.claim_validation?.verified_claims?.length ?? 0,
        rejectedClaims: result.claim_validation?.rejected_claims?.length ?? 0,
      },
      latencyMs: result.decision_trace.latencyMs,
      timestamp: new Date().toISOString(),
    });
  });

  // 3. PROPERTY 3: J VILLAGE TRACE
  it('Property 3: J Village model-driven reasoning & tool calling trace', async () => {
    const agent = new JVillageAgent(dataset);
    const sessionId = `trace-jv-${Date.now()}`;
    const userPrompt = 'Phòng 202 Neon ở J Village giá nghỉ 2 tiếng bao nhiêu em? Có chỗ đỗ xe không?';

    const result = await agent.processTurn(sessionId, userPrompt, {
      referenceClock: '2026-11-28T14:00:00+07:00',
    });

    expect(result.customer_visible_response).toBeDefined();
    expect(result.customer_visible_response).toContain('J Village');
    expect(result.customer_visible_response).toContain('202');

    capturedTraces.push({
      propertyId: 'j-village',
      propertyName: 'J Village',
      sessionId,
      userMessage: userPrompt,
      executionMode: result.decision_trace.executionMode,
      toolsExecuted: result.internal_trace.tools_executed,
      customerVisibleResponse: result.customer_visible_response,
      claimValidation: {
        totalClaims: result.claim_validation?.total_claims ?? 0,
        verifiedClaims: result.claim_validation?.verified_claims?.length ?? 0,
        rejectedClaims: result.claim_validation?.rejected_claims?.length ?? 0,
      },
      latencyMs: result.decision_trace.latencyMs,
      timestamp: new Date().toISOString(),
    });

    fs.writeFileSync(artifactPath, JSON.stringify({ traces: capturedTraces }, null, 2), 'utf-8');
    console.log(`Multi-property traces exported successfully to: ${artifactPath}`);
  });
});
