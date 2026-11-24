import {
  CoSoMa,
  RawRoomCategory,
  OwnerTierLabel,
  FacilityCategoryConfirmationStatus,
} from '../domain/types.js';

/**
 * J Collection AI Concierge - Facility Category Mapper
 * Maps raw dataset room categories to owner pricing tiers without mutating source dataset.
 */

export interface FacilityCategoryMappingResult {
  co_so_ma: CoSoMa;
  raw_hang: RawRoomCategory;
  mapped_owner_tier: OwnerTierLabel | null;
  confirmation_status: FacilityCategoryConfirmationStatus;
  notes: string;
}

export interface FacilityCategoryConfig {
  co_so_ma: CoSoMa;
  has_time_based_hourly_policy: boolean;
  mappings: Record<
    string,
    {
      mapped_owner_tier: OwnerTierLabel | null;
      confirmation_status: FacilityCategoryConfirmationStatus;
      notes: string;
    }
  >;
}

export const FACILITY_CATEGORY_CONFIGS: Record<CoSoMa, FacilityCategoryConfig> = {
  'jacayl-ha-dong': {
    co_so_ma: 'jacayl-ha-dong',
    has_time_based_hourly_policy: true,
    mappings: {
      Standard: {
        mapped_owner_tier: 'Standard',
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '6 phòng Standard tại Hà Đông khớp chính xác với nhãn Standard trong bảng giá.',
      },
      Deluxe: {
        mapped_owner_tier: 'Deluxe',
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '14 phòng Deluxe tại Hà Đông khớp chính xác với nhãn Deluxe trong bảng giá.',
      },
      Concept: {
        mapped_owner_tier: 'Suite',
        confirmation_status: 'OWNER_CONFIRMED',
        notes:
          '3 phòng Concept (101 Lồng Chim, 601 50 Sắc Thái, 602 Playboy) tại Hà Đông được Chủ dự án xác nhận áp dụng biểu giá Suite.',
      },
    },
  },
  'j-village': {
    co_so_ma: 'j-village',
    has_time_based_hourly_policy: false,
    mappings: {
      Superior: {
        mapped_owner_tier: null,
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '15 phòng Superior tại J Village sử dụng trực tiếp giá tham khảo trong JSON gốc 24/7.',
      },
      Deluxe: {
        mapped_owner_tier: null,
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '5 phòng Deluxe tại J Village sử dụng trực tiếp giá tham khảo trong JSON gốc 24/7.',
      },
      Concept: {
        mapped_owner_tier: null,
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '3 phòng Concept tại J Village sử dụng trực tiếp giá tham khảo trong JSON gốc 24/7.',
      },
      Suite: {
        mapped_owner_tier: null,
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '1 phòng Suite (Crimson Suite) tại J Village sử dụng trực tiếp giá tham khảo trong JSON gốc 24/7.',
      },
    },
  },
  'jacayl-tran-khat-chan': {
    co_so_ma: 'jacayl-tran-khat-chan',
    has_time_based_hourly_policy: false,
    mappings: {
      Standard: {
        mapped_owner_tier: null,
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '4 phòng Standard tại Trần Khát Chân sử dụng trực tiếp giá tham khảo trong JSON gốc 24/7.',
      },
      Premium: {
        mapped_owner_tier: null,
        confirmation_status: 'UNCONFIRMED_PRESERVED',
        notes:
          '6 phòng Premium tại Trần Khát Chân được giữ nguyên nhãn Premium; tuyệt đối không tự ý ánh xạ thành Deluxe khi chưa có xác nhận từ chủ dự án.',
      },
      Concept: {
        mapped_owner_tier: null,
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '8 phòng Concept tại Trần Khát Chân sử dụng trực tiếp giá tham khảo trong JSON gốc 24/7.',
      },
      'VIP Signature': {
        mapped_owner_tier: null,
        confirmation_status: 'DATASET_EXACT_MATCH',
        notes: '1 phòng VIP Signature (1001 Đêm) tại Trần Khát Chân sử dụng trực tiếp giá tham khảo trong JSON gốc 24/7.',
      },
    },
  },
};

export class FacilityCategoryMapper {
  /**
   * Resolves the pricing tier mapping for a room at a given facility.
   * Does not mutate original dataset room category.
   */
  public static resolve(co_so_ma: CoSoMa, raw_hang: RawRoomCategory): FacilityCategoryMappingResult {
    const facilityConfig = FACILITY_CATEGORY_CONFIGS[co_so_ma];
    if (!facilityConfig) {
      throw new Error(`Unrecognized facility code: "${co_so_ma}"`);
    }

    const mapping = facilityConfig.mappings[raw_hang];
    if (!mapping) {
      throw new Error(
        `Category "${raw_hang}" does not exist at facility "${co_so_ma}". Valid categories: ${Object.keys(
          facilityConfig.mappings
        ).join(', ')}`
      );
    }

    return {
      co_so_ma,
      raw_hang,
      mapped_owner_tier: mapping.mapped_owner_tier,
      confirmation_status: mapping.confirmation_status,
      notes: mapping.notes,
    };
  }
}
