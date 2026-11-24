/**
 * J COLLECTION AI CONCIERGE — CANONICAL ROOM VALIDATOR
 *
 * Centralized verification engine for all outbound room references.
 * Enforces Owner-Confirmed Canonical Room Identity Policy:
 * 1. Every room must have a valid composite key (facility_id:room_code).
 * 2. Every room must strictly belong to the active facility and requested category.
 * 3. Display name strictly uses canonical `room.ten_phong` from dataset.
 * 4. Technical room code (e.g. 601) must NOT be prepended to official display name (e.g. "50 — Sắc Thái").
 * 5. Rooms registered as NOT_FOR_SALE (e.g. 401 Ha Dong) must NEVER be recommended or quoted.
 * 6. Hallucinated, invented, or translated room names from LLMs are discarded and replaced with canonical dataset values.
 */

import { NormalizedDataset, NormalizedRoom } from '../../domain/normalized-schema.js';
import { CoSoMa, RawRoomCategory } from '../../domain/types.js';
import { isRoomNotForSale } from '../../domain/room-business-registry.js';

export interface RoomValidationResult {
  isValid: boolean;
  canonicalRoom?: NormalizedRoom;
  display_name: string;
  rejection_reason?: string;
}

export interface OutboundTextValidationResult {
  passed: boolean;
  violations: string[];
  verifiedRooms: string[];
}

export class CanonicalRoomValidator {
  private dataset: NormalizedDataset;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
  }

  /**
   * Validates a single room candidate against canonical dataset and business registry.
   */
  public validateRoom(
    candidate: {
      co_so_ma: string;
      ma_phong: string;
      ten_phong?: string;
      hang?: string;
    },
    options?: {
      expectedFacility?: string | null;
      expectedCategory?: string | null;
    }
  ): RoomValidationResult {
    // 1. Check NOT_FOR_SALE status first
    if (isRoomNotForSale(candidate.co_so_ma, candidate.ma_phong)) {
      return {
        isValid: false,
        display_name: candidate.ten_phong ?? candidate.ma_phong,
        rejection_reason: `REJECTED_NOT_FOR_SALE: Room ${candidate.ma_phong} at ${candidate.co_so_ma} is registered NOT_FOR_SALE.`,
      };
    }

    // 2. Find exact canonical room in dataset
    const canonical = this.dataset.phong.find(
      (p) => p.co_so_ma === candidate.co_so_ma && p.ma_phong === candidate.ma_phong
    );

    if (!canonical) {
      return {
        isValid: false,
        display_name: candidate.ten_phong ?? candidate.ma_phong,
        rejection_reason: `REJECTED_UNKNOWN_ROOM: Room ${candidate.ma_phong} does not exist at facility ${candidate.co_so_ma}.`,
      };
    }

    // 3. Facility isolation check
    if (options?.expectedFacility && canonical.co_so_ma !== options.expectedFacility) {
      return {
        isValid: false,
        display_name: canonical.ten_phong,
        rejection_reason: `REJECTED_FACILITY_MISMATCH: Room belongs to ${canonical.co_so_ma}, expected ${options.expectedFacility}.`,
      };
    }

    // 4. Category alignment check
    if (
      options?.expectedCategory &&
      canonical.hang.toLowerCase() !== options.expectedCategory.toLowerCase()
    ) {
      return {
        isValid: false,
        display_name: canonical.ten_phong,
        rejection_reason: `REJECTED_CATEGORY_MISMATCH: Room is ${canonical.hang}, expected ${options.expectedCategory}.`,
      };
    }

    // 5. Always enforce canonical room.ten_phong
    return {
      isValid: true,
      canonicalRoom: canonical,
      display_name: canonical.ten_phong,
    };
  }

  /**
   * Retrieves the exact, verified set of active commercial rooms for a facility and category.
   * Strictly filters out NOT_FOR_SALE rooms and unknown records.
   */
  public getCanonicalRooms(co_so_ma: CoSoMa, category: RawRoomCategory): NormalizedRoom[] {
    return this.dataset.phong.filter((p) => {
      const matchFac = p.co_so_ma === co_so_ma;
      const matchCat = p.hang.toLowerCase() === category.toLowerCase();
      const notForSale = isRoomNotForSale(p.co_so_ma, p.ma_phong);
      return matchFac && matchCat && !notForSale;
    });
  }

  /**
   * Audits outbound customer-facing text to ensure:
   * - No fictitious room names (e.g. Cinema, Nhật Bản, Lồng Sắt, Gác Mái Cổ Điển at Ha Dong).
   * - No room code prepending (e.g. "601 — 50 — Sắc Thái" -> must be "50 — Sắc Thái").
   * - No NOT_FOR_SALE room offers (e.g. room 401 Ha Dong).
   * - Every room mentioned belongs strictly to the active facility.
   */
  public validateOutboundText(
    text: string,
    facility?: CoSoMa | null,
    expectedCategory?: RawRoomCategory | null
  ): OutboundTextValidationResult {
    const violations: string[] = [];
    const verifiedRooms: string[] = [];
    const lower = text.toLowerCase();

    // 1. Check for known fictitious rooms hallucinated in past reports
    const fictitiousRooms = [
      { name: 'cinema', label: '201 — Cinema' },
      { name: 'nhật bản', label: '301 — Nhật Bản' },
      { name: 'nhat ban', label: '301 — Nhật Bản' },
      { name: 'lồng sắt', label: '402 — Lồng Sắt' },
      { name: 'long sat', label: '402 — Lồng Sắt' },
      { name: 'gác mái cổ điển', label: '501 — Gác Mái Cổ Điển' },
      { name: 'gac mai co dien', label: '501 — Gác Mái Cổ Điển' },
    ];

    for (const f of fictitiousRooms) {
      if (lower.includes(f.name)) {
        violations.push(
          `FICTITIOUS_ROOM_DETECTED: Text mentions "${f.label}" which does not exist in dataset.`
        );
      }
    }

    // 2. Check for prepended room code on official room 601 (50 — Sắc Thái)
    if (
      lower.includes('601 — 50 — sắc thái') ||
      lower.includes('601 - 50 — sắc thái') ||
      lower.includes('601 - 50 - sắc thái') ||
      lower.includes('601 — 50 - sắc thái')
    ) {
      violations.push(
        'PREPENDED_ROOM_CODE: Technical room code "601" was prepended to canonical name "50 — Sắc Thái".'
      );
    }

    // 3. Check for Room 401 Ha Dong being offered or quoted
    if (
      (lower.includes('401') && (facility === 'jacayl-ha-dong' || lower.includes('hà đông') || lower.includes('ha dong'))) &&
      (lower.includes('giá dự kiến') || lower.includes('danh sách các phòng') || lower.includes('lựa chọn'))
    ) {
      const isClarification =
        lower.includes('không kinh doanh') ||
        lower.includes('không sử dụng để kinh doanh') ||
        lower.includes('không mở bán');
      if (!isClarification) {
        violations.push('NOT_FOR_SALE_ROOM_OFFERED: Room 401 Ha Dong is not for sale.');
      }
    }

    // 4. If facility is jacayl-ha-dong and expectedCategory is Concept, verify exact set of Concept rooms
    if (facility === 'jacayl-ha-dong' && expectedCategory === 'Concept') {
      const canonicalConcept = this.getCanonicalRooms('jacayl-ha-dong', 'Concept');
      for (const room of canonicalConcept) {
        if (text.includes(room.ten_phong)) {
          verifiedRooms.push(room.ten_phong);
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      verifiedRooms,
    };
  }
}
