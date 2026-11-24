import { describe, it, expect } from 'vitest';
import { NLUEngine } from '../src/conversation/nlu-engine.js';

describe('NLUEngine - Vietnamese Intent & Entity Extraction', () => {
  const nlu = new NLUEngine('2026-11-28T10:00:00+07:00');

  it('recognizes hourly search at Trần Khát Chân with datetime and amenities', () => {
    const text = 'anh cần tìm phòng ở cơ sở Trần Khát Chân vào chiều thứ Bảy tuần này khoảng 2h chiều, ở tầm 3 tiếng, có bồn tắm đôi và máy chiếu.';
    const result = nlu.parse(text);

    expect(result.intent).toBe('SEARCH_ROOM');
    expect(result.entities.facility).toBe('jacayl-tran-khat-chan');
    expect(result.entities.duration_hours).toBe(3);
    expect(result.entities.checkin_time).toBe('14:00');
    expect(result.entities.must_have_amenities).toContain('bồn tắm');
    expect(result.entities.must_have_amenities).toContain('máy chiếu');
  });

  it('recognizes budget-constrained overnight search at Hà Đông', () => {
    const text = 'ngân sách dưới 400k, muốn ở qua đêm thứ Sáu tại Hà Đông.';
    const result = nlu.parse(text);

    expect(result.intent).toBe('SEARCH_ROOM');
    expect(result.entities.facility).toBe('jacayl-ha-dong');
    expect(result.entities.budget).toBe(400000);
    expect(result.entities.stay_type).toBe('qua_dem');
  });

  it('handles abbreviations and text without diacritics', () => {
    const text = 'tim phong tkc chieu thu 7 tam 3h chieu co bon tam';
    const result = nlu.parse(text);

    expect(result.entities.facility).toBe('jacayl-tran-khat-chan');
    expect(result.entities.checkin_time).toBe('15:00');
    expect(result.entities.must_have_amenities).toContain('bồn tắm');
  });

  it('extracts constraint retractions properly', () => {
    const text = 'À thôi không cần ghế tình yêu nữa, nhưng cần phòng yên tĩnh và có ban công.';
    const result = nlu.parse(text);

    expect(result.intent).toBe('REMOVE_REQUIREMENT');
    expect(result.entities.removed_constraints).toContain('ghế tình yêu');
    expect(result.entities.must_have_amenities).toContain('ban công');
    expect(result.entities.must_have_amenities).not.toContain('ghế tình yêu');
  });

  it('detects booking intent without false positives', () => {
    const text = 'Tôi chốt phòng 201 này nhé, đặt cho tôi từ 14h đến 17h, tên tôi là Nguyễn Văn A, sđt 0901234567';
    const result = nlu.parse(text);

    expect(result.intent).toBe('BOOKING_INTENT');
    expect(result.entities.room_name).toContain('201');
  });

  it('detects in-stay service requests', () => {
    const text = 'Cho anh xin thêm 2 chai nước suối và 1 khăn tắm lên phòng 302 với.';
    const result = nlu.parse(text);

    expect(result.intent).toBe('IN_STAY_OPERATIONAL_REQUEST');
  });

  it('detects checkout disputes', () => {
    const text = 'Lễ tân tính tiền anh lố 15 phút mà bắt trả thêm 1 tiếng, sao vô lý thế em?';
    const result = nlu.parse(text);

    expect(result.intent).toBe('CHECKOUT_DISPUTE');
  });

  it('detects AI identity inquiries', () => {
    const text = 'Em là người thật hay robot đấy?';
    const result = nlu.parse(text);

    expect(result.intent).toBe('AI_IDENTITY_INQUIRY');
  });

  it('detects target references like "căn thứ hai" or "phòng rẻ hơn"', () => {
    const text1 = 'cho anh xem chi tiết căn thứ hai';
    const res1 = nlu.parse(text1);
    expect(res1.entities.target_reference).toBe('căn thứ hai');

    const text2 = 'giá phòng rẻ hơn là bao nhiêu?';
    const res2 = nlu.parse(text2);
    expect(res2.entities.target_reference).toBe('phòng rẻ hơn');
  });

  it('detects policy inquiries (overtime phụ thu, check-in time, parking)', () => {
    const text = 'Quá giờ 15 phút thì phụ thu tính thế nào em?';
    const result = nlu.parse(text);

    expect(result.intent).toBe('ASK_POLICY');
  });
});
