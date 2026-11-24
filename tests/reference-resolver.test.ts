import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { RoomReferenceResolver } from '../src/conversation/reference-resolver.js';
import { WorkingMemory } from '../src/conversation/conversation-types.js';

describe('Milestone 3 - A7. Dedicated RoomReferenceResolver Tests', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const resolver = new RoomReferenceResolver(dataset);

  const mockMemory: WorkingMemory = {
    session_id: 'test-session',
    active_facility: 'jacayl-tran-khat-chan',
    focused_room: { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '201-sapphire' },
    shortlisted_rooms: [
      {
        key: { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '201-sapphire' },
        name: '201 — Sapphire',
        category: 'Deluxe',
        price: 380000,
        bucket: 'EXACT',
      },
      {
        key: { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '301-ivory' },
        name: '301 — Ivory',
        category: 'Deluxe',
        price: 420000,
        bucket: 'EXACT',
      },
      {
        key: { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '1001-dem' },
        name: '1001 — Đêm',
        category: 'VIP Signature',
        price: 600000,
        bucket: 'PARTIAL',
      },
    ],
    stay_type: 'nghi_gio',
    checkin_datetime: null,
    duration_hours: null,
    max_budget: null,
    must_have_amenities: [],
    nice_to_have_amenities: [],
    negated_constraints: [],
    preferred_styles: [],
    recent_references: [],
    last_quote_context: null,
    conversation_lifecycle: 'CONSULTATION',
    ownership_state: 'AI_ACTIVE',
    pending_clarification: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    turn_count: 2,
  };

  it('resolves ordinal index references ("căn thứ hai", "căn đầu tiên")', () => {
    // "căn thứ hai" -> index 1 -> 301-ivory
    const res2 = resolver.resolve('cho anh xem chi tiết căn thứ hai', mockMemory);
    expect(res2?.resolution_type).toBe('ORDINAL');
    expect(res2?.matched_key?.ma_phong).toBe('301-ivory');

    // "căn đầu tiên" -> index 0 -> 201-sapphire
    const res1 = resolver.resolve('căn đầu tiên có những gì?', mockMemory);
    expect(res1?.resolution_type).toBe('ORDINAL');
    expect(res1?.matched_key?.ma_phong).toBe('201-sapphire');
  });

  it('resolves price comparison references ("phòng rẻ hơn", "phòng đắt hơn")', () => {
    // "phòng rẻ hơn" -> sorts shortlisted by price ascending -> 201-sapphire (380k)
    const resCheap = resolver.resolve('cho anh xem phòng rẻ hơn trong các phòng trên', mockMemory);
    expect(resCheap?.resolution_type).toBe('PRICE_COMPARISON');
    expect(resCheap?.matched_key?.ma_phong).toBe('201-sapphire');

    // "phòng đắt hơn" -> sorts shortlisted by price descending -> 1001-dem (600k)
    const resExpensive = resolver.resolve('phòng đắt hơn có bồn tắm không?', mockMemory);
    expect(resExpensive?.resolution_type).toBe('PRICE_COMPARISON');
    expect(resExpensive?.matched_key?.ma_phong).toBe('1001-dem');
  });

  it('resolves pronominal references ("phòng đó", "phòng nãy")', () => {
    const res = resolver.resolve('phòng đó giá bao nhiêu tiền vậy em?', mockMemory);
    expect(res?.resolution_type).toBe('PRONOMINAL');
    expect(res?.matched_key?.ma_phong).toBe('201-sapphire');
  });

  it('resolves explicit room number or code ("phòng 1001")', () => {
    const res = resolver.resolve('tôi muốn xem phòng 1001', mockMemory);
    expect(res?.matched_key?.ma_phong).toBe('1001-dem');
  });
});
