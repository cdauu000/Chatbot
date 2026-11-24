import { NormalizedDataset, NormalizedRoom } from '../domain/normalized-schema.js';
import { PreBookingQuoteEngine } from '../pricing/prebooking-quote-engine.js';
import { isRoomNotForSale } from '../domain/room-business-registry.js';
import {
  RoomSearchCriteria,
  RoomSearchResult,
  ScoredRoomCandidate,
  RecommendationBucketType,
} from './search-types.js';

export class InMemoryRoomSearchEngine {
  private dataset: NormalizedDataset;
  private quoteEngine: PreBookingQuoteEngine;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
    this.quoteEngine = new PreBookingQuoteEngine(dataset);
  }

  /**
   * Evaluates criteria and classifies all 66 rooms into 4 recommendation buckets.
   * Pure in-memory filtering: fast (<1ms), zero network overhead, strictly grounded in evidence.
   */
  public search(criteria: RoomSearchCriteria): RoomSearchResult {
    const candidates: ScoredRoomCandidate[] = [];

    const stayType = criteria.stay_type ?? 'nghi_gio';
    const durationHours = stayType === 'nghi_gio' ? (criteria.duration_hours ?? 2) : 1;

    // Owner-Confirmed Canonical Room Identity Policy:
    // Room 401 Ha Dong is NOT_FOR_SALE in business registry. Exclude from sellable search inventory.
    const rawPool = criteria.co_so_ma
      ? this.dataset.phong.filter((p) => p.co_so_ma === criteria.co_so_ma)
      : this.dataset.phong;

    const pool = rawPool.filter((p) => !isRoomNotForSale(p.co_so_ma, p.ma_phong));

    for (const room of pool) {
      let isHardConstraintFailed = false;
      let isUnverified = false;

      const matchReasons: string[] = [];
      const unmetSoftPreferences: string[] = [];
      const alternativeVariances: string[] = [];
      const unverifiedReasons: string[] = [];

      // 1. Facility Constraint
      if (criteria.co_so_ma) {
        if (room.co_so_ma === criteria.co_so_ma) {
          matchReasons.push(`Đúng cơ sở ${room.co_so_ten}`);
        } else {
          isHardConstraintFailed = true;
          alternativeVariances.push(`Cơ sở ${room.co_so_ten} (thay vì ${criteria.co_so_ma})`);
        }
      }

      // 2. Category Constraint
      if (criteria.hang) {
        const allowedHangs = Array.isArray(criteria.hang) ? criteria.hang : [criteria.hang];
        if (allowedHangs.includes(room.hang)) {
          matchReasons.push(`Đúng hạng phòng ${room.hang}`);
        } else {
          isHardConstraintFailed = true;
          alternativeVariances.push(`Hạng phòng ${room.hang} (thay vì ${allowedHangs.join(', ')})`);
        }
      }

      // 3. Must-have Amenities Constraint
      if (criteria.must_have_amenities && criteria.must_have_amenities.length > 0) {
        for (const amenity of criteria.must_have_amenities) {
          const amenityField = room.tien_nghi[amenity];
          if (amenityField.status === 'CONFIRMED_TRUE') {
            matchReasons.push(`Có tiện ích xác nhận: ${amenity}`);
          } else if (amenityField.status === 'CONFIRMED_FALSE') {
            isHardConstraintFailed = true;
            alternativeVariances.push(`Không có tiện ích: ${amenity}`);
          } else if (amenityField.status === 'UNKNOWN') {
            isUnverified = true;
            unverifiedReasons.push(`Chưa có bằng chứng xác nhận tiện ích ${amenity}`);
          }
        }
      }

      // 4. Floor Constraint
      if (criteria.floor_requirement !== undefined) {
        if (room.tang.status === 'CONFIRMED_TRUE') {
          if (room.tang.value === criteria.floor_requirement) {
            matchReasons.push(`Nằm ở tầng ${criteria.floor_requirement}`);
          } else {
            isHardConstraintFailed = true;
            alternativeVariances.push(`Tầng ${room.tang.value} (thay vì tầng ${criteria.floor_requirement})`);
          }
        } else {
          isUnverified = true;
          unverifiedReasons.push(`Số tầng của phòng chưa được cập nhật chính thức trên website`);
        }
      }

      // 5. Negated Constraints (e.g. 'tone_toi', 'blackpink')
      if (criteria.negated_constraints && criteria.negated_constraints.length > 0) {
        const allRoomText = [
          room.ma_phong,
          room.ten_phong,
          room.meta_description ?? '',
          room.cau_gioi_thieu_ngan ?? '',
          ...room.noi_dung_nguyen_van,
        ]
          .join(' ')
          .toLowerCase();

        for (const negated of criteria.negated_constraints) {
          const normNeg = negated.toLowerCase();
          if (
            allRoomText.includes(normNeg) ||
            (normNeg.includes('tone_toi') && (allRoomText.includes('đen') || allRoomText.includes('blackpink')))
          ) {
            isHardConstraintFailed = true;
            alternativeVariances.push(`Vi phạm điều kiện phủ định: "${negated}"`);
          }
        }
      }

      // 6. Pre-Booking Quote & Budget-Aware Constraint
      const quote = this.quoteEngine.getQuote({
        co_so_ma: room.co_so_ma,
        ma_phong: room.ma_phong,
        stay_type: stayType,
        duration_hours: durationHours,
        checkin_datetime: criteria.checkin_datetime,
      });

      if (criteria.max_budget !== undefined) {
        if (!quote.is_resolved || quote.total_estimate === undefined) {
          // Cannot verify budget constraint! Must be UNVERIFIED
          isUnverified = true;
          unverifiedReasons.push(
            `Chưa xác định được giá dự kiến để kiểm tra ngân sách (${quote.price_breakdown_text})`
          );
        } else if (quote.total_estimate <= criteria.max_budget) {
          matchReasons.push(
            `Tổng giá dự kiến ${quote.total_estimate.toLocaleString('vi-VN')}đ nằm trong ngân sách ${criteria.max_budget.toLocaleString('vi-VN')}đ`
          );
        } else {
          // Exceeds budget!
          isHardConstraintFailed = true;
          const diff = quote.total_estimate - criteria.max_budget;
          alternativeVariances.push(
            `Vượt ngân sách ${diff.toLocaleString('vi-VN')}đ (tổng dự kiến: ${quote.total_estimate.toLocaleString('vi-VN')}đ cho ${quote.duration_hours} giờ)`
          );
        }
      }

      // 7. Soft Preferences
      let meetsAllSoft = true;

      if (criteria.nice_to_have_amenities && criteria.nice_to_have_amenities.length > 0) {
        for (const amenity of criteria.nice_to_have_amenities) {
          const amenityField = room.tien_nghi[amenity];
          if (amenityField.status === 'CONFIRMED_TRUE') {
            matchReasons.push(`Ưu tiên thỏa mãn: ${amenity}`);
          } else {
            meetsAllSoft = false;
            unmetSoftPreferences.push(`Chưa có tiện ích ưu tiên: ${amenity}`);
          }
        }
      }

      if (criteria.preferred_styles && criteria.preferred_styles.length > 0) {
        const roomText = [
          room.ten_phong,
          room.cau_gioi_thieu_ngan ?? '',
          ...room.noi_dung_nguyen_van,
        ]
          .join(' ')
          .toLowerCase();

        for (const style of criteria.preferred_styles) {
          if (roomText.includes(style.toLowerCase())) {
            matchReasons.push(`Phong cách phù hợp: ${style}`);
          } else {
            meetsAllSoft = false;
            unmetSoftPreferences.push(`Chưa khớp phong cách: ${style}`);
          }
        }
      }

      // 8. Determine Recommendation Bucket
      let bucket: RecommendationBucketType;

      if (isUnverified && !isHardConstraintFailed) {
        bucket = 'UNVERIFIED';
      } else if (!isHardConstraintFailed) {
        bucket = meetsAllSoft ? 'EXACT' : 'PARTIAL';
      } else {
        bucket = 'ALTERNATIVE';
      }

      candidates.push({
        room,
        quote,
        bucket,
        match_reasons: matchReasons,
        unmet_soft_preferences: unmetSoftPreferences,
        alternative_variances: alternativeVariances,
        unverified_reasons: unverifiedReasons,
      });
    }

    return {
      criteria_applied: criteria,
      total_candidates_analyzed: candidates.length,
      buckets: {
        exact_matches: candidates.filter((c) => c.bucket === 'EXACT'),
        partial_matches: candidates.filter((c) => c.bucket === 'PARTIAL'),
        alternative_suggestions: candidates.filter((c) => c.bucket === 'ALTERNATIVE'),
        unverified_candidates: candidates.filter((c) => c.bucket === 'UNVERIFIED'),
      },
      search_timestamp: new Date().toISOString(),
    };
  }
}
