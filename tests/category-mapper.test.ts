import { describe, it, expect } from 'vitest';
import { FacilityCategoryMapper } from '../src/pricing/category-mapper.js';

describe('FacilityCategoryMapper - Ánh xạ Hạng phòng & Bảo toàn Dữ liệu Gốc', () => {
  it('tại Hà Đông: Concept được OWNER_CONFIRMED ánh xạ sang Suite', () => {
    const result = FacilityCategoryMapper.resolve('jacayl-ha-dong', 'Concept');
    expect(result.raw_hang).toBe('Concept');
    expect(result.mapped_owner_tier).toBe('Suite');
    expect(result.confirmation_status).toBe('OWNER_CONFIRMED');
  });

  it('tại Hà Đông: Standard và Deluxe khớp trực tiếp DATASET_EXACT_MATCH', () => {
    const std = FacilityCategoryMapper.resolve('jacayl-ha-dong', 'Standard');
    expect(std.mapped_owner_tier).toBe('Standard');
    expect(std.confirmation_status).toBe('DATASET_EXACT_MATCH');

    const dlx = FacilityCategoryMapper.resolve('jacayl-ha-dong', 'Deluxe');
    expect(dlx.mapped_owner_tier).toBe('Deluxe');
    expect(dlx.confirmation_status).toBe('DATASET_EXACT_MATCH');
  });

  it('tại J Village: 4 hạng phòng Superior, Deluxe, Concept, Suite dùng giá gốc dataset 24/7', () => {
    const superior = FacilityCategoryMapper.resolve('j-village', 'Superior');
    expect(superior.raw_hang).toBe('Superior');
    expect(superior.mapped_owner_tier).toBeNull();
    expect(superior.confirmation_status).toBe('DATASET_EXACT_MATCH');

    const deluxe = FacilityCategoryMapper.resolve('j-village', 'Deluxe');
    expect(deluxe.raw_hang).toBe('Deluxe');
    expect(deluxe.mapped_owner_tier).toBeNull();

    const concept = FacilityCategoryMapper.resolve('j-village', 'Concept');
    expect(concept.raw_hang).toBe('Concept');
    expect(concept.mapped_owner_tier).toBeNull();

    const suite = FacilityCategoryMapper.resolve('j-village', 'Suite');
    expect(suite.raw_hang).toBe('Suite');
    expect(suite.mapped_owner_tier).toBeNull();
  });

  it('tại Trần Khát Chân: Premium được bảo toàn UNCONFIRMED_PRESERVED, không tự ánh xạ thành Deluxe', () => {
    const premium = FacilityCategoryMapper.resolve('jacayl-tran-khat-chan', 'Premium');
    expect(premium.raw_hang).toBe('Premium');
    expect(premium.mapped_owner_tier).toBeNull();
    expect(premium.confirmation_status).toBe('UNCONFIRMED_PRESERVED');

    const vip = FacilityCategoryMapper.resolve('jacayl-tran-khat-chan', 'VIP Signature');
    expect(vip.raw_hang).toBe('VIP Signature');
    expect(vip.mapped_owner_tier).toBeNull();
  });

  it('ném ngoại lệ khi tra cứu hạng phòng không tồn tại tại cơ sở', () => {
    // TKC không có Deluxe
    expect(() =>
      FacilityCategoryMapper.resolve('jacayl-tran-khat-chan', 'Deluxe')
    ).toThrowError(/Category "Deluxe" does not exist at facility "jacayl-tran-khat-chan"/);

    // Hà Đông không có Suite trong dataset raw
    expect(() =>
      FacilityCategoryMapper.resolve('jacayl-ha-dong', 'Suite')
    ).toThrowError(/Category "Suite" does not exist at facility "jacayl-ha-dong"/);
  });
});
