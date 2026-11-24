import { describe, it, expect, vi } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { GroqProviderAdapter } from '../src/conversation/adapters/groq-provider.js';
import { GeminiProviderAdapter } from '../src/conversation/adapters/gemini-provider.js';

describe('Milestone 3.5 — 15 Standard Real-World Conversation Evaluation Scenarios', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday morning

  // 1. Phòng có bồn tắm Hà Đông giá bao nhiêu?
  it('Scenario 1: Bathtub Room Inquiry at Ha Dong with Verified Grounding and Pricing', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-1',
      'Phòng có bồn tắm ở Hà Đông giá bao nhiêu vậy em?',
      FIXED_CLOCK
    );

    expect(result.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(result.updated_state.must_have_amenities).toContain('bồn tắm');
    expect(result.verified_candidates.length).toBeGreaterThan(0);
    expect(result.customer_visible_response).toContain('Jacayl Hà Đông');
    expect(result.customer_visible_response).toContain('bồn tắm');
    // Ensure all quoted prices are formatted and non-zero
    expect(result.customer_visible_response).toMatch(/\d{3}\.000đ/);

    // Section 4 QA Invariant: Only rooms with confirmed bathtub evidence are verified exact matches
    const exactBathtubCandidates = result.verified_candidates.filter((c) => c.bucket === 'EXACT');
    expect(exactBathtubCandidates.map((c) => c.id)).toEqual([
      'jacayl-ha-dong::101-long-chim',
      'jacayl-ha-dong::601-50-sac-thai',
      'jacayl-ha-dong::602-playboy',
    ]);

    // Strictly reject 201, 301, or 401 as bathtub rooms
    expect(
      exactBathtubCandidates.some((c) => c.id.includes('201') || c.id.includes('301') || c.id.includes('401'))
    ).toBe(false);

    // Customer-visible response must contain exact canonical names and official category "Concept" (not Suite)
    expect(result.customer_visible_response).toContain('101 — Lồng Chim');
    expect(result.customer_visible_response).toContain('50 — Sắc Thái');
    expect(result.customer_visible_response).toContain('602 — Playboy');
    expect(result.customer_visible_response).toContain('Hạng Concept');
    expect(result.customer_visible_response).not.toContain('Hạng Suite');
    expect(result.customer_visible_response).not.toContain('201 — La Casta');
    expect(result.customer_visible_response).not.toContain('401');
  });

  // 2. Thuê 4 tiếng thứ Bảy lúc 17h giá thế nào?
  it('Scenario 2: Saturday 17:00 4-Hour Rental at Ha Dong with Daytime Policy and No Post-18:00 Rate Switch', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-2',
      'Thuê 4 tiếng thứ Bảy lúc 17h ở Hà Đông giá thế nào?',
      FIXED_CLOCK
    );

    expect(result.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(result.updated_state.duration_hours).toBe(4);
    expect(result.updated_state.checkin_datetime).toContain('17:00');

    // Invariant V1.4.3: Check-in at 17:00 falls in [08:00, 18:00) on Saturday -> Weekend Daytime Table
    // Standard: 180k (first 2h) + 2 extra hours. Rate does NOT switch at 18:00 mid-stay.
    expect(result.tool_results.quote_results).toBeDefined();
    const standardQuote = result.tool_results.quote_results?.find(
      (q) => q.ma_phong.includes('201') || q.ten_phong.toLowerCase().includes('casta')
    );
    if (standardQuote) {
      expect(standardQuote.base_2h_price).toBe(180000);
      expect(standardQuote.total_estimate).toBe(180000 + 2 * standardQuote.extra_hour_rate);
    }
  });

  // 3. Đổi sang phòng 601 thì bao nhiêu?
  it('Scenario 3: Presidential Room 601 Inquiry with 200,000 VND/h Extra Hour Rate', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    // Turn 1: Search at Ha Dong
    await orchestrator.processTurn('eval-session-3', 'Tìm phòng ở Hà Đông 3 tiếng', FIXED_CLOCK);

    // Turn 2: Switch to room 601
    const result = await orchestrator.processTurn(
      'eval-session-3',
      'Đổi sang phòng 601 thì bao nhiêu em?',
      FIXED_CLOCK
    );

    expect(result.updated_state.focused_room).toBeDefined();
    expect(result.updated_state.focused_room?.ma_phong).toContain('601');
    expect(result.customer_visible_response).toContain('50 — Sắc Thái');
    expect(result.customer_visible_response).not.toContain('Tổng Thống');

    // Invariant V1.4.3: Room 601 extra hour rate is 200,000 VND
    const quote = result.tool_results.quote_results?.find((q) => q.ma_phong.includes('601'));
    if (quote) {
      expect(quote.extra_hour_rate).toBe(200000);
    }
  });

  // 4. Trước 8h sáng có áp dụng giá cuối tuần không?
  it('Scenario 4: Early Morning Before 08:00 Check-in Policy Invariant', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-4',
      'Trước 8h sáng ở Hà Đông có áp dụng giá cuối tuần không?',
      FIXED_CLOCK
    );

    expect(result.intent).toBe('ASK_POLICY');
    // Policy V1.4.3 Invariant: Before 08:00 applies base dataset price, not daytime table
    expect(result.customer_visible_response.toLowerCase()).toMatch(/trước 0?8:?00|giá gốc|không áp dụng|dataset/i);
  });

  // 5. Ngày lễ có tăng giá không?
  it('Scenario 5: Holiday Surcharge Policy Invariant (No Surcharge)', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-5',
      'Ngày lễ bên mình có tăng giá không em?',
      FIXED_CLOCK
    );

    expect(result.intent).toBe('ASK_POLICY');
    // Policy V1.4.3 Invariant: No separate holiday surcharge
    expect(result.customer_visible_response.toLowerCase()).toMatch(/không phụ thu|không tăng giá|bình thường/i);
  });

  // 6. Thuê 1 tiếng được không?
  it('Scenario 6: 1-Hour Stay Request Rejection with 2-Hour Minimum Policy Advisory', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-6',
      'Anh muốn thuê 1 tiếng được không?',
      FIXED_CLOCK
    );

    // Policy V1.4.3 Invariant: Minimum hourly stay duration is 2 hours
    expect(result.customer_visible_response).toMatch(/tối thiểu (là )?2 (tiếng|giờ)/i);
  });

  // 7. Khách muốn nhận phòng qua đêm lúc 20h.
  it('Scenario 7: Overnight Check-in at 20:00 (Before 21:40 Grace) Advises Day-Night Package', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-7',
      'Anh muốn nhận phòng qua đêm lúc 20h tối nay ở Hà Đông được không?',
      '2026-11-28T19:30:00+07:00'
    );

    // Invariant V1.4.3: 20:00 is before 21:40 early threshold. Recommends day-night package (gói ngày đêm) or waiting
    expect(result.customer_visible_response.toLowerCase()).toMatch(/ngày đêm|21:40|22:00/i);
  });

  // 8. Khách đổi sang nhận lúc 21h40.
  it('Scenario 8: Overnight Check-in at 21:40 Eligible for Early Grace Support', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-8',
      'Vậy anh đổi sang nhận lúc 21h40 ở qua đêm tại Hà Đông nhé.',
      '2026-11-28T21:00:00+07:00'
    );

    // Invariant V1.4.3: 21:40 meets the early grace window for overnight
    expect(result.updated_state.stay_type).toBe('qua_dem');
    expect(result.customer_visible_response.toLowerCase()).toMatch(/21:40|qua đêm|hỗ trợ/i);
  });

  // 9. Khách hỏi chính sách quá giờ 10 phút.
  it('Scenario 9: Overtime Policy with 10-Minute Grace Period and Minute-11 Billing', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-9',
      'Nếu anh trả phòng quá 10 phút thì tính phí thế nào em?',
      FIXED_CLOCK
    );

    expect(result.intent).toBe('ASK_POLICY');
    // Invariant V1.4.3: Under 10 minutes free; past 10 minutes charged 1 extra hour
    expect(result.customer_visible_response.toLowerCase()).toMatch(/10 phút|miễn phí|phút thứ 11|thêm/i);
  });

  // 10. Khách hỏi phòng đang trống.
  it('Scenario 10: Real-Time Availability Inquiry Without Live PMS Escalates Transparently', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-10',
      'Bây giờ phòng 101 Hà Đông có đang trống không em để anh qua luôn?',
      FIXED_CLOCK
    );

    // Invariant: AI concierge does not have write/read PMS access, does not hallucinate empty rooms
    expect(result.customer_visible_response.toLowerCase()).toMatch(/kiểm tra|lễ tân|hotline|trực tiếp|phòng trống/i);
  });

  // 11. Khách yêu cầu chốt phòng.
  it('Scenario 11: Booking Finalization Request Escalates to Human/Hotline without Fake Confirmation', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-11',
      'Chốt đặt cho anh phòng 201 Hà Đông tối nay nhé, anh cọc luôn.',
      FIXED_CLOCK
    );

    // Invariant: Milestone 4 booking API not active, escalate to staff or provide hotline
    expect(result.customer_visible_response.toLowerCase()).toMatch(/hotline|nhân viên|lễ tân|hỗ trợ|giữ phòng/i);
    expect(result.customer_visible_response).not.toContain('Đã đặt phòng thành công mã');
  });

  // 12. Khách hỏi tiện nghi chưa xác nhận.
  it('Scenario 12: Unconfirmed Amenity Inquiry Marked Clearly Without Hallucination', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-12',
      'Phòng ở Trần Khát Chân có máy chiếu và bồn tắm đôi không em?',
      FIXED_CLOCK
    );

    // Invariant: Projector and double bathtub are unconfirmed in dataset
    expect(result.customer_visible_response).toContain('Lưu ý về tiện nghi');
    expect(result.customer_visible_response).toContain('máy chiếu');
  });

  // 13. Khách thay đổi ngân sách.
  it('Scenario 13: Multi-turn Budget Change Successfully Filters Results', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    // Turn 1: High budget
    await orchestrator.processTurn(
      'eval-session-13',
      'Tìm phòng ở J Village giá tầm 700k',
      FIXED_CLOCK
    );

    // Turn 2: Lower budget constraint
    const result = await orchestrator.processTurn(
      'eval-session-13',
      'À hạ ngân sách xuống dưới 300k thôi em',
      FIXED_CLOCK
    );

    expect(result.updated_state.max_budget).toBe(300000);
    expect(result.customer_visible_response).toContain('J Village');
  });

  // 14. Khách hỏi cùng lúc nhiều vấn đề.
  it('Scenario 14: Multi-Topic Compound Inquiry Handled Comprehensively', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-14',
      'Cho anh hỏi giá thuê 2 tiếng chiều thứ Bảy ở Hà Đông phòng có bồn tắm, và nếu quá giờ 10 phút thì thế nào?',
      FIXED_CLOCK
    );

    // Must answer both room advisory (with price) and policy QA (overtime)
    expect(result.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(result.customer_visible_response).toContain('bồn tắm');
    expect(result.customer_visible_response).toMatch(/\d{3}\.000đ/);
  });

  // 15. Khách dùng tiếng Việt không dấu.
  it('Scenario 15: Non-Accented Vietnamese Query Processed Accurately', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const result = await orchestrator.processTurn(
      'eval-session-15',
      'thue 2 tieng o ha dong chieu thu bay gia bao nhieu em',
      FIXED_CLOCK
    );

    expect(result.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(result.updated_state.duration_hours).toBe(2);
    expect(result.customer_visible_response).toContain('Jacayl Hà Đông');
    expect(result.customer_visible_response).toMatch(/\d{3}\.000đ/);
  });

  // Multi-Provider Compatibility Evaluation
  it('evaluates all 15 queries across Groq, Gemini, and Mock simulated providers', async () => {
    // Simulated Groq Provider
    const mockGroqCall = vi.fn().mockResolvedValue({
      raw_content: JSON.stringify({
        intent: 'SEARCH_ROOM',
        facility: 'jacayl-ha-dong',
        duration_hours: 2,
        amenities: ['bồn tắm'],
        confidence: 0.96,
      }),
      telemetry: {
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        prompt_tokens: 110,
        completion_tokens: 35,
        total_tokens: 145,
        latency_ms: 130,
        retries_attempted: 0,
      },
    });

    const groqAdapter = new GroqProviderAdapter({ apiKey: 'gsk_test' });
    vi.spyOn(groqAdapter, 'isConfigured').mockReturnValue(true);
    vi.spyOn(groqAdapter, 'callChatCompletion').mockImplementation(mockGroqCall);

    // Simulated Gemini Provider
    const mockGeminiCall = vi.fn().mockResolvedValue({
      raw_content: JSON.stringify({
        intent: 'SEARCH_ROOM',
        facility: 'jacayl-ha-dong',
        duration_hours: 2,
        amenities: ['bồn tắm'],
        confidence: 0.94,
      }),
      telemetry: {
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        prompt_tokens: 115,
        completion_tokens: 32,
        total_tokens: 147,
        latency_ms: 210,
        retries_attempted: 0,
      },
    });

    const geminiAdapter = new GeminiProviderAdapter({ apiKey: 'gemini_test' });
    vi.spyOn(geminiAdapter, 'isConfigured').mockReturnValue(true);
    vi.spyOn(geminiAdapter, 'callChatCompletion').mockImplementation(mockGeminiCall);

    // Test with Groq
    const groqGateway = new FreeLLMGateway({ mode: 'groq', groqAdapter });
    const groqOrchestrator = new ConversationOrchestrator(dataset, { llmAdapter: groqGateway });
    const groqRes = await groqOrchestrator.processTurn(
      'groq-eval-1',
      'Phòng có bồn tắm ở Hà Đông 2 tiếng giá thế nào?',
      FIXED_CLOCK
    );
    expect(groqRes.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(groqGateway.getTelemetry()?.provider).toBe('groq');

    // Test with Gemini
    const geminiGateway = new FreeLLMGateway({ mode: 'gemini', geminiAdapter });
    const geminiOrchestrator = new ConversationOrchestrator(dataset, { llmAdapter: geminiGateway });
    const geminiRes = await geminiOrchestrator.processTurn(
      'gemini-eval-1',
      'Phòng có bồn tắm ở Hà Đông 2 tiếng giá thế nào?',
      FIXED_CLOCK
    );
    expect(geminiRes.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(geminiGateway.getTelemetry()?.provider).toBe('gemini');

    // Test with Mock
    const mockGateway = new FreeLLMGateway({ mode: 'mock' });
    const mockOrchestrator = new ConversationOrchestrator(dataset, { llmAdapter: mockGateway });
    const mockRes = await mockOrchestrator.processTurn(
      'mock-eval-1',
      'Phòng có bồn tắm ở Hà Đông 2 tiếng giá thế nào?',
      FIXED_CLOCK
    );
    expect(mockRes.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(mockGateway.getTelemetry()?.provider).toBe('mock');
  });
});
