import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { DatasetAuditor } from '../src/audit/dataset-auditor.js';

describe('Dataset Audit & Ground Truth Verification', () => {
  const raw = loadRawDataset();
  const audit = DatasetAuditor.runAudit(raw);

  it('xác nhận chính xác 3 cơ sở trong chuỗi', () => {
    expect(audit.facilities.total).toBe(3);
    const codes = audit.facilities.details.map((d) => d.ma).sort();
    expect(codes).toEqual(['j-village', 'jacayl-ha-dong', 'jacayl-tran-khat-chan'].sort());
  });

  it('xác nhận địa chỉ và số điện thoại chuẩn xác của từng cơ sở', () => {
    const jv = audit.facilities.details.find((d) => d.ma === 'j-village');
    expect(jv).toBeDefined();
    // Phải là 64 Triệu Việt Vương, không phải 82 Triệu Việt Vương
    expect(jv?.dia_chi).toBe('64 Triệu Việt Vương');
    expect(jv?.dien_thoai).toBe('0707 646 464');

    const tkc = audit.facilities.details.find((d) => d.ma === 'jacayl-tran-khat-chan');
    expect(tkc).toBeDefined();
    expect(tkc?.dia_chi).toBe('283 Trần Khát Chân');
    expect(tkc?.dien_thoai).toBe('0921 123 939');

    const hd = audit.facilities.details.find((d) => d.ma === 'jacayl-ha-dong');
    expect(hd).toBeDefined();
    expect(hd?.dia_chi).toBe('Ngã ba Phúc La Phùng Hưng');
    expect(hd?.dien_thoai).toBe('0522 464 646');
  });

  it('xác nhận phân bổ số lượng phòng từng cơ sở và tổng 66 phòng', () => {
    expect(audit.rooms.by_facility['j-village']).toBe(24);
    expect(audit.rooms.by_facility['jacayl-tran-khat-chan']).toBe(19);
    expect(audit.rooms.by_facility['jacayl-ha-dong']).toBe(23);
    expect(audit.rooms.total).toBe(66);
  });

  it('xác nhận phân bổ số lượng ảnh phòng: JV 81, TKC 78, HD 69 -> tổng 228 ảnh', () => {
    expect(audit.rooms.photos_by_facility['j-village']).toBe(81);
    expect(audit.rooms.photos_by_facility['jacayl-tran-khat-chan']).toBe(78);
    expect(audit.rooms.photos_by_facility['jacayl-ha-dong']).toBe(69);
    expect(audit.rooms.total_photos).toBe(228);
  });

  it('xác nhận 22 phòng có tầng xác nhận và 44 phòng UNKNOWN', () => {
    expect(audit.rooms.confirmed_floors.by_facility['j-village']).toBe(11);
    expect(audit.rooms.confirmed_floors.by_facility['jacayl-tran-khat-chan']).toBe(11);
    expect(audit.rooms.confirmed_floors.by_facility['jacayl-ha-dong']).toBe(0);
    expect(audit.rooms.confirmed_floors.total).toBe(22);
    expect(audit.rooms.confirmed_floors.unconfirmed_count).toBe(44);
  });

  it('xác nhận chính xác 5 phòng có bồn tắm trên toàn chuỗi', () => {
    expect(audit.rooms.bathtub_rooms.length).toBe(5);
    const bathtubIds = audit.rooms.bathtub_rooms.map((r) => r.id).sort();
    expect(bathtubIds).toEqual(
      [
        'jacayl-ha-dong::101-long-chim',
        'jacayl-ha-dong::601-50-sac-thai',
        'jacayl-ha-dong::602-playboy',
        'j-village::crimson-suite',
        'jacayl-tran-khat-chan::1001-dem',
      ].sort()
    );
  });

  it('xác nhận giá sàn thấp nhất của phòng bồn tắm là 399.000đ (không có phòng nào dưới 399k)', () => {
    const minPrice = Math.min(...audit.rooms.bathtub_rooms.map((r) => r.gia_2h));
    expect(minPrice).toBe(399000);
    expect(minPrice).not.toBeLessThan(399000);
  });

  it('xác nhận chính xác 4 phòng có ghế tình yêu', () => {
    expect(audit.rooms.love_chair_rooms.length).toBe(4);
    const chairIds = audit.rooms.love_chair_rooms.map((r) => r.id).sort();
    expect(chairIds).toEqual(
      [
        'j-village::blackpink',
        'j-village::playboy',
        'jacayl-ha-dong::601-50-sac-thai',
        'jacayl-ha-dong::602-playboy',
      ].sort()
    );
  });

  it('xác nhận chỉ có 2 phòng 601 và 602 Hà Đông có phụ thu riêng 200k/h', () => {
    expect(audit.rooms.special_extra_hour_rooms.length).toBe(2);
    const specialIds = audit.rooms.special_extra_hour_rooms.map((r) => r.id).sort();
    expect(specialIds).toEqual(
      ['jacayl-ha-dong::601-50-sac-thai', 'jacayl-ha-dong::602-playboy'].sort()
    );
    audit.rooms.special_extra_hour_rooms.forEach((r) => {
      expect(r.rate).toBe(200000);
    });
  });

  it('xác nhận phòng 101 Lồng Chim Hà Đông có giá 2h là 399.000đ và phụ thu 100k/h', () => {
    const room101 = raw.phong.find(
      (p) => p.co_so_ma === 'jacayl-ha-dong' && p.ma_phong === '101-long-chim'
    );
    expect(room101).toBeDefined();
    expect(room101?.gia.nghi_gio_2h).toBe(399000);
    expect(room101?.hang).toBe('Concept');
    // Phụ thu mặc định 100k/h (do không có ghi riêng)
    expect(room101?.gia.gio_phat_sinh_ap_dung).toBe(100000);
  });

  it('xác nhận các quy định chung trong raw dataset', () => {
    expect(audit.policies.overnight_hours).toBe('Từ 22h đến 12h hôm sau');
    expect(audit.policies.fullday_hours).toBe('Từ 14h đến 12h hôm sau');
    expect(audit.policies.overtime_rule).toBe('Quá giờ sau 10 phút thì tính thêm 1 giờ.');
    expect(audit.policies.parking_general_rule).toBe('Có chỗ đỗ xe.');
  });
});
