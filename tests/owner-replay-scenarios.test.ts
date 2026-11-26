import { describe, it, expect, beforeAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { TranKhatChanAgent } from '../src/agent/trankhatchan-agent.js';
import { JVillageAgent } from '../src/agent/jvillage-agent.js';

describe('OWNER REPLAY SCENARIOS — "Nay còn phòng kh b"', () => {
  let dataset: NormalizedDataset;
  const REF_CLOCK = '2026-11-28T14:00:00+07:00';

  beforeAll(() => {
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
  });

  it('Owner Scenario 1 (Brand New Session): "Nay còn phòng kh b" without prior context', async () => {
    const agent = new HadongAgent(dataset, { referenceClock: REF_CLOCK });
    const sessionId = `owner-replay-new-${Date.now()}`;

    const res = await agent.processTurn(sessionId, 'Nay còn phòng kh b');

    expect(res.customer_visible_response).toBeDefined();
    // 1. Must NOT fabricate an arbitrary 2h or 4h duration
    expect(res.extracted_entities.duration_hours).toBeUndefined();
    // 2. Must state availability across categories
    expect(res.customer_visible_response).toMatch(/Standard|Deluxe|Concept/);
    // 3. Must explain that real-time vacancy is held and managed by reception
    expect(res.customer_visible_response.toLowerCase()).toMatch(/lễ tân|đối soát/);
    // 4. Must proactively ask guest for desired timeframe / stay package
    expect(res.customer_visible_response.toLowerCase()).toMatch(/mấy giờ|gói/);
    // 5. Must NOT hardcode "thứ 7 không cần bồn tắm" or "chiều cuối tuần"
    expect(res.customer_visible_response).not.toContain('thứ 7 không cần bồn tắm');
    expect(res.customer_visible_response).not.toContain('chiều cuối tuần');
    // 6. Zero ungrounded claims
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });

  it('Owner Scenario 2 (Follow-up Session): "Nay còn phòng kh b" after prior 4h room discussion', async () => {
    const agent = new HadongAgent(dataset, { referenceClock: REF_CLOCK });
    const sessionId = `owner-replay-followup-${Date.now()}`;

    // Turn 1: Discuss 4h pricing for Room 101
    const res1 = await agent.processTurn(sessionId, 'Phòng 101 ở 4 tiếng giá thế nào em');
    expect(res1.customer_visible_response).toContain('101');
    expect(res1.customer_visible_response).toContain('649.000đ');

    // Turn 2: Replay Owner question "Nay còn phòng kh b"
    const res2 = await agent.processTurn(sessionId, 'Nay còn phòng kh b');

    expect(res2.customer_visible_response).toBeDefined();
    // 1. Must recognize prior 4h discussion and/or room 101
    expect(res2.customer_visible_response.toLowerCase()).toMatch(/4 tiếng|101/);
    // 2. Must address availability today
    expect(res2.customer_visible_response.toLowerCase()).toMatch(/sẵn sàng|phục vụ|hôm nay/);
    // 3. Must clarify real-time vacancy management with reception
    expect(res2.customer_visible_response.toLowerCase()).toMatch(/lễ tân|đối soát/);
    // 4. Must offer reception booking/holding or ask for arrival time
    expect(res2.customer_visible_response.toLowerCase()).toMatch(/giữ phòng|nhận phòng|mấy giờ/);
    // 5. Zero ungrounded claims
    expect(res2.claim_validation?.rejected_claims.length).toBe(0);
  });
});
