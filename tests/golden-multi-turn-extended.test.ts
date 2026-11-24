import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('Milestone 3 - A5. Restored Golden Multi-Turn Extended Scenarios', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const orchestrator = new ConversationOrchestrator(dataset);
  const FIXED_CLOCK = '2026-11-28T08:00:00+07:00'; // Saturday morning

  it('Sequence 1: Saturday 09:00 at Hà Đông with successive slot updates & special rate explanation', async () => {
    const sId = 'seq-ha-dong-saturday-morning';

    // Step 1: Standard 2 giờ lúc 09:00 thứ Bảy -> 180.000đ
    const res1 = await orchestrator.processTurn(
      sId,
      'Tôi muốn tìm phòng Standard tại Hà Đông lúc 9h sáng thứ Bảy, ở 2 tiếng.',
      FIXED_CLOCK
    );
    expect(res1.updated_state.active_facility).toBe('jacayl-ha-dong');
    expect(res1.updated_state.duration_hours).toBe(2);
    expect(res1.updated_state.checkin_datetime).toContain('2026-11-28T09:00');
    expect(res1.tool_results.quote_results?.[0]?.total_estimate).toBe(180000);

    // Step 2: Cùng phòng 4 giờ -> 380.000đ (180k + 2h * 100k)
    const res2 = await orchestrator.processTurn(sId, 'Tăng lên ở 4 tiếng thì giá bao nhiêu em?', FIXED_CLOCK);
    expect(res2.updated_state.duration_hours).toBe(4);
    expect(res2.tool_results.quote_results?.[0]?.total_estimate).toBe(380000);

    // Step 3: Đổi Deluxe, giữ 4 giờ -> 515.000đ (315k + 2h * 100k)
    const res3 = await orchestrator.processTurn(sId, 'Nếu đổi sang phòng Deluxe vẫn ở 4 tiếng thì sao?', FIXED_CLOCK);
    expect(res3.updated_state.duration_hours).toBe(4);
    expect(res3.tool_results.quote_results?.[0]?.total_estimate).toBe(515000);

    // Step 4: Đổi sang phòng 601, giữ 4 giờ -> 849.000đ (449k + 2h * 200k)
    const res4 = await orchestrator.processTurn(sId, 'Cho anh xem phòng 601 ở 4 tiếng thì hết bao nhiêu?', FIXED_CLOCK);
    expect(res4.updated_state.duration_hours).toBe(4);
    expect(res4.tool_results.quote_results?.[0]?.total_estimate).toBe(849000);

    // Step 5: Khách hỏi vì sao giá tăng -> Giải thích đúng giá 2h đầu và giờ thêm riêng của phòng (50 — Sắc Thái)
    const res5 = await orchestrator.processTurn(sId, 'Sao phòng 601 này đắt thế, vì sao giá lại tăng lên vậy em?', FIXED_CLOCK);
    expect(res5.customer_visible_response).toContain('50 — Sắc Thái');
    expect(res5.customer_visible_response).toContain('200.000');
  });

  it('Sequence 2: Room 101 Saturday 17:00 -> 19:00 with boundary price adjustment', async () => {
    const sId = 'seq-room-101-boundary-shift';

    // Step 1: Phòng 101 thứ Bảy 17:00, 4 giờ -> 649.000đ (449k daytime weekend + 2h * 100k)
    const res1 = await orchestrator.processTurn(
      sId,
      'Anh muốn đặt phòng 101 Hà Đông vào thứ Bảy lúc 17h, nghỉ 4 tiếng.',
      FIXED_CLOCK
    );
    expect(res1.updated_state.duration_hours).toBe(4);
    expect(res1.updated_state.checkin_datetime).toContain('2026-11-28T17:00');
    expect(res1.tool_results.quote_results?.[0]?.total_estimate).toBe(649000);

    // Step 2: Khách đổi giờ nhận sang 19:00 -> 599.000đ (19:00 >= 18:00, base lấy từ dataset 399k + 2h * 100k)
    const res2 = await orchestrator.processTurn(
      sId,
      'Anh đổi sang đến lúc 19h tối nhé.',
      FIXED_CLOCK
    );
    expect(res2.updated_state.duration_hours).toBe(4); // Duration 4h unchanged
    expect(res2.updated_state.checkin_datetime).toContain('2026-11-28T19:00');
    expect(res2.tool_results.quote_results?.[0]?.total_estimate).toBe(599000);
  });
});
