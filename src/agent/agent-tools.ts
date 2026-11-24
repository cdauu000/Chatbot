import { z } from 'zod';
import { NormalizedDataset, NormalizedRoom } from '../domain/normalized-schema.js';
import { CoSoMa, RawRoomCategory, StayType } from '../domain/types.js';
import { InMemoryRoomSearchEngine } from '../search/in-memory-room-search.js';
import { PreBookingQuoteEngine } from '../pricing/prebooking-quote-engine.js';
import { KnowledgeBase } from '../knowledge/knowledge-base.js';
import { ToolCall, ToolResult } from './agent-contracts.js';

// ============================================================================
// ZOD SCHEMAS FOR THE 5 READ-ONLY TOOLS (V2.0 EVIDENCE-FIRST SPECIFICATION)
// ============================================================================

export const SearchRoomsArgsSchema = z.object({
  property_id: z.string().default('jacayl-ha-dong'),
  must_have_amenities: z.array(z.string()).default([]),
  category: z.enum(['Standard', 'Deluxe', 'Concept']).nullish(),
  max_budget: z.number().positive().nullish(),
});

export const GetRoomFactsArgsSchema = z.object({
  property_id: z.string().default('jacayl-ha-dong'),
  room_id: z.string().min(1, 'room_id is required'),
});

export const GetRoomMediaArgsSchema = z.object({
  property_id: z.string().default('jacayl-ha-dong'),
  room_id: z.string().min(1, 'room_id is required'),
});

export const GetPoliciesArgsSchema = z.object({
  property_id: z.string().default('jacayl-ha-dong'),
  topic: z.string().min(1, 'topic is required'),
});

export const QuotePriceArgsSchema = z
  .object({
    property_id: z.string().default('jacayl-ha-dong'),
    room_id: z.string().nullish(),
    room_ids: z.array(z.string()).nullish(),
    stay_type: z.enum(['nghi_gio', 'qua_dem', 'ngay_dem']).nullish().transform((v) => v ?? 'nghi_gio'),
    duration_hours: z.number().int().min(1).nullish().transform((v) => v ?? 2),
    checkin_datetime: z.string().min(10, 'checkin_datetime is required (ISO)'),
  })
  .refine((data) => data.room_id || (data.room_ids && data.room_ids.length > 0), {
    message: 'Either room_id or room_ids must be provided',
  });

export interface AgentToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export class AgentToolGateway {
  private dataset: NormalizedDataset;
  private searchEngine: InMemoryRoomSearchEngine;
  private quoteEngine: PreBookingQuoteEngine;
  private kb: KnowledgeBase;
  public readonly trustedPropertyId: CoSoMa;

  constructor(
    dataset: NormalizedDataset,
    trustedPropertyId: CoSoMa = 'jacayl-ha-dong',
    options?: {
      searchEngine?: InMemoryRoomSearchEngine;
      quoteEngine?: PreBookingQuoteEngine;
      kb?: KnowledgeBase;
    }
  ) {
    this.dataset = dataset;
    this.trustedPropertyId = trustedPropertyId;
    this.searchEngine = options?.searchEngine ?? new InMemoryRoomSearchEngine(dataset);
    this.quoteEngine = options?.quoteEngine ?? new PreBookingQuoteEngine(dataset);
    this.kb = options?.kb ?? new KnowledgeBase(dataset);
  }

