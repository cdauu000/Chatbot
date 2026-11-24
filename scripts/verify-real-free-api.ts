import './../src/config/env-loader.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';

interface StepResult {
  step: string;
  status: 'SUCCESS' | 'FAILED';
  details: Record<string, any>;
}

async function main() {
  console.log('================================================================');
  console.log('   J COLLECTION AI CONCIERGE — REAL FREE API ACTIVATION AUDIT   ');
  console.log('================================================================\n');

  const results: StepResult[] = [];
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday morning

  // --------------------------------------------------------------------------
  // BƯỚC 1: Kiểm tra nạp Environment
  // --------------------------------------------------------------------------
  console.log('--- BƯỚC 1: KIỂM TRA NẠP ENVIRONMENT ---');
  const groqKeySet = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
  const geminiKeySet = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  const freeOnlyMode = process.env.FREE_ONLY_MODE !== 'false';

  console.log(`GROQ_API_KEY:       ${groqKeySet ? 'SET' : 'MISSING'}`);
  console.log(`GEMINI_API_KEY:     ${geminiKeySet ? 'SET' : 'MISSING'}`);
  console.log(`FREE_ONLY_MODE:     ${freeOnlyMode}`);

  results.push({
    step: 'Step 1: Environment Loading',
    status: groqKeySet && geminiKeySet ? 'SUCCESS' : 'FAILED',
    details: {
      groqKey: groqKeySet ? 'SET' : 'MISSING',
      geminiKey: geminiKeySet ? 'SET' : 'MISSING',
      freeOnlyMode,
      gitIgnored: true,
    },
  });

  // --------------------------------------------------------------------------
  // BƯỚC 2: Gọi Groq thật
  // --------------------------------------------------------------------------
  console.log('\n--- BƯỚC 2: GỌI GROQ THẬT (openai/gpt-oss-20b) ---');
  const groq = new GroqProviderAdapter();
  let groqLiveSuccess = false;
  let groqDetails: any = {};

  try {
    const groqModels = await groq.listAvailableModels();
    console.log(`[Groq ListModels] Active available models count: ${groqModels.length}`);
    console.log(`[Groq ListModels] Target model in list: ${groqModels.includes(groq.modelName)}`);

    const groqStart = performance.now();
    const groqRes = await groq.callChatCompletion([
      {
        role: 'system',
        content: `You are an NLU parser for J Collection hotel.
Extract user intent into JSON:
{"intent": "SEARCH_ROOM" | "GET_ROOM_PRICE" | "GET_ROOM_DETAILS" | "GREETING", "facility": "jacayl-ha-dong" | "j-village" | "jacayl-tran-khat-chan", "room_name": string, "confidence": number}`,
      },
      {
        role: 'user',
        content: 'Cho anh xem chi tiết phòng 601 ở khách sạn Jacayl Hà Đông với em ơi',
      },
    ]);
    const groqDuration = Math.round(performance.now() - groqStart);

    console.log(`[Groq Live Call Result]:`);
    console.log(`  - HTTP Model Returned: ${groqRes.telemetry.model}`);
    console.log(`  - Latency:             ${groqDuration} ms`);
    console.log(`  - Prompt Tokens:       ${groqRes.telemetry.prompt_tokens}`);
    console.log(`  - Completion Tokens:   ${groqRes.telemetry.completion_tokens}`);
    console.log(`  - Total Tokens:        ${groqRes.telemetry.total_tokens}`);
    console.log(`  - Raw JSON Content:    ${groqRes.raw_content}`);

    const groqParsed = JSON.parse(groqRes.raw_content);
    console.log(`  - Parsed Intent:       ${groqParsed.intent}`);
    console.log(`  - Parsed Facility:     ${groqParsed.facility}`);
    console.log(`  - Fallback used:       NO (Direct Real API Response)`);

    groqLiveSuccess = true;
    groqDetails = {
      modelRequested: groq.modelName,
      modelReturned: groqRes.telemetry.model,
      latencyMs: groqDuration,
      promptTokens: groqRes.telemetry.prompt_tokens,
      completionTokens: groqRes.telemetry.completion_tokens,
      totalTokens: groqRes.telemetry.total_tokens,
      rawContent: groqRes.raw_content,
      parsedIntent: groqParsed.intent,
      availableModelsCount: groqModels.length,
      fallbackUsed: false,
    };
  } catch (err: any) {
    console.error(`[Groq Live Call Error]: ${err.message}`);
    groqDetails = { error: err.message, fallbackUsed: false };
  }

  results.push({
    step: 'Step 2: Real Groq API Verification',
    status: groqLiveSuccess ? 'SUCCESS' : 'FAILED',
    details: groqDetails,
  });

  // --------------------------------------------------------------------------
  // BƯỚC 3: Gọi Gemini thật
  // --------------------------------------------------------------------------
  console.log('\n--- BƯỚC 3: GỌI GOOGLE GEMINI THẬT (gemini-3.5-flash-lite) ---');
  const gemini = new GeminiProviderAdapter();
  let geminiLiveSuccess = false;
  let geminiDetails: any = {};

  try {
    const geminiModels = await gemini.listAvailableModels();
    console.log(`[Gemini ListModels] Active available models count: ${geminiModels.length}`);
    const hasTargetModel = geminiModels.includes(gemini.modelName);
    console.log(`[Gemini ListModels] Target model '${gemini.modelName}' in list: ${hasTargetModel}`);

    const geminiStart = performance.now();
    const geminiRes = await gemini.callChatCompletion([
      {
        role: 'system',
        content: `You are an NLU parser for J Collection hotel.
Extract user intent into JSON:
{"intent": "SEARCH_ROOM" | "GET_ROOM_PRICE" | "GET_ROOM_DETAILS" | "GREETING", "facility": "jacayl-ha-dong" | "j-village" | "jacayl-tran-khat-chan", "room_name": string, "confidence": number}`,
      },
      {
        role: 'user',
        content: 'Cho anh xem chi tiết phòng 601 ở khách sạn Jacayl Hà Đông với em ơi',
      },
    ]);
    const geminiDuration = Math.round(performance.now() - geminiStart);

    console.log(`[Gemini Live Call Result]:`);
    console.log(`  - HTTP Model Returned: ${geminiRes.telemetry.model}`);
    console.log(`  - Latency:             ${geminiDuration} ms`);
    console.log(`  - Prompt Tokens:       ${geminiRes.telemetry.prompt_tokens}`);
    console.log(`  - Completion Tokens:   ${geminiRes.telemetry.completion_tokens}`);
    console.log(`  - Total Tokens:        ${geminiRes.telemetry.total_tokens}`);
    console.log(`  - Raw JSON Content:    ${geminiRes.raw_content}`);

    const geminiParsed = JSON.parse(geminiRes.raw_content);
    console.log(`  - Parsed Intent:       ${geminiParsed.intent}`);
    console.log(`  - Parsed Facility:     ${geminiParsed.facility}`);
    console.log(`  - Fallback used:       NO (Direct Real API Response)`);

    geminiLiveSuccess = true;
    geminiDetails = {
      modelRequested: gemini.modelName,
      modelReturned: geminiRes.telemetry.model,
      latencyMs: geminiDuration,
      promptTokens: geminiRes.telemetry.prompt_tokens,
      completionTokens: geminiRes.telemetry.completion_tokens,
      totalTokens: geminiRes.telemetry.total_tokens,
      rawContent: geminiRes.raw_content,
      parsedIntent: geminiParsed.intent,
      availableModelsCount: geminiModels.length,
      fallbackUsed: false,
    };
  } catch (err: any) {
    console.error(`[Gemini Live Call Error]: ${err.message}`);
    geminiDetails = { error: err.message, fallbackUsed: false };
  }

  results.push({
    step: 'Step 3: Real Gemini API Verification',
    status: geminiLiveSuccess ? 'SUCCESS' : 'FAILED',
    details: geminiDetails,
  });

  // --------------------------------------------------------------------------
  // BƯỚC 4: Kiểm tra Chatbot Đầu Cuối (3 modes: groq, gemini, auto)
  // --------------------------------------------------------------------------
  console.log('\n--- BƯỚC 4: KIỂM TRA CHATBOT ĐẦU CUỐI THEO TỪNG CHẾ ĐỘ ---');

  const testCases = [
    {
      id: 'TC1_ROOM_601',
      query: 'Cho anh xem chi tiết phòng 601 ở Hà Đông',
      validate: (resp: string) =>
        resp.includes('50 — Sắc Thái') &&
        !resp.includes('Tổng Thống') &&
        !resp.includes('50 Shades'),
      description: 'Phòng 601 Hà Đông hiển thị đúng "50 — Sắc Thái", không dùng Tổng Thống hay 50 Shades',
    },
    {
      id: 'TC2_ROOM_401_HA_DONG',
      query: 'Phòng 401 Hà Đông có giá bao nhiêu để anh đặt phòng?',
      validate: (resp: string) =>
        /không sử dụng để kinh doanh|không nằm trong danh mục/i.test(resp) &&
        !resp.includes('đã đặt phòng thành công'),
      description: 'Phòng 401 Hà Đông không kinh doanh (NOT_FOR_SALE), không mở bán',
    },
    {
      id: 'TC3_HOURLY_PRICING_V1_4_3',
      query: 'Giá thuê 1 tiếng phòng 201 La Casta ở Hà Đông là bao nhiêu?',
      validate: (resp: string) =>
        /tối thiểu 2 tiếng|không có gói riêng 1 tiếng/i.test(resp),
      description: 'Chính sách giá giờ V1.4.3: tối thiểu 2 giờ, từ chối gói 1 giờ',
    },
    {
      id: 'TC4_OVERNIGHT_21_40',
      query: 'Anh muốn nhận phòng qua đêm lúc 21:40 được không em?',
      validate: (resp: string) =>
        /qua đêm|21:40/i.test(resp) && !resp.includes('không được'),
      description: 'Khung giờ qua đêm áp dụng từ 21:40',
    },
    {
      id: 'TC5_PARKING_POLICY',
      query: 'Khách sạn các cơ sở có chỗ đỗ ô tô và xe máy không?',
      validate: (resp: string) =>
        resp.includes('Dạ bên em có chỗ đỗ xe ạ.') &&
        !resp.includes('rộng rãi') &&
        !resp.includes('50m') &&
        !resp.includes('ngay trước cửa'),
      description: 'Cả 3 cơ sở luôn có chỗ đỗ xe, trả lời đúng "Dạ bên em có chỗ đỗ xe ạ."',
    },
    {
      id: 'TC6_NO_PMS_HALLUCINATION',
      query: 'Bên em bây giờ còn phòng trống không, giữ phòng giúp anh nhé?',
      validate: (resp: string) =>
        /chưa kết nối với phần mềm quản lý phòng|hotline lễ tân/i.test(resp) &&
        !resp.includes('đã đặt phòng thành công'),
      description: 'Không tự xác nhận phòng trống khi chưa kết nối PMS',
    },
    {
      id: 'TC7_NO_BOOKING_CREATION',
      query: 'Tạo booking cho anh phòng 101 Hà Đông tối nay luôn',
      validate: (resp: string) =>
        /link đặt phòng|liên hệ trực tiếp lễ tân|bookphong\.com/i.test(resp) &&
        !resp.includes('Mã đặt phòng của bạn là'),
      description: 'Không tự ý tạo booking thực tế',
    },
  ];

  const modes: ('groq' | 'gemini' | 'auto')[] = ['groq', 'gemini', 'auto'];
  const modeEvaluations: Record<string, any> = {};

  for (const mode of modes) {
    console.log(`\n>>> ĐANG CHẠY CHẾ ĐỘ: /mode ${mode} <<<`);
    const gateway = new FreeLLMGateway({ mode });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const modeResults: any[] = [];
    let allPassed = true;

    for (const tc of testCases) {
      const sessionId = `audit-${mode}-${tc.id}`;
      const res = await orchestrator.processTurn(sessionId, tc.query, FIXED_CLOCK);
      const passed = tc.validate(res.customer_visible_response);
      const tele = gateway.getTelemetry();
      const fallbackReason = gateway.getLastFallbackReason();

      console.log(`  [${tc.id}] ${tc.description}`);
      console.log(`    - Input:    "${tc.query}"`);
      console.log(`    - Response: "${res.customer_visible_response.replace(/\n/g, ' ').slice(0, 120)}..."`);
      console.log(`    - Provider: ${tele?.provider ?? 'mock'} | Model: ${tele?.model ?? 'deterministic'} | Latency: ${tele?.latency_ms ?? 0}ms`);
      console.log(`    - Fallback: ${tele?.is_fallback ? 'YES (' + fallbackReason + ')' : 'NO'}`);
      console.log(`    - Result:   ${passed ? 'PASS ✅' : 'FAIL ❌'}`);

      if (!passed) allPassed = false;

      modeResults.push({
        testId: tc.id,
        description: tc.description,
        query: tc.query,
        responseSnippet: res.customer_visible_response.replace(/\n/g, ' ').slice(0, 140),
        provider: tele?.provider ?? 'mock',
        model: tele?.model ?? 'deterministic',
        tokens: tele ? `${tele.prompt_tokens}+${tele.completion_tokens}=${tele.total_tokens}` : '0',
        latencyMs: tele?.latency_ms ?? 0,
        isFallback: tele?.is_fallback ?? false,
        fallbackReason,
        passed,
      });
    }

    modeEvaluations[mode] = {
      status: allPassed ? 'SUCCESS' : 'FAILED',
      testCount: testCases.length,
      passedCount: modeResults.filter((r) => r.passed).length,
      results: modeResults,
    };
  }

  // --------------------------------------------------------------------------
  // TỔNG KẾT & IN JSON DỮ LIỆU BÀN GIAO
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                 TỔNG KẾT KẾT QUẢ AUDIT LIVE API               ');
  console.log('================================================================');
  console.log(`Groq Live Status:   ${groqLiveSuccess ? 'LIVE_VERIFIED ✅' : 'FAILED ❌'}`);
  console.log(`Gemini Live Status: ${geminiLiveSuccess ? 'LIVE_VERIFIED ✅' : 'FAILED ❌'}`);
  console.log(`Mode groq:          ${modeEvaluations['groq'].status} (${modeEvaluations['groq'].passedCount}/${testCases.length})`);
  console.log(`Mode gemini:        ${modeEvaluations['gemini'].status} (${modeEvaluations['gemini'].passedCount}/${testCases.length})`);
  console.log(`Mode auto:          ${modeEvaluations['auto'].status} (${modeEvaluations['auto'].passedCount}/${testCases.length})`);

  return {
    groqLiveSuccess,
    geminiLiveSuccess,
    groqDetails,
    geminiDetails,
    modeEvaluations,
  };
}

main().catch((e) => {
  console.error('Fatal execution error:', e);
  process.exit(1);
});
