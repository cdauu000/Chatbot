/**
 * J Collection AI Concierge - Milestone 0 Core Types
 * Defines canonical domain types, composite room key, categories, and stay types.
 */

export type CoSoMa = 'j-village' | 'jacayl-tran-khat-chan' | 'jacayl-ha-dong';

export interface CompositeRoomKey {
  co_so_ma: CoSoMa;
  ma_phong: string;
}

/**
 * Format composite room key into canonical string identifier: "<co_so_ma>::<ma_phong>"
 */
export function toCompositeKeyString(co_so_ma: string, ma_phong: string): string {
  return `${co_so_ma}::${ma_phong}`;
}

/**
 * Parse canonical composite key string back to object
 */
export function parseCompositeKeyString(key: string): CompositeRoomKey {
  const parts = key.split('::');
  if (parts.length !== 2) {
    throw new Error(`Invalid composite key string format: "${key}". Expected "<co_so_ma>::<ma_phong>".`);
  }
  return {
    co_so_ma: parts[0] as CoSoMa,
    ma_phong: parts[1],
  };
}

/**
 * Actual room categories present in the canonical dataset:
 * - J Village: Superior, Deluxe, Concept, Suite
 * - Jacayl Trần Khát Chân: VIP Signature, Standard, Premium, Concept
 * - Jacayl Hà Đông: Standard, Deluxe, Concept
 */
export type RawRoomCategory =
  | 'Standard'
  | 'Deluxe'
  | 'Concept'
  | 'Suite'
  | 'Superior'
  | 'Premium'
  | 'VIP Signature';

/**
 * Owner-facing category tier label used for time-based pricing policies
 */
export type OwnerTierLabel = 'Standard' | 'Deluxe' | 'Suite';

export type StayType = 'nghi_gio' | 'qua_dem' | 'ngay_dem';

export type PricingStatusCode =
  | 'RESOLVED_DAYTIME_POLICY'      // Applied verified daytime pricing rule
  | 'RESOLVED_BASE_DATASET'        // Fallback to verified base dataset rate
  | 'TIME_UNSPECIFIED_ESTIMATE'    // Time not provided, requires estimate range
  | 'UNRESOLVED_EARLY_MORNING'     // Check-in before 08:00, policy unknown (historical V1.4.2)
  | 'UNRESOLVED_POLICY'            // Missing policy or unconfirmed rule
  | 'INVALID_DATETIME'             // Malformed datetime input
  | 'INVALID_ROOM_OR_BRANCH'       // Room or facility does not exist
  | 'DECLINED_AS_UNSUPPORTED_PACKAGE' // Duration < 2 or unsupported stay package duration
  | 'NOT_FOR_SALE';                // Room exists physically but is confirmed by owner as not for commercial sale

export type RoomCommercialStatus = 'COMMERCIAL' | 'NOT_FOR_SALE';

export type FacilityCategoryConfirmationStatus =
  | 'OWNER_CONFIRMED'              // Explicitly approved by business owner (e.g., Hà Đông Concept -> Suite)
  | 'DATASET_EXACT_MATCH'          // Matches dataset category directly
  | 'UNCONFIRMED_PRESERVED';       // Kept as-is without remapping because unconfirmed (e.g., TKC Premium)
