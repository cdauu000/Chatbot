import { describe, it, expect } from 'vitest';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { InMemoryRoomSearchEngine } from '../src/search/in-memory-room-search.js';

describe('In-Memory Room Search Engine & Four-Bucket Recommendation', () => {
  const raw = loadRawDataset();
  const normalized = transformRawDatasetToDomain(raw);
  const searchEngine = new InMemoryRoomSearchEngine(normalized);

  // 1. Kiểm thử Trọng yếu: Lọc Ngân sách dựa trên TỔNG TIỀN NGHỈ DỰ KIẾN (Budget-Aware)
  describe('Budget-Aware Filtering (Thứ Bảy 09:00, Hà Đông, 4 giờ, ngân sách 500k)', () => {
    const result = searchEngine.search({
      co_so_ma: 'jacayl-ha-dong',
      checkin_datetime: '2026-11-28T09:00:00+07:00', // Thứ Bảy 09:00
      duration_hours: 4,
      max_budget: 500000,
    });

    it('Standard (tổng 380k <= 500k) được xếp vào EXACT MATCH', () => {
      const exactStandard = result.buckets.exact_matches.filter((c) => c.room.hang === 'Standard');
      expect(exactStandard.length).toBe(6); // Toàn bộ 6 phòng Standard Hà Đông
      exactStandard.forEach((c) => {
        expect(c.quote?.total_estimate).toBe(380000);
      });
    });

    it('Deluxe (tổng 515k > 500k) BẮT BUỘC KHÔNG ĐƯỢC VÀO EXACT MATCH dù base 2h chỉ 315k', () => {
      const exactDeluxe = result.buckets.exact_matches.filter((c) => c.room.hang === 'Deluxe');
      // KHÔNG ĐƯỢC CÓ BẤT KỲ PHÒNG DELUXE NÀO TRONG EXACT MATCH!
      expect(exactDeluxe.length).toBe(0);

      const altDeluxe = result.buckets.alternative_suggestions.filter((c) => c.room.hang === 'Deluxe');
      expect(altDeluxe.length).toBe(14); // Cả 14 phòng Deluxe chuyển sang Alternative
      altDeluxe.forEach((c) => {
        expect(c.quote?.total_estimate).toBe(515000);
        expect(c.alternative_variances.some((v) => v.includes('Vượt ngân sách 15.000đ'))).toBe(true);
      });
    });

    it('101 Lồng Chim (tổng 649k) và 601/602 (tổng 849k) chuyển sang ALTERNATIVE do vượt ngân sách', () => {
      const exactConcept = result.buckets.exact_matches.filter((c) => c.room.hang === 'Concept');
      expect(exactConcept.length).toBe(0);

      const altConcept = result.buckets.alternative_suggestions.filter((c) => c.room.hang === 'Concept');
      expect(altConcept.length).toBe(3);

      const room101 = altConcept.find((c) => c.room.ma_phong === '101-long-chim');
      expect(room101?.quote?.total_estimate).toBe(649000);

      const room601 = altConcept.find((c) => c.room.ma_phong === '601-50-sac-thai');
      expect(room601?.quote?.total_estimate).toBe(849000);

      const room602 = altConcept.find((c) => c.room.ma_phong === '602-playboy');
      expect(room602?.quote?.total_estimate).toBe(849000);
    });
  });

  // 2. Kiểm thử Four-Bucket Classification
  describe('Phân loại 4 Nhóm Đề xuất Không Vi phạm Ràng buộc', () => {
    it('nhóm PARTIAL MATCH khi thỏa mãn hard constraints nhưng thiếu soft preference', () => {
      const result = searchEngine.search({
        co_so_ma: 'j-village',
        hang: 'Superior',
        preferred_styles: ['mural_dac_biet_khong_ton_tai'], // Soft preference không có
      });

      // Toàn bộ phòng Superior J Village thỏa mãn cơ sở & hạng, nhưng thiếu soft style
      expect(result.buckets.exact_matches.length).toBe(0);
      expect(result.buckets.partial_matches.length).toBe(15);
      result.buckets.partial_matches.forEach((c) => {
        expect(c.unmet_soft_preferences.length).toBeGreaterThan(0);
      });
    });

    it('V1.4.3: Check-in sáng sớm trước 08:00 tại Hà Đông được RESOLVED_BASE_DATASET nên phòng trong ngân sách là exact matches', () => {
      const result = searchEngine.search({
        co_so_ma: 'jacayl-ha-dong',
        checkin_datetime: '2026-11-24T06:30:00+07:00', // Sáng sớm trước 08:00
        max_budget: 300000,
      });

      // V1.4.3: 20 phòng (Standard 159k, Deluxe 279k) nằm trong ngân sách 300k
      expect(result.buckets.exact_matches.length).toBe(20);
      expect(result.buckets.alternative_suggestions.length).toBe(3); // 3 phòng Concept 399k vượt ngân sách
    });

    it('nhóm UNVERIFIED khi yêu cầu số tầng cụ thể mà phòng không ghi nhận tầng', () => {
      const result = searchEngine.search({
        co_so_ma: 'jacayl-ha-dong', // 100% phòng Hà Đông chưa ghi nhận số tầng trên web
        floor_requirement: 3,
      });

      expect(result.buckets.exact_matches.length).toBe(0);
      expect(result.buckets.unverified_candidates.length).toBe(23);
      result.buckets.unverified_candidates.forEach((c) => {
        expect(c.unverified_reasons.some((r) => r.includes('Số tầng'))).toBe(true);
      });
    });
  });

  // 3. Kiểm thử lọc theo tiện nghi bắt buộc (Must-have Amenities)
  describe('Lọc Tiện nghi Bắt buộc (Must-have Amenities)', () => {
    it('lọc phòng có bồn tắm trên toàn chuỗi: chỉ có đúng 5 phòng thỏa mãn', () => {
      const result = searchEngine.search({
        must_have_amenities: ['bon_tam'],
      });

      expect(result.buckets.exact_matches.length).toBe(5);
      const bathtubIds = result.buckets.exact_matches.map((c) => c.room.id).sort();
      expect(bathtubIds).toEqual(
        [
          'jacayl-ha-dong::101-long-chim',
          'jacayl-ha-dong::601-50-sac-thai',
          'jacayl-ha-dong::602-playboy',
          'j-village::crimson-suite',
          'jacayl-tran-khat-chan::1001-dem',
        ].sort()
      );

      // 61 phòng còn lại chuyển sang ALTERNATIVE
      expect(result.buckets.alternative_suggestions.length).toBe(61);
    });

    it('lọc phòng có ghế tình yêu trên toàn chuỗi: chỉ có đúng 4 phòng thỏa mãn', () => {
      const result = searchEngine.search({
        must_have_amenities: ['ghe_tinh_yeu'],
      });

      expect(result.buckets.exact_matches.length).toBe(4);
      const chairIds = result.buckets.exact_matches.map((c) => c.room.id).sort();
      expect(chairIds).toEqual(
        [
          'j-village::blackpink',
          'j-village::playboy',
          'jacayl-ha-dong::601-50-sac-thai',
          'jacayl-ha-dong::602-playboy',
        ].sort()
      );
    });
  });

  // 4. Kiểm thử điều kiện phủ định (Negated Constraints)
  describe('Lọc Điều kiện Phủ định (Negated Constraints)', () => {
    it('loại trừ phòng tone tối tại J Village', () => {
      const result = searchEngine.search({
        co_so_ma: 'j-village',
        negated_constraints: ['tone_toi'],
      });

      // Phòng Blackpink (tone đen/tối) không được nằm trong EXACT
      const exactIds = result.buckets.exact_matches.map((c) => c.room.ma_phong);
      expect(exactIds.includes('blackpink')).toBe(false);

      const altBlackpink = result.buckets.alternative_suggestions.find(
        (c) => c.room.ma_phong === 'blackpink'
      );
      expect(altBlackpink).toBeDefined();
      expect(
        altBlackpink?.alternative_variances.some((v) => v.includes('Vi phạm điều kiện phủ định'))
      ).toBe(true);
    });
  });
});
