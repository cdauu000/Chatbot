import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('Representative Blind Evaluation — 5 Complex Real Customer Cases', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const orchestrator = new ConversationOrchestrator(dataset, { referenceClock: '2026-11-28T10:00:00+07:00' });
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00';

  it('Case 1: Overnight visitor inquiry without keyword ("dẫn bạn vào ngủ cùng lúc 2h sáng có tính thêm tiền không?")', async () => {
    const res = await orchestrator.processTurn('blind-rep-1', 'dẫn bạn vào ngủ cùng lúc 2h sáng có tính thêm tiền không?', FIXED_CLOCK, 'jacayl-ha-dong');
    console.log('\n--- CASE 1 OUTPUT ---');
    console.log(res.customer_visible_response);
    expect(res.customer_visible_response.toLowerCase()).toMatch(/người thứ ba|người thứ 3|phụ thu|chính sách/i);
    expect(res.customer_visible_response).not.toContain('danh sách phòng');
  });

  it('Case 2: Discern Jacuzzi vs soaking tub ("bên em có bồn sục sủi bọt jacuzzi không hay chỉ bồn tắm thường thôi?")', async () => {
    const res = await orchestrator.processTurn('blind-rep-2', 'bên em có bồn sục sủi bọt jacuzzi không hay chỉ bồn tắm thường thôi?', FIXED_CLOCK, 'jacayl-ha-dong');
    console.log('\n--- CASE 2 OUTPUT ---');
    console.log(res.customer_visible_response);
    expect(res.customer_visible_response.toLowerCase()).toMatch(/bồn tắm nằm|thư giãn|không có bồn sục|không có jacuzzi/i);
  });

  it('Case 3: Compare categories weekend daytime ("so sánh giá 2 tiếng ban ngày thứ 7 giữa phòng deluxe và phòng concept ở hà đông")', async () => {
    const res = await orchestrator.processTurn('blind-rep-3', 'so sánh giá 2 tiếng ban ngày thứ 7 giữa phòng deluxe và phòng concept ở hà đông', FIXED_CLOCK, 'jacayl-ha-dong');
    console.log('\n--- CASE 3 OUTPUT ---');
    console.log(res.customer_visible_response);
    expect(res.customer_visible_response).toContain('315.000đ'); // Deluxe cuối tuần ban ngày
    expect(res.customer_visible_response).toContain('449.000đ'); // Concept cuối tuần ban ngày
  });

  it('Case 4: Typo + slang unverified twin tub check ("phongf 601 ben ha dong co bon tam doi k shop")', async () => {
    const res = await orchestrator.processTurn('blind-rep-4', 'phongf 601 ben ha dong co bon tam doi k shop', FIXED_CLOCK, 'jacayl-ha-dong');
    console.log('\n--- CASE 4 OUTPUT ---');
    console.log(res.customer_visible_response);
    expect(res.customer_visible_response).toContain('50 — Sắc Thái');
    expect(res.customer_visible_response.toLowerCase()).toMatch(/bồn tắm nằm|bồn tắm/i);
    expect(res.customer_visible_response.toLowerCase()).toContain('chưa được công bố chính thức');
  });

  it('Case 5: Multi-hour pricing starting at 18:00 ("cho mình hỏi từ 18h tối đến 22h đêm phòng 201 la casta tính bao nhiêu")', async () => {
    const res = await orchestrator.processTurn('blind-rep-5', 'cho mình hỏi từ 18h tối đến 22h đêm phòng 201 la casta tính bao nhiêu', FIXED_CLOCK, 'jacayl-ha-dong');
    console.log('\n--- CASE 5 OUTPUT ---');
    console.log(res.customer_visible_response);
    expect(res.customer_visible_response).toContain('La Casta');
    expect(res.customer_visible_response).toMatch(/\d{3}\.000đ/);
  });
});
