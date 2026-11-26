import { describe, it, expect, vi } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { InMemoryRoomSearchEngine } from '../src/search/in-memory-room-search.js';
import { PreBookingQuoteEngine } from '../src/pricing/prebooking-quote-engine.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';

describe('J Collection — Canonical Room Identity Policy & Room 401 Non-Commercial Tests', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday morning

  // 1. Khách hỏi "phòng 601 Hà Đông" -> Trả đúng tên "50 — Sắc Thái"
  it('identifies "phòng 601 Hà Đông" and returns canonical name "50 — Sắc Thái" strictly', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const result = await orchestrator.processTurn(
      'canonical-test-1',
      'Cho anh xem chi tiết phòng 601 Hà Đông',
      FIXED_CLOCK
    );

    expect(result.updated_state.focused_room?.ma_phong).toBe('601-50-sac-thai');
    expect(result.updated_state.focused_room?.co_so_ma).toBe('jacayl-ha-dong');
    expect(result.customer_visible_response).toContain('50 — Sắc Thái');
    expect(result.customer_visible_response).not.toContain('601 — 50 — Sắc Thái');
    expect(result.customer_visible_response).not.toContain('601 Tổng Thống');
    expect(result.customer_visible_response).not.toContain('Tổng Thống');
    expect(result.customer_visible_response).not.toContain('50 Shades');
  });

  // 2. Khách hỏi "50 sắc thái" -> Nhận diện đúng phòng 601-50-sac-thai
  it('identifies thematic name "50 sắc thái" and binds to composite key jacayl-ha-dong:601-50-sac-thai', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const result = await orchestrator.processTurn(
      'canonical-test-2',
      'Phòng 50 sắc thái ở Hà Đông giá thế nào em?',
      FIXED_CLOCK
    );

    expect(result.updated_state.focused_room?.ma_phong).toBe('601-50-sac-thai');
    expect(result.customer_visible_response).toContain('50 — Sắc Thái');
  });

  // 3. Khách hỏi "phòng Tổng Thống" hoặc gán nhầm tên -> Không chấp nhận Ground Truth sai
  it('strictly rejects the fabricated commercial name "601 Tổng Thống" and clarifies with official dataset name', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const result = await orchestrator.processTurn(
      'canonical-test-3',
      'Phòng 601 ở Hà Đông có phải là phòng Tổng Thống không em?',
      FIXED_CLOCK
    );

    // Reconciled phrasing: asserts canonical official name "50 — Sắc Thái" without echoing fabricated title as truth
    expect(result.customer_visible_response).toContain('50 — Sắc Thái');
    expect(result.customer_visible_response).not.toContain('phòng Tổng Thống của bạn');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // 4. Không được tự dịch "50 — Sắc Thái" thành "50 Shades" trong câu trả lời
  it('does not translate Vietnamese room commercial names into English (e.g. 50 Shades)', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const result = await orchestrator.processTurn(
      'canonical-test-4',
      'Do you have 50 shades room at Ha Dong?',
      FIXED_CLOCK
    );

    // Reconciled V3 offline oracle: verifies canonical identity protection (never translates to "50 Shades" in reply)
    expect(result.customer_visible_response).not.toContain('50 Shades');
    expect(result.claim_validation?.rejected_claims.length).toBe(0);
  });

  // 5. Groq và Gemini đề xuất tên khác -> Hệ thống vẫn bảo vệ tên canonical từ dataset
  it('preserves canonical room name "50 — Sắc Thái" even when LLM provider proposes non-canonical room names', async () => {
    const mockGroqCall = vi.fn().mockResolvedValue({
      raw_content: JSON.stringify({
        intent: 'SEARCH_ROOM',
        facility: 'jacayl-ha-dong',
        room_name: 'Presidential 601 Fifty Shades',
        confidence: 0.95,
      }),
      telemetry: {
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        prompt_tokens: 120,
        completion_tokens: 40,
        total_tokens: 160,
        latency_ms: 110,
        retries_attempted: 0,
      },
    });

    const groqAdapter = new GroqProviderAdapter({ apiKey: 'gsk_test' });
    vi.spyOn(groqAdapter, 'isConfigured').mockReturnValue(true);
    vi.spyOn(groqAdapter, 'callChatCompletion').mockImplementation(mockGroqCall);

    const gateway = new FreeLLMGateway({ mode: 'groq', groqAdapter });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'canonical-llm-test',
      'Cho anh xem phòng 601 Hà Đông',
      FIXED_CLOCK
    );

    expect(result.customer_visible_response).toContain('50 — Sắc Thái');
    expect(result.customer_visible_response).not.toContain('Presidential');
    expect(result.customer_visible_response).not.toContain('Fifty Shades');
  });

  // 6. Phòng 401 Hà Đông không sử dụng để kinh doanh -> Không bao giờ xuất hiện trong Search Engine
  it('completely excludes Room 401 Ha Dong from commercial room search inventory', () => {
    const searchEngine = new InMemoryRoomSearchEngine(dataset);

    const result = searchEngine.search({
      co_so_ma: 'jacayl-ha-dong',
      stay_type: 'nghi_gio',
      duration_hours: 2,
    });

    const allMatchedRooms = [
      ...result.buckets.exact_matches,
      ...result.buckets.partial_matches,
      ...result.buckets.alternative_suggestions,
      ...result.buckets.unverified_candidates,
    ];

    const has401HaDong = allMatchedRooms.some(
      (candidate) =>
        candidate.room.co_so_ma === 'jacayl-ha-dong' &&
        (candidate.room.ma_phong.startsWith('401') || candidate.room.ten_phong.includes('401'))
    );

    expect(has401HaDong).toBe(false);
  });

  // 7. Báo giá phòng 401 Hà Đông bị từ chối (PRICE_NOT_FOUND / Non-Commercial)
  it('declines quote request for Room 401 Ha Dong as non-commercial room', () => {
    const quoteEngine = new PreBookingQuoteEngine(dataset);

    const quote = quoteEngine.getQuote({
      co_so_ma: 'jacayl-ha-dong',
      ma_phong: '401',
      stay_type: 'nghi_gio',
      duration_hours: 2,
    });

    expect(quote.is_resolved).toBe(false);
    expect(quote.pricing_status).toBe('NOT_FOR_SALE');
    expect(quote.total_estimate).toBeUndefined();
    expect(quote.price_breakdown_text).toContain('không sử dụng để kinh doanh');
  });

  // 8. Khách hỏi phòng 401 Hà Đông -> Chatbot thông báo minh bạch phòng không kinh doanh
  it('informs customer transparently that Room 401 Ha Dong is not used for business', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const result = await orchestrator.processTurn(
      'canonical-test-401',
      'Phòng 401 ở Hà Đông giá bao nhiêu em, anh muốn thuê phòng này',
      FIXED_CLOCK
    );

    expect(result.customer_visible_response.toLowerCase()).toMatch(/không sử dụng để kinh doanh|không nằm trong danh mục/i);
    expect(result.customer_visible_response).not.toContain('Đặt phòng thành công');
    expect(result.verified_candidates.some((c) => c.id.includes('401') && c.id.includes('ha-dong'))).toBe(false);
  });

  // 9. ClaimLevelValidator phát hiện và từ chối tên phòng bịa đặt hoặc dịch sai
  it('ClaimLevelValidator rejects ungrounded / translated room names and non-commercial room 401 sale', () => {
    const validator = new ClaimLevelValidator(dataset);

    // 9.1. Fabricated name "601 Tổng Thống"
    const val1 = validator.validate('Phòng 601 Tổng Thống tại Hà Đông giá 849.000đ', {
      facility: 'jacayl-ha-dong',
    });
    expect(val1.rejected_claims.some((r) => r.includes('REJECTED_CANONICAL_ROOM_NAME'))).toBe(true);

    // 9.2. Translated name "50 Shades"
    const val2 = validator.validate('Gửi bạn phòng 50 Shades tại Hà Đông rất đẹp', {
      facility: 'jacayl-ha-dong',
    });
    expect(val2.rejected_claims.some((r) => r.includes('REJECTED_CANONICAL_ROOM_TRANSLATION'))).toBe(true);

    // 9.3. Non-commercial room 401 Ha Dong sale
    const val3 = validator.validate('Lựa chọn phù hợp nhất là phòng 401 Hà Đông giá dự kiến 279.000đ', {
      facility: 'jacayl-ha-dong',
    });
    expect(val3.rejected_claims.some((r) => r.includes('REJECTED_NON_COMMERCIAL_ROOM_SALE'))).toBe(true);
  });

  // 10. ClaimLevelValidator không chặn nhầm câu đính chính hợp lệ
  it('ClaimLevelValidator does not reject legitimate clarification / correction sentences', () => {
    const validator = new ClaimLevelValidator(dataset);

    // 10.1. Correction: "Phòng này không có tên Tổng Thống"
    const cor1 = validator.validate('Dạ phòng này không có tên Tổng Thống mà tên chính thức là 50 — Sắc Thái ạ.', {
      facility: 'jacayl-ha-dong',
    });
    expect(cor1.rejected_claims.some((r) => r.includes('REJECTED_CANONICAL_ROOM_NAME'))).toBe(false);
    expect(cor1.verified_claims.some((v) => v.includes('VERIFIED_CANONICAL_ROOM_CORRECTION'))).toBe(true);

    // 10.2. Official policy QA response for 601
    const cor2 = validator.validate(
      'Dạ trong dữ liệu chính thức của J Collection, phòng 601 tại cơ sở Jacayl Hà Đông có tên thương mại chính thức là 50 — Sắc Thái chứ không có tên "Tổng Thống" ạ.',
      { facility: 'jacayl-ha-dong' }
    );
    expect(cor2.rejected_claims.some((r) => r.includes('REJECTED_CANONICAL_ROOM_NAME'))).toBe(false);
    expect(cor2.verified_claims.some((v) => v.includes('VERIFIED_CANONICAL_ROOM_CORRECTION'))).toBe(true);

    // 10.3. Correction: "chứ không gọi là 50 Shades"
    const cor3 = validator.validate('Dạ phòng bên em có tên tiếng Việt là 50 — Sắc Thái chứ không gọi là 50 Shades ạ.', {
      facility: 'jacayl-ha-dong',
    });
    expect(cor3.rejected_claims.some((r) => r.includes('REJECTED_CANONICAL_ROOM_TRANSLATION'))).toBe(false);
    expect(cor3.verified_claims.some((v) => v.includes('VERIFIED_CANONICAL_NAME_CORRECTION'))).toBe(true);

    // 10.4. Clarification: Room 401 Ha Dong is NOT for sale
    const cor4 = validator.validate(
      'Dạ phòng 401 tại cơ sở Jacayl Hà Đông hiện không sử dụng để kinh doanh ạ. Anh/chị có thể lựa chọn các phòng tầng 4 khác như 402 — Whisky nhé ạ!',
      { facility: 'jacayl-ha-dong' }
    );
    expect(cor4.rejected_claims.some((r) => r.includes('REJECTED_NON_COMMERCIAL_ROOM_SALE'))).toBe(false);
    expect(cor4.verified_claims.some((v) => v.includes('VERIFIED_NON_COMMERCIAL_ROOM_CLARIFICATION'))).toBe(true);
  });

  // 11. Xác nhận phòng 401 ở cơ sở khác (Trần Khát Chân, J Village) hoàn toàn không bị chặn
  it('confirms room 401 at other facilities (Tran Khat Chan, J Village) is commercial and not blocked', () => {
    const searchEngine = new InMemoryRoomSearchEngine(dataset);
    const quoteEngine = new PreBookingQuoteEngine(dataset);

    // 11.1. Tran Khat Chan: 401-blush
    const tkcSearch = searchEngine.search({
      co_so_ma: 'jacayl-tran-khat-chan',
      stay_type: 'nghi_gio',
      duration_hours: 2,
    });
    const tkcAll = [
      ...tkcSearch.buckets.exact_matches,
      ...tkcSearch.buckets.partial_matches,
      ...tkcSearch.buckets.alternative_suggestions,
    ];
    const tkcHas401 = tkcAll.some((c) => c.room.ma_phong === '401-blush');
    expect(tkcHas401).toBe(true);

    const tkcQuote = quoteEngine.getQuote({
      co_so_ma: 'jacayl-tran-khat-chan',
      ma_phong: '401-blush',
      stay_type: 'nghi_gio',
      duration_hours: 2,
    });
    expect(tkcQuote.is_resolved).toBe(true);
    expect(tkcQuote.pricing_status).not.toBe('NOT_FOR_SALE');
    expect(tkcQuote.total_estimate).toBeGreaterThan(0);

    // 11.2. J Village: 401-mosaic
    const jvSearch = searchEngine.search({
      co_so_ma: 'j-village',
      stay_type: 'nghi_gio',
      duration_hours: 2,
    });
    const jvAll = [
      ...jvSearch.buckets.exact_matches,
      ...jvSearch.buckets.partial_matches,
      ...jvSearch.buckets.alternative_suggestions,
    ];
    const jvHas401 = jvAll.some((c) => c.room.ma_phong === '401-mosaic');
    expect(jvHas401).toBe(true);

    const jvQuote = quoteEngine.getQuote({
      co_so_ma: 'j-village',
      ma_phong: '401-mosaic',
      stay_type: 'nghi_gio',
      duration_hours: 2,
    });
    expect(jvQuote.is_resolved).toBe(true);
    expect(jvQuote.pricing_status).not.toBe('NOT_FOR_SALE');
    expect(jvQuote.total_estimate).toBeGreaterThan(0);
  });
});
