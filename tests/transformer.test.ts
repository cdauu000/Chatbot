import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';

describe('Raw-to-Normalized Transformer & Lossless Evidence Preservation', () => {
  const raw = loadRawDataset();
  const normalized = transformRawDatasetToDomain(raw);

  it('chuyển đổi đủ 66 phòng và 3 cơ sở', () => {
    expect(normalized.phong.length).toBe(66);
    expect(normalized.co_so.length).toBe(3);
  });

  it('bảo toàn 100% hình ảnh không bị mất mát hay xáo trộn thứ tự', () => {
    raw.phong.forEach((rawRoom) => {
      const normRoom = normalized.phong.find(
        (p) => p.co_so_ma === rawRoom.co_so_ma && p.ma_phong === rawRoom.ma_phong
      );
      expect(normRoom).toBeDefined();
      expect(normRoom?.anh.length).toBe(rawRoom.anh.length);

      rawRoom.anh.forEach((img, idx) => {
        expect(normRoom?.anh[idx].url).toBe(img.url);
        expect(normRoom?.anh[idx].alt).toBe(img.alt);
        expect(normRoom?.anh[idx].index).toBe(idx);
      });
    });
  });

  it('phân định đúng trạng thái tầng: 22 CONFIRMED_TRUE, 44 UNKNOWN (không biến null thành false/0)', () => {
    const confirmedFloors = normalized.phong.filter((p) => p.tang.status === 'CONFIRMED_TRUE');
    const unknownFloors = normalized.phong.filter((p) => p.tang.status === 'UNKNOWN');

    expect(confirmedFloors.length).toBe(22);
    expect(unknownFloors.length).toBe(44);

    confirmedFloors.forEach((p) => {
      if (p.tang.status === 'CONFIRMED_TRUE') {
        expect(typeof p.tang.value).toBe('number');
        expect(p.tang.value).toBeGreaterThanOrEqual(1);
      }
    });

    unknownFloors.forEach((p) => {
      if (p.tang.status === 'UNKNOWN') {
        expect(p.tang.reason).toBe('NOT_SPECIFIED_ON_WEBSITE');
      }
    });
  });

  it('phân định đúng 5 phòng bồn tắm CONFIRMED_TRUE và 61 phòng CONFIRMED_FALSE', () => {
    const confirmedBathtub = normalized.phong.filter(
      (p) => p.tien_nghi.bon_tam.status === 'CONFIRMED_TRUE'
    );
    const falseBathtub = normalized.phong.filter(
      (p) => p.tien_nghi.bon_tam.status === 'CONFIRMED_FALSE'
    );

    expect(confirmedBathtub.length).toBe(5);
    expect(falseBathtub.length).toBe(61);
  });

  it('phân định đúng 4 phòng ghế tình yêu CONFIRMED_TRUE và 62 phòng CONFIRMED_FALSE', () => {
    const confirmedChairs = normalized.phong.filter(
      (p) => p.tien_nghi.ghe_tinh_yeu.status === 'CONFIRMED_TRUE'
    );
    const falseChairs = normalized.phong.filter(
      (p) => p.tien_nghi.ghe_tinh_yeu.status === 'CONFIRMED_FALSE'
    );

    expect(confirmedChairs.length).toBe(4);
    expect(falseChairs.length).toBe(62);
  });

  it('chính sách thú cưng, hút thuốc, bếp nấu trong phòng bắt buộc là UNKNOWN do chưa có bằng chứng', () => {
    normalized.phong.forEach((p) => {
      expect(p.tien_nghi.bep_nau.status).toBe('UNKNOWN');
      expect(p.tien_nghi.thu_cung_cho_phep.status).toBe('UNKNOWN');
      expect(p.tien_nghi.cho_phep_hut_thuoc.status).toBe('UNKNOWN');
    });
  });

  it('bảo toàn đơn giá giờ thêm riêng của 601 và 602 Hà Đông', () => {
    const room601 = normalized.phong.find((p) => p.id === 'jacayl-ha-dong::601-50-sac-thai');
    const room602 = normalized.phong.find((p) => p.id === 'jacayl-ha-dong::602-playboy');
    const room101 = normalized.phong.find((p) => p.id === 'jacayl-ha-dong::101-long-chim');

    expect(room601?.gia_goc_dataset.gio_phat_sinh_ap_dung).toBe(200000);
    expect(room602?.gia_goc_dataset.gio_phat_sinh_ap_dung).toBe(200000);
    expect(room101?.gia_goc_dataset.gio_phat_sinh_ap_dung).toBe(100000);
  });
});
