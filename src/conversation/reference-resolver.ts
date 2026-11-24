import { CompositeRoomKey, CoSoMa } from '../domain/types.js';
import { NormalizedDataset, NormalizedRoom } from '../domain/normalized-schema.js';
import { WorkingMemory, ShortlistedRoomItem } from './conversation-types.js';

export interface ReferenceResolutionResult {
  matched_room?: NormalizedRoom;
  matched_key?: CompositeRoomKey;
  resolution_type: 'ORDINAL' | 'PRONOMINAL' | 'NAME_OR_CODE' | 'PRICE_COMPARISON';
  is_ambiguous?: boolean;
  ambiguous_candidates?: NormalizedRoom[];
  explanation: string;
}

export class RoomReferenceResolver {
  private dataset: NormalizedDataset;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
  }

  /**
   * Resolves room reference from customer text using conversation working memory.
   */
  public resolve(text: string, memory: WorkingMemory): ReferenceResolutionResult | null {
    const norm = text.toLowerCase();

    // 1. Ordinal References: "căn thứ hai", "phòng thứ 2", "cái đầu tiên", "căn thứ 3"
    const ordinalMap: Record<string, number> = {
      'đầu tiên': 0,
      'thứ nhất': 0,
      'thứ 1': 0,
      'thứ hai': 1,
      'thứ 2': 1,
      'thứ ba': 2,
      'thứ 3': 2,
      'thứ tư': 3,
      'thứ 4': 3,
    };

    for (const [phrase, index] of Object.entries(ordinalMap)) {
      if (norm.includes(phrase)) {
        if (memory.shortlisted_rooms && memory.shortlisted_rooms.length > index) {
          const item = memory.shortlisted_rooms[index];
          const room = this.findRoom(item.key.co_so_ma, item.key.ma_phong);
          if (room) {
            return {
              matched_room: room,
              matched_key: item.key,
              resolution_type: 'ORDINAL',
              explanation: `Tham chiếu thứ tự: "${phrase}" tương ứng với phòng ${room.ten_phong} (vị trí số ${index + 1} trong danh sách vừa hiển thị).`,
            };
          }
        }
      }
    }

    // 2. Pronominal References: "phòng đó", "căn đó", "phòng nãy", "phòng vừa rồi"
    const pronominalTerms = ['phòng đó', 'căn đó', 'phòng nãy', 'căn nãy', 'phòng vừa rồi', 'căn vừa rồi'];
    for (const term of pronominalTerms) {
      if (norm.includes(term)) {
        if (memory.focused_room) {
          const room = this.findRoom(memory.focused_room.co_so_ma, memory.focused_room.ma_phong);
          if (room) {
            return {
              matched_room: room,
              matched_key: memory.focused_room,
              resolution_type: 'PRONOMINAL',
              explanation: `Tham chiếu đại từ: "${term}" tương ứng với phòng đang thảo luận: ${room.ten_phong}.`,
            };
          }
        } else if (memory.shortlisted_rooms.length === 1) {
          const item = memory.shortlisted_rooms[0];
          const room = this.findRoom(item.key.co_so_ma, item.key.ma_phong);
          if (room) {
            return {
              matched_room: room,
              matched_key: item.key,
              resolution_type: 'PRONOMINAL',
              explanation: `Tham chiếu duy nhất: tương ứng với phòng ${room.ten_phong}.`,
            };
          }
        }
      }
    }

    // 3. Price Comparison Reference: "phòng đắt hơn", "phòng rẻ hơn", "căn rẻ nhất"
    if (norm.includes('đắt hơn') || norm.includes('đắt nhất')) {
      const candidates = memory.shortlisted_rooms.filter((i) => i.price !== undefined);
      if (candidates.length > 0) {
        const highest = candidates.reduce((prev, curr) =>
          (curr.price ?? 0) > (prev.price ?? 0) ? curr : prev
        );
        const room = this.findRoom(highest.key.co_so_ma, highest.key.ma_phong);
        if (room) {
          return {
            matched_room: room,
            matched_key: highest.key,
            resolution_type: 'PRICE_COMPARISON',
            explanation: `Phòng có mức giá cao hơn: ${room.ten_phong} (${highest.price?.toLocaleString('vi-VN')}đ).`,
          };
        }
      }
    }

    if (norm.includes('rẻ hơn') || norm.includes('rẻ nhất')) {
      const candidates = memory.shortlisted_rooms.filter((i) => i.price !== undefined);
      if (candidates.length > 0) {
        const lowest = candidates.reduce((prev, curr) =>
          (curr.price ?? Infinity) < (prev.price ?? Infinity) ? curr : prev
        );
        const room = this.findRoom(lowest.key.co_so_ma, lowest.key.ma_phong);
        if (room) {
          return {
            matched_room: room,
            matched_key: lowest.key,
            resolution_type: 'PRICE_COMPARISON',
            explanation: `Phòng có mức giá thấp hơn: ${room.ten_phong} (${lowest.price?.toLocaleString('vi-VN')}đ).`,
          };
        }
      }
    }

    // 4. Exact Name or Number Match: "căn 601", "phòng 101", "Lồng Chim", "50 Sắc Thái", "Neon", "Crimson Suite"
    // Extract room number:
    const numMatch = norm.match(/\b(101|102|201|202|203|204|205|301|302|303|304|305|401|402|403|404|405|501|502|503|504|505|601|602|603|604|701|702|703|1001)\b/);
    if (numMatch) {
      const roomNum = numMatch[1];

      // Canonical Room Identity Rule: Room 401 Ha Dong is NOT used for commercial business
      if (
        roomNum === '401' &&
        (norm.includes('hà đông') || norm.includes('ha dong') || memory.active_facility === 'jacayl-ha-dong')
      ) {
        return {
          resolution_type: 'NAME_OR_CODE',
          is_ambiguous: false,
          explanation: 'Phòng 401 tại cơ sở Jacayl Hà Đông không sử dụng để kinh doanh.',
        };
      }

      const matchingRooms = this.dataset.phong.filter((p) => p.ma_phong.startsWith(roomNum));

      if (matchingRooms.length === 1) {
        return {
          matched_room: matchingRooms[0],
          matched_key: { co_so_ma: matchingRooms[0].co_so_ma, ma_phong: matchingRooms[0].ma_phong },
          resolution_type: 'NAME_OR_CODE',
          explanation: `Nhận diện theo mã phòng: "${roomNum}" -> ${matchingRooms[0].ten_phong}.`,
        };
      }

      if (matchingRooms.length > 1) {
        // Disambiguate if utterance includes specific room commercial name (e.g. "La Casta", "Sapphire", etc.)
        const matchByName = matchingRooms.find(
          (p) =>
            norm.includes(p.ten_phong.toLowerCase()) ||
            norm.includes(p.ma_phong.toLowerCase().replace(/^[0-9]+-/, ''))
        );
        if (matchByName) {
          return {
            matched_room: matchByName,
            matched_key: { co_so_ma: matchByName.co_so_ma, ma_phong: matchByName.ma_phong },
            resolution_type: 'NAME_OR_CODE',
            explanation: `Nhận diện mã phòng "${roomNum}" theo tên cụ thể: ${matchByName.ten_phong}.`,
          };
        }

        // Disambiguate using utterance facility or memory active_facility
        let targetFacility = memory.active_facility;
        if (norm.includes('hà đông') || norm.includes('ha dong')) {
          targetFacility = 'jacayl-ha-dong';
        } else if (norm.includes('trần khát chân') || norm.includes('tran khat chan') || norm.includes('tkc')) {
          targetFacility = 'jacayl-tran-khat-chan';
        } else if (norm.includes('j village') || norm.includes('village') || norm.includes('triệu việt vương')) {
          targetFacility = 'j-village';
        }

        if (targetFacility) {
          const facilityMatch = matchingRooms.find((p) => p.co_so_ma === targetFacility);
          if (facilityMatch) {
            return {
              matched_room: facilityMatch,
              matched_key: { co_so_ma: facilityMatch.co_so_ma, ma_phong: facilityMatch.ma_phong },
              resolution_type: 'NAME_OR_CODE',
              explanation: `Nhận diện mã phòng "${roomNum}" tại cơ sở ${targetFacility} -> ${facilityMatch.ten_phong}.`,
            };
          }
        }

        return {
          resolution_type: 'NAME_OR_CODE',
          is_ambiguous: true,
          ambiguous_candidates: matchingRooms,
          explanation: `Mã phòng "${roomNum}" xuất hiện tại nhiều cơ sở. Cần xác nhận cơ sở cụ thể.`,
        };
      }
    }

    // Name keywords (Canonical Room Identity aliases):
    const nameKeywords: Record<string, { co_so_ma: CoSoMa; ma_phong: string }> = {
      'lồng chim': { co_so_ma: 'jacayl-ha-dong', ma_phong: '101-long-chim' },
      'long chim': { co_so_ma: 'jacayl-ha-dong', ma_phong: '101-long-chim' },
      '50 sắc thái': { co_so_ma: 'jacayl-ha-dong', ma_phong: '601-50-sac-thai' },
      '50 sac thai': { co_so_ma: 'jacayl-ha-dong', ma_phong: '601-50-sac-thai' },
      '50 shades': { co_so_ma: 'jacayl-ha-dong', ma_phong: '601-50-sac-thai' },
      'playboy': { co_so_ma: 'jacayl-ha-dong', ma_phong: '602-playboy' },
      'la casta': { co_so_ma: 'jacayl-ha-dong', ma_phong: '201-la-casta' },
      'grand canyon': { co_so_ma: 'jacayl-ha-dong', ma_phong: '202-grand-canyon' },
      'sapphire': { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '201-sapphire' },
      'crimson suite': { co_so_ma: 'j-village', ma_phong: 'crimson-suite' },
      '1001 đêm': { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '1001-dem' },
      '1001 dem': { co_so_ma: 'jacayl-tran-khat-chan', ma_phong: '1001-dem' },
      'neon': { co_so_ma: 'j-village', ma_phong: '202-neon' },
      'sketch': { co_so_ma: 'j-village', ma_phong: '302-sketch' },
      'azure': { co_so_ma: 'j-village', ma_phong: '301-azure' },
      'blackpink': { co_so_ma: 'j-village', ma_phong: 'blackpink' },
    };

    for (const [kw, target] of Object.entries(nameKeywords)) {
      if (norm.includes(kw)) {
        const room = this.findRoom(target.co_so_ma, target.ma_phong);
        if (room) {
          return {
            matched_room: room,
            matched_key: target,
            resolution_type: 'NAME_OR_CODE',
            explanation: `Nhận diện tên phòng: "${kw}" -> ${room.ten_phong}.`,
          };
        }
      }
    }

    return null;
  }

  private findRoom(co_so_ma: CoSoMa, ma_phong: string): NormalizedRoom | undefined {
    return this.dataset.phong.find((p) => p.co_so_ma === co_so_ma && p.ma_phong === ma_phong);
  }
}
