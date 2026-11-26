import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { TranKhatChanAgent } from '../src/agent/trankhatchan-agent.js';
import { JVillageAgent } from '../src/agent/jvillage-agent.js';
import { CoSoMa } from '../src/domain/types.js';

function approxTokens(text: string): number {
  if (!text) return 0;
  // Rough 3.5 chars/token average across mixed Vietnamese + JSON syntax
  return Math.ceil(text.length / 3.5);
}

class TokenMeasuringHadongAgent extends HadongAgent {
  public inspectPromptComponents(
    userMessage: string,
    sessionId: string,
    iteration: number,
    mustSynthesize: boolean
  ) {
    const state = this.getSessionState(sessionId);
    const msgs = this.buildLLMReasoningPrompt(
      userMessage,
      state,
      [],
      iteration,
      undefined,
      false,
      '2026-11-28T14:00:00+07:00',
      mustSynthesize
    );
    const sys = msgs[0].content;
    const usr = msgs[1].content;
    const toolsIdx = sys.indexOf('TOOLS:');
    const sysCore = toolsIdx >= 0 ? sys.slice(0, toolsIdx) : sys;
    const toolSchema = toolsIdx >= 0 ? sys.slice(toolsIdx) : '';

    const histStart = usr.indexOf('Recent Conversation History:');
    const epiStart = usr.indexOf('Epistemic State:');
    const obsStart = usr.indexOf('Tool Observations Collected This Turn:');

    const historyPart = histStart >= 0 && epiStart > histStart ? usr.slice(histStart, epiStart) : '';
    const memoryPart = epiStart >= 0 && obsStart > epiStart ? usr.slice(epiStart, obsStart) : '';
    const obsPart = obsStart >= 0 ? usr.slice(obsStart) : '';

    return {
      system_prompt_tokens: approxTokens(sysCore),
      tool_schemas_tokens: approxTokens(toolSchema),
      conversation_history_tokens: approxTokens(historyPart),
      working_memory_tokens: approxTokens(memoryPart),
      tool_observations_tokens: approxTokens(obsPart),
      total_estimated_prompt_tokens: approxTokens(sys) + approxTokens(usr),
    };
  }
}

