import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { JCollectionAgent } from '../src/agent/jcollection-agent.js';
import { AgentToolGateway } from '../src/agent/agent-tools.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';
import {
  computeDatasetVersionHash,
  lookupStructuredReference,
  recordToolResultAsEvidence,
  renderStructuredMonetaryPlaceholders,
} from '../src/conversation/grounding/business-evidence.js';
import { AgentLLMDecision, BusinessEvidenceRecord } from '../src/agent/agent-contracts.js';

function makeMockSequenceAdapter(decisions: AgentLLMDecision[]) {
  let idx = 0;
  return {
    name: 'mock-replay-llm',
    modelName: 'mock-contract-replay-v1',
    getMode: () => 'live-mock',
    callChatCompletion: async () => {
      const dec = decisions[Math.min(idx, decisions.length - 1)];
      idx += 1;
      return {
        raw_content: JSON.stringify(dec),
        telemetry: {
          provider: 'mock-replay-llm',
          model: 'mock-contract-replay-v1',
          prompt_tokens: 120,
          completion_tokens: 45,
        },
      };
    },
  };
}

describe('J COLLECTION — Final Contract Compatibility Offline Replay & Mutation Suite', () => {
  const dataset = transformRawDatasetToDomain(loadRawDataset());
  const validator = new ClaimLevelValidator(dataset);
  const activeHash = computeDatasetVersionHash(dataset);

  it('1. ACC-HD-01 Verbatim Offline Replay (T1/T2/T3): opaque factIds, multi-role breakdown, budget delta, separated telemetry, zero duplicate OBSERVE toolResults', async () => {
    let observedToolCount = 0;
    const adapter = {
      name: 'mock-replay-llm',
      modelName: 'mock-contract-replay-v1',
      getMode: () => 'live-mock',
      callChatCompletion: async (messages: Array<{ role: string; content: string }>) => {
        const userMsg = messages[messages.length - 1]?.content || '';
        const latestCustomerMsg = userMsg.match(/Latest Customer Message:\s*"([^"]+)"/)?.[1] || userMsg;
        const turnObsSection = userMsg.split('Tool Observations Collected This Turn:')[1] || '';
        const factRefMatches = Array.from(turnObsSection.matchAll(/\b(q\d+_f\d+)\s*=>\s*([^\n|]+)/g)).map((m) => ({
          id: m[1],
          desc: m[2].trim(),
        }));
        observedToolCount += factRefMatches.length;

        let dec: AgentLLMDecision;
        if (latestCustomerMsg.includes('nghỉ 2 tiếng giá bao nhiêu')) {
          if (factRefMatches.length === 0) {
            dec = {
              action: 'CALL_TOOLS',
              thought_summary: 'Quote 101 2h at 20:00 Wed',
              tool_calls: [
                {
                  tool_name: 'quote_price',
                  arguments: {
                    property_id: 'jacayl-ha-dong',
                    room_id: '101-long-chim',
                    stay_type: 'nghi_gio',
                    stay_intent: 'hourly',
                    duration_hours: 2,
                    checkin_datetime: '2026-11-25T20:00:00+07:00',
                    checkin_confidence: 'CONFIRMED',
                  },
                },
              ],
            };
          } else {
            const totalRef = factRefMatches.find((f) => f.desc.includes('/TOTAL/'))!.id;
            dec = {
              action: 'RESPOND_DIRECTLY',
              thought_summary: 'Reply using opaque factId',
              claim_refs: [totalRef],
              final_response: `Dạ phòng 101 — Lồng Chim đặt lịch nghỉ 2 tiếng lúc 20:00 tối nay có giá trọn gói là {{ref:${totalRef}}} ạ.`,
            };
          }
        } else if (latestCustomerMsg.includes('nghỉ 4 tiếng luôn')) {
          if (factRefMatches.length === 0) {
            dec = {
              action: 'CALL_TOOLS',
              thought_summary: 'Quote 101 4h at 20:00 Wed',
              tool_calls: [
                {
                  tool_name: 'quote_price',
                  arguments: {
                    property_id: 'jacayl-ha-dong',
                    room_id: '101-long-chim',
                    stay_type: 'nghi_gio',
                    stay_intent: 'hourly',
                    duration_hours: 4,
                    checkin_datetime: '2026-11-25T20:00:00+07:00',
                    checkin_confidence: 'CONFIRMED',
                  },
                },
              ],
            };
          } else {
            const totalRef = factRefMatches.find((f) => f.desc.includes('/TOTAL/'))!.id;
            const baseRef = factRefMatches.find((f) => f.desc.includes('/BASE_2H/'))!.id;
            const subRef = factRefMatches.find((f) => f.desc.includes('/EXTRA_HOUR_SUBTOTAL/'))!.id;
            dec = {
              action: 'RESPOND_DIRECTLY',
              thought_summary: 'Reply 4h breakdown with opaque factIds',
              claim_refs: [totalRef, baseRef, subRef],
              final_response:
                `Dạ phòng 101 — Lồng Chim đặt lịch nghỉ 4 tiếng lúc 20:00 tối nay có chi tiết như sau ạ: ` +
                `tiền 2 giờ đầu là {{ref:${baseRef}}}, tiền 2 giờ phát sinh tiếp theo là {{ref:${subRef}}}, tổng cộng là {{ref:${totalRef}}} ạ.`,
            };
          }
        } else {
          // Turn 3: 601 Saturday 15h 4h + budget 800k
          if (factRefMatches.length === 0) {
            dec = {
              action: 'CALL_TOOLS',
              thought_summary: 'Quote 601 4h at 15:00 Sat',
              tool_calls: [
                {
                  tool_name: 'quote_price',
                  arguments: {
                    property_id: 'jacayl-ha-dong',
                    room_id: '601-50-sac-thai',
                    stay_type: 'nghi_gio',
                    stay_intent: 'hourly',
                    duration_hours: 4,
                    checkin_datetime: '2026-11-28T15:00:00+07:00',
                    checkin_confidence: 'CONFIRMED',
                  },
                },
              ],
            };
          } else {
            const totalRef = factRefMatches.find((f) => f.desc.includes('/TOTAL/'))!.id;
            const baseRef = factRefMatches.find((f) => f.desc.includes('/BASE_2H/'))!.id;
            const extraRateRef = factRefMatches.find((f) => f.desc.includes('/EXTRA_HOUR_RATE'))!.id;
            const subRef = factRefMatches.find((f) => f.desc.includes('/EXTRA_HOUR_SUBTOTAL/'))!.id;
            dec = {
              action: 'RESPOND_DIRECTLY',
              thought_summary: 'Reply 601 4h Sat with natural breakdown + 49k budget delta',
              claim_refs: [totalRef, baseRef, extraRateRef, subRef],
              final_response:
                `Dạ phòng 601 — 50 Sắc Thái đặt lịch nghỉ 4 tiếng vào chiều thứ Bảy lúc 15:00 có tổng chi phí là {{ref:${totalRef}}} ` +
                `(gồm 2 giờ đầu {{ref:${baseRef}}} và 2 giờ phát sinh mỗi giờ {{ref:${extraRateRef}}} là {{ref:${subRef}}}). ` +
                `Với ngân sách 800.000đ của anh/chị thì sẽ thiếu một chút (49.000đ) ạ.`,
            };
          }
        }
        return {
          raw_content: JSON.stringify(dec),
          telemetry: {
            provider: 'mock-replay-llm',
            model: 'mock-contract-replay-v1',
            prompt_tokens: 150,
            completion_tokens: 60,
          },
        };
      },
    };

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: adapter,
      strictLiveOnly: true,
    });
    const sessionId = 'replay-acc-hd-01';

    const t1 = await agent.processTurn(
      sessionId,
      'Chào em, phòng 101 Lồng Chim bên Hà Đông tối thứ Tư lúc 20h nghỉ 2 tiếng giá bao nhiêu?',
      { referenceClock: '2026-11-25T15:00:00+07:00', strictLiveOnly: true }
    );
    expect(observedToolCount).toBeGreaterThan(0);
    expect(t1.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(t1.customer_visible_response).toContain('399.000đ');
    expect(t1.customer_visible_response).not.toContain('{{ref:');
    expect(t1.claim_validation.rejected_claims).toEqual([]);
    expect(t1.claim_validation.grounding_status).toBe('VERIFIED');
    expect(t1.decision_trace.llmTelemetry?.telemetryEvents?.groundingRejections).toBe(0);
    expect(t1.decision_trace.decisionSteps.find((s) => s.phase === 'OBSERVE')?.toolResults).toBeUndefined();
    expect(t1.decision_trace.decisionSteps.find((s) => s.phase === 'ACT')?.toolResults?.length).toBe(1);

    const t2 = await agent.processTurn(
      sessionId,
      'Thế cũng phòng 101 tối thứ Tư đấy nhưng anh muốn nghỉ 4 tiếng luôn thì tổng hết bao nhiêu, tính tách giúp anh tiền 2h đầu với tiền phát sinh nhé.',
      { referenceClock: '2026-11-25T15:00:00+07:00', strictLiveOnly: true }
    );
    expect(t2.decision_trace.llmTelemetry?.fallbackState?.fallbackReason).toBeUndefined();
    expect(t2.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(t2.customer_visible_response).toContain('399.000đ');
    expect(t2.customer_visible_response).toContain('200.000đ');
    expect(t2.customer_visible_response).toContain('599.000đ');
    expect(t2.claim_validation.rejected_claims).toEqual([]);
    expect(t2.decision_trace.llmTelemetry?.telemetryEvents?.evidenceInvalidations).toBe(1);
    expect(t2.decision_trace.llmTelemetry?.telemetryEvents?.groundingRejections).toBe(0);

    const t3 = await agent.processTurn(
      sessionId,
      'À đổi sang phòng 601 50 Sắc Thái cho 4 tiếng chiều thứ Bảy lúc 15h thì hết bao nhiêu em? Nếu anh có tầm ngân sách 800k thì vừa không?',
      { referenceClock: '2026-11-25T15:00:00+07:00', strictLiveOnly: true }
    );
    expect(t3.decision_trace.llmTelemetry?.fallbackState?.fallbackReason).toBeUndefined();
    expect(t3.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(t3.extracted_entities.budget).toBe(800000);
    expect(t3.customer_visible_response).toContain('849.000đ');
    expect(t3.customer_visible_response).toContain('449.000đ');
    expect(t3.customer_visible_response).toContain('200.000đ');
    expect(t3.customer_visible_response).toContain('400.000đ');
    expect(t3.customer_visible_response).toContain('49.000đ');
    expect(t3.claim_validation.rejected_claims).toEqual([]);
    expect(t3.claim_validation.grounding_status).toBe('VERIFIED');
    expect(t3.decision_trace.llmTelemetry?.telemetryEvents?.replanningEvents).toBe(1);
    expect(t3.decision_trace.llmTelemetry?.telemetryEvents?.groundingRejections).toBe(0);
    expect(t3.decision_trace.llmTelemetry?.telemetryEvents?.evidenceInvalidations).toBe(1);
  });

  it('2. ACC-HD-02 Verbatim + Extended Replay (17.5 float duration, no fake 420k budget, no /1h/ ngay_dem, ALT_21_40 conditional, 21:45->13:10/13:15, budget change keeps valid quote)', async () => {
    const adapter = {
      name: 'mock-replay-llm',
      modelName: 'mock-contract-replay-v1',
      getMode: () => 'live-mock',
      callChatCompletion: async (messages: Array<{ role: string; content: string }>) => {
        const userMsg = messages[messages.length - 1]?.content || '';
        const latestCustomerMsg = userMsg.match(/Latest Customer Message:\s*"([^"]+)"/)?.[1] || userMsg;
        const turnObsSection = userMsg.split('Tool Observations Collected This Turn:')[1] || '';
        const factRefMatches = Array.from(turnObsSection.matchAll(/\b(q\d+_f\d+)\s*=>\s*([^\n|]+)/g)).map((m) => ({
          id: m[1],
          desc: m[2].trim(),
        }));

        let dec: AgentLLMDecision;
        if (latestCustomerMsg.includes('lúc 18:30 ở tới trưa hôm sau')) {
          if (factRefMatches.length === 0) {
            dec = {
              action: 'CALL_TOOLS',
              thought_summary: 'Quote 201 qua_dem check-in 18:30 with float 17.5h',
              tool_calls: [
                {
                  tool_name: 'quote_price',
                  arguments: {
                    property_id: 'jacayl-ha-dong',
                    room_id: '201-la-casta',
                    stay_type: 'qua_dem',
                    stay_intent: 'overnight_until_next_day',
                    duration_hours: 17.5,
                    checkin_datetime: '2026-11-26T18:30:00+07:00',
                    checkout_datetime: '2026-11-27T12:00:00+07:00',
                    checkin_confidence: 'CONFIRMED',
                  },
                },
              ],
            };
          } else {
            const ngayDemTotal = factRefMatches.find((f) => f.desc.includes('/ngay_dem/TOTAL'))!.id;
            const alt2140 = factRefMatches.find((f) => f.desc.includes('/ALT_21_40@delayed_to_21_40'))!.id;
            dec = {
              action: 'RESPOND_DIRECTLY',
              thought_summary: 'Explain 18:30 uses ngay_dem and 420k applies if moved to 21:40+',
              claim_refs: [ngayDemTotal, alt2140],
              final_response:
                `Dạ khung giờ nghỉ qua đêm tại J Collection bắt đầu từ 22:00 (hỗ trợ nhận sớm nhất từ 21:40). ` +
                `Do anh/chị dự kiến nhận phòng lúc 18:30 và ở đến trưa hôm sau, thời điểm này sẽ áp dụng gói Ngày Đêm (từ 14:00 hôm nay đến 12:00 trưa hôm sau) với giá {{ref:${ngayDemTotal}}} ạ.\n\n` +
                `Nếu anh/chị muốn áp dụng mức giá gói Qua Đêm ({{ref:${alt2140}}}), anh/chị có thể dời giờ nhận phòng sang từ 21:40 nhé ạ!`,
            };
          }
        } else if (latestCustomerMsg.includes('ngân sách 600k')) {
          // Turn 1b: budget change only — should NOT require re-quoting or invalidate prior valid quote
          const priorMatches = Array.from(userMsg.matchAll(/\b(q\d+_f\d+)=([A-Z0-9_]+)\(/g)).map((m) => ({
            id: m[1],
            role: m[2],
          }));
          const ngayDemTotal = priorMatches.find((f) => f.role === 'TOTAL')?.id;
          dec = {
            action: 'RESPOND_DIRECTLY',
            thought_summary: 'Prior valid ngay_dem quote still satisfies 600k budget without invalidation',
            claim_refs: ngayDemTotal ? [ngayDemTotal] : [],
            final_response: ngayDemTotal
              ? `Dạ với ngân sách 600.000đ của anh/chị thì gói Ngày Đêm {{ref:${ngayDemTotal}}} của phòng 201 hoàn toàn nằm trong ngân sách ạ.`
              : 'Dạ mức 520.000đ nằm trong ngân sách 600.000đ ạ.',
          };
        } else if (latestCustomerMsg.includes('13:10')) {
          if (factRefMatches.length === 0) {
            dec = {
              action: 'CALL_TOOLS',
              thought_summary: 'Quote 201 21:45 -> 13:10 qua_dem',
              tool_calls: [
                {
                  tool_name: 'quote_price',
                  arguments: {
                    property_id: 'jacayl-ha-dong',
                    room_id: '201-la-casta',
                    stay_type: 'qua_dem',
                    checkin_datetime: '2026-11-26T21:45:00+07:00',
                    checkout_datetime: '2026-11-27T13:10:00+07:00',
                    checkin_confidence: 'CONFIRMED',
                  },
                },
              ],
            };
          } else {
            const totalRef = factRefMatches.find((f) => f.desc.includes('/TOTAL'))!.id;
            const pkgRef = factRefMatches.find((f) => f.desc.includes('/PACKAGE_RATE'))!.id;
            const subRef = factRefMatches.find((f) => f.desc.includes('/EXTRA_HOUR_SUBTOTAL'))!.id;
            dec = {
              action: 'RESPOND_DIRECTLY',
              thought_summary: 'Reply 21:45->13:10 (1h late checkout, 520k)',
              claim_refs: [totalRef, pkgRef, subRef],
              final_response:
                `Dạ nhận phòng 201 lúc 21:45 được áp dụng ân hạn qua đêm ({{ref:${pkgRef}}}). ` +
                `Trả phòng 13:10 tính 1 giờ phát sinh là {{ref:${subRef}}}, tổng cộng {{ref:${totalRef}}} ạ (tình trạng kéo dài giờ cần lễ tân đối soát PMS thực tế).`,
            };
          }
        } else {
          // 13:15 -> 2h late checkout = 620k
          if (factRefMatches.length === 0) {
            dec = {
              action: 'CALL_TOOLS',
              thought_summary: 'Quote 201 21:45 -> 13:15 qua_dem',
              tool_calls: [
                {
                  tool_name: 'quote_price',
                  arguments: {
                    property_id: 'jacayl-ha-dong',
                    room_id: '201-la-casta',
                    stay_type: 'qua_dem',
                    checkin_datetime: '2026-11-26T21:45:00+07:00',
                    checkout_datetime: '2026-11-27T13:15:00+07:00',
                    checkin_confidence: 'CONFIRMED',
                  },
                },
              ],
            };
          } else {
            const totalRef = factRefMatches.find((f) => f.desc.includes('/TOTAL'))!.id;
            const pkgRef = factRefMatches.find((f) => f.desc.includes('/PACKAGE_RATE'))!.id;
            const subRef = factRefMatches.find((f) => f.desc.includes('/EXTRA_HOUR_SUBTOTAL'))!.id;
            dec = {
              action: 'RESPOND_DIRECTLY',
              thought_summary: 'Reply 21:45->13:15 (2h late checkout, 620k)',
              claim_refs: [totalRef, pkgRef, subRef],
              final_response:
                `Dạ nếu trả phòng lúc 13:15 (qua mốc ân hạn 13:10), phụ thu 2 giờ phát sinh là {{ref:${subRef}}}, ` +
                `cùng giá gói qua đêm {{ref:${pkgRef}}} tổng là {{ref:${totalRef}}} ạ (cần xác nhận PMS trực tiếp với lễ tân).`,
            };
          }
        }
        return {
          raw_content: JSON.stringify(dec),
          telemetry: {
            provider: 'mock-replay-llm',
            model: 'mock-contract-replay-v1',
            prompt_tokens: 150,
            completion_tokens: 60,
          },
        };
      },
    };

    const agent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: adapter,
      strictLiveOnly: true,
    });
    const sessionId = 'replay-acc-hd-02';

    const t1 = await agent.processTurn(
      sessionId,
      'Cho mình hỏi nếu thứ Năm tuần này mình đến phòng 201 La Casta lúc 18:30 ở tới trưa hôm sau thì áp dụng gói qua đêm 420k được không?',
      { referenceClock: '2026-11-26T10:00:00+07:00', strictLiveOnly: true }
    );
    expect(t1.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(t1.extracted_entities.budget).toBeUndefined();
    expect(t1.customer_visible_response).toContain('520.000đ');
    expect(t1.customer_visible_response).toContain('420.000đ');
    expect(t1.customer_visible_response).not.toContain('{{ref:');
    expect(t1.claim_validation.rejected_claims).toEqual([]);
    expect(t1.claim_validation.grounding_status).toBe('VERIFIED');
    expect(t1.decision_trace.llmTelemetry?.telemetryEvents?.replanningEvents).toBe(0);
    expect(t1.decision_trace.llmTelemetry?.telemetryEvents?.groundingRejections).toBe(0);

    // Ensure no /1h/ leaked onto ngay_dem fact refs in session evidence
    const sState = agent.getSessionState(sessionId);
    const ngayDemRefs = (sState.verifiedBusinessEvidence || []).flatMap((ev) =>
      (ev.scopedRates || []).filter((r) => r.stayPackage === 'ngay_dem')
    );
    expect(ngayDemRefs.length).toBeGreaterThan(0);
    expect(ngayDemRefs.every((r) => r.durationHours === undefined && !String(r.legacyRef).includes('/1h/'))).toBe(true);

    // Budget mutation on Turn 2 keeps prior valid quote evidence intact (no false invalidation!)
    const tBudget = await agent.processTurn(
      sessionId,
      'Thế ngân sách 600k cho gói Ngày Đêm phòng 201 ban nãy ổn không em?',
      { referenceClock: '2026-11-26T10:00:00+07:00', strictLiveOnly: true }
    );
    expect(tBudget.extracted_entities.budget).toBe(600000);
    expect(tBudget.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(tBudget.decision_trace.llmTelemetry?.telemetryEvents?.evidenceInvalidations).toBe(0);
    expect(tBudget.claim_validation.grounding_status).toBe('VERIFIED');

    // Late checkout 21:45 -> 13:10 (1h late = 100k, total 520k)
    const t2 = await agent.processTurn(
      sessionId,
      'Vậy nếu mình đợi đến 21:45 mới nhận phòng 201 để lấy gói qua đêm rồi 13:10 hôm sau mới trả phòng thì tính thêm bao nhiêu tiền phát sinh?',
      { referenceClock: '2026-11-26T10:00:00+07:00', strictLiveOnly: true }
    );
    expect(t2.decision_trace.llmTelemetry?.fallbackState?.fallbackReason).toBeUndefined();
    expect(t2.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(t2.customer_visible_response).toContain('420.000đ');
    expect(t2.customer_visible_response).toContain('100.000đ');
    expect(t2.customer_visible_response).toContain('520.000đ');
    expect(t2.claim_validation.rejected_claims).toEqual([]);

    // Late checkout 21:45 -> 13:15 (2h late = 200k, total 620k)
    const t3 = await agent.processTurn(
      sessionId,
      'Còn nếu đến 13:15 mới trả thì hết tổng bao nhiêu?',
      { referenceClock: '2026-11-26T10:00:00+07:00', strictLiveOnly: true }
    );
    expect(t3.decision_trace.llmTelemetry?.fallbackState?.fallbackReason).toBeUndefined();
    expect(t3.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(t3.customer_visible_response).toContain('200.000đ');
    expect(t3.customer_visible_response).toContain('620.000đ');
    expect(t3.claim_validation.rejected_claims).toEqual([]);
  });

  it('3. Ten Mandatory Negative & Boundary Mutations + Unified Lookup / LegacyRef Compatibility', async () => {
    const gateway = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    // Float 17.5 passes on qua_dem, rejects on nghi_gio
    const floatPkgRes = await gateway.executeTool({
      toolCallId: 'tc_float_pkg',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '201-la-casta',
        stay_type: 'qua_dem',
        duration_hours: 17.5,
        checkin_datetime: '2026-11-26T18:30:00+07:00',
      },
    });
    expect(floatPkgRes.status).toBe('SUCCESS');
    expect(floatPkgRes.data?.quotes?.[0]?.duration_hours).toBeUndefined();

    const floatHourlyRes = await gateway.executeTool({
      toolCallId: 'tc_float_hr',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '101-long-chim',
        stay_type: 'nghi_gio',
        duration_hours: 3.5,
      },
    });
    expect(floatHourlyRes.status).toBe('ERROR');

    // Prepare verified evidence fixtures in Session A
    const baseAgent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: makeMockSequenceAdapter([
        {
          action: 'CALL_TOOLS',
          thought_summary: 'Quote 601 4h sat',
          tool_calls: [
            {
              tool_name: 'quote_price',
              arguments: {
                property_id: 'jacayl-ha-dong',
                room_id: '601-50-sac-thai',
                stay_type: 'nghi_gio',
                duration_hours: 4,
                checkin_datetime: '2026-11-28T15:00:00+07:00',
              },
            },
          ],
        },
        {
          action: 'RESPOND_DIRECTLY',
          thought_summary: 'Answer 601 4h',
          final_response: 'Dạ phòng 601 — 50 Sắc Thái nghỉ 4 tiếng cuối tuần tổng chi phí là 849.000đ ạ.',
        },
      ]),
      strictLiveOnly: true,
    });
    await baseAgent.processTurn('sess-A', 'Phòng 601 thứ 7 lúc 15h nghỉ 4 tiếng giá bao nhiêu?');
    const sessAEvs = baseAgent.getSessionState('sess-A').verifiedBusinessEvidence || [];
    const sessAFactTotal = sessAEvs[0].scopedRates!.find((r) => r.role === 'TOTAL')!;
    expect(sessAFactTotal.factId).toMatch(/^q\d+_f\d+$/);

    // Prepare 201 eligibility evidence for Mutation #4 and #10
    const eligAgent = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: makeMockSequenceAdapter([
        {
          action: 'CALL_TOOLS',
          thought_summary: 'Quote 201 18:30',
          tool_calls: [
            {
              tool_name: 'quote_price',
              arguments: {
                property_id: 'jacayl-ha-dong',
                room_id: '201-la-casta',
                stay_type: 'qua_dem',
                checkin_datetime: '2026-11-26T18:30:00+07:00',
              },
            },
          ],
        },
        {
          action: 'RESPOND_DIRECTLY',
          thought_summary: 'Answer 201 ngay_dem',
          final_response: 'Dạ 18:30 áp dụng gói Ngày Đêm giá 520.000đ ạ.',
        },
      ]),
      strictLiveOnly: true,
    });
    await eligAgent.processTurn('sess-elig', '201 lúc 18:30 ở qua đêm');
    const eligEvs = eligAgent.getSessionState('sess-elig').verifiedBusinessEvidence || [];
    const alt2140Fact = eligEvs[0].scopedRates!.find((r) => r.role === 'ALT_21_40')!;
    const ineligFact = eligEvs[0].scopedRates!.find((r) => r.eligible === false)!;

    // Mutation 1: Wrong roomId (claims 101 cost 849k using 601 evidence)
    const m1 = validator.validate('Dạ phòng 101 — Lồng Chim nghỉ 4 tiếng tổng 849.000đ ạ.', {
      sessionId: 'sess-A',
      facility: 'jacayl-ha-dong',
      validEvidence: sessAEvs,
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m1.grounding_status).not.toBe('VERIFIED');

    // Mutation 2: Wrong monetary role (200k EXTRA_HOUR_RATE asserted as 400k TOTAL or vice versa)
    const m2 = validator.validate('Dạ phòng 601 — 50 Sắc Thái giá 200.000đ ạ.', {
      sessionId: 'sess-A',
      facility: 'jacayl-ha-dong',
      validEvidence: sessAEvs,
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m2.rejected_claims.length).toBeGreaterThan(0);

    // Mutation 3: Tampered amount / false budget delta (99.000đ instead of 49.000đ; and 200k extra rate NOT subtracted randomly from 849k!)
    const m3 = validator.validate(
      'Dạ phòng 601 nghỉ 4 tiếng là 849.000đ, vượt ngân sách 800.000đ hết 99.000đ ạ.',
      {
        sessionId: 'sess-A',
        facility: 'jacayl-ha-dong',
        guestBudgetVnd: 800000,
        validEvidence: sessAEvs,
        effectivePolicyVersion: '1.4.6',
        activeDatasetHash: activeHash,
      }
    );
    expect(m3.rejected_claims.length).toBeGreaterThan(0);

    // Mutation 4: Ineligible fact cannot render or validate via lookupStructuredReference
    const m4Lookup = lookupStructuredReference(eligEvs, ineligFact.factId!, {
      sessionId: 'sess-elig',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m4Lookup.status).toBe('REJECTED');
    if (m4Lookup.status === 'REJECTED') expect(m4Lookup.code).toBe('REJECTED_INELIGIBLE_CLAIM_REF');

    // Mutation 5: Wrong timeCondition (601 weekend 449k base asserted for weekday/evening!)
    const m5 = validator.validate('Dạ phòng 601 ngày thường 2 giờ đầu là 449.000đ ạ.', {
      sessionId: 'sess-A',
      facility: 'jacayl-ha-dong',
      validEvidence: sessAEvs,
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m5.rejected_claims.length).toBeGreaterThan(0);

    // Mutation 6: Stale dataset & stale policy revision rejected uniformly
    const m6Dataset = lookupStructuredReference(sessAEvs, sessAFactTotal.factId!, {
      sessionId: 'sess-A',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: 'rev#tampered_hash',
    });
    expect(m6Dataset.status).toBe('REJECTED');
    if (m6Dataset.status === 'REJECTED') expect(m6Dataset.code).toBe('REJECTED_STALE_DATASET_REVISION');

    const m6Policy = lookupStructuredReference(sessAEvs, sessAFactTotal.factId!, {
      sessionId: 'sess-A',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.5',
      activeDatasetHash: activeHash,
    });
    expect(m6Policy.status).toBe('REJECTED');
    if (m6Policy.status === 'REJECTED') expect(m6Policy.code).toBe('REJECTED_STALE_POLICY_RENDER_REF');

    // Mutation 7: Cross-session factId MUST fail in BOTH renderer and ClaimLevelValidator
    const m7Render = renderStructuredMonetaryPlaceholders(`Giá là {{ref:${sessAFactTotal.factId}}}`, sessAEvs, {
      sessionId: 'sess-B',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m7Render.errors.some((e) => e.includes('REJECTED_CROSS_SESSION_CLAIM_REF'))).toBe(true);

    const m7Validator = validator.validate('Dạ phòng 601 nghỉ 4 tiếng giá 849.000đ ạ.', {
      sessionId: 'sess-B',
      facility: 'jacayl-ha-dong',
      validEvidence: sessAEvs,
      structuredClaimRefs: [sessAFactTotal.factId!],
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m7Validator.rejected_claims.some((c) => c.includes('REJECTED_CROSS_SESSION_CLAIM_REF'))).toBe(true);

    // Mutation 8: Unissued non-existent factId AND leaked {{ref:...}} placeholder rejected
    const m8MissingRef = validator.validate('Dạ phòng 601 nghỉ 4 tiếng giá {{ref:q99_f99}} ạ.', {
      sessionId: 'sess-A',
      facility: 'jacayl-ha-dong',
      validEvidence: sessAEvs,
      structuredClaimRefs: ['q99_f99'],
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m8MissingRef.rejected_claims.some((c) => c.includes('REJECTED_UNRENDERED_STRUCTURED_PLACEHOLDER'))).toBe(true);
    expect(m8MissingRef.rejected_claims.some((c) => c.includes('REJECTED_INVALID_RENDER_REF'))).toBe(true);

    // Mutation 9: Budget figure masquerading as hotel TOTAL rate cannot satisfy claim_ref
    const m9 = validator.validate('Với tầm ngân sách 849.000đ của anh/chị thì thoải mái ạ.', {
      sessionId: 'sess-A',
      facility: 'jacayl-ha-dong',
      guestBudgetVnd: 849000,
      validEvidence: sessAEvs,
      structuredClaimRefs: [sessAFactTotal.factId!],
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m9.rejected_claims.some((c) => c.includes('REJECTED_CLAIM_REF_TEXT_MISMATCH'))).toBe(true);

    // Mutation 10: Asserting 420k qua_dem applies at 18:30 check-in (both plain and rendered ALT_21_40) MUST FAIL
    const m10Plain = validator.validate('Dạ nhận phòng 201 lúc 18:30 vẫn áp dụng gói qua đêm 420.000đ ạ.', {
      sessionId: 'sess-elig',
      facility: 'jacayl-ha-dong',
      validEvidence: eligEvs,
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m10Plain.rejected_claims.some((c) => c.includes('REJECTED_INELIGIBLE_PACKAGE_CLAIM'))).toBe(true);

    const m10Rendered = renderStructuredMonetaryPlaceholders(
      `Dạ nhận phòng 201 lúc 18:30 áp dụng gói qua đêm {{ref:${alt2140Fact.factId}}} ạ.`,
      eligEvs,
      {
        sessionId: 'sess-elig',
        propertyId: 'jacayl-ha-dong',
        effectivePolicyVersion: '1.4.6',
        activeDatasetHash: activeHash,
      }
    );
    const m10Validated = validator.validate(m10Rendered.renderedText, {
      sessionId: 'sess-elig',
      facility: 'jacayl-ha-dong',
      validEvidence: eligEvs,
      renderedRefBindings: m10Rendered.bindings,
      renderedRefErrors: m10Rendered.errors,
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(m10Validated.rejected_claims.some((c) => c.includes('REJECTED_INELIGIBLE_PACKAGE_CLAIM'))).toBe(true);

    // Verify backend-issued legacyRef containing ISO +07:00 timestamp also resolves via shared lookup
    const legacyIsoRef = sessAFactTotal.legacyRef!;
    expect(legacyIsoRef).toContain('+07:00');
    const legacyRendered = renderStructuredMonetaryPlaceholders(`Tổng: {{ref:${legacyIsoRef}}}`, sessAEvs, {
      sessionId: 'sess-A',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
    });
    expect(legacyRendered.errors).toEqual([]);
    expect(legacyRendered.renderedText).toBe('Tổng: 849.000đ');
  });

  it('4. Pre-flight A-B-C Audits: signed budget delta, operand-linked comparison, 21:45 without 21:40 & 18:30 bypass block, mandatory metadata & reload/collision isolation', async () => {
    // Prepare full-runtime verified evidence for 601 (849k Sat 4h) and 201 (18:30 elig + ALT_21_40)
    const runtimeA = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: makeMockSequenceAdapter([
        {
          action: 'CALL_TOOLS',
          thought_summary: 'Quote 601 4h Sat & 101 4h Wed',
          tool_calls: [
            {
              tool_name: 'quote_price',
              arguments: {
                property_id: 'jacayl-ha-dong',
                room_id: '601-50-sac-thai',
                stay_type: 'nghi_gio',
                duration_hours: 4,
                checkin_datetime: '2026-11-28T15:00:00+07:00',
              },
            },
          ],
        },
        {
          action: 'RESPOND_DIRECTLY',
          thought_summary: 'Answer 601 849k',
          final_response: 'Dạ phòng 601 nghỉ 4 tiếng cuối tuần tổng 849.000đ ạ.',
        },
      ]),
      strictLiveOnly: true,
    });
    await runtimeA.processTurn('preflight-s1', 'Phòng 601 4h thứ 7');
    const s1State = runtimeA.getSessionState('preflight-s1');
    const s1Evs = s1State.verifiedBusinessEvidence || [];
    const s1FactId = s1Evs[0].scopedRates!.find((r) => r.role === 'TOTAL')!.factId!;
    expect(s1FactId).toBe('q1_f1');

    // A1) Signed budget delta: 849k vs 800k budget -> "vượt/thiếu 49k" PASSES, "còn dư/tiết kiệm/thấp hơn 49k" REJECTED!
    const overDeltaOk = validator.validate(
      'Dạ phòng 601 nghỉ 4 tiếng tổng 849.000đ, vượt ngân sách 800.000đ là 49.000đ ạ.',
      {
        sessionId: 'preflight-s1',
        facility: 'jacayl-ha-dong',
        guestBudgetVnd: 800000,
        validEvidence: s1Evs,
        effectivePolicyVersion: '1.4.6',
        activeDatasetHash: activeHash,
        enforceMandatoryScope: true,
      }
    );
    expect(overDeltaOk.rejected_claims).toEqual([]);
    expect(overDeltaOk.grounding_status).toBe('VERIFIED');

    for (const wrongDirectionText of [
      'Dạ phòng 601 nghỉ 4 tiếng tổng 849.000đ, còn dư 49.000đ so với ngân sách 800.000đ ạ.',
      'Dạ phòng 601 nghỉ 4 tiếng tổng 849.000đ, tiết kiệm 49.000đ so với ngân sách 800.000đ ạ.',
      'Dạ phòng 601 nghỉ 4 tiếng tổng 849.000đ, thấp hơn ngân sách 800.000đ là 49.000đ ạ.',
    ]) {
      const wrongDirRes = validator.validate(wrongDirectionText, {
        sessionId: 'preflight-s1',
        facility: 'jacayl-ha-dong',
        guestBudgetVnd: 800000,
        validEvidence: s1Evs,
        effectivePolicyVersion: '1.4.6',
        activeDatasetHash: activeHash,
        enforceMandatoryScope: true,
      });
      expect(wrongDirRes.rejected_claims.some((r) => r.includes('REJECTED_INVALID_DELTA_CLAIM'))).toBe(true);
    }

    // A2) Quote comparison delta MUST link stated operands (no random subtraction from unrelated pool rates!)
    // Here s1Evs has TOTAL=849k and BASE_2H=449k; 849k - 449k = 400k, or if 449k is NOT compared in text:
    const unlinkedRandomDelta = validator.validate(
      'Dạ phòng 601 nghỉ 4 tiếng tổng 849.000đ, chênh lệch 400.000đ ạ.',
      {
        sessionId: 'preflight-s1',
        facility: 'jacayl-ha-dong',
        validEvidence: s1Evs,
        effectivePolicyVersion: '1.4.6',
        activeDatasetHash: activeHash,
        enforceMandatoryScope: true,
      }
    );
    expect(unlinkedRandomDelta.rejected_claims.some((r) => r.includes('REJECTED_INVALID_DELTA_CLAIM'))).toBe(true);

    // B) Conditional overnight: 21:45 accepted without literal 21:40/22:00; 18:30 bypass WITH 21:40+nếu MUST BE REJECTED!
    const runtimeB = new JCollectionAgent(dataset, 'jacayl-ha-dong', {
      llmAdapter: makeMockSequenceAdapter([
        {
          action: 'CALL_TOOLS',
          thought_summary: 'Quote 201 18:30',
          tool_calls: [
            {
              tool_name: 'quote_price',
              arguments: {
                property_id: 'jacayl-ha-dong',
                room_id: '201-la-casta',
                stay_type: 'qua_dem',
                checkin_datetime: '2026-11-26T18:30:00+07:00',
              },
            },
          ],
        },
        {
          action: 'RESPOND_DIRECTLY',
          thought_summary: 'Reply 21:45 without literal 21:40/22:00',
          final_response:
            'Dạ nhận phòng 201 lúc 18:30 áp dụng gói Ngày Đêm 520.000đ; nếu anh nhận phòng lúc 21:45 thì áp dụng gói qua đêm 420.000đ ạ.',
        },
      ]),
      strictLiveOnly: true,
    });
    const res2145 = await runtimeB.processTurn('preflight-s2', 'Phòng 201 lúc 18:30 ở qua đêm được không?');
    expect(res2145.decision_trace.verificationStatus).toBe('LIVE_LLM_DECISION_VERIFIED');
    expect(res2145.claim_validation.rejected_claims).toEqual([]);

    const bEvs = runtimeB.getSessionState('preflight-s2').verifiedBusinessEvidence || [];
    for (const deceptive1830 of [
      'Gói qua đêm quy định từ 21:40, nhưng nhận phòng lúc 18:30 vẫn được áp dụng gói qua đêm 420.000đ ạ.',
      'Mặc dù khung chuẩn từ 21:40, nếu anh đến lúc 18:30 thì áp dụng gói qua đêm 420.000đ ạ.',
    ]) {
      const blocked = validator.validate(deceptive1830, {
        sessionId: 'preflight-s2',
        facility: 'jacayl-ha-dong',
        validEvidence: bEvs,
        effectivePolicyVersion: '1.4.6',
        activeDatasetHash: activeHash,
        enforceMandatoryScope: true,
      });
      expect(blocked.rejected_claims.some((r) => r.includes('REJECTED_INELIGIBLE_PACKAGE_CLAIM'))).toBe(true);
    }

    // Also verify Turn 2 direct 21:45 quote works with zero literal 21:40 / 22:00
    const linkedOperandOk = validator.validate(
      'Dạ gói Ngày Đêm 520.000đ cao hơn mức Qua Đêm (nếu nhận lúc 21:45) 420.000đ là 100.000đ ạ.',
      {
        sessionId: 'preflight-s2',
        facility: 'jacayl-ha-dong',
        validEvidence: bEvs,
        effectivePolicyVersion: '1.4.6',
        activeDatasetHash: activeHash,
        enforceMandatoryScope: true,
      }
    );
    expect(linkedOperandOk.rejected_claims).toEqual([]);

    // C1) Mandatory live metadata enforcement: missing sessionId or datasetVersion MUST fail under enforceMandatoryScope
    const evMissingSession: BusinessEvidenceRecord = { ...s1Evs[0], sessionId: undefined, scopedRates: s1Evs[0].scopedRates!.map((r) => ({ ...r, sessionId: undefined })) };
    const cMissingSession = lookupStructuredReference([evMissingSession], s1FactId, {
      sessionId: 'preflight-s1',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
      enforceMandatoryScope: true,
    });
    expect(cMissingSession.status).toBe('REJECTED');

    const evMissingDataset: BusinessEvidenceRecord = { ...s1Evs[0], datasetVersion: '', scopedRates: s1Evs[0].scopedRates!.map((r) => ({ ...r, datasetVersion: undefined })) };
    const cMissingDataset = lookupStructuredReference([evMissingDataset], s1FactId, {
      sessionId: 'preflight-s1',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
      enforceMandatoryScope: true,
    });
    expect(cMissingDataset.status).toBe('REJECTED');

    // C2) Two separate sessions BOTH mint q1_f1 cleanly without cross-contamination
    const s2FactId = bEvs[0].scopedRates![0].factId!;
    expect(s2FactId).toBe('q1_f1');
    const isolatedS2 = lookupStructuredReference([...s1Evs, ...bEvs], 'q1_f1', {
      sessionId: 'preflight-s2',
      propertyId: 'jacayl-ha-dong',
      effectivePolicyVersion: '1.4.6',
      activeDatasetHash: activeHash,
      enforceMandatoryScope: true,
    });
    expect(isolatedS2.status).toBe('MATCHED');
    if (isolatedS2.status === 'MATCHED') {
      expect(isolatedS2.evidence.roomId).toBe('201-la-casta');
    }

    // C3) State reload / restore with missing nextFactSeq does NOT collide or reuse q1_f1
    const clonedReloadedState = JSON.parse(JSON.stringify(s1State));
    delete clonedReloadedState.nextFactSeq;
    const toolGw = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    const q101Res = await toolGw.executeTool({
      toolCallId: 'tc_reload',
      toolName: 'quote_price',
      arguments: { property_id: 'jacayl-ha-dong', room_id: '101-long-chim', stay_type: 'nghi_gio', duration_hours: 2 },
    });
    const newlyRecorded = recordToolResultAsEvidence(
      clonedReloadedState,
      'quote_price',
      q101Res,
      dataset,
      '1.4.6',
      activeHash
    );
    expect(newlyRecorded[0].scopedRates![0].factId).toBe('q2_f1');
    expect(clonedReloadedState.nextFactSeq).toBe(2);
  });
});
