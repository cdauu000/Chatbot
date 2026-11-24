import { describe, it, expect, beforeAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { JCollectionAgent } from '../src/agent/jcollection-agent.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { TranKhatChanAgent } from '../src/agent/trankhatchan-agent.js';
import { JVillageAgent } from '../src/agent/jvillage-agent.js';

describe('J COLLECTION — AGENTIC V3.0 LLM-NATIVE INTELLIGENCE CORE ACCEPTANCE', () => {
  let dataset: NormalizedDataset;
  const REF_SATURDAY = '2026-11-28T14:00:00+07:00';

  beforeAll(() => {
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
  });

  // =========================================================================
  // TEST SUITE 1: ROOT CAUSE RESOLUTION — NO ARBITRARY DURATION / CHECK-IN TIME
  // =========================================================================
  it('V3.0-01: Does not arbitrarily fabricate 4h or 14:00 when customer has not specified stay duration', async () => {
    const agent = new HadongAgent(dataset, { referenceClock: REF_SATURDAY });
    const sessionId = `test-v3-duration-${Date.now()}`;

    // Customer asks about bathtub rooms on Saturday afternoon without duration
    const res = await agent.processTurn(
      sessionId,
      'Anh muốn tìm phòng bồn tắm ở Hà Đông, chiều thứ 7 còn phòng không?'
    );

    expect(res.customer_visible_response).toBeDefined();
    // System should list bathtub rooms without hardcoding an arbitrary 4h quote
    expect(res.customer_visible_response).toContain('bồn tắm');
    expect(res.extracted_entities.duration_hours).toBeUndefined();
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // TEST SUITE 2: CHEAPEST ROOM REQUEST WITHOUT UNWANTED UPSELL
  // =========================================================================
  it('V3.0-02: Direct recommendation of cheapest room (201 La Casta) without forcing 601 upsell', async () => {
    const agent = new HadongAgent(dataset, { referenceClock: REF_SATURDAY });
    const sessionId = `test-v3-cheapest-${Date.now()}`;

    const res = await agent.processTurn(
      sessionId,
      'Em ơi phòng nào giá rẻ nhất ở cơ sở bên mình?'
    );

    expect(res.customer_visible_response).toContain('201 — La Casta');
    expect(res.customer_visible_response).toContain('180.000đ'); // 2h Saturday afternoon Deluxe/Standard
    // Should NOT force an expensive Concept room 601 upgrade when user only asked cheapest
    expect(res.customer_visible_response).not.toContain('849.000đ');
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // TEST SUITE 3: COMPOUND / MULTI-INTENT INQUIRY (ROOM PRICE + 7-SEAT PARKING)
  // =========================================================================
  it('V3.0-03: Successfully answers both room price and 7-seat car parking in one turn without swallowing either', async () => {
    const agent = new HadongAgent(dataset, { referenceClock: REF_SATURDAY });
    const sessionId = `test-v3-compound-${Date.now()}`;

    const res = await agent.processTurn(
      sessionId,
      'Phòng 601 giá bao nhiêu và khách sạn có chỗ đỗ ô tô 7 chỗ không em?'
    );

    // 1. Must answer room 601 pricing
    expect(res.customer_visible_response).toContain('50 — Sắc Thái');
    expect(res.customer_visible_response).toContain('449.000đ');

    // 2. Must answer parking information
    expect(res.customer_visible_response.toLowerCase()).toMatch(/đỗ|chỗ đỗ|ô tô|xe máy/);
    expect(res.internal_trace.tools_executed).toContain('quote_price');
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // TEST SUITE 4: CONSTRAINT RETRACTION (MIND CHANGE)
  // =========================================================================
  it('V3.0-04: Gracefully handles constraint retraction ("Thôi không cần bồn tắm nữa, tìm phòng rẻ nhất")', async () => {
    const agent = new HadongAgent(dataset, { referenceClock: REF_SATURDAY });
    const sessionId = `test-v3-retract-${Date.now()}`;

    // Turn 1: Requests bathtub room
    const res1 = await agent.processTurn(
      sessionId,
      'Tìm cho anh phòng lãng mạn có bồn tắm nhé'
    );
    expect(res1.customer_visible_response).toContain('bồn tắm');

    // Turn 2: Retracts bathtub and asks for cheapest room
    const res2 = await agent.processTurn(
      sessionId,
      'Thôi không cần bồn tắm nữa, tìm phòng giá rẻ nhất cho anh nhé'
    );

    // Must recommend room 201 La Casta, NOT room 101 or 601
    expect(res2.customer_visible_response).toContain('201 — La Casta');
    expect(agent.getSessionState(sessionId).hardConstraints.requiredAmenities).not.toContain('bon_tam');
    expect(res2.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // TEST SUITE 5: KEYWORD DISAMBIGUATION ("giúp anh" vs "ảnh phòng")
  // =========================================================================
  it('V3.0-05: Accurately distinguishes polite pronoun "giúp anh" from photo request "ảnh"', async () => {
    const agent = new HadongAgent(dataset, { referenceClock: REF_SATURDAY });
    const sessionId = `test-v3-pronoun-${Date.now()}`;

    const res = await agent.processTurn(
      sessionId,
      'Em có thể giúp anh xem phòng nào có không gian ấm cúng không?'
    );

    // Should NOT trigger image viewing workflow
    expect(agent.getSessionState(sessionId).currentActivity).not.toBe('VIEWING_PHOTOS');
    expect(res.images.length).toBe(0);
    expect(res.customer_visible_response).not.toContain('xem trước các hình ảnh thực tế');
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });

  // =========================================================================
  // TEST SUITE 6: STRICT TENANT ISOLATION ACROSS ALL 3 PROPERTIES
  // =========================================================================
  it('V3.0-06: Strict tenant isolation protects property boundaries without cross-contamination', async () => {
    const hadong = new HadongAgent(dataset);
    const trankhatchan = new TranKhatChanAgent(dataset);
    const jvillage = new JVillageAgent(dataset);

    // 1. Cross-facility inquiry on Hà Đông about Trần Khát Chân
    const resHD = await hadong.processTurn(
      'tenant-hd-1',
      'Bên Trần Khát Chân có phòng nào có bồn tắm đôi không em?'
    );
    expect(resHD.customer_visible_response).toContain('Jacayl Hotel Hà Đông');
    expect(resHD.customer_visible_response).toContain('Jacayl Hotel Trần Khát Chân');
    expect(resHD.updated_state.active_facility).toBe('jacayl-ha-dong');

    // 2. Inquiry on Trần Khát Chân stays within TKC inventory (24 rooms)
    const resTKC = await trankhatchan.processTurn(
      'tenant-tkc-1',
      'Anh muốn xem phòng Signature bên mình'
    );
    expect(resTKC.customer_visible_response).toContain('Trần Khát Chân');
    expect(resTKC.updated_state.active_facility).toBe('jacayl-tran-khat-chan');

    // 3. Inquiry on J Village stays within J Village inventory (24 rooms)
    const resJV = await jvillage.processTurn(
      'tenant-jv-1',
      'Cho anh xem phòng Suite có bồn tắm ở Triệu Việt Vương'
    );
    expect(resJV.customer_visible_response).toContain('J Village');
    expect(resJV.updated_state.active_facility).toBe('j-village');
  });

  // =========================================================================
  // TEST SUITE 7: TRANSPARENT DEGRADED MODE TELEMETRY
  // =========================================================================
  it('V3.0-07: In offline or degraded mode, reports truthful telemetry without faking live LLM', async () => {
    const agent = new HadongAgent(dataset);
    const res = await agent.processTurn('degraded-telemetry-test', 'Phòng 101 giá thế nào em?');

    expect(res.decision_trace.verificationStatus).toBeDefined();
    expect(res.decision_trace.llmTelemetry).toBeDefined();
    // When offline, fallbackState must report isFallback truthfully
    if (res.decision_trace.verificationStatus !== 'LIVE_LLM_DECISION_VERIFIED') {
      expect(res.decision_trace.llmTelemetry?.fallbackState?.isFallback).toBe(true);
    }
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });
});
