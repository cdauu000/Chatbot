import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { AdvisoryComposer } from '../src/conversation/advisory-composer.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { PolicyQAEngine } from '../src/knowledge/policy-qa-engine.js';
import { ClaimLevelValidator } from '../src/conversation/grounding/claim-validator.js';
import { isRoomNotForSale } from '../src/domain/room-business-registry.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';

describe('J Collection — M3.5.1 Final Ground Truth Hardening Integration Tests', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday morning
  const composer = new AdvisoryComposer({}, dataset);
  const kb = new KnowledgeBase(dataset);
  const policyEngine = new PolicyQAEngine(kb);
  const validator = new ClaimLevelValidator(dataset);

  // 1. Đúng địa chỉ cả ba cơ sở lấy nguyên từ canonical dataset
  it('Requirement 1: strictly uses canonical dataset address for all three facilities', () => {
    const jv = composer.getFacilityInfo('j-village');
    expect(jv.address).toBe('64 Triệu Việt Vương');

    const tkc = composer.getFacilityInfo('jacayl-tran-khat-chan');
    expect(tkc.address).toBe('283 Trần Khát Chân');

    const hd = composer.getFacilityInfo('jacayl-ha-dong');
    expect(hd.address).toBe('Ngã ba Phúc La Phùng Hưng');
  });

  // 2. Không xuất hiện địa chỉ không được phê duyệt (TT3-C19, Văn Quán)
  it('Requirement 2: unapproved addresses (TT3-C19, Văn Quán) never appear in responses', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const res = await orchestrator.processTurn('gt-test-addr', 'Tư vấn phòng tại cơ sở Hà Đông', FIXED_CLOCK);

    expect(res.customer_visible_response).toContain('Ngã ba Phúc La Phùng Hưng');
    expect(res.customer_visible_response).not.toContain('Biệt thự TT3-C19');
    expect(res.customer_visible_response).not.toContain('Văn Quán');

    // ClaimLevelValidator rejects ungrounded address
    const badCheck = validator.validate('Cơ sở Hà Đông tại Biệt thự TT3-C19 KĐT Văn Quán rất đẹp', {
      facility: 'jacayl-ha-dong',
    });
    expect(badCheck.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_ADDRESS'))).toBe(true);

    const goodCheck = validator.validate('Cơ sở Jacayl Hà Đông tại Ngã ba Phúc La Phùng Hưng', {
      facility: 'jacayl-ha-dong',
    });
    expect(goodCheck.verified_claims.some((c) => c.includes('VERIFIED_CANONICAL_FACILITY_ADDRESS'))).toBe(true);
    expect(goodCheck.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_ADDRESS'))).toBe(false);
  });

  // 3. Knowledge Base không mất topic cũ (Khôi phục WEEKDAY_VS_WEEKEND & DAYTIME_18H_BOUNDARY)
  it('Requirement 3: Knowledge Base retains all original topics including restored 3 & 4', () => {
    // Topic 3: WEEKDAY_VS_WEEKEND
    const weekendRes = policyEngine.answer('Giá ngày thường và cuối tuần có khác nhau không?');
    expect(weekendRes).not.toBeNull();
    expect(weekendRes?.topic).toBe('WEEKDAY_VS_WEEKEND');
    expect(weekendRes?.verification_status).toBe('CONFIRMED');
    expect(weekendRes?.answer_text).toContain('180.000đ');

    // Topic 4: DAYTIME_18H_BOUNDARY
    const boundaryRes = policyEngine.answer('Check in lúc 17h và 18h tính giá thế nào? Tại sao giá 17h không đổi khi ở qua 18h?');
    expect(boundaryRes).not.toBeNull();
    expect(boundaryRes?.topic).toBe('DAYTIME_18H_BOUNDARY');
    expect(boundaryRes?.verification_status).toBe('CONFIRMED');
    expect(boundaryRes?.answer_text).toContain('KEEP_CHECKIN_BASE_PRICE');
  });

  // 4. Không tự tạo khoảng cách bãi đỗ xe hoặc phí gửi xe
  it('Requirement 4: Parking policy strictly reflects dataset "Có chỗ đỗ xe" without invented distance', () => {
    const parkingRes = policyEngine.answer('Khách sạn có chỗ đỗ ô tô không?');
    expect(parkingRes).not.toBeNull();
    expect(parkingRes?.topic).toBe('PARKING_POLICY');
    expect(parkingRes?.answer_text).toBe('Dạ bên em có chỗ đỗ xe ạ.');
    expect(parkingRes?.answer_text).not.toContain('50m');
    expect(parkingRes?.answer_text).not.toContain('Văn Quán');
    expect(parkingRes?.answer_text).not.toContain('TT3-C19');
    expect(parkingRes?.answer_text).not.toContain('ngay trước cửa');
    expect(parkingRes?.answer_text).not.toContain('rộng rãi');

    // Validator rejects invented parking distance, location or fee
    const badParking1 = validator.validate('Bãi gửi xe ô tô cách khách sạn khoảng 50m nhé anh/chị', {});
    expect(badParking1.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_PARKING_DISTANCE'))).toBe(true);

    const badParking2 = validator.validate('Bên em có bãi đỗ ô tô rộng rãi ngay trước cửa cơ sở ạ', {});
    expect(badParking2.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_PARKING_DISTANCE'))).toBe(true);
  });

  // 5. Không suy luận tầng từ mã phòng khi tang_theo_website là null
  it('Requirement 5: Does not infer floor from room code when tang_theo_website is null', () => {
    const room402 = dataset.phong.find((p) => p.co_so_ma === 'jacayl-ha-dong' && p.ma_phong === '402-whisky');
    expect(room402?.tang.status).toBe('UNKNOWN');
    expect((room402?.tang as any).value).toBeUndefined();

    // Policy answer for 401 must not claim "các phòng tầng 4 khác"
    const policy401 = policyEngine.answer('Phòng 401 Hà Đông có bán không em?');
    expect(policy401?.answer_text).not.toContain('tầng 4');
    expect(policy401?.answer_text).toContain('các phòng khác như 402 — Whisky');

    // Validator rejects asserting floor for 40x Ha Dong
    const badFloor = validator.validate('Anh/chị có thể chọn các phòng tầng 4 khác tại Hà Đông', {
      facility: 'jacayl-ha-dong',
    });
    expect(badFloor.rejected_claims.some((c) => c.includes('REJECTED_UNCONFIRMED_FLOOR_ASSERTION'))).toBe(true);
  });

  // 6. Tên phòng 601 đúng "50 — Sắc Thái", không dùng Tổng Thống hay 50 Shades
  it('Requirement 6: Room 601 is strictly "50 — Sắc Thái"', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const res = await orchestrator.processTurn('gt-test-601', 'Xem chi tiết phòng 601 Hà Đông', FIXED_CLOCK);
    expect(res.customer_visible_response).toContain('50 — Sắc Thái');
    expect(res.customer_visible_response).not.toContain('Tổng Thống');
    expect(res.customer_visible_response).not.toContain('50 Shades');
  });

  // 7. Phòng 401 Hà Đông = NOT_FOR_SALE, phòng 401 cơ sở khác thương mại bình thường
  it('Requirement 7: Room 401 Ha Dong is NOT_FOR_SALE, while other 401s are commercial', () => {
    expect(isRoomNotForSale('jacayl-ha-dong', '401')).toBe(true);
    expect(isRoomNotForSale('jacayl-tran-khat-chan', '401-blush')).toBe(false);
    expect(isRoomNotForSale('j-village', '401-mosaic')).toBe(false);
  });

  // 8. 101, 601, 602 là danh sách bồn tắm Hà Đông được xác nhận
  it('Requirement 8: Ha Dong confirmed bathtub rooms are strictly 101, 601, 602', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);
    const res = await orchestrator.processTurn('gt-test-bath', 'Tìm phòng có bồn tắm ở Hà Đông', FIXED_CLOCK);
    const exactIds = res.verified_candidates.filter((c) => c.bucket === 'EXACT').map((c) => c.id).sort();
    expect(exactIds).toEqual([
      'jacayl-ha-dong::101-long-chim',
      'jacayl-ha-dong::601-50-sac-thai',
      'jacayl-ha-dong::602-playboy',
    ]);
  });

  // 9. Business Policy V1.4.3 không hồi quy
  it('Requirement 9: Business Policy V1.4.3 non-regression (weekend lock-in, 2h min, no holiday hike)', async () => {
    const orchestrator = new ConversationOrchestrator(dataset);

    // 9.1. 1-hour package inquiry confirms minimum 2 hours
    const res1h = await orchestrator.processTurn('gt-test-1h', 'Thuê 1 tiếng phòng 201 La Casta có được nửa giá không?', FIXED_CLOCK);
    expect(res1h.customer_visible_response.toLowerCase()).toMatch(/tối thiểu 2 tiếng|không có gói riêng 1 tiếng/);

    // 9.2. Holiday inquiry confirms NO surcharge
    const resHol = await orchestrator.processTurn('gt-test-hol', 'Ngày lễ 30/4 bên em có phụ thu ngày lễ không?', FIXED_CLOCK);
    expect(resHol.customer_visible_response.toLowerCase()).toMatch(/không tăng giá|không có phụ thu ngày lễ/);
  });

  // 10. Provider error/fallback không phát sinh thông tin bịa đặt
  it('Requirement 10: Provider error or fallback does not produce ungrounded information', async () => {
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });

    const res = await orchestrator.processTurn('gt-test-fallback', 'Phòng 601 ở Hà Đông giá bao nhiêu?', FIXED_CLOCK);
    expect(res.customer_visible_response).toContain('50 — Sắc Thái');
    expect(res.customer_visible_response).toContain('Ngã ba Phúc La Phùng Hưng');
    expect(res.customer_visible_response).not.toContain('Tổng Thống');
    expect(res.customer_visible_response).not.toContain('Văn Quán');
    expect(res.claim_validation?.rejected_claims.length).toBe(0);
  });

  // 11. Micro-Fix: Đỗ xe chỉ trả lời "Dạ bên em có chỗ đỗ xe ạ.", không suy luận loại xe/vị trí/khoảng cách/phí
  it('Requirement 11: Micro-fix - Parking answer is strictly "Dạ bên em có chỗ đỗ xe ạ." across all facilities without unverified inferences', () => {
    // Jacayl Hà Đông query
    const resHD = policyEngine.answer('Cơ sở Hà Đông có bãi đỗ ô tô rộng rãi ngay trước cửa không?', {
      facilityId: 'jacayl-ha-dong',
    });
    expect(resHD?.answer_text).toBe('Dạ bên em có chỗ đỗ xe ạ.');
    expect(resHD?.answer_text).not.toContain('rộng rãi');
    expect(resHD?.answer_text).not.toContain('ngay trước cửa');
    expect(resHD?.answer_text).not.toContain('ô tô');
    expect(resHD?.answer_text).not.toContain('xe máy');
    expect(resHD?.answer_text).not.toContain('50m');
    expect(resHD?.answer_text).not.toContain('phí');

    // Jacayl Trần Khát Chân query
    const resTKC = policyEngine.answer('Jacayl Trần Khát Chân có chỗ gửi xe máy không em?', {
      facilityId: 'jacayl-tran-khat-chan',
    });
    expect(resTKC?.answer_text).toBe('Dạ bên em có chỗ đỗ xe ạ.');

    // J Village query
    const resJV = policyEngine.answer('Bên J Village gửi xe ô tô mất bao nhiêu tiền một đêm?', {
      facilityId: 'j-village',
    });
    expect(resJV?.answer_text).toBe('Dạ bên em có chỗ đỗ xe ạ.');

    // Validator rejects invented parking assertions (fees, unverified positions)
    const badFree = validator.validate('Bên em có chỗ đỗ xe miễn phí cho khách nhé', {});
    expect(badFree.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_PARKING_DISTANCE'))).toBe(true);

    const badFee = validator.validate('Khách sạn có bãi đỗ xe có phí 50k một lượt ạ', {});
    expect(badFee.rejected_claims.some((c) => c.includes('REJECTED_UNSOURCED_PARKING_DISTANCE'))).toBe(true);
  });

  // 12. Micro-Fix: Legacy FAQs (projector, double bathtub, third person, voucher) maintain strict status
  it('Requirement 12: Micro-fix - Legacy FAQs (projector, double bathtub, third person, voucher) maintain strict status', () => {
    // Projector: UNCONFIRMED
    const resProj = policyEngine.answer('Khách sạn có máy chiếu phim trong phòng không?');
    expect(resProj).not.toBeNull();
    expect(resProj?.verification_status).toBe('UNCONFIRMED');
    expect(resProj?.answer_text).toContain('chưa có thông tin xác nhận chính thức');
    expect(resProj?.requires_staff_verification).toBe(true);

    // Double bathtub: UNCONFIRMED
    const resBath = policyEngine.answer('Có phòng nào trang bị bồn tắm đôi không?');
    expect(resBath).not.toBeNull();
    expect(resBath?.verification_status).toBe('UNCONFIRMED');
    expect(resBath?.answer_text).toContain('5 phòng có bồn tắm nằm');
    expect(resBath?.requires_staff_verification).toBe(true);

    // Third person: UNKNOWN
    const resThird = policyEngine.answer('Phòng 2 người ở thêm người thứ ba thì phụ thu bao nhiêu?');
    expect(resThird).not.toBeNull();
    expect(resThird?.verification_status).toBe('UNKNOWN');
    expect(resThird?.answer_text).toContain('chưa có quy định chính thức về mức phụ thu');
    expect(resThird?.requires_staff_verification).toBe(true);

    // Voucher: UNKNOWN
    const resVoucher = policyEngine.answer('Chatbot có mã voucher giảm giá nào không?');
    expect(resVoucher).not.toBeNull();
    expect(resVoucher?.verification_status).toBe('UNKNOWN');
    expect(resVoucher?.answer_text).toContain('chưa có chương trình voucher giảm giá tự động');
  });
});

