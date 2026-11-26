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
    for (let attempt = 1; attempt <= 2; attempt++) {
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
          clientMessageId: `live145_${params.convId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          referenceClock: params.referenceClock,
          customerName: `Verify V1.4.5 (${params.scenario})`,
        }),
      });
      data = await res.json();
      if (res.ok && data?.aiMessage) break;
      if (attempt < 2) {
        console.log(`[RETRYING ${params.scenario}] transient error (${data?.error || res.status}), waiting 15s...`);
        await sleep(15000);
      }
    }

    const aiMsg = data?.aiMessage;
    const convRows = store.getMessagesByConversationId(params.convId, 50);
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
      aiResponse: aiMsg?.content ?? `ERROR: ${data?.error || 'no aiMessage'}`,
      telemetry: aiMsg?.metadata?.telemetry ?? trace?.llmTelemetry,
      effectivePolicyVersion: trace?.llmTelemetry?.effectivePolicyVersion ?? telemetryJson.effectivePolicyVersion,
      toolCalls,
      quoteResults: quoteResults.map((q) => ({
        room_id: q.room_id,
        stay_type: q.stay_type,
        confirmed_checkin: q.confirmed_checkin,
        confirmed_checkout: q.confirmed_checkout,
        standard_checkout: q.standard_checkout,
        grace_period_minutes: q.grace_period_minutes,
        actual_late_checkout_minutes: q.actual_late_checkout_minutes,
        billable_extra_hours: q.billable_extra_hours,
        base_package_price_vnd: q.base_package_price_vnd,
        extra_hour_rate_vnd: q.extra_hour_rate_vnd,
        extra_hour_subtotal_vnd: q.extra_hour_subtotal_vnd,
        total_price_vnd: q.total_price_vnd,
        effective_policy_version: q.effective_policy_version,
      })),
      messageCount: convRows.length,
    };
    transcripts.push(entry);
    console.log(
      `[${params.scenario}] ${entry.telemetry?.provider}:${entry.telemetry?.model} (${entry.telemetry?.verificationStatus}) quotes=${JSON.stringify(entry.quoteResults.map((q) => ({ room: q.room_id, pkg: q.stay_type, total: q.total_price_vnd, extraH: q.billable_extra_hours })))} -> ${String(entry.aiResponse).slice(0, 140).replace(/\n/g, ' ')}`
    );
    return entry;
  }

  try {
    await sendLiveTurn({
      scenario: 'V145_MT1_405_2030_TO_1400',
      convId: 'v145_hd_405_multiturn',
      propertyId: 'jacayl-ha-dong',
      message: 'Phòng 405 bên Hà Đông nếu tầm 8 rưỡi tối nay anh mới tới, định ngủ lại tới 2 giờ chiều hôm sau thì hết tổng cộng bao nhiêu tiền?',
      referenceClock: '2026-11-25T20:10:00+07:00',
    });
    await sleep(7000);

    await sendLiveTurn({
      scenario: 'V145_MT2_405_SHIFT_CHECKIN_2230_KEEP_1400',
      convId: 'v145_hd_405_multiturn',
      propertyId: 'jacayl-ha-dong',
      message: 'À nếu anh cố thu xếp qua trễ hẳn lúc 10 giờ rưỡi tối thì bớt được nhiều không?',
      referenceClock: '2026-11-25T20:11:00+07:00',
    });
    await sleep(7000);

    await sendLiveTurn({
      scenario: 'V145_MT3_405_SHIFT_CHECKOUT_1208_GRACE',
      convId: 'v145_hd_405_multiturn',
      propertyId: 'jacayl-ha-dong',
      message: 'Thế sáng hôm sau tầm 12h08 anh mới trả phòng thì có bị tính thêm tiền tiếng nào không em?',
      referenceClock: '2026-11-25T20:12:00+07:00',
    });
    await sleep(7000);

    await sendLiveTurn({
      scenario: 'V145_HD_601_2200_TO_1415',
      convId: 'v145_hd_601_late',
      propertyId: 'jacayl-ha-dong',
      message: 'Cho anh hỏi căn 50 Sắc Thái nếu 10h tối nay nhận phòng và tới 2h15 chiều mai mới trả thì tổng chi phí tính thế nào?',
      referenceClock: '2026-11-25T19:15:00+07:00',
    });
    await sleep(7000);

    await sendLiveTurn({
      scenario: 'V145_TKC_202_BREAKFAST_FALSE',
      convId: 'v145_tkc_breakfast',
      propertyId: 'jacayl-tran-khat-chan',
      message: 'Cho mình hỏi phòng 202 bên Trần Khát Chân đặt qua đêm có được ăn sáng miễn phí hay mua thêm suất sáng tại khách sạn không?',
      referenceClock: '2026-11-25T19:20:00+07:00',
    });
    await sleep(7000);

    await sendLiveTurn({
      scenario: 'V145_JV_601_LATE_AND_BREAKFAST',
      convId: 'v145_jv_601',
      propertyId: 'j-village',
      message: 'Căn 601 bên J Village tối nay 22h vào ngủ tới 14h chiều mai trả phòng thì hết tất cả bao nhiêu? Sáng có đồ ăn sáng không?',
      referenceClock: '2026-11-25T19:25:00+07:00',
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
    const outPath = path.resolve('artifacts', 'live-v1-4-5-verification.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('\nSaved V1.4.5 live verification to:', outPath);
    await server.stop().catch(() => {});
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
