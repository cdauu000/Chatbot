import { CoSoMa, RawRoomCategory, StayType } from '../domain/types.js';
import { NormalizedRoom } from '../domain/normalized-schema.js';
import { PreBookingQuoteResult } from '../pricing/quote-types.js';

export interface RoomSearchCriteria {
  co_so_ma?: CoSoMa;
  hang?: RawRoomCategory | RawRoomCategory[];
  stay_type?: StayType; // defaults to 'nghi_gio'
  checkin_datetime?: string;
  duration_hours?: number; // defaults to 2 for 'nghi_gio'
  max_budget?: number;
  must_have_amenities?: Array<'bon_tam' | 'ghe_tinh_yeu' | 'thang_may'>;
  nice_to_have_amenities?: Array<'bon_tam' | 'ghe_tinh_yeu' | 'thang_may'>;
  preferred_styles?: string[];
  negated_constraints?: string[]; // e.g. ['tone_toi', 'khong_lay_den']
  floor_requirement?: number; // e.g. tầng 2, 3
}

export type RecommendationBucketType = 'EXACT' | 'PARTIAL' | 'ALTERNATIVE' | 'UNVERIFIED';

export interface ScoredRoomCandidate {
  room: NormalizedRoom;
  quote?: PreBookingQuoteResult;
  bucket: RecommendationBucketType;
  match_reasons: string[];
  unmet_soft_preferences: string[];
  alternative_variances: string[];
  unverified_reasons: string[];
}

export interface RoomSearchResult {
  criteria_applied: RoomSearchCriteria;
  total_candidates_analyzed: number;
  buckets: {
    exact_matches: ScoredRoomCandidate[];
    partial_matches: ScoredRoomCandidate[];
    alternative_suggestions: ScoredRoomCandidate[];
    unverified_candidates: ScoredRoomCandidate[];
  };
  search_timestamp: string;
}
