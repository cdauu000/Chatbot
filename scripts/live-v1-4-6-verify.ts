import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../src/staff/auth/access-control.js';
import { TakeoverCoordinator } from '../src/staff/takeover/takeover-coordinator.js';
import { DashboardServer } from '../src/staff/server/dashboard-server.js';
import { getEffectivePolicyMetadata } from '../src/data-loader/pricing-policy-loader.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  process.env.CONVERSATION_ENGINE = 'agentic';
  process.env.STRICT_LIVE_ONLY = 'true';
  process.env.FREE_ONLY_MODE = 'true';

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const store = new SqliteStore({ dbPath: ':memory:' });
  AuthManager.seedDefaultUsers(store);
  const authManager = new AuthManager(store);

  const gateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });
  let lastDecisionTrace: any = null;
  const origProcessTurn = orchestrator.processTurn.bind(orchestrator);
  orchestrator.processTurn = async (...args: Parameters<typeof orchestrator.processTurn>) => {
    const res = await origProcessTurn(...args);
    lastDecisionTrace = res.decision_trace ?? null;
    return res;
  };
  const coordinator = new TakeoverCoordinator({ orchestrator, store });
  const server = new DashboardServer({
    port: 0,
    host: '127.0.0.1',
    store,
    authManager,
    takeoverCoordinator: coordinator,
    llmGateway: gateway,
  });

  const serverUrl = await server.start();
  const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@JCollection2026!' }),
  });
  const { token } = (await loginRes.json()) as { token: string };

  const telemetryRes = await fetch(`${serverUrl}/api/telemetry`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const telemetryJson: any = await telemetryRes.json();

  const transcripts: any[] = [];

  async function sendLiveTurn(params: {
    scenario: string;
    convId: string;
    propertyId: 'jacayl-ha-dong' | 'jacayl-tran-khat-chan' | 'j-village';
    message: string;
    referenceClock: string;
  }) {
    let data: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      lastDecisionTrace = null;
      const res = await fetch(`${serverUrl}/api/simulate/customer-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: params.convId,
          propertyId: params.propertyId,
          content: params.message,
          clientMessageId: `live146_${params.convId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          referenceClock: params.referenceClock,
          customerName: `Verify V1.4.6 (${params.scenario})`,
        }),
      });
      data = await res.json();
      if (res.ok && data?.aiMessage) break;
      if (attempt < 3) {
        console.log(`[RETRYING ${params.scenario} attempt ${attempt}] transient error (${data?.error || res.status}), waiting 35s...`);
        await sleep(35000);
      }
    }

    const aiMsg = data?.aiMessage;
    const trace = data?.decisionTrace ?? lastDecisionTrace ?? null;
    const toolCalls: any[] = [];
    const quoteResults: any[] = [];
    if (trace?.decisionSteps) {
      for (const step of trace.decisionSteps) {
        if (Array.isArray(step.toolCalls)) {
          toolCalls.push(...step.toolCalls.map((tc: any) => ({ toolName: tc.toolName, arguments: tc.arguments })));
        }
        if (Array.isArray(step.toolResults)) {
          for (const tr of step.toolResults) {
            if (tr.toolName === 'quote_price' && tr.data) {
              const qs = Array.isArray(tr.data.quotes) ? tr.data.quotes : [tr.data];
              quoteResults.push(...qs);
            }
          }
        }
      }
    }

    const entry = {
      scenario: params.scenario,
      conversationId: params.convId,
      propertyId: params.propertyId,
      referenceClockUsed: params.referenceClock,
      userMessage: params.message,
      aiResponse: aiMsg?.content ?? `BLOCKED/ERROR: ${data?.error || 'no aiMessage'}`,
      telemetry: aiMsg?.metadata?.telemetry ?? trace?.llmTelemetry,
      toolCalls,
      quoteResults: quoteResults.map((q) => ({
        room_id: q.room_id,
        stay_type: q.stay_type,
        confirmed_checkin: q.confirmed_checkin,
        confirmed_checkout: q.confirmed_checkout,
        standard_checkout: q.standard_checkout,
        grace_period_minutes: q.grace_period_minutes,
        grace_period_mode: q.grace_period_mode,
        actual_late_checkout_minutes: q.actual_late_checkout_minutes,
        billable_extra_hours: q.billable_extra_hours,
        base_package_price_vnd: q.base_package_price_vnd,
        extra_hour_rate_vnd: q.extra_hour_rate_vnd,
        extra_hour_subtotal_vnd: q.extra_hour_subtotal_vnd,
        total_price_vnd: q.total_price_vnd,
        effective_policy_version: q.effective_policy_version,
      })),
    };
    transcripts.push(entry);
    console.log(
      `[${params.scenario}] ${entry.telemetry?.provider}:${entry.telemetry?.model} (${entry.telemetry?.verificationStatus}) quotes=${JSON.stringify(entry.quoteResults.map((q) => ({ room: q.room_id, pkg: q.stay_type, total: q.total_price_vnd, extraH: q.billable_extra_hours })))} -> ${String(entry.aiResponse).slice(0, 140).replace(/\n/g, ' ')}`
    );
    return entry;
  }

  try {
    // Turn 1: Natural checkout 13:05 on Room 405 (65m late => 1h extra = 520.000đ)
    await sendLiveTurn({
      scenario: 'V146_MT1_405_2200_TO_1305',
      convId: 'v146_hd_405_multiturn',
      propertyId: 'jacayl-ha-dong',
      message: 'Anh ghé phòng 405 tầm 10 giờ đêm nay, trưa mai khoảng 1 giờ 5 phút chiều mới trả phòng thì hết bao nhiêu?',
      referenceClock: '2026-11-25T20:30:00+07:00',
    });
    await sleep(7000);

    // Turn 2: Keep 22:00 check-in, shift checkout across 13:10 vs 13:11 boundary
    await sendLiveTurn({
      scenario: 'V146_MT2_405_1310_VS_1311',
      convId: 'v146_hd_405_multiturn',
      propertyId: 'jacayl-ha-dong',
      message: 'Nếu anh cố ra trước 1h10 chiều mai với lại lỡ sang 1h11 thì tiền khác nhau thế nào em?',
      referenceClock: '2026-11-25T20:31:00+07:00',
    });
    await sleep(7000);

    // Compare room 405 (100k/h) vs room 601 (200k/h) at 22:00 -> 14:05
    await sendLiveTurn({
      scenario: 'V146_HD_COMPARE_405_VS_601_AT_1405',
      convId: 'v146_hd_compare_rates',
      propertyId: 'jacayl-ha-dong',
      message: 'So sánh giúp anh tổng tiền phòng 405 và căn 50 Sắc Thái nếu 22h tối nay nhận phòng và 2h05 chiều mai trả nhé.',
      referenceClock: '2026-11-25T20:35:00+07:00',
    });
    await sleep(7000);

    // TKC Room 601 at 22:00 -> 14:10 (100k/h => 1.300.000đ) + Breakfast FALSE
    await sendLiveTurn({
      scenario: 'V146_TKC_601_1410_AND_BREAKFAST',
      convId: 'v146_tkc_601',
      propertyId: 'jacayl-tran-khat-chan',
      message: 'Phòng 601 bên Trần Khát Chân vào lúc 22h tối nay, chiều mai 14h10 trả thì tổng cộng bao nhiêu và có ăn sáng không?',
      referenceClock: '2026-11-25T20:40:00+07:00',
    });
    await sleep(7000);

    // J Village Room 601 at 22:00 -> 14:10 (100k/h => 919.000đ)
    await sendLiveTurn({
      scenario: 'V146_JV_601_1410',
      convId: 'v146_jv_601',
      propertyId: 'j-village',
      message: 'Phòng 601 bên J Village tối nay 22h nhận phòng, trưa mai 2 giờ 10 chiều trả phòng hết tổng cộng mấy tiền?',
      referenceClock: '2026-11-25T20:45:00+07:00',
    });
  } finally {
    const out = {
      verified_at: new Date().toISOString(),
      strict_live_only: true,
      free_only_mode: true,
      policy_metadata: getEffectivePolicyMetadata(),
      dashboard_telemetry: telemetryJson,
      gateway_reliability: gateway.getReliabilityMetrics(),
      transcripts,
    };
    const outPath = path.resolve('artifacts', 'live-v1-4-6-verification.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('\nSaved V1.4.6 live verification to:', outPath);
    await server.stop().catch(() => {});
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
