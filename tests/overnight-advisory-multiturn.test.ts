import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('Business Policy V1.4.3 Golden Tests — Group E: Multi-Turn Conversation Scenarios', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const orchestrator = new ConversationOrchestrator(dataset);
  const FIXED_CLOCK = '2026-11-28T18:00:00+07:00'; // Saturday 18:00

  // =========================================================================
  // SCENARIO 1: Overnight check-in time negotiation (20:00 -> 21:40 -> 20:00)
  // =========================================================================
  it('Scenario 1: Multi-turn overnight negotiation: 20:00 (Day-Night) -> 21:40 (Overnight) -> 20:00 (Day-Night consistent)', async () => {
    const prevEngine = process.env.CONVERSATION_ENGINE;
    process.env.CONVERSATION_ENGINE = 'legacy';
    const legacyOrchestrator = new ConversationOrchestrator(dataset);
    const sessionId = 'scen-1-overnight-negotiation';

    try {
      // Turn 1: Check-in 20:00 tonight until noon tomorrow at Ha Dong
      const turn1 = await legacyOrchestrator.processTurn(
        sessionId,
        'Tối nay 20h anh muốn ghé cơ sở Hà Đông ở đến trưa mai có phòng nào không em?',
        FIXED_CLOCK
      );

      expect(turn1.updated_state.active_facility).toBe('jacayl-ha-dong');
      expect(turn1.updated_state.stay_type).toBe('qua_dem');
      expect(turn1.internal_trace.rules_triggered).toContain('STAY_ELIGIBILITY_ALTERNATIVE_PACKAGE_RECOMMENDED');

      // Assistant explains 21:40 boundary and recommends Day-Night package
      expect(turn1.customer_visible_response).toContain('21:40');
      expect(turn1.customer_visible_response).toContain('Ngày Đêm');
      expect(turn1.verified_candidates.length).toBeGreaterThan(0);

      // Turn 2: Customer reschedules to 21:40
      const turn2 = await legacyOrchestrator.processTurn(
        sessionId,
        'Thế 21h40 anh đến thì giá thế nào?',
        FIXED_CLOCK
      );

      expect(turn2.updated_state.checkin_datetime).toContain('21:40');
      expect(turn2.internal_trace.rules_triggered).toContain('STAY_ELIGIBILITY_EARLY_CHECKIN_GRACE_APPLIED');

      // Assistant acknowledges 20-minute early check-in grace for overnight rate
      expect(turn2.customer_visible_response).toContain('20 phút');
      expect(turn2.customer_visible_response).toContain('qua đêm');
      expect(turn2.customer_visible_response).not.toContain('ngày đêm');

      // Turn 3: Customer cannot wait and insists on checking in at 20:00
      const turn3 = await legacyOrchestrator.processTurn(
        sessionId,
        'Anh bận việc không đợi được, anh vẫn đến lúc 20h thì sao em?',
        FIXED_CLOCK
      );

      expect(turn3.updated_state.checkin_datetime).toContain('20:00');
      expect(turn3.internal_trace.rules_triggered).toContain('STAY_ELIGIBILITY_ALTERNATIVE_PACKAGE_RECOMMENDED');

      // Assistant remains consistent: quotes Day-Night rate, explains 21:40 option again
      expect(turn3.customer_visible_response).toContain('Ngày Đêm');
      expect(turn3.customer_visible_response).toContain('21:40');
    } finally {
      if (prevEngine === undefined) delete process.env.CONVERSATION_ENGINE;
      else process.env.CONVERSATION_ENGINE = prevEngine;
    }
  });

  // =========================================================================
  // SCENARIO 2: Holiday pricing inquiry -> Saturday 09:00 Concept quote
  // =========================================================================
  it('Scenario 2: Holiday pricing inquiry -> Saturday 09:00 Concept room quote (449k/2h)', async () => {
    const sessionId = 'scen-2-holiday-concept';

    // Turn 1: Holiday inquiry
    const turn1 = await orchestrator.processTurn(
      sessionId,
      'Ngày lễ Valentine 14/2 bên mình có tăng giá hay phụ thu gì không em?',
      FIXED_CLOCK
    );

    // AI explains: Standard rate, NO holiday surcharge (Policy V1.4.3 phrasing-tolerant)
    expect(turn1.customer_visible_response.toLowerCase()).toMatch(/không phụ thu|không có phụ thu|không tăng giá|giá niêm yết/);

    // Turn 2: Room quote for Saturday 09:00 Concept at Ha Dong
    const turn2 = await orchestrator.processTurn(
      sessionId,
      'Cho anh xem phòng Concept ở Hà Đông sáng thứ Bảy lúc 9h thuê 2 tiếng giá thế nào?',
      FIXED_CLOCK
    );

    expect(turn2.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(turn2.verified_candidates.length).toBeGreaterThan(0);

    // Concept mapped to Suite: Saturday daytime 2h rate is exactly 449.000đ
    expect(turn2.customer_visible_response).toContain('449.000đ');
    // Does NOT invent fake surcharge or holiday price increase
    expect(turn2.customer_visible_response).not.toContain('phụ thu ngày lễ');
  });

  // =========================================================================
  // SCENARIO 3: 1-hour package rejection and 2-hour minimum explanation
  // =========================================================================
  it('Scenario 3: 1-hour request rejection -> 2-hour minimum explanation, no price halving', async () => {
    const sessionId = 'scen-3-one-hour-request';

    // Turn 1: Ask for 1-hour rental
    const turn1 = await orchestrator.processTurn(
      sessionId,
      'Anh chỉ muốn thuê 1 tiếng phòng Standard ở Hà Đông thì giá bao nhiêu em?',
      '2026-11-25T10:00:00+07:00' // Wednesday
    );

    expect(turn1.updated_state.active_facility).toBe('jacayl-ha-dong');
    // Rejects 1-hour, explains minimum 2 hours
    expect(turn1.customer_visible_response.toLowerCase()).toMatch(/tối thiểu.*2 (tiếng|giờ)/);
    // Does NOT halve price to 80k
    expect(turn1.customer_visible_response).not.toContain('80.000đ');
    expect(turn1.customer_visible_response).not.toContain('79.500đ');

    // Turn 2: Customer asks if price can be halved for 1 hour
    const turn2 = await orchestrator.processTurn(
      sessionId,
      'Nếu anh chỉ ở đúng 1 tiếng thôi có được giảm nửa giá còn 80k không em?',
      '2026-11-25T10:00:00+07:00'
    );

    // Explains fixed minimum 2-hour package, rejects 80k claim
    expect(turn2.customer_visible_response.toLowerCase()).toMatch(/tối thiểu.*2 (tiếng|giờ)|không áp dụng/);
    expect(turn2.customer_visible_response).not.toContain('được giảm nửa giá');
  });
});
