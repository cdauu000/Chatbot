import {
  CoSoMa,
  RawRoomCategory,
  OwnerTierLabel,
  StayType,
  CompositeRoomKey,
  PricingStatusCode,
} from '../domain/types.js';

/**
 * J Collection AI Concierge - Pricing Types
 * Discriminated union separating RESOLVED from UNRESOLVED pricing outcomes.
 */

export interface CheckinPricingResolutionInput {
  co_so_ma: CoSoMa;
  ma_phong: string;
  stay_type: StayType;
  checkin_datetime?: string; // ISO 8601 string (e.g. '2026-11-28T10:00:00+07:00')
}

export type ResolvedPricingStatusCode =
  | 'RESOLVED_DAYTIME_POLICY'
  | 'RESOLVED_BASE_DATASET';

export type UnresolvedPricingStatusCode =
  | 'UNRESOLVED_EARLY_MORNING'
  | 'TIME_UNSPECIFIED_ESTIMATE'
  | 'UNRESOLVED_POLICY'
  | 'INVALID_DATETIME'
  | 'INVALID_ROOM_OR_BRANCH'
  | 'DECLINED_AS_UNSUPPORTED_PACKAGE';

export interface ResolvedPricingOutput {
  is_resolved: true;
  status: ResolvedPricingStatusCode;
  room_key: CompositeRoomKey;
  co_so_ma: CoSoMa;
  ma_phong: string;
  raw_hang: RawRoomCategory;
  applied_tier?: OwnerTierLabel;
  base_2h_price: number;
  extra_hour_rate: number;
  checkin_timestamp_normalized: string;
  policy_id: string;
  policy_version: string;
  price_source: 'OWNER_TIME_POLICY' | 'BASE_DATASET_REFERENCE';
  evidence_references: string[];
  stay_type: StayType;
}

export interface UnresolvedPricingOutput {
  is_resolved: false;
  status: UnresolvedPricingStatusCode;
  room_key?: CompositeRoomKey;
  co_so_ma: CoSoMa;
  ma_phong: string;
  raw_hang?: RawRoomCategory;
  applied_tier?: OwnerTierLabel;
  extra_hour_rate: number;
  reason_code: string;
  missing_information_or_unresolved_policy: string;
  base_2h_price: undefined; // Strictly undefined, NEVER 0!
  disclaimer: string;
  policy_id: string;
  policy_version: string;
  price_source: 'POLICY_UNKNOWN';
  stay_type: StayType;
}

export type PricingResolutionOutput = ResolvedPricingOutput | UnresolvedPricingOutput;
