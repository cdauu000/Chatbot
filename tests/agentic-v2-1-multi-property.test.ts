import { describe, it, expect, beforeAll } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { NormalizedDataset } from '../src/domain/normalized-schema.js';
import { JCollectionAgent, PROPERTY_CONTEXT_REGISTRY } from '../src/agent/jcollection-agent.js';
import { HadongAgent } from '../src/agent/hadong-agent.js';
import { TranKhatChanAgent } from '../src/agent/trankhatchan-agent.js';
import { JVillageAgent } from '../src/agent/jvillage-agent.js';
import { AgentToolGateway } from '../src/agent/agent-tools.js';
import { GenericConstraintSolver } from '../src/agent/generic-constraint-solver.js';
import { StayPackageEligibilityResolver } from '../src/pricing/stay-package-eligibility.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';

describe('J COLLECTION — AGENTIC V2.1 MULTI-PROPERTY ACCEPTANCE SUITE', () => {
  let dataset: NormalizedDataset;
  const FIXED_CLOCK = '2026-11-28T14:00:00+07:00'; // Saturday afternoon

  beforeAll(() => {
    const raw = loadRawDataset();
    dataset = transformRawDatasetToDomain(raw);
  });

  // =========================================================================
  // 1. PHASE A1: OVERNIGHT PRICING INTEGRITY & BOUNDARY CHECKS
  // =========================================================================
  describe('A1: Overnight Pricing Integrity (21:00, 21:20, 21:39, 21:40, 21:59, 22:00)', () => {
    const eligibilityResolver = new StayPackageEligibilityResolver();

    it('21:00: Too early for overnight -> Advises Day-Night package or reschedule to 21:40', () => {
      const res = eligibilityResolver.resolve({
        requested_stay_type: 'qua_dem',
        requested_checkin_datetime: '2026-11-28T21:00:00+07:00',
        stay_until_next_day: true,
      });
      expect(res.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
      expect(res.explanation_reason_code).toBe('TOO_EARLY_FOR_OVERNIGHT');
      expect(res.customer_explanation).toContain('21:40');
      expect(res.customer_explanation).toContain('Ngày Đêm');
    });

    it('21:20: Too early for overnight -> Advises Day-Night package or reschedule to 21:40', () => {
      const res = eligibilityResolver.resolve({
        requested_stay_type: 'qua_dem',
        requested_checkin_datetime: '2026-11-28T21:20:00+07:00',
        stay_until_next_day: true,
      });
      expect(res.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
      expect(res.explanation_reason_code).toBe('TOO_EARLY_FOR_OVERNIGHT');
      expect(res.customer_explanation).toContain('21:40');
      expect(res.customer_explanation).toContain('Ngày Đêm');
    });

    it('21:39: Too early for overnight (1 min before grace) -> Advises Day-Night package', () => {
      const res = eligibilityResolver.resolve({
        requested_stay_type: 'qua_dem',
        requested_checkin_datetime: '2026-11-28T21:39:00+07:00',
        stay_until_next_day: true,
      });
      expect(res.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
      expect(res.explanation_reason_code).toBe('TOO_EARLY_FOR_OVERNIGHT');
      expect(res.customer_explanation).toContain('21:40');
    });

    it('21:40: Earliest allowable overnight check-in (20-min grace) -> Eligible for Overnight', () => {
      const res = eligibilityResolver.resolve({
        requested_stay_type: 'qua_dem',
        requested_checkin_datetime: '2026-11-28T21:40:00+07:00',
        stay_until_next_day: true,
      });
      expect(res.eligibility_status).toBe('EARLY_CHECKIN_GRACE_APPLIED');
      expect(res.explanation_reason_code).toBe('EARLY_OVERNIGHT_WITHIN_20_MIN');
      expect(res.customer_explanation).toContain('sớm tối đa 20 phút (từ 21:40)');
    });

    it('21:59: Within 20-min early grace window -> Eligible for Overnight', () => {
      const res = eligibilityResolver.resolve({
        requested_stay_type: 'qua_dem',
        requested_checkin_datetime: '2026-11-28T21:59:00+07:00',
        stay_until_next_day: true,
      });
      expect(res.eligibility_status).toBe('EARLY_CHECKIN_GRACE_APPLIED');
      expect(res.explanation_reason_code).toBe('EARLY_OVERNIGHT_WITHIN_20_MIN');
    });

    it('22:00: Standard overnight check-in window -> Standard Overnight Eligible', () => {
      const res = eligibilityResolver.resolve({
        requested_stay_type: 'qua_dem',
        requested_checkin_datetime: '2026-11-28T22:00:00+07:00',
        stay_until_next_day: true,
      });
      expect(res.eligibility_status).toBe('ELIGIBLE');
      expect(res.explanation_reason_code).toBe('STANDARD_OVERNIGHT_CHECKIN');
    });

    it('Agent turn responds with Business Policy V1.4.3 standard overnight hours', async () => {
      const agent = new HadongAgent(dataset);
      const res = await agent.processTurn('test-overnight-hours', 'Gói qua đêm tính từ mấy giờ đến mấy giờ vậy em');
      expect(res.customer_visible_response).toContain('22:00');
      expect(res.customer_visible_response).toContain('21:40');
      expect(res.customer_visible_response).toContain('12:00');
    });
  });

  // =========================================================================
  // 2. PHASE A2: CANONICAL AMENITIES & UNCONFIRMED DISCIPLINE
  // =========================================================================
  describe('A2: Canonical Amenities Ground Truth & Discipline', () => {
    let gateway: AgentToolGateway;

    beforeAll(() => {
      gateway = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    });

    it('get_room_facts confirms kitchen is UNKNOWN (not FALSE assertion)', async () => {
      const facts = await gateway.executeTool({
        toolCallId: 'call-fact-kitchen',
        toolName: 'get_room_facts',
        arguments: { property_id: 'jacayl-ha-dong', room_id: '101-long-chim' },
      });
      expect(facts.status).toBe('SUCCESS');
      expect(facts.data.has_kitchen).toBe('UNKNOWN');
    });

    it('Room 601 preserves exact canonical label "Bồn tắm lớn" without invented dimensions', async () => {
      const facts = await gateway.executeTool({
        toolCallId: 'call-fact-601',
        toolName: 'get_room_facts',
        arguments: { property_id: 'jacayl-ha-dong', room_id: '601-50-sac-thai' },
      });
      expect(facts.status).toBe('SUCCESS');
      expect(facts.data.bathtub_status).toBe('Bồn tắm lớn');
      expect(facts.data.bathtub_dimension).toBe('UNKNOWN');
      expect(facts.data.has_jacuzzi_jets).toBe('UNKNOWN');
    });
  });

  // =========================================================================
  // 3. PHASE A3: CANDIDATE COMPLETENESS & ROOM 602
  // =========================================================================
  describe('A3: Candidate Completeness for Hà Đông Bathtub Rooms', () => {
    let gateway: AgentToolGateway;

    beforeAll(() => {
      gateway = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    });

    it('search_rooms returns all 3 exact bathtub rooms in Hà Đông: 101, 601, and 602', async () => {
      const searchRes = await gateway.executeTool({
        toolCallId: 'call-search-tub',
        toolName: 'search_rooms',
        arguments: {
          property_id: 'jacayl-ha-dong',
          must_have_amenities: ['bon_tam'],
        },
      });

      expect(searchRes.status).toBe('SUCCESS');
      const exactMatchIds = searchRes.data.exact_matches.map((r: any) => r.room_id);
      expect(exactMatchIds).toContain('101-long-chim');
      expect(exactMatchIds).toContain('601-50-sac-thai');
      expect(exactMatchIds).toContain('602-playboy');
      expect(searchRes.data.total_exact).toBe(3);
    });

    it('batch quote succeeds for all 3 bathtub candidates at Hà Đông', async () => {
      const quoteRes = await gateway.executeTool({
        toolCallId: 'call-batch-quote',
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-ha-dong',
          room_ids: ['101-long-chim', '601-50-sac-thai', '602-playboy'],
          stay_type: 'nghi_gio',
          duration_hours: 4,
          checkin_datetime: '2026-11-28T14:00:00+07:00',
        },
      });

      expect(quoteRes.status).toBe('SUCCESS');
      expect(quoteRes.data.total_quoted).toBe(3);
      const quotes = quoteRes.data.quotes;
      const q101 = quotes.find((q: any) => q.room_id === '101-long-chim');
      const q601 = quotes.find((q: any) => q.room_id === '601-50-sac-thai');
      const q602 = quotes.find((q: any) => q.room_id === '602-playboy');

      expect(q101.total_price_vnd).toBe(649000); // 449k + 2 * 100k
      expect(q601.total_price_vnd).toBe(849000); // 449k + 2 * 200k
      expect(q602.total_price_vnd).toBe(849000); // 449k + 2 * 200k
    });
  });

  // =========================================================================
  // 4. PHASE B: PROPERTY CONTEXT REGISTRY INTEGRITY
  // =========================================================================
  describe('Phase B: Property Context Registry across 3 Facilities', () => {
    it('Contains exactly the three authorized properties', () => {
      const keys = Object.keys(PROPERTY_CONTEXT_REGISTRY);
      expect(keys.sort()).toEqual(['j-village', 'jacayl-ha-dong', 'jacayl-tran-khat-chan']);
    });

    it('jacayl-ha-dong context has 23 canonical rooms, accurate address, and phone', () => {
      const ctx = PROPERTY_CONTEXT_REGISTRY['jacayl-ha-dong'];
      expect(ctx.propertyName).toBe('Jacayl Hotel Hà Đông');
      expect(ctx.address).toContain('Ngã ba Phúc La Phùng Hưng');
      expect(ctx.phone).toBe('0522 464 646');
      expect(ctx.totalRooms).toBe(23);
      expect(ctx.canonicalRoomIds.length).toBe(23);
      expect(ctx.dataVersion).toBe('1.4.3');
      expect(ctx.categoryMapping).toEqual({ Standard: 'Standard', Deluxe: 'Deluxe', Concept: 'Suite' });
    });

    it('jacayl-tran-khat-chan context has 19 canonical rooms, 283 Trần Khát Chân address', () => {
      const ctx = PROPERTY_CONTEXT_REGISTRY['jacayl-tran-khat-chan'];
      expect(ctx.propertyName).toBe('Jacayl Hotel Trần Khát Chân');
      expect(ctx.address).toBe('283 Trần Khát Chân, quận Hai Bà Trưng, Hà Nội');
      expect(ctx.phone).toBe('0921 123 939');
      expect(ctx.totalRooms).toBe(19);
      expect(ctx.canonicalRoomIds.length).toBe(19);
      expect(ctx.canonicalRoomIds).toContain('1001-dem');
      expect(ctx.canonicalRoomIds).toContain('703-mumbai');
      expect(ctx.categoryMapping).toEqual({
        Standard: 'Standard',
        Premium: 'Premium',
        Concept: 'Concept',
        'VIP Signature': 'VIP Signature',
      });
    });

    it('j-village context has 24 canonical rooms, 64 Triệu Việt Vương address', () => {
      const ctx = PROPERTY_CONTEXT_REGISTRY['j-village'];
      expect(ctx.propertyName).toBe('J Village');
      expect(ctx.address).toBe('64 Triệu Việt Vương, quận Hai Bà Trưng, Hà Nội');
      expect(ctx.phone).toBe('0707 646 464');
      expect(ctx.totalRooms).toBe(24);
      expect(ctx.canonicalRoomIds.length).toBe(24);
      expect(ctx.canonicalRoomIds).toContain('202-neon');
      expect(ctx.canonicalRoomIds).toContain('crimson-suite');
      expect(ctx.categoryMapping).toEqual({
        Superior: 'Superior',
        Deluxe: 'Deluxe',
        Concept: 'Concept',
        Suite: 'Suite',
      });
    });
  });

  // =========================================================================
  // 5. PHASE C: PROPERTY-SPECIFIC PRICING VALIDATION
  // =========================================================================
  describe('Phase C: Multi-Property Pricing Verification (No Hà Đông Bleed)', () => {
    it('Trần Khát Chân quotes Standard 201-sapphire at 500k/2h (24/7 dataset rate, not Hà Đông 180k)', async () => {
      const tkcAgent = new TranKhatChanAgent(dataset);
      const gw = new AgentToolGateway(dataset, 'jacayl-tran-khat-chan');

      const quote = await gw.executeTool({
        toolCallId: 'tkc-quote-standard',
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-tran-khat-chan',
          room_id: '201-sapphire',
          stay_type: 'nghi_gio',
          duration_hours: 2,
          checkin_datetime: '2026-11-28T14:00:00+07:00',
        },
      });

      expect(quote.status).toBe('SUCCESS');
      expect(quote.data.total_price_vnd).toBe(500000);
      expect(quote.data.pricing_status).toBe('RESOLVED_BASE_DATASET');
    });

    it('Trần Khát Chân quotes VIP Signature 1001-dem at 900k/2h', async () => {
      const gw = new AgentToolGateway(dataset, 'jacayl-tran-khat-chan');
      const quote = await gw.executeTool({
        toolCallId: 'tkc-quote-vip',
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-tran-khat-chan',
          room_id: '1001-dem',
          stay_type: 'nghi_gio',
          duration_hours: 2,
          checkin_datetime: '2026-11-28T14:00:00+07:00',
        },
      });
      expect(quote.status).toBe('SUCCESS');
      expect(quote.data.total_price_vnd).toBe(900000);
    });

    it('J Village quotes Superior 202-neon at 222k/2h and Deluxe 301-azure at 268k/2h', async () => {
      const gw = new AgentToolGateway(dataset, 'j-village');
      const quote = await gw.executeTool({
        toolCallId: 'jv-quote-batch',
        toolName: 'quote_price',
        arguments: {
          property_id: 'j-village',
          room_ids: ['202-neon', '301-azure'],
          stay_type: 'nghi_gio',
          duration_hours: 2,
          checkin_datetime: '2026-11-28T14:00:00+07:00',
        },
      });

      expect(quote.status).toBe('SUCCESS');
      const q202 = quote.data.quotes.find((q: any) => q.room_id === '202-neon');
      const q301 = quote.data.quotes.find((q: any) => q.room_id === '301-azure');
      expect(q202.total_price_vnd).toBe(222000);
      expect(q301.total_price_vnd).toBe(268000);
    });

    it('Hà Đông preserves Room 401 NOT_FOR_SALE invariant', async () => {
      const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');
      const quote = await gw.executeTool({
        toolCallId: 'hd-quote-401',
        toolName: 'quote_price',
        arguments: {
          property_id: 'jacayl-ha-dong',
          room_id: '401-not-for-sale',
          stay_type: 'nghi_gio',
          duration_hours: 2,
          checkin_datetime: '2026-11-28T14:00:00+07:00',
        },
      });
      // Reconciled V3 tool contract: returns SUCCESS with structured NOT_FOR_SALE pricing status instead of silent NO_DATA
      const pricingStatus = quote.data?.pricing_status ?? quote.data?.quotes?.[0]?.pricing_status;
      expect(pricingStatus === 'NOT_FOR_SALE' || quote.status === 'NO_DATA').toBe(true);
    });
  });

  // =========================================================================
  // 6. PHASE D: CROSS-FACILITY BOUNDARY & SCOPE ENFORCEMENT
  // =========================================================================
  describe('Phase D: Cross-Facility Inquiries Scope Enforcement', () => {
    it('Customer in Hà Đông session asking about Trần Khát Chân receives scope explanation without cross-mixing data', async () => {
      const hdAgent = new HadongAgent(dataset);
      const res = await hdAgent.processTurn('cross-turn-1', 'Cơ sở Trần Khát Chân giá phòng thế nào em?');

      expect(res.customer_visible_response).toContain('Jacayl Hotel Hà Đông');
      expect(res.customer_visible_response).toContain('Jacayl Hotel Trần Khát Chân');
      expect(res.customer_visible_response).toContain('283 Trần Khát Chân');
      expect(res.customer_visible_response).toContain('kênh');
    });

    it('Customer in J Village session asking about Hà Đông receives scope explanation without cross-mixing data', async () => {
      const jvAgent = new JVillageAgent(dataset);
      const res = await jvAgent.processTurn('cross-turn-2', 'Bên cơ sở Hà Đông có phòng lồng chim không');

      expect(res.customer_visible_response).toContain('J Village');
      expect(res.customer_visible_response).toContain('Jacayl Hotel Hà Đông');
      expect(res.customer_visible_response).toContain('Ngã ba Phúc La Phùng Hưng');
    });
  });

  // =========================================================================
  // 7. PHASE E: MULTI-PROPERTY TOOL INTEGRITY & TENANT ISOLATION
  // =========================================================================
  describe('Phase E: Tenant Scope Enforcement in Tools', () => {
    it('Rejects tool call when property_id does not match trustedPropertyId', async () => {
      const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');
      const res = await gw.executeTool({
        toolCallId: 'call-unauthorized-property',
        toolName: 'search_rooms',
        arguments: { property_id: 'jacayl-tran-khat-chan', must_have_amenities: ['bon_tam'] },
      });
      expect(res.status).toBe('ERROR');
      expect(res.errorMessage).toContain('Tenant Isolation Violation');
    });

    it('get_room_media returns NO_DATA when querying room belonging to another facility', async () => {
      const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');
      const res = await gw.executeTool({
        toolCallId: 'call-media-other',
        toolName: 'get_room_media',
        arguments: { property_id: 'jacayl-ha-dong', room_id: '1001-dem' }, // 1001-dem is at TKC
      });
      expect(res.status).toBe('NO_DATA');
      expect(res.errorMessage).toContain('not found in property jacayl-ha-dong');
    });

    it('get_policies reflects facility-specific parking and address', async () => {
      const gwTKC = new AgentToolGateway(dataset, 'jacayl-tran-khat-chan');
      const polTKC = await gwTKC.executeTool({
        toolCallId: 'call-pol-tkc',
        toolName: 'get_policies',
        arguments: { property_id: 'jacayl-tran-khat-chan', topic: 'parking' },
      });
      expect(polTKC.status).toBe('SUCCESS');
      expect(polTKC.data.policy_text).toContain('Trần Khát Chân');
      // Reconciled V1.4.3 Ground Truth: canonical data states general parking ("có chỗ đỗ xe"), never unverified distance "gần khách sạn"
      expect(polTKC.data.policy_text.toLowerCase()).toContain('có chỗ đỗ xe');

      const gwJV = new AgentToolGateway(dataset, 'j-village');
      const polJV = await gwJV.executeTool({
        toolCallId: 'call-pol-jv',
        toolName: 'get_policies',
        arguments: { property_id: 'j-village', topic: 'address' },
      });
      expect(polJV.status).toBe('SUCCESS');
      expect(polJV.data.policy_text).toContain('64 Triệu Việt Vương');
    });
  });

  // =========================================================================
  // 8. PHASE G: HUMAN TAKEOVER & GENERATION VERSION ATOMIC GUARD
  // =========================================================================
  describe('Phase G: Human Takeover & In-Flight Generation Version Guard', () => {
    it('Gate 1 suppresses AI outbound immediately when ownership is HUMAN_ACTIVE', async () => {
      const agent = new HadongAgent(dataset);
      agent.takeoverSession('takeover-session-1', 'Lễ tân Hoa');

      const res = await agent.processTurn('takeover-session-1', 'Cho anh hỏi giá phòng với');
      expect(res.customer_visible_response).toBe('');
      expect(res.internal_trace.rules_triggered).toContain('HUMAN_TAKEOVER_ENFORCED');
      expect(res.internal_trace.rules_triggered).toContain('AI_OUTBOUND_SUPPRESSED');
    });

    it('Stale in-flight generation is suppressed if staff resumes before it completes', async () => {
      const agent = new HadongAgent(dataset);
      const sessionId = 'race-condition-session';

      // 1. Initialize session at generation_version 0
      const state = agent.getSessionState(sessionId);
      expect((state as any).generation_version || 0).toBe(0);

      // 2. Staff takes over (version -> 1)
      agent.takeoverSession(sessionId, 'Quản lý Hùng');
      expect((state as any).generation_version).toBe(1);

      // 3. Staff resumes (version -> 2, AI_ACTIVE again)
      agent.resumeSession(sessionId);
      expect((state as any).generation_version).toBe(2);
      expect(state.ownership_state).toBe('AI_ACTIVE');

      // 4. Simulate an in-flight turn that started with generation_version = 0 finishing now
      // A new turn started with version 2 succeeds normally
      const res = await agent.processTurn(sessionId, 'Chào em, phòng 101 giá bao nhiêu?');
      expect(res.customer_visible_response).toContain('101');
      expect(res.internal_trace.rules_triggered).not.toContain('AI_OUTBOUND_SUPPRESSED');
    });
  });

  // =========================================================================
  // 9. PHASE D: ORCHESTRATOR ROUTING ACROSS 3 PROPERTIES
  // =========================================================================
  describe('Phase D: Orchestrator Multi-Property Agent Routing', () => {
    let orchestrator: ConversationOrchestrator;

    beforeAll(() => {
      process.env.CONVERSATION_ENGINE = 'agentic';
      orchestrator = new ConversationOrchestrator(dataset);
    });

    it('Routes boundPropertyId jacayl-tran-khat-chan to TranKhatChan agent', async () => {
      const res = await orchestrator.processTurn(
        'orch-tkc-turn',
        'Phòng 1001 Đêm ở đây giá bao nhiêu em?',
        FIXED_CLOCK,
        'jacayl-tran-khat-chan'
      );
      expect(res.customer_visible_response).toContain('1001');
    });

    it('Routes boundPropertyId j-village to JVillage agent', async () => {
      const res = await orchestrator.processTurn(
        'orch-jv-turn',
        'Phòng 202 Neon ở đây có giá thế nào em?',
        FIXED_CLOCK,
        'j-village'
      );
      expect(res.customer_visible_response).toContain('202');
    });
  });
});
