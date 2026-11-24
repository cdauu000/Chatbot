import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { toCompositeKeyString, RawRoomCategory } from '../src/domain/types.js';

describe('Business Invariants & Data Integrity', () => {
  const raw = loadRawDataset();

  it('bảo toàn tính duy nhất của Composite Room Key (co_so_ma, ma_phong)', () => {
    const keys = new Set<string>();
    raw.phong.forEach((p) => {
      const key = toCompositeKeyString(p.co_so_ma, p.ma_phong);
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    });
    expect(keys.size).toBe(66);
  });

  it('mọi phòng đều tham chiếu đến cơ sở tồn tại thật trong danh sách co_so', () => {
    const validFacilityCodes = new Set(raw.co_so.map((cs) => cs.ma));
    raw.phong.forEach((p) => {
      expect(validFacilityCodes.has(p.co_so_ma)).toBe(true);
    });
  });

  it('mọi hạng phòng đều thuộc danh mục danh xưng thực tế trong dataset', () => {
    const allowedCategories: RawRoomCategory[] = [
      'Standard',
      'Deluxe',
      'Concept',
      'Suite',
      'Superior',
      'Premium',
      'VIP Signature',
    ];
    const allowedSet = new Set<string>(allowedCategories);

    raw.phong.forEach((p) => {
      expect(allowedSet.has(p.hang)).toBe(true);
    });
  });

  it('bảo toàn số lượng hạng phòng thực tế tại từng cơ sở', () => {
    const jvRooms = raw.phong.filter((p) => p.co_so_ma === 'j-village');
    const tkcRooms = raw.phong.filter((p) => p.co_so_ma === 'jacayl-tran-khat-chan');
    const hdRooms = raw.phong.filter((p) => p.co_so_ma === 'jacayl-ha-dong');

    // J Village: 15 Superior, 5 Deluxe, 3 Concept, 1 Suite
    expect(jvRooms.filter((p) => p.hang === 'Superior').length).toBe(15);
    expect(jvRooms.filter((p) => p.hang === 'Deluxe').length).toBe(5);
    expect(jvRooms.filter((p) => p.hang === 'Concept').length).toBe(3);
    expect(jvRooms.filter((p) => p.hang === 'Suite').length).toBe(1);

    // Trần Khát Chân: 4 Standard, 6 Premium, 8 Concept, 1 VIP Signature
    expect(tkcRooms.filter((p) => p.hang === 'Standard').length).toBe(4);
    expect(tkcRooms.filter((p) => p.hang === 'Premium').length).toBe(6);
    expect(tkcRooms.filter((p) => p.hang === 'Concept').length).toBe(8);
    expect(tkcRooms.filter((p) => p.hang === 'VIP Signature').length).toBe(1);
    // Tuyệt đối không có Studio hoặc Deluxe tại Trần Khát Chân trong dataset gốc
    expect(tkcRooms.filter((p) => p.hang === 'Studio').length).toBe(0);
    expect(tkcRooms.filter((p) => p.hang === 'Deluxe').length).toBe(0);

    // Hà Đông: 6 Standard, 14 Deluxe, 3 Concept
    expect(hdRooms.filter((p) => p.hang === 'Standard').length).toBe(6);
    expect(hdRooms.filter((p) => p.hang === 'Deluxe').length).toBe(14);
    expect(hdRooms.filter((p) => p.hang === 'Concept').length).toBe(3);
  });

  it('toàn bộ 66 phòng đều có giá hợp lệ, số nguyên dương', () => {
    raw.phong.forEach((p) => {
      expect(p.gia.nghi_gio_2h).toBeGreaterThan(0);
      expect(Number.isInteger(p.gia.nghi_gio_2h)).toBe(true);

      expect(p.gia.qua_dem).toBeGreaterThan(0);
      expect(Number.isInteger(p.gia.qua_dem)).toBe(true);

      expect(p.gia.ngay_dem).toBeGreaterThan(0);
      expect(Number.isInteger(p.gia.ngay_dem)).toBe(true);
    });
  });

  it('mọi phòng đều có ít nhất 1 ảnh và tổng ảnh là 228', () => {
    let totalPhotos = 0;
    raw.phong.forEach((p) => {
      expect(p.anh.length).toBeGreaterThanOrEqual(1);
      totalPhotos += p.anh.length;
      p.anh.forEach((img) => {
        expect(img.url).toMatch(/^https:\/\//);
        if (img.alt !== null && img.alt !== undefined) {
          expect(img.alt.trim().length).toBeGreaterThan(0);
        }
      });
    });
    expect(totalPhotos).toBe(228);
  });

  it('phòng có tầng xác nhận phải có số tầng từ 1 đến 10', () => {
    raw.phong.forEach((p) => {
      if (p.tang_theo_website !== null && p.tang_theo_website !== undefined) {
        expect(p.tang_theo_website).toBeGreaterThanOrEqual(1);
        expect(p.tang_theo_website).toBeLessThanOrEqual(10);
      }
    });
  });
});
