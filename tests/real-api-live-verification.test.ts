import { describe, it, expect, beforeEach } from 'vitest';
import '../src/config/env-loader.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';

const isLiveTestEnabled = process.env.RUN_REAL_API_TESTS === 'true';

describe.skipIf(!isLiveTestEnabled)('Milestone 3.5 — Real Free API Live Activation & Invariant Verification Suite', { timeout: 60000 }, () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday morning

  // --------------------------------------------------------------------------
  // BƯỚC 1: Kiểm tra nạp Environment
  // --------------------------------------------------------------------------
  describe('Bước 1 — Kiểm tra nạp Environment', () => {
    it('Xác nhận GROQ_API_KEY và GEMINI_API_KEY được nạp vào Node.js process (Chỉ SET/MISSING)', () => {
      const groqKeySet = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
      const geminiKeySet = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
      const freeOnlyMode = process.env.FREE_ONLY_MODE !== 'false';

      console.log(`[ENV AUDIT] GROQ_API_KEY:   ${groqKeySet ? 'SET' : 'MISSING'}`);
      console.log(`[ENV AUDIT] GEMINI_API_KEY: ${geminiKeySet ? 'SET' : 'MISSING'}`);
      console.log(`[ENV AUDIT] FREE_ONLY_MODE: ${freeOnlyMode}`);

      expect(groqKeySet).toBe(true);
      expect(geminiKeySet).toBe(true);
      expect(freeOnlyMode).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // BƯỚC 2: Gọi Groq thật
  // --------------------------------------------------------------------------
  describe('Bước 2 — Gọi Groq thật (openai/gpt-oss-20b)', () => {
    const groq = new GroqProviderAdapter();

    it('Gửi request tiếng Việt thật đến Groq, xác minh HTTP 200, model, tokens, latency, NO fallback', async () => {
      expect(groq.isConfigured()).toBe(true);

      const startTime = performance.now();
      const res = await groq.callChatCompletion([
        {
          role: 'system',
          content: `You are an NLU parser for J Collection hotel.
Extract user intent into JSON:
{"intent": "GET_ROOM_DETAILS", "facility": "jacayl-ha-dong", "room_name": "601", "confidence": 0.95}`,
        },
        {
          role: 'user',
          content: 'Cho anh xem chi tiết phòng 601 ở cơ sở Jacayl Hà Đông với em',
        },
      ]);
      const latencyMs = Math.round(performance.now() - startTime);

      console.log('[GROQ REAL CALL RESULT]:');
      console.log(`  - Returned Model:   ${res.telemetry.model}`);
      console.log(`  - Latency:          ${latencyMs} ms`);
      console.log(`  - Tokens:           Prompt ${res.telemetry.prompt_tokens} | Completion ${res.telemetry.completion_tokens} | Total ${res.telemetry.total_tokens}`);
      console.log(`  - Raw JSON:         ${res.raw_content}`);

      expect(res.raw_content).toBeDefined();
      const parsed = JSON.parse(res.raw_content);
      expect(parsed.intent).toBe('GET_ROOM_DETAILS');
      expect(parsed.facility).toBe('jacayl-ha-dong');

      expect(res.telemetry.provider).toBe('groq');
      expect(res.telemetry.model).toBe('openai/gpt-oss-20b');
      expect(res.telemetry.total_tokens).toBeGreaterThan(0);
      expect(res.telemetry.is_fallback).toBe(false);

      // List models
      const models = await groq.listAvailableModels();
      console.log(`  - Available Groq models count: ${models.length}`);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // BƯỚC 3: Gọi Gemini thật
  // --------------------------------------------------------------------------
  describe('Bước 3 — Gọi Google Gemini thật (gemini-3.5-flash-lite)', () => {
    const gemini = new GeminiProviderAdapter();

    it('Gửi request tiếng Việt thật đến Gemini, xác minh HTTP 200, model, tokens, latency, NO fallback', async () => {
      expect(gemini.isConfigured()).toBe(true);

      // Discover active models first
      const models = await gemini.listAvailableModels();
      console.log(`[GEMINI REAL CALL] Active Gemini models count: ${models.length}`);
      expect(models.length).toBeGreaterThan(0);

      const startTime = performance.now();
      const res = await gemini.callChatCompletion([
        {
          role: 'system',
          content: `You are an NLU parser for J Collection hotel.
Extract user intent into JSON:
{"intent": "GET_ROOM_DETAILS", "facility": "jacayl-ha-dong", "room_name": "601", "confidence": 0.95}`,
        },
        {
          role: 'user',
          content: 'Cho anh xem chi tiết phòng 601 ở cơ sở Jacayl Hà Đông với em',
        },
      ]);
      const latencyMs = Math.round(performance.now() - startTime);

      console.log('[GEMINI REAL CALL RESULT]:');
      console.log(`  - Returned Model:   ${res.telemetry.model}`);
      console.log(`  - Latency:          ${latencyMs} ms`);
      console.log(`  - Tokens:           Prompt ${res.telemetry.prompt_tokens} | Completion ${res.telemetry.completion_tokens} | Total ${res.telemetry.total_tokens}`);
      console.log(`  - Raw JSON:         ${res.raw_content}`);

      expect(res.raw_content).toBeDefined();
      const parsed = JSON.parse(res.raw_content);
      expect(parsed.intent).toBe('GET_ROOM_DETAILS');
      expect(parsed.facility).toBe('jacayl-ha-dong');

      expect(res.telemetry.provider).toBe('gemini');
      expect(res.telemetry.model).toBe('gemini-3.5-flash-lite');
      expect(res.telemetry.total_tokens).toBeGreaterThan(0);
      expect(res.telemetry.is_fallback).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // BƯỚC 4: Kiểm tra Chatbot Đầu Cuối theo từng chế độ
  // --------------------------------------------------------------------------
  describe('Bước 4 — Kiểm tra Chatbot Đầu Cuối (/mode groq, /mode gemini, /mode auto)', () => {
    const modes: ('groq' | 'gemini' | 'auto')[] = ['groq', 'gemini', 'auto'];

    for (const mode of modes) {
      describe(`Chế độ: /mode ${mode}`, () => {
        const gateway = new FreeLLMGateway({ mode });
        const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

        beforeEach(async () => {
          // Pacing delay to avoid burst rate limits on Free Tier APIs
          await new Promise((r) => setTimeout(r, 1500));
        });

        it('1. Phòng 601 Hà Đông hiển thị đúng "50 — Sắc Thái", không dùng Tổng Thống hay 50 Shades', async () => {
          const res = await orchestrator.processTurn(`audit-${mode}-601`, 'Xem chi tiết phòng 601 Hà Đông', FIXED_CLOCK);
          const tele = gateway.getTelemetry();

          console.log(`[${mode.toUpperCase()} TC1] Room 601: Provider=${tele?.provider}, Model=${tele?.model}, Fallback=${tele?.is_fallback}, Reason=${gateway.getLastFallbackReason()}`);
          expect(res.customer_visible_response).toContain('50 — Sắc Thái');
          expect(res.customer_visible_response).not.toContain('Tổng Thống');
          expect(res.customer_visible_response).not.toContain('50 Shades');
          expect(tele?.is_fallback).toBe(false);
        });

        it('2. Phòng 401 Hà Đông không kinh doanh (NOT_FOR_SALE), không mở bán', async () => {
          const res = await orchestrator.processTurn(`audit-${mode}-401`, 'Phòng 401 ở Hà Đông giá bao nhiêu em?', FIXED_CLOCK);
          const tele = gateway.getTelemetry();

          console.log(`[${mode.toUpperCase()} TC2] Room 401: Provider=${tele?.provider}, Model=${tele?.model}, Fallback=${tele?.is_fallback}, Reason=${gateway.getLastFallbackReason()}`);
          expect(res.customer_visible_response.toLowerCase()).toMatch(/không sử dụng để kinh doanh|không nằm trong danh mục/);
          expect(res.customer_visible_response).not.toContain('đã đặt phòng thành công');
          expect(tele?.is_fallback).toBe(false);
        });

        it('3. Chính sách giá nghỉ giờ V1.4.3: tối thiểu 2 giờ', async () => {
          const res = await orchestrator.processTurn(`audit-${mode}-1h`, 'Giá thuê 1 tiếng phòng 201 La Casta ở Hà Đông là bao nhiêu?', FIXED_CLOCK);
          const tele = gateway.getTelemetry();

          console.log(`[${mode.toUpperCase()} TC3] 1h Min: Provider=${tele?.provider}, Model=${tele?.model}, Fallback=${tele?.is_fallback}, Reason=${gateway.getLastFallbackReason()}`);
          expect(res.customer_visible_response.toLowerCase()).toMatch(/tối thiểu 2 tiếng|không có gói riêng 1 tiếng/);
          expect(tele?.is_fallback).toBe(false);
        });

        it('4. Khung giờ qua đêm áp dụng từ 21:40', async () => {
          const res = await orchestrator.processTurn(`audit-${mode}-overnight`, 'Anh muốn nhận phòng qua đêm lúc 21:40 được không em?', FIXED_CLOCK);
          const tele = gateway.getTelemetry();

          console.log(`[${mode.toUpperCase()} TC4] Overnight 21:40: Provider=${tele?.provider}, Model=${tele?.model}, Fallback=${tele?.is_fallback}, Reason=${gateway.getLastFallbackReason()}`);
          expect(res.customer_visible_response.toLowerCase()).toMatch(/qua đêm|21:40/);
          expect(tele?.is_fallback).toBe(false);
        });

        it('5. Cả 3 cơ sở luôn có chỗ đỗ xe, trả lời đúng "Dạ bên em có chỗ đỗ xe ạ."', async () => {
          const res = await orchestrator.processTurn(`audit-${mode}-parking`, 'Khách sạn có chỗ đỗ xe không?', FIXED_CLOCK);
          const tele = gateway.getTelemetry();

          console.log(`[${mode.toUpperCase()} TC5] Parking: Provider=${tele?.provider}, Model=${tele?.model}, Fallback=${tele?.is_fallback}, Reason=${gateway.getLastFallbackReason()}`);
          expect(res.customer_visible_response).toContain('Dạ bên em có chỗ đỗ xe ạ.');
          expect(res.customer_visible_response).not.toContain('50m');
          expect(res.customer_visible_response).not.toContain('rộng rãi');
          expect(tele?.is_fallback).toBe(false);
        });

        it('6. Không tự xác nhận phòng trống khi chưa kết nối PMS', async () => {
          const res = await orchestrator.processTurn(`audit-${mode}-avail`, 'Bên em bây giờ còn phòng trống không qua luôn?', FIXED_CLOCK);
          const tele = gateway.getTelemetry();

          console.log(`[${mode.toUpperCase()} TC6] Availability: Provider=${tele?.provider}, Model=${tele?.model}, Fallback=${tele?.is_fallback}, Reason=${gateway.getLastFallbackReason()}`);
          expect(res.customer_visible_response.toLowerCase()).toMatch(/chưa kết nối với phần mềm quản lý phòng|hotline lễ tân/);
          expect(res.customer_visible_response).not.toContain('đã đặt phòng thành công');
          expect(tele?.is_fallback).toBe(false);
        });

        it('7. Không tự tạo booking', async () => {
          const res = await orchestrator.processTurn(`audit-${mode}-booking`, 'Tạo booking cho anh phòng 101 Hà Đông tối nay luôn', FIXED_CLOCK);
          const tele = gateway.getTelemetry();

          console.log(`[${mode.toUpperCase()} TC7] Booking: Provider=${tele?.provider}, Model=${tele?.model}, Fallback=${tele?.is_fallback}, Reason=${gateway.getLastFallbackReason()}`);
          expect(res.customer_visible_response.toLowerCase()).toMatch(/link đặt phòng|liên hệ trực tiếp lễ tân|bookphong\.com/);
          expect(res.customer_visible_response).not.toContain('Mã đặt phòng của bạn là');
          expect(tele?.is_fallback).toBe(false);
        });
      });
    }
  });
});
