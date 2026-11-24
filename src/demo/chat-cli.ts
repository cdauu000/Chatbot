import '../config/env-loader.js';
import * as readline from 'readline';
import { loadRawDataset } from '../data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../domain/transformer.js';
import { ConversationOrchestrator } from '../conversation/orchestrator.js';
import { FreeLLMGateway, GatewayRoutingMode } from '../conversation/adapters/free-llm-gateway.js';

export async function runChatCli() {
  console.log('================================================================');
  console.log('      J COLLECTION AI CONCIERGE — LOCAL CHAT DEMO (M3.5)        ');
  console.log('      FREE MULTI-PROVIDER LLM INTEGRATION: GROQ + GEMINI        ');
  console.log('================================================================');
  console.log('Commands:');
  console.log('  /mode <mock|groq|gemini|auto> - Switch LLM provider routing mode');
  console.log('  /provider-status              - Check health & rate limits of Free Providers');
  console.log('  /debug                        - Toggle developer debug telemetry inspection');
  console.log('  /reset                        - Clear conversation memory');
  console.log('  /clock <ISO>                  - Set reference clock (e.g. 2026-11-28T14:00:00+07:00)');
  console.log('  /exit                         - Quit the interactive chat');
  console.log('================================================================\n');

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);

  const freeGateway = new FreeLLMGateway();
  let orchestrator = new ConversationOrchestrator(dataset, {
    llmAdapter: freeGateway,
  });

  let sessionId = `session-${Date.now()}`;
  let debugMode = false;
  let referenceClock: string | undefined;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = () => {
    rl.question('\nKhách hàng: ', async (input) => {
      const text = input.trim();
      if (!text) {
        promptUser();
        return;
      }

      if (text === '/exit' || text === 'exit' || text === 'quit') {
        console.log('Cảm ơn anh/chị đã quan tâm đến J Collection. Tạm biệt anh/chị ạ!');
        rl.close();
        process.exit(0);
      }

      if (text === '/reset') {
        sessionId = `session-${Date.now()}`;
        console.log(`[Hệ thống] Đã reset phiên hội thoại. Mã phiên mới: ${sessionId}`);
        promptUser();
        return;
      }

      if (text === '/debug') {
        debugMode = !debugMode;
        console.log(`[Hệ thống] Chế độ debug: ${debugMode ? 'BẬT' : 'TẮT'}`);
        promptUser();
        return;
      }

      if (text === '/provider-status') {
        const status = freeGateway.getProviderStatus();
        console.log('\n--- [FREE LLM PROVIDER STATUS] ---');
        console.log(`- Active Routing Mode:   ${status.activeMode.toUpperCase()}`);
        console.log(`- Free-Only Mode:        ${status.freeOnlyMode ? 'STRICT_ACTIVE' : 'DISABLED'}`);
        console.log(`- Provider 1 (Groq):     ${status.groq.configured ? 'CONFIGURED (Free Tier)' : 'UNCONFIGURED (GROQ_API_KEY missing)'}`);
        console.log(`  Model:                 ${status.groq.model}`);
        console.log(`  Rate Limited:          ${status.groq.isRateLimited ? `YES (Cooloff ${status.groq.rateLimitCooloffSecRemaining}s remaining)` : 'NO'}`);
        console.log(`- Provider 2 (Gemini):   ${status.gemini.configured ? 'CONFIGURED (Free Tier)' : 'UNCONFIGURED (GEMINI_API_KEY missing)'}`);
        console.log(`  Model:                 ${status.gemini.model}`);
        console.log(`  Rate Limited:          ${status.gemini.isRateLimited ? `YES (Cooloff ${status.gemini.rateLimitCooloffSecRemaining}s remaining)` : 'NO'}`);
        console.log(`- Provider 3 (Mock):     CONFIGURED (Deterministic Grounded Core)`);
        console.log('----------------------------------\n');
        promptUser();
        return;
      }

      if (text.startsWith('/mode ')) {
        const targetMode = text.replace('/mode ', '').trim().toLowerCase() as GatewayRoutingMode;
        if (targetMode === 'groq' || targetMode === 'gemini' || targetMode === 'auto' || targetMode === 'mock') {
          freeGateway.setMode(targetMode);
          console.log(`[Hệ thống] Đã chuyển LLM Routing Mode sang: ${targetMode.toUpperCase()}`);
          if (targetMode === 'groq' && !process.env.GROQ_API_KEY) {
            console.log('  ⚠️ Lưu ý: GROQ_API_KEY chưa có trong biến môi trường. Khi gọi sẽ tự động fallback sang Mock.');
          }
          if (targetMode === 'gemini' && !process.env.GEMINI_API_KEY) {
            console.log('  ⚠️ Lưu ý: GEMINI_API_KEY chưa có trong biến môi trường. Khi gọi sẽ tự động fallback sang Mock.');
          }
        } else {
          console.log('[Lỗi] Mode không hợp lệ. Vui lòng chọn một trong: mock, groq, gemini, auto');
        }
        promptUser();
        return;
      }

      if (text.startsWith('/clock ')) {
        referenceClock = text.replace('/clock ', '').trim();
        orchestrator.setReferenceClock(referenceClock);
        console.log(`[Hệ thống] Đã thiết lập reference clock: ${referenceClock}`);
        promptUser();
        return;
      }

      try {
        const result = await orchestrator.processTurn(sessionId, text, referenceClock);
        const telemetry = freeGateway.getTelemetry();
        const fallbackReason = freeGateway.getLastFallbackReason();

        console.log(`\nAI Concierge:\n${result.customer_visible_response}`);

        if (debugMode) {
          console.log('\n--- [DEBUG STRUCTURED TELEMETRY & DECISION TRACE] ---');
          console.log(`- Provider Used:   ${telemetry?.provider?.toUpperCase() ?? 'MOCK'}`);
          console.log(`- Model Name:      ${telemetry?.model ?? 'internal-deterministic-engine'}`);
          console.log(`- Latency:         ${telemetry?.latency_ms ?? result.internal_trace.latency_ms} ms`);
          console.log(`- Token Usage:     Prompt: ${telemetry?.prompt_tokens ?? 0} | Completion: ${telemetry?.completion_tokens ?? 0} | Total: ${telemetry?.total_tokens ?? 0}`);
          if (fallbackReason) {
            console.log(`- Fallback Reason: ${fallbackReason}`);
          }
          console.log(`- Applied Policy:  ${result.internal_trace.applied_policy_id ?? 'J_COLLECTION_BUSINESS_POLICY_V1_4_3'}`);
          console.log(`- Extracted Intent:${result.intent}`);
          console.log(`- Chosen Action:   ${result.chosen_action}`);
          console.log(`- Active Facility: ${result.updated_state.active_facility ?? 'none'}`);
          console.log(`- Stay Type:       ${result.updated_state.stay_type}`);
          console.log(`- Check-in Time:   ${result.updated_state.checkin_datetime ?? 'not set'}`);
          console.log(`- Duration:        ${result.updated_state.duration_hours ?? 2}h`);
          console.log(`- Must Haves:      ${result.updated_state.must_have_amenities.join(', ') || 'none'}`);
          console.log(`- Negated:         ${result.updated_state.negated_constraints.join(', ') || 'none'}`);
          console.log(`- Candidates:      ${result.verified_candidates.map((c) => `${c.name} (${c.price_text})`).join(' | ')}`);

          if (result.claim_validation) {
            console.log(`- Verified Claims: ${result.claim_validation.verified_claims.join(' | ') || 'none'}`);
            if (result.claim_validation.disclaimed_claims.length > 0) {
              console.log(`- Disclaimed:      ${result.claim_validation.disclaimed_claims.join(' | ')}`);
            }
            if (result.claim_validation.rejected_claims.length > 0) {
              console.log(`- REJECTED Claims: ${result.claim_validation.rejected_claims.join(' | ')}`);
            }
          }

          if (result.human_escalation && result.human_escalation.needed) {
            console.log(`- Human Escalation: NEEDED (${result.human_escalation.reason_code})`);
            console.log(`  Contact Channel:  ${result.human_escalation.contact_channel}`);
          }

          console.log(`- Evidence Refs:   ${result.evidence_references.join(', ')}`);
          console.log('------------------------------------------------------\n');
        }
      } catch (err) {
        console.error('Lỗi xử lý lượt hội thoại:', err);
      }

      promptUser();
    });
  };

  promptUser();
}

// Allow direct execution
if (process.argv[1] && (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) || import.meta.url.includes(process.argv[1].replace(/\\/g, '/')))) {
  runChatCli();
}