  /**
   * Returns tool descriptions for LLM reasoning prompt.
   */
  public getToolDeclarations(): AgentToolDeclaration[] {
    return [
      {
        name: 'search_rooms',
        description: 'Tìm kiếm phòng tại cơ sở theo tiện nghi bắt buộc, hạng phòng và ngân sách tối đa. Phân biệt rõ exact matches, partial matches, và alternatives.',
        parameters: {
          type: 'object',
          properties: {
            property_id: { type: 'string', description: 'Mã cơ sở (mặc định: jacayl-ha-dong)' },
            must_have_amenities: {
              type: 'array',
              items: { type: 'string' },
              description: "Tiện nghi cần tìm, ví dụ ['bon_tam', 'ghe_tinh_yeu']",
            },
            category: {
              type: 'string',
              enum: ['Standard', 'Deluxe', 'Concept'],
              description: 'Hạng phòng cần lọc',
            },
            max_budget: {
              type: 'number',
              description: 'Ngân sách tối đa của khách (VND)',
            },
          },
        },
      },
      {
        name: 'get_room_facts',
        description: 'Tra cứu thông tin chi tiết và dữ kiện xác thực của một phòng cụ thể (bồn tắm, ghế tình yêu, phụ thu thêm giờ, tiện nghi xác nhận TRUE/FALSE/UNKNOWN).',
        parameters: {
          type: 'object',
          required: ['room_id'],
          properties: {
            property_id: { type: 'string', description: 'Mã cơ sở (mặc định: jacayl-ha-dong)' },
            room_id: {
              type: 'string',
              description: 'Mã phòng (ví dụ: "601-50-sac-thai", "101-long-chim", "202-grand-canyon")',
            },
          },
        },
      },
      {
        name: 'get_room_media',
        description: 'Lấy link ảnh xem phòng thực tế đã kiểm duyệt và link đặt phòng.',
        parameters: {
          type: 'object',
          required: ['room_id'],
          properties: {
            property_id: { type: 'string', description: 'Mã cơ sở (mặc định: jacayl-ha-dong)' },
            room_id: {
              type: 'string',
              description: 'Mã phòng (ví dụ: "101-long-chim", "601-50-sac-thai")',
            },
          },
        },
      },
      {
        name: 'get_policies',
        description: 'Tra cứu quy định và chính sách khách sạn theo chủ đề ngữ nghĩa (đỗ xe, ngày lễ, nhận trả phòng, ân hạn, người thứ ba, hút thuốc, thanh toán, v.v.).',
        parameters: {
          type: 'object',
          required: ['topic'],
          properties: {
            property_id: { type: 'string', description: 'Mã cơ sở (mặc định: jacayl-ha-dong)' },
            topic: {
              type: 'string',
              description: 'Chủ đề quy định cần tra cứu: "parking", "holiday", "stay_hours", "extra_person", "smoking", "payment", "early_late", "cancellation", "deposit", "wifi", "water"',
            },
          },
        },
      },
      {
        name: 'quote_price',
        description: 'Tính toán giá chuẩn theo Pricing Engine và Business Policy V1.4.3. Hỗ trợ tính giá đơn lẻ hoặc theo lô nhiều phòng.',
        parameters: {
          type: 'object',
          required: ['stay_type', 'duration_hours', 'checkin_datetime'],
          properties: {
            property_id: { type: 'string', description: 'Mã cơ sở (mặc định: jacayl-ha-dong)' },
            room_id: {
              type: 'string',
              description: 'Mã phòng đơn lẻ cần tính giá',
            },
            room_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Danh sách nhiều mã phòng cần tính giá theo lô (batch quote)',
            },
            stay_type: {
              type: 'string',
              enum: ['nghi_gio', 'qua_dem', 'ngay_dem'],
              description: 'Gói lưu trú (nghỉ giờ tối thiểu 2 giờ)',
            },
            duration_hours: {
              type: 'number',
              description: 'Số giờ nghỉ',
            },
            checkin_datetime: {
              type: 'string',
              description: 'Thời điểm nhận phòng ISO 8601 (ví dụ: 2026-11-28T14:00:00+07:00)',
            },
          },
        },
      },
    ];
  }

  /**
   * Executes a tool with strict backend validation, property scoping, and error containment.
   */
  public async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const { toolCallId, toolName, arguments: rawArgs } = toolCall;

    try {
      switch (toolName) {
        case 'search_rooms': {
          const parsed = SearchRoomsArgsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return {
              toolCallId,
              toolName,
              status: 'ERROR',
              data: null,
              provenance: 'backend_validator',
              errorMessage: `Invalid arguments for search_rooms: ${parsed.error.message}`,
            };
          }

          // Enforce tenant isolation
          if (parsed.data.property_id && parsed.data.property_id !== this.trustedPropertyId) {
            throw new Error(`Tenant Isolation Violation: Tool call target ${parsed.data.property_id} is forbidden outside ${this.trustedPropertyId} scope.`);
          }

          const rawAmenities = parsed.data.must_have_amenities || [];
          const mappedAmenities: Array<'bon_tam' | 'ghe_tinh_yeu' | 'thang_may'> = [];
          const missingEvidenceAmenities: string[] = [];

          for (const am of rawAmenities) {
            const lower = am.toLowerCase().trim();
            if (
              lower.includes('bon') ||
              lower.includes('bồn') ||
              lower.includes('tam') ||
              lower.includes('tắm') ||
              lower.includes('bath') ||
              lower.includes('tub')
            ) {
              mappedAmenities.push('bon_tam');
            } else if (lower.includes('ghe') || lower.includes('ghế') || lower.includes('tantra') || lower.includes('love')) {
              mappedAmenities.push('ghe_tinh_yeu');
            } else if (lower.includes('may chieu') || lower.includes('may_chieu') || lower.includes('projector')) {
              mappedAmenities.push('may_chieu' as any);
            } else if (lower.includes('thang') || lower.includes('elevator')) {
              mappedAmenities.push('thang_may');
            } else {
              // Amenities not confirmed or unmatchable in hotel dataset (e.g. jacuzzi, ho_boi, sauna, bep)
              missingEvidenceAmenities.push(am);
            }
          }

          // If user specifically requested unconfirmed amenities like pool, sauna, kitchen, jacuzzi:
          if (rawAmenities.length > 0 && missingEvidenceAmenities.length === rawAmenities.length) {
            return {
              toolCallId,
              toolName,
              status: 'NO_DATA',
              data: {
                property_id: this.trustedPropertyId,
                total_exact: 0,
                total_partial: 0,
                exact_matches: [],
                partial_matches: [],
                alternative_suggestions: [],
                excluded_candidates: [],
                missing_evidence: missingEvidenceAmenities,
                candidates: [],
              },
              provenance: 'dataset.phong',
            };
          }

          const supportedAmenities = mappedAmenities.filter((a) => a !== ('may_chieu' as any));
          const searchCriteria = {
            co_so_ma: this.trustedPropertyId,
            hang: parsed.data.category ?? undefined,
            must_have_amenities: supportedAmenities.length > 0 ? Array.from(new Set(supportedAmenities)) : undefined,
          };

          const searchResult = this.searchEngine.search(searchCriteria);

          const formatCandidate = (c: any) => {
            let formattedName = c.room.ten_phong;
            if (c.room.ma_phong === '601-50-sac-thai') {
              formattedName = '50 — Sắc Thái (Mã 601 / 50 Sắc Thái)';
            } else {
              const roomNum = c.room.ma_phong.split('-')[0];
              formattedName = c.room.ten_phong.includes(roomNum)
                ? c.room.ten_phong
                : `${roomNum} — ${c.room.ten_phong}`;
            }
            return {
              id: c.room.ma_phong,
              room_id: c.room.ma_phong,
              room_name: formattedName,
              category: c.room.hang,
              confirmed_amenities: [
                c.room.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE' ? 'Bồn tắm' : null,
                c.room.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE' ? 'Ghế tình yêu' : null,
              ].filter(Boolean) as string[],
              base_pricing: c.room.gia_goc_dataset,
              bucket: c.bucket,
            };
          };

          const exactMatches = searchResult.buckets.exact_matches.map(formatCandidate);
          const partialMatches = searchResult.buckets.partial_matches.map(formatCandidate);
          const alternativeSuggestions = searchResult.buckets.alternative_suggestions.map(formatCandidate);

          // Section V Specification:
          // NEVER dump partial_matches or alternative_suggestions into exact candidates!
          let candidateList: any[] = [];
          if (mappedAmenities.includes('may_chieu' as any)) {
            const allSellable = this.dataset.phong.filter(
              (p) => p.co_so_ma === this.trustedPropertyId && p.ma_phong !== '401-ha-dong'
            );
            const projectorRooms = allSellable.filter((p) => ['101-long-chim', '201-la-casta'].includes(p.ma_phong));
            candidateList = projectorRooms.map((p) => formatCandidate({ room: p, bucket: 'exact_matches' }));
          } else if (mappedAmenities.length > 0 || parsed.data.category) {
            candidateList = exactMatches.length > 0 ? exactMatches : partialMatches;
          } else {
            // General query without amenities or category
            candidateList = [...exactMatches, ...partialMatches, ...alternativeSuggestions];
          }

          // Build excluded candidates list with transparent reasons
          const allSellable = this.dataset.phong.filter(
            (p) => p.co_so_ma === this.trustedPropertyId && p.ma_phong !== '401-ha-dong'
          );
          const includedIds = new Set(candidateList.map((c) => c.room_id));
          const excludedCandidates = allSellable
            .filter((p) => !includedIds.has(p.ma_phong))
            .map((p) => ({
              room_id: p.ma_phong,
              room_name: p.ten_phong,
              reason: mappedAmenities.includes('bon_tam') && p.tien_nghi.bon_tam?.status !== 'CONFIRMED_TRUE'
                ? 'Missing required amenity: bon_tam'
                : mappedAmenities.includes('ghe_tinh_yeu') && p.tien_nghi.ghe_tinh_yeu?.status !== 'CONFIRMED_TRUE'
                  ? 'Missing required amenity: ghe_tinh_yeu'
                  : parsed.data.category && p.hang !== parsed.data.category
                    ? `Category mismatch: ${p.hang} !== ${parsed.data.category}`
                    : 'Did not match search criteria',
            }));

          return {
            toolCallId,
            toolName,
            status: candidateList.length > 0 ? 'SUCCESS' : 'NO_DATA',
            data: {
              property_id: this.trustedPropertyId,
              total_exact: exactMatches.length,
              total_partial: partialMatches.length,
              exact_matches: exactMatches,
              partial_matches: partialMatches,
              alternative_suggestions: alternativeSuggestions,
              excluded_candidates: excludedCandidates,
              missing_evidence: missingEvidenceAmenities,
              candidates: candidateList,
            },
            provenance: 'dataset.phong',
          };
        }

        case 'get_room_facts': {
          const parsed = GetRoomFactsArgsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return {
              toolCallId,
              toolName,
              status: 'ERROR',
              data: null,
              provenance: 'backend_validator',
              errorMessage: `Invalid arguments for get_room_facts: ${parsed.error.message}`,
            };
          }

          if (parsed.data.property_id && parsed.data.property_id !== this.trustedPropertyId) {
            throw new Error(`Tenant Isolation Violation: Tool call target ${parsed.data.property_id} is forbidden outside ${this.trustedPropertyId} scope.`);
          }

          const targetId = parsed.data.room_id.toLowerCase().trim();
          const room = this.dataset.phong.find(
            (p) =>
              p.co_so_ma === this.trustedPropertyId &&
              (p.ma_phong.toLowerCase() === targetId ||
                p.ma_phong.toLowerCase().includes(targetId) ||
                p.ten_phong.toLowerCase().includes(targetId))
          );

          if (!room) {
            return {
              toolCallId,
              toolName,
              status: 'NO_DATA',
              data: null,
              provenance: 'dataset.phong',
              errorMessage: `Room ${targetId} not found in property ${this.trustedPropertyId}`,
            };
          }

          // Specific amenity evidence tags
          const rawTextCombined = [
            room.ten_phong,
            room.meta_description ?? '',
            room.cau_gioi_thieu_ngan ?? '',
            ...(room.noi_dung_nguyen_van ?? []),
            ...(room.nhom_nhu_cau ?? []),
          ].join(' ').toLowerCase();

          const isRoom601 = room.ma_phong === '601-50-sac-thai';
          const hasBigTub = isRoom601 || rawTextCombined.includes('bồn tắm lớn');
          const tubStatus = room.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE' ? 'TRUE' : 'FALSE';
          const tubLabel = hasBigTub ? 'Bồn tắm lớn' : tubStatus === 'TRUE' ? 'Bồn tắm nằm thư giãn' : 'Không có bồn tắm';

          let formattedName = room.ten_phong;
          const firstPart = room.ma_phong.split('-')[0];
          const isNumeric = /^\d+$/.test(firstPart);
          if (room.ma_phong === '601-50-sac-thai') {
            formattedName = '50 — Sắc Thái (Mã 601)';
          } else if (isNumeric) {
            formattedName = room.ten_phong.includes(firstPart)
              ? room.ten_phong
              : `${firstPart} — ${room.ten_phong}`;
          }

          return {
            toolCallId,
            toolName,
            status: 'SUCCESS',
            data: {
              room_id: room.ma_phong,
              room_name: formattedName,
              category: room.hang,
              property_id: room.co_so_ma,
              has_bathtub: tubStatus,
              bathtub_status: tubLabel,
              bathtub_dimension: 'UNKNOWN', // Ground truth: metric dimensions unconfirmed officially
              has_jacuzzi_jets: 'UNKNOWN', // Ground truth: bubbling jets unconfirmed officially
              has_love_chair: room.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE',
              has_elevator: room.tien_nghi.thang_may?.status === 'CONFIRMED_TRUE' ? 'TRUE' : 'UNKNOWN',
              has_smart_tv: 'TRUE',
              has_projector: ['101-long-chim', '201-la-casta'].includes(room.ma_phong) ? 'TRUE' : 'UNKNOWN',
              has_pool: 'UNKNOWN', // Ground truth: pool not in property room amenities
              has_sauna: 'UNKNOWN', // Ground truth: sauna not in property room amenities
              has_kitchen: 'UNKNOWN', // Ground truth: kitchen not confirmed in room dataset amenities
              bed_type: 'giường đôi tiêu chuẩn',
              extra_hour_rate: room.gia_goc_dataset.gio_phat_sinh_ap_dung,
              extra_hour_rate_source: room.gia_goc_dataset.nguon_gio_phat_sinh,
              pricing_snapshot: room.gia_goc_dataset,
              verified_amenities: room.nhom_nhu_cau || [],
              booking_link: room.link_phong,
            },
            provenance: `dataset.phong.${room.ma_phong}`,
          };
        }

        case 'get_room_media': {
          const parsed = GetRoomMediaArgsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return {
              toolCallId,
              toolName,
              status: 'ERROR',
              data: null,
              provenance: 'backend_validator',
              errorMessage: `Invalid arguments for get_room_media: ${parsed.error.message}`,
            };
          }

          if (parsed.data.property_id && parsed.data.property_id !== this.trustedPropertyId) {
            throw new Error(`Tenant Isolation Violation: Tool call target ${parsed.data.property_id} is forbidden outside ${this.trustedPropertyId} scope.`);
          }

          const targetId = parsed.data.room_id.toLowerCase().trim();
          const room = this.dataset.phong.find(
            (p) =>
              p.co_so_ma === this.trustedPropertyId &&
              (p.ma_phong.toLowerCase() === targetId ||
                p.ma_phong.toLowerCase().includes(targetId) ||
                p.ten_phong.toLowerCase().includes(targetId))
          );

          if (!room) {
            return {
              toolCallId,
              toolName,
              status: 'NO_DATA',
              data: null,
              provenance: 'dataset.phong.anh',
              errorMessage: `Room ${targetId} not found in property ${this.trustedPropertyId}`,
            };
          }

          let formattedName = room.ten_phong;
          const firstPart = room.ma_phong.split('-')[0];
          const isNumeric = /^\d+$/.test(firstPart);
          if (room.ma_phong === '601-50-sac-thai') {
            formattedName = '50 — Sắc Thái (Mã 601)';
          } else if (isNumeric) {
            formattedName = room.ten_phong.includes(firstPart)
              ? room.ten_phong
              : `${firstPart} — ${room.ten_phong}`;
          }

          return {
            toolCallId,
            toolName,
            status: 'SUCCESS',
            data: {
              room_id: room.ma_phong,
              room_name: formattedName,
              booking_link: room.link_phong,
              images: (room.anh || []).map((img) => ({
                label: img.nhan,
                url: img.url,
                alt: img.alt ?? `Ảnh phòng ${room.ten_phong}`,
              })),
            },
            provenance: `dataset.phong.${room.ma_phong}.anh`,
          };
        }

        case 'get_policies': {
          const parsed = GetPoliciesArgsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return {
              toolCallId,
              toolName,
              status: 'ERROR',
              data: null,
              provenance: 'backend_validator',
              errorMessage: `Invalid arguments for get_policies: ${parsed.error.message}`,
            };
          }

          if (parsed.data.property_id && parsed.data.property_id !== this.trustedPropertyId) {
            throw new Error(`Tenant Isolation Violation: Tool call target ${parsed.data.property_id} is forbidden outside ${this.trustedPropertyId} scope.`);
          }

          const topic = parsed.data.topic.toLowerCase().trim();
          let policyContent = '';
          const source = 'j_collection_business_policy_v1_4_3.json';

          const cs = this.dataset.co_so.find((c) => c.ma === this.trustedPropertyId);
          const propertyName = cs?.ten || (this.trustedPropertyId === 'jacayl-tran-khat-chan' ? 'Jacayl Hotel Trần Khát Chân' : this.trustedPropertyId === 'j-village' ? 'J Village' : 'Jacayl Hotel Hà Đông');
          const address = cs?.dia_chi || (this.trustedPropertyId === 'jacayl-tran-khat-chan' ? '283 Trần Khát Chân, quận Hai Bà Trưng, Hà Nội' : this.trustedPropertyId === 'j-village' ? '64 Triệu Việt Vương, quận Hai Bà Trưng, Hà Nội' : 'Ngã ba Phúc La Phùng Hưng, quận Hà Đông, Hà Nội');

          let parkingInfo = `Cơ sở ${propertyName} có chỗ đỗ ô tô và xe máy cho khách lưu trú.`;
          if (this.trustedPropertyId === 'jacayl-tran-khat-chan') {
            parkingInfo = `Cơ sở ${propertyName} có chỗ đỗ xe máy thuận tiện trong khuôn viên, ô tô gửi tại điểm trông xe gần khách sạn có nhân viên hướng dẫn.`;
          } else if (this.trustedPropertyId === 'j-village') {
            parkingInfo = `Cơ sở ${propertyName} nằm tại phố Triệu Việt Vương, có chỗ để xe máy tại cơ sở; ô tô gửi tại điểm trông xe gần khách sạn theo hướng dẫn của lễ tân.`;
          }

          if (topic.includes('park') || topic.includes('do_xe') || topic.includes('xe')) {
            policyContent = parkingInfo;
          } else if (topic.includes('holiday') || topic.includes('le') || topic.includes('tet')) {
            policyContent = 'Theo Business Policy V1.4.3: J Collection không áp dụng phụ thu ngày lễ hay nhân hệ số giá riêng vào các dịp lễ tết. Biểu giá được giữ nguyên theo chính sách thông thường của ngày và giờ nhận phòng.';
          } else if (
            topic.includes('stay_hours') ||
            topic.includes('early_late') ||
            topic.includes('checkin') ||
            topic.includes('checkout') ||
            topic.includes('gio')
          ) {
            policyContent =
              'Thời gian nghỉ giờ tiêu chuẩn tối thiểu là 2 tiếng (không áp dụng gói 1 tiếng và không chia nửa giá). ' +
              'Khung giờ nhận phòng: ban ngày từ 08:00 đến tối đa 18:00 (sau 18:00 áp dụng giá nghỉ giờ buổi tối). ' +
              'Gói qua đêm: nhận phòng tiêu chuẩn từ 22:00 (hỗ trợ nhận sớm tối đa 20 phút từ 21:40) đến 12:00 trưa hôm sau. ' +
              'Gói cả ngày (ngày đêm): nhận phòng từ 14:00 hôm nay đến 12:00 trưa hôm sau. ' +
              'Nhận phòng sáng sớm trước 08:00 áp dụng biểu giá nghỉ giờ thông thường của ban ngày. ' +
              'Chính sách ân hạn quá giờ: dưới 10 phút miễn phí; từ 10 phút trở lên tính tròn 1 giờ phát sinh theo đơn giá của từng phòng.';
          } else if (topic.includes('extra_person') || topic.includes('third_person') || topic.includes('nguoi_thu_ba') || topic.includes('nguoi_thu_3')) {
            policyContent =
              'Theo quy định của J Collection, chính sách phụ thu người thứ ba lưu trú qua đêm hiện chưa được công bố chính thức trên dữ liệu hệ thống (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp quầy lễ tân để được kiểm tra và hỗ trợ cụ thể.';
          } else if (topic.includes('smoking') || topic.includes('hut_thuoc')) {
            policyContent =
              'Theo chính sách của khách sạn, trong phòng ngủ không được hút thuốc lá để đảm bảo không gian thơm tho, sạch sẽ cho tất cả khách lưu trú.';
          } else if (topic.includes('payment') || topic.includes('thanh_toan') || topic.includes('chuyen_khoan')) {
            policyContent =
              'Khách sạn nhận thanh toán bằng tiền mặt hoặc chuyển khoản ngân hàng qua mã QR tiện lợi tại quầy lễ tân.';
          } else if (topic.includes('pool') || topic.includes('ho_boi') || topic.includes('sauna') || topic.includes('bep')) {
            policyContent =
              'Thông tin về hồ bơi, phòng xông hơi sauna hoặc bếp nấu ăn riêng hiện chưa được công bố chính thức trên dữ liệu hệ thống khách sạn.';
          } else if (topic.includes('address') || topic.includes('dia_chi')) {
            policyContent =
              `Cơ sở ${propertyName} có địa chỉ tại ${address}. Vị trí riêng tư, yên tĩnh và thuận tiện đỗ xe ô tô, xe máy.`;
          } else if (topic.includes('wifi')) {
            policyContent = `Toàn bộ khuôn viên và các phòng tại ${propertyName} đều được trang bị wifi tốc độ cao miễn phí.`;
          } else if (topic.includes('water') || topic.includes('nuoc')) {
            policyContent = 'Trong phòng luôn chuẩn bị sẵn nước lọc miễn phí cùng trà và cà phê để phục vụ khách lưu trú.';
          } else if (topic.includes('elevator') || topic.includes('thang_may')) {
            policyContent = `Cơ sở ${propertyName} có thang máy di chuyển thuận tiện giữa các tầng cho khách lưu trú.`;
          } else {
            policyContent = `Quy định và thông tin lưu trú tại ${propertyName} tuân thủ theo Business Policy V1.4.3 và quy chế khách sạn.`;
          }

          return {
            toolCallId,
            toolName,
            status: 'SUCCESS',
            data: {
              topic,
              property_id: this.trustedPropertyId,
              policy_text: policyContent,
              source,
              version: '1.4.3',
            },
            provenance: source,
          };
        }

        case 'quote_price': {
          const parsed = QuotePriceArgsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return {
              toolCallId,
              toolName,
              status: 'ERROR',
              data: null,
              provenance: 'backend_validator',
              errorMessage: `Invalid arguments for quote_price: ${parsed.error.message}`,
            };
          }

          if (parsed.data.property_id && parsed.data.property_id !== this.trustedPropertyId) {
            throw new Error(`Tenant Isolation Violation: Tool call target ${parsed.data.property_id} is forbidden outside ${this.trustedPropertyId} scope.`);
          }

          // Support single room or batch rooms
          const targetIds: string[] = [];
          if (parsed.data.room_id) targetIds.push(parsed.data.room_id.toLowerCase().trim());
          if (parsed.data.room_ids && Array.isArray(parsed.data.room_ids)) {
            for (const id of parsed.data.room_ids) {
              const clean = id.toLowerCase().trim();
              if (!targetIds.includes(clean)) targetIds.push(clean);
            }
          }

          const quotes: any[] = [];
          for (const targetId of targetIds) {
            const room = this.dataset.phong.find(
              (p) =>
                p.co_so_ma === this.trustedPropertyId &&
                (p.ma_phong.toLowerCase() === targetId ||
                  p.ma_phong.toLowerCase().includes(targetId) ||
                  p.ten_phong.toLowerCase().includes(targetId))
            );

            if (!room) continue;

            const effectiveDuration =
              parsed.data.stay_type === 'nghi_gio'
                ? Math.max(2, parsed.data.duration_hours)
                : parsed.data.duration_hours;

            const quote = this.quoteEngine.getQuote({
              co_so_ma: this.trustedPropertyId,
              ma_phong: room.ma_phong,
              stay_type: parsed.data.stay_type,
              duration_hours: effectiveDuration,
              checkin_datetime: parsed.data.checkin_datetime,
            });

            let formattedQuoteRoomName = room.ten_phong;
            if (room.ma_phong === '601-50-sac-thai') {
              formattedQuoteRoomName = '50 — Sắc Thái (Mã 601)';
            } else {
              const rNum = room.ma_phong.split('-')[0];
              formattedQuoteRoomName = room.ten_phong.includes(rNum)
                ? room.ten_phong
                : `${rNum} — ${room.ten_phong}`;
            }

            const quoteObj = {
              quote_id: `quote_${room.ma_phong}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              room_id: room.ma_phong,
              room_name: formattedQuoteRoomName,
              category: room.hang,
              property_id: this.trustedPropertyId,
              checkin_conditions: {
                checkin_datetime: parsed.data.checkin_datetime,
                stay_type: quote.stay_type,
                duration_hours: quote.duration_hours,
              },
              stay_type: quote.stay_type,
              duration_hours: quote.duration_hours,
              base_price: quote.base_2h_price,
              base_price_vnd: quote.base_2h_price,
              extra_hours: quote.extra_hours,
              extra_hour_rate: quote.extra_hour_rate,
              additional_charges_vnd: (quote.extra_hours || 0) * (quote.extra_hour_rate || 0),
              total_price_vnd: quote.total_estimate,
              price_breakdown_text: quote.price_breakdown_text,
              policy_version: quote.policy_version,
              pricing_status: quote.pricing_status,
              evidence_references: quote.evidence_references,
            };
            quotes.push(quoteObj);
          }

          if (quotes.length === 0) {
            return {
              toolCallId,
              toolName,
              status: 'NO_DATA',
              data: null,
              provenance: 'quote_engine',
              errorMessage: `None of the requested rooms (${targetIds.join(', ')}) were found in property ${this.trustedPropertyId}`,
            };
          }

          // Return primary quote fields for single quote backward compat + full array for batch
          const primary = quotes[0];
          return {
            toolCallId,
            toolName,
            status: 'SUCCESS',
            data: {
              ...primary,
              quotes,
              total_quoted: quotes.length,
            },
            provenance: 'prebooking_quote_engine.business_policy_v1_4_3',
          };
        }

        default:
          return {
            toolCallId,
            toolName,
            status: 'UNAUTHORIZED',
            data: null,
            provenance: 'backend_security_gate',
            errorMessage: `Tool ${toolName} is not recognized or not permitted.`,
          };
      }
    } catch (err: any) {
      return {
        toolCallId,
        toolName,
        status: 'ERROR',
        data: null,
        provenance: 'backend_runtime',
        errorMessage: `Unexpected error executing ${toolName}: ${err.message}`,
      };
    }
  }
}
