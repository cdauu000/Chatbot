import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { loadOwnerPolicyAddendums, getV144PolicyAddendumPath } from '../src/data-loader/pricing-policy-loader.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { AgentToolGateway } from '../src/agent/agent-tools.js';
import { getVietnamTemporalContext } from '../src/pricing/checkin-pricing-resolver.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';

describe('V3.0 FINAL — Breakfast Addendum, Temporal Intelligence & Room Media Grouping', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);

  it('loads Owner Breakfast Policy addendum without altering V1.4.3 room rates', async () => {
    const addendum = loadOwnerPolicyAddendums();
    expect(addendum).not.toBeNull();
    expect(addendum!.source_metadata.source_type).toBe('OWNER_DIRECT_INSTRUCTION');
    expect(addendum!.breakfast?.included_in_room_rate).toBe(false);
    expect(addendum!.breakfast?.scope).toBe('ALL_PROPERTIES');
    expect(addendum!.breakfast?.applies_to).toEqual(['nghi_gio', 'qua_dem', 'ngay_dem']);
    // Under V1.4.5, Owner confirmed breakfast service is officially FALSE (superseding V1.4.4 UNKNOWN)
    expect(addendum!.breakfast?.separate_service_availability).toBe('FALSE');
    expect(addendum!.breakfast?.service_available).toBe(false);

    // Historical V1.4.4 archive remains auditable explicitly by path
    const v144 = loadOwnerPolicyAddendums(getV144PolicyAddendumPath());
    expect(v144?.breakfast?.separate_service_availability).toBe('UNKNOWN');

    const kb = new KnowledgeBase(dataset);
    const kbItem = kb.getById('POLICY_BREAKFAST');
    expect(kbItem).toBeDefined();
    expect(kbItem!.verification_status).toBe('CONFIRMED');

    for (const prop of ['jacayl-ha-dong', 'jacayl-tran-khat-chan', 'j-village'] as const) {
      const gw = new AgentToolGateway(dataset, prop);
      const res = await gw.executeTool({ toolCallId: 'b1', toolName: 'get_policies', arguments: { property_id: prop, topic: 'breakfast' } });
      expect(res.status).toBe('SUCCESS');
      expect(res.data.structured).toMatchObject({
        included_in_room_rate: false,
        service_available: false,
        separate_service_availability: 'FALSE',
      });
    }
  });

  it('validates breakfast claims properly under V1.4.5 (verifies not-served, rejects free-breakfast or service-available hallucinations)', () => {
    const validator = new ClaimLevelValidator(dataset);
    const ok = validator.validate('Dạ bên em không phục vụ bữa sáng và giá phòng chưa bao gồm bữa sáng ạ.', { facility: 'jacayl-ha-dong' });
    expect(ok.rejected_claims).toEqual([]);
    expect(ok.verified_claims.some((c) => c.includes('VERIFIED_BREAKFAST_NOT_SERVED'))).toBe(true);

    const badIncluded = validator.validate('Phòng đã bao gồm bữa sáng miễn phí cho 2 người.', { facility: 'jacayl-ha-dong' });
    expect(badIncluded.rejected_claims.some((c) => c.includes('REJECTED_BREAKFAST_INCLUDED_CLAIM'))).toBe(true);

    const badServed = validator.validate('Khách sạn có phục vụ bữa sáng từ 7h đến 9h ạ.', { facility: 'jacayl-ha-dong' });
    expect(badServed.rejected_claims.some((c) => c.includes('REJECTED_BREAKFAST_SERVICE_AVAILABLE_CLAIM'))).toBe(true);
  });

  it('formats trusted server temporal context in Asia/Ho_Chi_Minh without hardcoded test clock', () => {
    const ctx = getVietnamTemporalContext('2026-11-25T10:22:00.000Z'); // 17:22 ICT Wednesday
    expect(ctx.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(ctx.localDate).toBe('2026-11-25');
    expect(ctx.localTime).toBe('17:22');
    expect(ctx.dayOfWeekIso).toBe(3);
    expect(ctx.dayOfWeekVi).toBe('Thứ Tư');
    expect(ctx.isWeekend).toBe(false);
  });

  it('evaluates StayPackageEligibility inside quote_price for room 405 (19:00 -> ngay_dem 520k, 21:40 -> qua_dem 420k, 07:00 -> clarification)', async () => {
    const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');

    // 19:00 + qua_dem -> ALTERNATIVE_PACKAGE_RECOMMENDED => ngay_dem 520.000đ
    const q19 = await gw.executeTool({
      toolCallId: 'q19',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '405-1st-time',
        stay_type: 'qua_dem',
        stay_intent: 'overnight_until_next_day',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T19:00:00+07:00',
        checkin_confidence: 'INFERRED',
      },
    });
    expect(q19.status).toBe('SUCCESS');
    expect(q19.data.stay_type).toBe('ngay_dem');
    expect(q19.data.total_price_vnd).toBe(520000);
    expect(q19.data.stay_package_eligibility.eligibility_status).toBe('ALTERNATIVE_PACKAGE_RECOMMENDED');
    expect(q19.data.stay_package_eligibility.requested_package).toBe('qua_dem');
    expect(q19.data.stay_package_eligibility.recommended_package).toBe('ngay_dem');
    expect(q19.data.stay_package_eligibility.ineligible_packages[0].alternative_if_delayed_to_21_40_vnd).toBe(420000);

    // 21:40 + qua_dem -> EARLY_CHECKIN_GRACE_APPLIED => qua_dem 420.000đ
    const q2140 = await gw.executeTool({
      toolCallId: 'q2140',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '405-1st-time',
        stay_type: 'qua_dem',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T21:40:00+07:00',
      },
    });
    expect(q2140.data.stay_type).toBe('qua_dem');
    expect(q2140.data.total_price_vnd).toBe(420000);
    expect(q2140.data.stay_package_eligibility.eligibility_status).toBe('EARLY_CHECKIN_GRACE_APPLIED');

    // 07:00 + qua_dem -> NEEDS_POLICY_CLARIFICATION (never blindly returns 420k overnight!)
    const q07 = await gw.executeTool({
      toolCallId: 'q07',
      toolName: 'quote_price',
      arguments: {
        property_id: 'jacayl-ha-dong',
        room_id: '405-1st-time',
        stay_type: 'qua_dem',
        duration_hours: 1,
        checkin_datetime: '2026-11-25T07:00:00+07:00',
      },
    });
    expect(q07.data.pricing_status).toBe('NEEDS_POLICY_CLARIFICATION');
    expect(q07.data.total_price_vnd).toBeNull();
    expect(q07.data.stay_package_eligibility.ineligible_packages[0].stay_type).toBe('qua_dem');
  });

  it('returns per-room structured media metadata (501=4, 505=3, 405=3) and persists cleanly in SQLite', async () => {
    const gw = new AgentToolGateway(dataset, 'jacayl-ha-dong');
    const m501 = await gw.executeTool({ toolCallId: 'm1', toolName: 'get_room_media', arguments: { property_id: 'jacayl-ha-dong', room_id: '501-hentai-room' } });
    const m505 = await gw.executeTool({ toolCallId: 'm2', toolName: 'get_room_media', arguments: { property_id: 'jacayl-ha-dong', room_id: '505-koi-room' } });
    const m405 = await gw.executeTool({ toolCallId: 'm3', toolName: 'get_room_media', arguments: { property_id: 'jacayl-ha-dong', room_id: '405-1st-time' } });

    expect(m501.data.images.length).toBe(4);
    expect(m505.data.images.length).toBe(3);
    expect(m405.data.images.length).toBe(3);
    expect(m501.data.images[0].caption).toContain('501');
    expect(m505.data.images[1].caption).toContain('505');
    expect(m405.data.images[2].caption).toContain('405');

    const store = new SqliteStore({ dbPath: ':memory:' });
    store.createConversation({ id: 'c_media', propertyId: 'jacayl-ha-dong', customerName: 'Test' });
    store.addMessage({
      conversationId: 'c_media',
      senderType: 'ai',
      content: 'Gửi anh ảnh 3 phòng',
      metadata: {
        roomPresentations: [
          { propertyId: 'jacayl-ha-dong', roomId: m501.data.room_id, roomCode: m501.data.room_code, roomName: m501.data.room_name, displayOrder: 0, images: m501.data.images },
          { propertyId: 'jacayl-ha-dong', roomId: m505.data.room_id, roomCode: m505.data.room_code, roomName: m505.data.room_name, displayOrder: 1, images: m505.data.images },
          { propertyId: 'jacayl-ha-dong', roomId: m405.data.room_id, roomCode: m405.data.room_code, roomName: m405.data.room_name, displayOrder: 2, images: m405.data.images },
        ],
      },
    });
    const loaded = store.getMessagesByConversationId('c_media', 10);
    expect(loaded[0].metadata?.roomPresentations?.length).toBe(3);
    expect(loaded[0].metadata?.roomPresentations?.[0].images.length).toBe(4);
    expect(loaded[0].metadata?.roomPresentations?.[1].images.length).toBe(3);
    expect(loaded[0].metadata?.roomPresentations?.[2].images.length).toBe(3);
    store.close();
  });
});
