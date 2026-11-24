import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { PolicyQAEngine } from '../src/knowledge/policy-qa-engine.js';

describe('Milestone 3 - G2. Policy Q&A 20 Topics Verification', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const kb = new KnowledgeBase(dataset);
  const engine = new PolicyQAEngine(kb);

  // Topic 1: Giá nghỉ 2 giờ
  it('Topic 1: answers 2-hour base rental policy', () => {
    const res = engine.answer('Gói nghỉ giờ tính tối thiểu mấy tiếng?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('2 giờ đầu');
  });

  // Topic 2: Giá thuê 3 và 4 giờ
  it('Topic 2: answers overtime extra hours calculation basis', () => {
    const res = engine.answer('Nếu tôi thuê 3 hoặc 4 tiếng thì tính thế nào?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('phát sinh');
  });

  // Topic 3: Giá theo ngày thường / cuối tuần (Restored)
  it('Topic 3: answers weekday vs weekend pricing policy', () => {
    const res = engine.answer('Giá ngày thường và cuối tuần khác nhau thế nào em?');
    expect(res).not.toBeNull();
    expect(res?.topic).toBe('WEEKDAY_VS_WEEKEND');
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('Jacayl Hà Đông');
    expect(res?.answer_text).toContain('180.000đ');
  });

  // Topic 4: Giá theo check-in trước và sau 18h (Restored)
  it('Topic 4: answers 18:00 check-in time boundary and locked-in base price', () => {
    const res = engine.answer('Check in lúc 17:00 và 18:00 tính giá thế nào? Tại sao giá 17h không đổi khi nghỉ qua 18h?');
    expect(res).not.toBeNull();
    expect(res?.topic).toBe('DAYTIME_18H_BOUNDARY');
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('CHECKIN_TIMESTAMP');
    expect(res?.answer_text).toContain('giữ nguyên đơn giá ban ngày');
  });

  // Topic 5: Giá trước 08:00 đã xác nhận theo V1.4.3
  it('Topic 5: early morning before 08:00 confirmed as base dataset rates', () => {
    const res = engine.answer('Khách nhận phòng lúc 6h sáng trước 08h thì tính thế nào?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('giá gốc nghỉ giờ niêm yết');
  });

  // Topic 6: Giá ngày lễ đã xác nhận theo V1.4.3 (không phụ thu)
  it('Topic 6: public holiday pricing confirmed with no surcharge', () => {
    const res = engine.answer('Ngày Lễ 30/4 có phụ thu giá phòng không em?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('không có phụ thu ngày lễ');
  });

  // Topic 7: Gói qua đêm
  it('Topic 7: overnight stay hours 22:00 to 12:00 next day', () => {
    const res = engine.answer('Giờ nhận và trả phòng gói qua đêm là mấy giờ?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('22:00');
    expect(res?.answer_text).toContain('12:00 trưa hôm sau');
  });

  // Topic 8: Gói ngày đêm
  it('Topic 8: day-night stay hours 14:00 to 12:00 next day', () => {
    const res = engine.answer('Gói thuê theo ngày check in từ mấy giờ?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('14:00');
    expect(res?.answer_text).toContain('12:00 trưa hôm sau');
  });

  // Topic 9: Quy định quá giờ 10 phút
  it('Topic 9: grace period of 10 minutes then charges 1 hour', () => {
    const res = engine.answer('Quá giờ 10 phút thì khách sạn tính thế nào?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text.toLowerCase()).toContain('sau 10p bên em tính giờ tiếp theo');
  });

  // Topic 10: Khách yêu cầu tính phụ thu checkout thực tế
  it('Topic 10: refuses actual checkout calculation and directs to staff', () => {
    const res = engine.answer('Tôi đang ở lố 15 phút, tính tiền giúp tôi phải trả bao nhiêu lúc trả phòng?');
    expect(res).not.toBeNull();
    expect(res?.topic).toBe('CHECKOUT_BILLING_REQUEST');
    expect(res?.answer_text).toContain('lễ tân tại quầy');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 11: Chính sách thú cưng thiếu dữ liệu
  it('Topic 11: pet policy is UNKNOWN and directs to reception', () => {
    const res = engine.answer('Khách sạn có cho mang chó mèo vào phòng không?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('UNKNOWN');
    expect(res?.answer_text).toContain('chưa có quy định chính thức');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 12: Chính sách hút thuốc thiếu dữ liệu
  it('Topic 12: smoking policy is UNKNOWN and directs to reception', () => {
    const res = engine.answer('Trong phòng có được hút thuốc lá không em?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('UNKNOWN');
    expect(res?.answer_text).toContain('chưa có thông tin xác nhận chính thức');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 13: Phụ thu người thứ ba thiếu dữ liệu
  it('Topic 13: third person surcharge is UNKNOWN', () => {
    const res = engine.answer('Phòng ở 3 người lớn thì phụ thu thêm người thứ ba bao nhiêu?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('UNKNOWN');
    expect(res?.answer_text).toContain('tiêu chuẩn cho 2 người lớn');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 14: Đỗ xe có chỗ đỗ xe nhưng không tự bịa khoảng cách/phí
  it('Topic 14: parking exists strictly adhering to dataset without invented distances', () => {
    const res = engine.answer('Cơ sở có chỗ đỗ xe ô tô không và phí gửi xe bao nhiêu?');
    expect(res).not.toBeNull();
    expect(res?.answer_text).toBe('Dạ bên em có chỗ đỗ xe ạ.');
    expect(res?.answer_text).not.toContain('50m');
    expect(res?.answer_text).not.toContain('Văn Quán');
    expect(res?.answer_text).not.toContain('TT3-C19');
    expect(res?.answer_text).not.toContain('ngay trước cửa');
    expect(res?.answer_text).not.toContain('rộng rãi');
  });

  // Topic 15: Khách hỏi khuyến mãi không có chính sách
  it('Topic 15: voucher/discount policy disclaims automated vouchers', () => {
    const res = engine.answer('Cho tôi xin mã voucher giảm giá phòng với');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('UNKNOWN');
    expect(res?.answer_text).toContain('biểu phí niêm yết');
  });

  // Topic 16: Khách yêu cầu hoàn tiền
  it('Topic 16: cancellation & refund handled by human staff', () => {
    const res = engine.answer('Tôi muốn hủy phòng và hoàn tiền lại cọc');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('nhân viên lễ tân trực tiếp tiếp nhận');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 17: Khách hỏi phòng có máy chiếu
  it('Topic 17: projector amenity is UNCONFIRMED in dataset', () => {
    const res = engine.answer('Phòng nào có máy chiếu rạp phim vậy em?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('UNCONFIRMED');
    expect(res?.answer_text).toContain('chưa có thông tin xác nhận chính thức');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 18: Khách hỏi phòng có bồn tắm đôi
  it('Topic 18: double bathtub is UNCONFIRMED in dataset', () => {
    const res = engine.answer('Có phòng nào có bồn tắm đôi không em?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('UNCONFIRMED');
    expect(res?.answer_text).toContain('5 phòng có bồn tắm nằm');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 19: Khách hỏi tiện nghi không được website liệt kê (Bếp nấu)
  it('Topic 19: kitchen amenity is UNKNOWN', () => {
    const res = engine.answer('Phòng có bếp nấu ăn riêng không em?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('UNKNOWN');
    expect(res?.answer_text).toContain('chưa có thông tin xác nhận về trang bị bếp nấu');
    expect(res?.requires_staff_verification).toBe(true);
  });

  // Topic 20: Thông tin giờ giấc chung
  it('Topic 20: answers general checkin/checkout hours', () => {
    const res = engine.answer('Giờ check in và check out của khách sạn là lúc nào?');
    expect(res).not.toBeNull();
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('22:00');
    expect(res?.answer_text).toContain('14:00');
  });

  // Topic 21: Hỏi phòng trống thời gian thực (PMS chưa kết nối)
  it('Topic 21: transparently clarifies live room availability (PMS not connected)', () => {
    const res = engine.answer('Bên em hiện tại đang còn phòng trống không qua luôn?');
    expect(res).not.toBeNull();
    expect(res?.topic).toBe('LIVE_AVAILABILITY_INQUIRY');
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('chưa kết nối với phần mềm quản lý phòng (PMS)');
  });

  // Topic 22: Tên thương mại phòng 601 Hà Đông là "50 — Sắc Thái", không phải "Tổng Thống"
  it('Topic 22: clarifies room 601 Ha Dong is officially "50 — Sắc Thái", not "Tổng Thống"', () => {
    const res = engine.answer('Phòng 601 Hà Đông có phải phòng Tổng Thống không?');
    expect(res).not.toBeNull();
    expect(res?.topic).toBe('CANONICAL_ROOM_IDENTITY_601');
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('50 — Sắc Thái');
    expect(res?.answer_text).toContain('chứ không có tên "Tổng Thống"');
  });

  // Topic 23: Phòng 401 Hà Đông không sử dụng để kinh doanh
  it('Topic 23: clarifies room 401 Ha Dong is not for sale without inferring floor', () => {
    const res = engine.answer('Phòng 401 ở Hà Đông giá bao nhiêu?');
    expect(res).not.toBeNull();
    expect(res?.topic).toBe('NON_COMMERCIAL_ROOM_401_HA_DONG');
    expect(res?.verification_status).toBe('CONFIRMED');
    expect(res?.answer_text).toContain('không sử dụng để kinh doanh');
    expect(res?.answer_text).not.toContain('tầng 4');
  });
});
