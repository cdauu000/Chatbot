import { describe, it, expect, beforeAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';

describe('AGENTIC V1.2.1 — Architectural Regression Suite (BUG-01 to BUG-06)', () => {
  let dataset: NormalizedDataset;
  let agent: HadongAgent;

  beforeAll(() => {
    try {
      process.loadEnvFile?.();
    } catch {}
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    agent = new HadongAgent(dataset, { llmAdapter: gateway });
  });

  // =========================================================================
  // BUG-01: Day-of-week collision ("thu bay" vs "thu ba")
  // =========================================================================
  it('BUG-01 Regression: "thu bay" is correctly resolved as weekend without colliding with "thu ba"', async () => {
    const resSat = await agent.processTurn('bug01-sat', 'Phòng 601 nghỉ 2 tiếng chiều thứ bảy giá bao nhiêu em');
    expect(resSat.customer_visible_response).toContain('449.000đ'); // Weekend Concept 2h is 449k

    const resTue = await agent.processTurn('bug01-tue', 'Phòng 601 nghỉ 2 tiếng sáng thứ ba giá bao nhiêu em');
    expect(resTue.customer_visible_response).toContain('399.000đ'); // Weekday Concept 2h is 399k
  });

  // =========================================================================
  // BUG-02: Price inquiry ("tính giá thế nào") vs Amenity detail
  // =========================================================================
  it('BUG-02 Regression: "tính giá thế nào" triggers quote_price, not amenity facts', async () => {
    const res = await agent.processTurn(
      'bug02-session',
      'Phòng 601 nhận phòng 17h đến 21h thứ 7 tính giá thế nào'
    );
    expect(res.internal_trace.tools_executed).toContain('quote_price');
    expect(res.customer_visible_response).toContain('849.000đ');
  });

  // =========================================================================
  // BUG-03: Question particle "không" vs Negation
  // =========================================================================
  it('BUG-03 Regression: Question particle "có tăng không?" does not negate Room 101', async () => {
    const res = await agent.processTurn(
      'bug03-session',
      'Giá phòng 101 vào ngày 30/4 có tăng không em'
    );
    expect(res.customer_visible_response).toContain('101');
    expect(res.customer_visible_response.toLowerCase()).toContain('không phụ thu');
  });

  // =========================================================================
  // BUG-04: Pronoun "anh" vs Media "ảnh"
  // =========================================================================
  it('BUG-04 Regression: Pronoun "giúp anh" does not trigger get_room_media, while "cho anh xem ảnh" does', async () => {
    const resQuote = await agent.processTurn(
      'bug04-quote',
      'Báo giá giúp anh phòng 601 chiều thứ 7 2 tiếng với'
    );
    expect(resQuote.internal_trace.tools_executed).toContain('quote_price');
    expect(resQuote.internal_trace.tools_executed).not.toContain('get_room_media');
    expect(resQuote.customer_visible_response).toContain('449.000đ');

    const resMedia = await agent.processTurn(
      'bug04-media',
      'Cho anh xem ảnh phòng 601 ở Hà Đông với em'
    );
    expect(resMedia.internal_trace.tools_executed).toContain('get_room_media');
    expect(resMedia.customer_visible_response.toLowerCase()).toContain('hình ảnh');
  });

  // =========================================================================
  // BUG-05: Room 601 bathtub label is strictly "Bồn tắm lớn" (No 1.7m-1.8m)
  // =========================================================================
  it('BUG-05 Regression: Room 601 bathtub label is strictly "Bồn tắm lớn", zero metric hallucination', async () => {
    const res = await agent.processTurn(
      'bug05-session',
      'Phòng 601 ở Hà Đông bồn tắm to không em, kích thước thế nào'
    );
    expect(res.customer_visible_response).toContain('Bồn tắm lớn');
    expect(res.customer_visible_response).not.toContain('1,7');
    expect(res.customer_visible_response).not.toContain('1.7');
    expect(res.customer_visible_response).not.toContain('1,8');
    expect(res.customer_visible_response).not.toContain('1.8');
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // BUG-06: Zero hardcoded room ID for low budget
  // =========================================================================
  it('BUG-06 Regression: Low budget dynamically selects most affordable room from dataset', async () => {
    const res = await agent.processTurn(
      'bug06-session',
      'Có phòng nào ở Hà Đông dưới 350k thứ 7 2 tiếng không cần bồn tắm không em'
    );
    expect(res.internal_trace.tools_executed).toContain('quote_price');
    expect(res.customer_visible_response).toContain('180.000đ');
    expect(res.customer_visible_response).toContain('Standard');
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });
});