async function main() {
  const baselinePath = path.resolve('artifacts', 'live-30-cognitive-evaluation.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  const baseTurns = (baseline.scenarios || []).flatMap((s: any) => s.turns || []);
  const totalBasePrompt = baseTurns.reduce((a: number, t: any) => a + (t.prompt_tokens || 0), 0);
  const totalBaseComp = baseTurns.reduce((a: number, t: any) => a + (t.completion_tokens || 0), 0);

  // Run the same representative 3-facility multi-turn set (6 turns total) AFTER optimization
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const gateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const REF_CLOCK = '2026-11-28T14:00:00+07:00';

  const measurer = new TokenMeasuringHadongAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK });
  const componentSampleIter1 = measurer.inspectPromptComponents('Nay còn phòng kh b', 'sample-probe', 1, false);
  const componentSampleFinal = measurer.inspectPromptComponents('Nay còn phòng kh b', 'sample-probe', 2, true);

  const agents: Record<CoSoMa, any> = {
    'jacayl-ha-dong': new HadongAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true }),
    'jacayl-tran-khat-chan': new TranKhatChanAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true }),
    'j-village': new JVillageAgent(dataset, { llmAdapter: gateway, referenceClock: REF_CLOCK, strictLiveOnly: true }),
  };

  // Same 3 scenarios (3 turns HD + 2 turns TKC + 2 turns JV = 7 turns matching benchmark set!)
  const probeConvos: Array<{ id: string; facility: CoSoMa; turns: string[] }> = [
    {
      id: 'TOK-HD-01',
      facility: 'jacayl-ha-dong',
      turns: [
        'Nay còn phòng kh b',
        'Thứ 7 từ 14h đến 18h phòng có bồn tắm rẻ nhất giá bao nhiêu, với khách sạn có bể bơi không?',
        'Thôi không cần bồn tắm nữa nhưng không lấy phòng 201 đâu nhé, gợi ý phòng rẻ nhất khác giúp anh',
      ],
    },
    {
      id: 'TOK-TKC-02',
      facility: 'jacayl-tran-khat-chan',
      turns: [
        'Phòng 1001 Đêm bên Trần Khát Chân giá thế nào và thứ 7 có tăng giá không em?',
        'Ok giữ giúp anh phòng 1001 Đêm tối nay lúc 22h nhé',
      ],
    },
    {
      id: 'TOK-JV-03',
      facility: 'j-village',
      turns: [
        'Bên J Village có phòng nào dưới 300k nghỉ 2 tiếng không em?',
        'Còn phòng Crimson Suite có bồn tắm không và gửi giúp mình ảnh phòng đó',
      ],
    },
  ];

  // Extract PRE-optimization gemini-3.5-flash-lite benchmark numbers on the EXACT same 7 turns from model-quality-benchmark.json if present
  let preOptBenchSame7: any = null;
  const benchPath = path.resolve('artifacts', 'model-quality-benchmark.json');
  if (fs.existsSync(benchPath)) {
    const bench = JSON.parse(fs.readFileSync(benchPath, 'utf-8'));
    const gem = (bench.models || []).find((m: any) => m.id === 'gemini-3.5-flash-lite');
    if (gem?.transcripts?.length) {
      const pTok = gem.transcripts.reduce((a: number, t: any) => a + (t.prompt_tokens || 0), 0);
      const cTok = gem.transcripts.reduce((a: number, t: any) => a + (t.completion_tokens || 0), 0);
      preOptBenchSame7 = {
        turns: gem.transcripts.length,
        prompt_tokens_total: pTok,
        completion_tokens_total: cTok,
        avg_prompt_tokens_per_turn: Math.round(pTok / gem.transcripts.length),
        avg_completion_tokens_per_turn: Math.round(cTok / gem.transcripts.length),
      };
    }
  }

  const afterTurnRecords: any[] = [];
  let afterFormatRepairs = 0;
  for (const sc of probeConvos) {
    const sid = `tok-after-${sc.id}-${Date.now()}`;
    for (let i = 0; i < sc.turns.length; i++) {
      try {
        const res = await agents[sc.facility].processTurn(sid, sc.turns[i], { referenceClock: REF_CLOCK, strictLiveOnly: true });
        const tel = res.decision_trace.llmTelemetry;
        afterFormatRepairs += tel?.protocolMetrics?.formatRepairs ?? 0;
        afterTurnRecords.push({
          scenario: sc.id,
          turn: i + 1,
          provider: tel?.provider,
          model: tel?.model,
          calls: tel?.callCount ?? 0,
          prompt_tokens: tel?.promptTokens ?? 0,
          completion_tokens: tel?.completionTokens ?? 0,
          tools: res.internal_trace.tools_executed,
          rejected_claims: res.claim_validation?.rejected_claims?.length ?? 0,
          response_preview: res.customer_visible_response.slice(0, 140),
        });
        await new Promise((r) => setTimeout(r, tel?.provider === 'groq' ? 12000 : 5000));
      } catch (err: any) {
        afterTurnRecords.push({
          scenario: sc.id,
          turn: i + 1,
          status: 'BLOCKED',
          error: err.message,
        });
      }
    }
  }

  const liveAfter = afterTurnRecords.filter((t) => !t.status);
  const afterPromptTotal = liveAfter.reduce((a, t) => a + t.prompt_tokens, 0);
  const afterCompTotal = liveAfter.reduce((a, t) => a + t.completion_tokens, 0);
  const afterCallsTotal = liveAfter.reduce((a, t) => a + t.calls, 0);
  const rel = gateway.getReliabilityMetrics();
  const providerRetries = (rel.groq.http429 + rel.groq.http503 + rel.gemini.http429 + rel.gemini.http503);

  const report = {
    generated_at: new Date().toISOString(),
    baseline_live_30: {
      scenarios: 30,
      turns: baseTurns.length,
      prompt_tokens_total: totalBasePrompt,
      completion_tokens_total: totalBaseComp,
      avg_prompt_tokens_per_turn: Math.round(totalBasePrompt / Math.max(1, baseTurns.length)),
      avg_completion_tokens_per_turn: Math.round(totalBaseComp / Math.max(1, baseTurns.length)),
      why_high: [
        'state.observations accumulated across turns inside multi-turn sessions and re-injected full Tier-1 Turn search_rooms catalog dumps under "Tool Observations Collected This Turn" on Turns 2-3',
        'tool schemas (~850 est. tokens verbose Vietnamese descriptions) were re-sent verbatim on every iteration including final synthesis iterations',
        'conversationHistory window sent up to 9 prior turns alongside redundant prompt prose',
      ],
    },
    component_breakdown_estimated_per_call: {
      iteration_1_with_tools: componentSampleIter1,
      final_synthesis_no_tools: componentSampleFinal,
      after_output_completion_avg_per_turn: {
        model_decisions_plus_response_generation_tokens: Math.round(afterCompTotal / Math.max(1, liveAfter.length)),
        format_repair_calls: afterFormatRepairs,
        provider_retries_or_failovers: providerRetries,
      },
    },
    before_vs_after_same_7_turn_suite: {
      before_pre_optimization: preOptBenchSame7,
      after_per_turn_isolation_and_schema_trim: {
        completed_turns: liveAfter.length,
        blocked_turns: afterTurnRecords.length - liveAfter.length,
        prompt_tokens_total: afterPromptTotal,
        completion_tokens_total: afterCompTotal,
        avg_prompt_tokens_per_turn: Math.round(afterPromptTotal / Math.max(1, liveAfter.length)),
        avg_completion_tokens_per_turn: Math.round(afterCompTotal / Math.max(1, liveAfter.length)),
        avg_calls_per_turn: Number((afterCallsTotal / Math.max(1, liveAfter.length)).toFixed(2)),
        rejected_claims: liveAfter.reduce((a, t) => a + t.rejected_claims, 0),
        prompt_reduction_percent_vs_live30_avg:
          Number((((totalBasePrompt / Math.max(1, baseTurns.length) - afterPromptTotal / Math.max(1, liveAfter.length)) / (totalBasePrompt / Math.max(1, baseTurns.length))) * 100).toFixed(2)),
      },
    },
    per_turn_after_details: afterTurnRecords,
    gateway_reliability: rel,
  };

  const outPath = path.resolve('artifacts', 'token-optimization-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log('DONE:', outPath, report.before_vs_after_same_7_turn_suite);
}

main().catch((err) => {
  console.error('Token report error:', err);
  process.exit(1);
});
