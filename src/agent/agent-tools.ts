import { z } from 'zod';
import { NormalizedDataset, NormalizedRoom } from '../domain/normalized-schema.js';
import { CoSoMa, RawRoomCategory, StayType } from '../domain/types.js';
import { InMemoryRoomSearchEngine } from '../search/in-memory-room-search.js';
import { PreBookingQuoteEngine } from '../pricing/prebooking-quote-engine.js';
import { KnowledgeBase } from '../knowledge/knowledge-base.js';
import { ToolCall, ToolResult } from './agent-contracts.js';
import { isRoomNotForSale, getRoomOperationalRecord } from '../domain/room-business-registry.js';
import {
  getEffectivePolicyMetadata,
  getHolidayPolicyProvenance,
  loadActivePricingPolicyConfig,
  loadOwnerPolicyAddendums,
} from '../data-loader/pricing-policy-loader.js';
import { StayPackageEligibilityResolver } from '../pricing/stay-package-eligibility.js';
import { EvidenceField } from '../domain/evidence.js';

/**
 * Distinguishes TRUE / FALSE / UNKNOWN cleanly without converting website omission into FALSE.
 */
export function resolveTriStateAmenity(field?: EvidenceField<boolean>): 'TRUE' | 'FALSE' | 'UNKNOWN' {
  if (!field) return 'UNKNOWN';
  if (field.status === 'CONFIRMED_TRUE') return 'TRUE';
  if (field.status === 'CONFIRMED_FALSE') {
    const reason = (field.reason || '').toLowerCase();
    // Absence of mention in website copy is epistemic UNKNOWN, never confirmed negative
    if (reason.includes('không có ghi nhận') || reason.includes('không nhắc')) {
      return 'UNKNOWN';
    }
    return 'FALSE';
  }
  return 'UNKNOWN';
}

// ============================================================================
// ZOD SCHEMAS FOR THE 5 READ-ONLY TOOLS (V2.0 EVIDENCE-FIRST SPECIFICATION)
// ============================================================================

export const SearchRoomsArgsSchema = z.object({
  property_id: z.string().default('jacayl-ha-dong'),
  must_have_amenities: z.array(z.string()).default([]),
  category: z.enum(['Standard', 'Deluxe', 'Concept', 'Superior', 'Premium', 'Suite', 'VIP Signature']).nullish(),
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
    stay_intent: z.enum(['hourly', 'overnight_until_next_day', 'day_night', 'unspecified']).nullish(),
    duration_hours: z.number().positive().nullish(),
    checkin_datetime: z.string().nullish(),
    checkout_datetime: z.string().nullish(),
    checkin_confidence: z.enum(['CONFIRMED', 'INFERRED', 'CONDITIONAL', 'UNKNOWN']).nullish(),
  })
  .superRefine((data, ctx) => {
    if (!data.room_id && (!data.room_ids || data.room_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either room_id or room_ids must be provided',
      });
    }
    if (
      data.stay_type === 'nghi_gio' &&
      data.duration_hours !== undefined &&
      data.duration_hours !== null &&
      (!Number.isInteger(data.duration_hours) || data.duration_hours < 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['duration_hours'],
        message: 'duration_hours must be an integer >= 1 for hourly stay_type nghi_gio',
      });
    }
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
  private eligibilityResolver: StayPackageEligibilityResolver;
  public readonly trustedPropertyId: CoSoMa;

  constructor(
    dataset: NormalizedDataset,
    trustedPropertyId: CoSoMa = 'jacayl-ha-dong',
    options?: {
      searchEngine?: InMemoryRoomSearchEngine;
      quoteEngine?: PreBookingQuoteEngine;
      kb?: KnowledgeBase;
      eligibilityResolver?: StayPackageEligibilityResolver;
    }
  ) {
    this.dataset = dataset;
    this.trustedPropertyId = trustedPropertyId;
    this.searchEngine = options?.searchEngine ?? new InMemoryRoomSearchEngine(dataset);
    this.quoteEngine = options?.quoteEngine ?? new PreBookingQuoteEngine(dataset);
    this.kb = options?.kb ?? new KnowledgeBase(dataset);
    this.eligibilityResolver = options?.eligibilityResolver ?? new StayPackageEligibilityResolver();
  }

  /**
   * Returns tool descriptions for LLM reasoning prompt, strictly scoped to trustedPropertyId.
   */
  public getToolDeclarations(): AgentToolDeclaration[] {
    const propertyCategories =
      this.trustedPropertyId === 'jacayl-tran-khat-chan'
        ? ['Standard', 'Premium', 'Concept', 'VIP Signature']
        : this.trustedPropertyId === 'j-village'
          ? ['Superior', 'Deluxe', 'Concept', 'Suite']
          : ['Standard', 'Deluxe', 'Concept'];

    return [
      {
        name: 'search_rooms',
        description: 'Static catalog search (NO live vacancy/housekeeping). Ha Dong 401 is NOT_FOR_SALE.',
        parameters: {
          type: 'object',
          properties: {
            property_id: { type: 'string', description: this.trustedPropertyId },
            must_have_amenities: { type: 'array', items: { type: 'string' }, description: "e.g. ['bon_tam','ghe_tinh_yeu']" },
            category: { type: 'string', enum: propertyCategories },
            max_budget: { type: 'number', description: 'VND' },
          },
        },
      },
      {
        name: 'get_room_facts',
        description: 'Static verified room facts (bathtub, love_chair, extra_hour, TRUE/FALSE/UNKNOWN).',
        parameters: {
          type: 'object',
          required: ['room_id'],
          properties: {
            property_id: { type: 'string' },
            room_id: { type: 'string', description: 'e.g. "601-50-sac-thai", "101-long-chim"' },
          },
        },
      },
      {
        name: 'get_room_media',
        description: 'Verified room photo URLs and booking reference link.',
        parameters: {
          type: 'object',
          required: ['room_id'],
          properties: {
            property_id: { type: 'string' },
            room_id: { type: 'string' },
          },
        },
      },
      {
        name: 'get_policies',
        description: 'Official policy lookup by topic.',
        parameters: {
          type: 'object',
          required: ['topic'],
          properties: {
            property_id: { type: 'string' },
            topic: {
              type: 'string',
              description: 'parking|holiday|stay_hours|breakfast|extra_person|smoking|payment|early_late|cancellation|deposit|wifi|water|pool',
            },
          },
        },
      },
      {
        name: 'quote_price',
        description:
          'Policy V1.4.3 + V1.4.6 price, stay-package eligibility, and late-checkout calculator. Pass checkin_datetime and optional checkout_datetime (Asia/Ho_Chi_Minh +07:00) when confirmed or inferred; backend evaluates overnight (22:00/grace 21:40-12:00), day-night (14:00-12:00), and recurring 10-min grace on EVERY post-12:00 extra hour (ceil(max(0, lateMinutes - grace)/60) * room extra_hour_rate).',
        parameters: {
          type: 'object',
          required: ['stay_type', 'duration_hours'],
          properties: {
            property_id: { type: 'string' },
            room_id: { type: 'string' },
            room_ids: { type: 'array', items: { type: 'string' }, description: 'Batch room IDs' },
            stay_type: { type: 'string', enum: ['nghi_gio', 'qua_dem', 'ngay_dem'] },
            stay_intent: { type: 'string', enum: ['hourly', 'overnight_until_next_day', 'day_night', 'unspecified'] },
            duration_hours: { type: 'number', description: 'Min 2h for nghi_gio' },
            checkin_datetime: { type: 'string', description: 'ISO-8601 Asia/Ho_Chi_Minh (+07:00) if confirmed/inferred; omit if unknown' },
            checkout_datetime: { type: 'string', description: 'Optional ISO-8601 Asia/Ho_Chi_Minh (+07:00) checkout if guest specified (e.g. next day 14:00)' },
            checkin_confidence: { type: 'string', enum: ['CONFIRMED', 'INFERRED', 'CONDITIONAL', 'UNKNOWN'] },
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
              missingEvidenceAmenities.push(am);
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
          if (mappedAmenities.length > 0 || parsed.data.category) {
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
                ? resolveTriStateAmenity(p.tien_nghi.bon_tam) === 'FALSE'
                  ? 'Confirmed absent amenity: bon_tam'
                  : 'Unconfirmed amenity in catalog: bon_tam (UNKNOWN — website description omits bathtub)'
                : mappedAmenities.includes('ghe_tinh_yeu') && p.tien_nghi.ghe_tinh_yeu?.status !== 'CONFIRMED_TRUE'
                  ? resolveTriStateAmenity(p.tien_nghi.ghe_tinh_yeu) === 'FALSE'
                    ? 'Confirmed absent amenity: ghe_tinh_yeu'
                    : 'Unconfirmed amenity in catalog: ghe_tinh_yeu (UNKNOWN — website description omits love chair)'
                  : parsed.data.category && p.hang !== parsed.data.category
                    ? `Category mismatch: ${p.hang} !== ${parsed.data.category}`
                    : 'Did not match search criteria',
            }));

          // Build per-category price range & variation summary directly from dataset so category-level advice never omits price tiers
          const byCategoryMap = new Map<string, NormalizedRoom[]>();
          for (const rm of allSellable) {
            const arr = byCategoryMap.get(rm.hang) || [];
            arr.push(rm);
            byCategoryMap.set(rm.hang, arr);
          }
          const categoryPricingSummary = Array.from(byCategoryMap.entries()).map(([cat, rms]) => {
            const b2h = rms.map((r) => r.gia_goc_dataset.nghi_gio_2h);
            const ovn = rms.map((r) => r.gia_goc_dataset.qua_dem);
            const dnt = rms.map((r) => r.gia_goc_dataset.ngay_dem);
            const ext = rms.map((r) => r.gia_goc_dataset.gio_phat_sinh_ap_dung);
            const minMax = (nums: number[]) => ({ min: Math.min(...nums), max: Math.max(...nums) });
            const extraGroups = new Map<number, string[]>();
            for (const r of rms) {
              const rate = r.gia_goc_dataset.gio_phat_sinh_ap_dung;
              const list = extraGroups.get(rate) || [];
              list.push(`${r.ma_phong} (${r.ten_phong})`);
              extraGroups.set(rate, list);
            }
            const isUniform =
              new Set(b2h).size === 1 &&
              new Set(ovn).size === 1 &&
              new Set(dnt).size === 1 &&
              new Set(ext).size === 1;
            return {
              category: cat,
              room_count: rms.length,
              is_uniform_across_rooms: isUniform,
              ranges: {
                base_2h_vnd: minMax(b2h),
                qua_dem_vnd: minMax(ovn),
                ngay_dem_vnd: minMax(dnt),
                extra_hour_rate_vnd: minMax(ext),
              },
              room_rate_variants: !isUniform
                ? Array.from(extraGroups.entries()).map(([extraRateVnd, rooms]) => ({
                    extra_hour_rate_vnd: extraRateVnd,
                    rooms,
                  }))
                : undefined,
            };
          });

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
              category_pricing_summary: categoryPricingSummary,
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
          if (isRoomNotForSale(this.trustedPropertyId, targetId)) {
            const opRecord = getRoomOperationalRecord(this.trustedPropertyId, targetId);
            return {
              toolCallId,
              toolName,
              status: 'SUCCESS',
              data: {
                room_id: targetId,
                room_name: `Phòng ${opRecord?.room_code || targetId} (Không kinh doanh)`,
                property_id: this.trustedPropertyId,
                commercial_status: 'NOT_FOR_SALE',
                explanation: opRecord?.display_explanation || 'Phòng tồn tại thực tế nhưng không sử dụng để kinh doanh.',
              },
              provenance: `room_business_registry.${this.trustedPropertyId}.${targetId}`,
            };
          }

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
          const tubStatus = resolveTriStateAmenity(room.tien_nghi.bon_tam);
          const loveChairStatus = resolveTriStateAmenity(room.tien_nghi.ghe_tinh_yeu);
          const tubLabel = hasBigTub
            ? 'Bồn tắm lớn'
            : tubStatus === 'TRUE'
              ? 'Bồn tắm nằm thư giãn'
              : tubStatus === 'FALSE'
                ? 'Không có bồn tắm (Đã xác nhận)'
                : 'Chưa có thông tin xác nhận bồn tắm trong dữ liệu catalog (UNKNOWN — vui lòng liên hệ lễ tân để kiểm tra thực tế)';

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

          const mentionsTv = /\btv\b|tủ tv/i.test(rawTextCombined);
          return {
            toolCallId,
            toolName,
            status: 'SUCCESS',
            data: {
              room_id: room.ma_phong,
              room_name: formattedName,
              category: room.hang,
              property_id: room.co_so_ma,
              catalog_scope_note: 'Static catalog facts only — NOT real-time room availability or housekeeping readiness.',
              amenity_knowledge_policy: 'Absence of mention in website catalog equals UNKNOWN (not confirmed FALSE); state UNKNOWN and advise checking with reception unless explicitly TRUE or FALSE.',
              has_bathtub: tubStatus,
              bathtub_status: tubLabel,
              bathtub_dimension: 'UNKNOWN', // Ground truth: metric dimensions unconfirmed officially
              has_jacuzzi_jets: 'UNKNOWN', // Ground truth: bubbling jets unconfirmed officially
              has_love_chair: loveChairStatus,
              has_elevator: room.tien_nghi.thang_may?.status === 'CONFIRMED_TRUE' ? 'TRUE' : 'UNKNOWN',
              has_tv_catalog_mention: mentionsTv ? 'TRUE' : 'UNKNOWN',
              has_smart_tv: 'UNKNOWN', // Ground truth: Smart TV across rooms is NOT confirmed in canonical dataset
              has_netflix_youtube: 'UNKNOWN', // Ground truth: Netflix/YouTube apps NOT confirmed in canonical dataset
              has_projector: 'UNKNOWN', // Ground truth: projector is UNCONFIRMED in official dataset
              has_pool: 'UNKNOWN', // Ground truth: absence of mention in dataset means UNKNOWN, not confirmed absent
              has_sauna: 'UNKNOWN', // Ground truth: sauna not confirmed in canonical dataset
              has_kitchen: 'UNKNOWN', // Ground truth: kitchen not confirmed in canonical dataset
              housekeeping_readiness: 'UNKNOWN_NO_LIVE_PMS',
              bed_type: 'UNKNOWN_NOT_SPECIFIED_SIZE',
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
          if (isRoomNotForSale(this.trustedPropertyId, targetId)) {
            const opRecord = getRoomOperationalRecord(this.trustedPropertyId, targetId);
            return {
              toolCallId,
              toolName,
              status: 'SUCCESS',
              data: {
                room_id: targetId,
                room_name: `Phòng ${opRecord?.room_code || targetId} (Không kinh doanh)`,
                property_id: this.trustedPropertyId,
                commercial_status: 'NOT_FOR_SALE',
                explanation: opRecord?.display_explanation || 'Phòng tồn tại thực tế nhưng không sử dụng để kinh doanh.',
              },
              provenance: `room_business_registry.${this.trustedPropertyId}.${targetId}`,
            };
          }

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
              property_id: this.trustedPropertyId,
              room_id: room.ma_phong,
              room_code: firstPart,
              room_name: formattedName,
              category: room.hang,
              booking_link: room.link_phong,
              images: (room.anh || []).map((img, idx) => {
                const rawAlt = img.alt?.trim();
                const genericPrefix = `Ảnh phòng ${room.ten_phong}`.toLowerCase();
                const descriptiveCaption =
                  rawAlt && rawAlt.toLowerCase() !== genericPrefix && !rawAlt.toLowerCase().startsWith('ảnh phòng ')
                    ? `${formattedName} — ${rawAlt}`
                    : `${formattedName} — Ảnh ${idx + 1}`;
                return {
                  propertyId: this.trustedPropertyId,
                  roomId: room.ma_phong,
                  roomCode: firstPart,
                  roomName: formattedName,
                  label: img.nhan,
                  url: img.url,
                  order: idx,
                  caption: descriptiveCaption,
                  alt: rawAlt ?? `Ảnh ${formattedName}`,
                };
              }),
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
          const policyMeta = getEffectivePolicyMetadata();
          const addendum = loadOwnerPolicyAddendums();
          let policyContent = '';
          let source = policyMeta.activeAddendumFilename || 'j_collection_business_policy_v1_4_3.json';
          let policyVersion = policyMeta.effectivePolicyVersion;
          let structuredPolicyData: Record<string, any> | undefined;

          const cs = this.dataset.co_so.find((c) => c.ma === this.trustedPropertyId);
          const propertyName = cs?.ten || (this.trustedPropertyId === 'jacayl-tran-khat-chan' ? 'Jacayl Hotel Trần Khát Chân' : this.trustedPropertyId === 'j-village' ? 'J Village' : 'Jacayl Hotel Hà Đông');
          const address = cs?.dia_chi || (this.trustedPropertyId === 'jacayl-tran-khat-chan' ? '283 Trần Khát Chân, quận Hai Bà Trưng, Hà Nội' : this.trustedPropertyId === 'j-village' ? '64 Triệu Việt Vương, quận Hai Bà Trưng, Hà Nội' : 'Ngã ba Phúc La Phùng Hưng, quận Hà Đông, Hà Nội');
          const phone = cs?.dien_thoai || '';

          const parkingInfo =
            `Dữ liệu chính thức của ${propertyName} xác nhận: "Có chỗ đỗ xe." (quy_dinh.do_xe). ` +
            `Thông tin chi tiết về loại xe cụ thể (ví dụ ô tô 7 chỗ, ô tô 4 chỗ, xe máy), vị trí điểm đỗ hoặc phí gửi xe (nếu có) hiện chưa được công bố chi tiết trong hệ thống (UNKNOWN)` +
            (phone ? ` — anh/chị vui lòng liên hệ lễ tân (${phone}) để xác nhận trực tiếp ạ.` : ' — anh/chị vui lòng liên hệ lễ tân để xác nhận trực tiếp ạ.');

          if (topic.includes('park') || topic.includes('do_xe') || topic.includes('xe')) {
            policyContent = parkingInfo;
          } else if (topic.includes('holiday') || topic.includes('le') || topic.includes('tet')) {
            const holProv = getHolidayPolicyProvenance(loadActivePricingPolicyConfig());
            source = holProv.provenancePath;
            policyContent = holProv.confirmedByOwner
              ? `Theo chính sách được Chủ dự án xác nhận (${holProv.policyId} / ${holProv.sourceType}): ${holProv.statement}`
              : holProv.statement;
            structuredPolicyData = {
              holiday_surcharge_status: holProv.status,
              holiday_surcharge_vnd: holProv.confirmedByOwner && holProv.hasHolidaySurcharge === false ? 0 : null,
              approved_by_owner: holProv.confirmedByOwner,
              approval_status: holProv.approvalStatus,
              source_type: holProv.sourceType,
              provenance: holProv.provenancePath,
            };
          } else if (
            topic.includes('stay_hours') ||
            topic.includes('early_late') ||
            topic.includes('late_checkout') ||
            topic.includes('checkin') ||
            topic.includes('checkout') ||
            topic.includes('gio')
          ) {
            const lateStmt =
              addendum?.late_checkout?.official_statement ||
              'Trả phòng sau 12:00 đối với gói qua đêm và ngày đêm áp dụng ân hạn 10 phút cho từng mốc giờ phát sinh (12:00–12:10 = 0h; 12:11–13:10 = 1h; 13:11–14:10 = 2h...) theo đơn giá riêng của từng phòng (mặc định 100.000đ/giờ; 601 & 602 Hà Đông 200.000đ/giờ).';
            policyContent =
              'Thời gian nghỉ giờ tiêu chuẩn tối thiểu là 2 tiếng (không áp dụng gói 1 tiếng và không chia nửa giá). ' +
              'Khung giờ nhận phòng: ban ngày từ 08:00 đến trước 18:00 (từ 18:00 áp dụng biểu giá gốc trong dataset). ' +
              'Gói qua đêm: nhận phòng tiêu chuẩn từ 22:00 (hỗ trợ nhận sớm tối đa 20 phút từ 21:40) đến 12:00 trưa hôm sau. ' +
              'Gói cả ngày (ngày đêm): nhận phòng từ 14:00 hôm nay đến 12:00 trưa hôm sau. ' +
              'Nhận phòng sáng sớm trước 08:00 áp dụng biểu giá nghỉ giờ gốc trong dataset. ' +
              `Chính sách trả phòng muộn & quá giờ (Policy V${policyVersion}): ${lateStmt}`;
            if (addendum?.late_checkout) {
              structuredPolicyData = addendum.late_checkout;
            }
          } else if (topic.includes('extra_person') || topic.includes('third_person') || topic.includes('nguoi_thu_ba') || topic.includes('nguoi_thu_3')) {
            policyContent =
              'Theo quy định của J Collection, chính sách phụ thu người thứ ba lưu trú qua đêm hiện chưa được công bố chính thức trên dữ liệu hệ thống (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp quầy lễ tân để được kiểm tra và hỗ trợ cụ thể.';
          } else if (topic.includes('smoking') || topic.includes('hut_thuoc')) {
            policyContent =
              'Thông tin quy định hút thuốc lá trong phòng hiện chưa được công bố chính thức trong dataset chuẩn hóa (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp quầy lễ tân để được hỗ trợ và xác nhận quy định tại cơ sở.';
          } else if (topic.includes('payment') || topic.includes('thanh_toan') || topic.includes('chuyen_khoan')) {
            policyContent =
              'Thông tin chi tiết về hình thức thanh toán (tiền mặt/chuyển khoản) chưa được công bố chi tiết trong dữ liệu hệ thống; anh/chị có thể liên hệ trực tiếp lễ tân để được hỗ trợ cụ thể.';
          } else if (topic.includes('pool') || topic.includes('ho_boi') || topic.includes('be_boi') || topic.includes('sauna') || topic.includes('bep')) {
            policyContent =
              'Thông tin về hồ bơi/bể bơi, phòng xông hơi sauna hoặc bếp nấu ăn riêng chưa có dữ liệu xác nhận chính thức trong hệ thống (UNKNOWN — không tìm thấy trong catalog cũng chưa đủ căn cứ khẳng định có hay không). Anh/chị vui lòng liên hệ lễ tân để xác minh trực tiếp.';
          } else if (topic.includes('address') || topic.includes('dia_chi')) {
            policyContent =
              `Cơ sở ${propertyName} có địa chỉ chính thức tại ${address}.`;
          } else if (topic.includes('wifi')) {
            policyContent = `Thông tin chi tiết về tốc độ/mật khẩu wifi chưa được công bố trong dữ liệu catalog (UNKNOWN); anh/chị có thể hỏi lễ tân khi nhận phòng.`;
          } else if (topic.includes('water') || topic.includes('nuoc')) {
            policyContent = 'Thông tin về nước uống miễn phí trong phòng chưa được công bố chi tiết trong dữ liệu catalog (UNKNOWN); anh/chị vui lòng kiểm tra với lễ tân khi nhận phòng.';
          } else if (topic.includes('elevator') || topic.includes('thang_may')) {
            policyContent = `Thông tin thang máy phụ thuộc từng hạng phòng/cơ sở trong dữ liệu xác thực; nếu chưa ghi nhận ở phòng cụ thể, anh/chị vui lòng liên hệ lễ tân để xác nhận.`;
          } else if (
            topic.includes('breakfast') ||
            topic.includes('an_sang') ||
            topic.includes('bua_sang') ||
            topic.includes('sang')
          ) {
            if (addendum?.breakfast) {
              policyContent = addendum.breakfast.official_statement;
              source = 'j_collection_business_policy_addendum_v1_4_5.json';
              policyVersion = policyMeta.effectivePolicyVersion;
              structuredPolicyData = addendum.breakfast;
            } else {
              policyContent =
                'Giá phòng tại cả 3 cơ sở và mọi gói nghỉ đều không bao gồm bữa sáng; khách sạn không phục vụ bữa sáng và không cung cấp dịch vụ bán suất sáng riêng.';
            }
          } else {
            policyContent = `Quy định và thông tin lưu trú tại ${propertyName} tuân thủ theo Business Policy V1.4.3 và Owner Addendum V${policyVersion}.`;
          }

          return {
            toolCallId,
            toolName,
            status: 'SUCCESS',
            data: {
              topic,
              property_id: this.trustedPropertyId,
              policy_text: policyContent,
              ...(structuredPolicyData ? { structured: structuredPolicyData } : {}),
              source,
              version: policyVersion,
              effective_policy_version: policyMeta.effectivePolicyVersion,
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
            if (isRoomNotForSale(this.trustedPropertyId, targetId)) {
              const opRecord = getRoomOperationalRecord(this.trustedPropertyId, targetId);
              quotes.push({
                quote_id: `quote_nfs_${targetId}_${Date.now()}`,
                room_id: targetId,
                room_name: `Phòng ${opRecord?.room_code || targetId} (Không kinh doanh)`,
                property_id: this.trustedPropertyId,
                pricing_status: 'NOT_FOR_SALE',
                price_breakdown_text: opRecord?.display_explanation || 'Phòng không sử dụng để kinh doanh.',
                policy_version: '1.4.3',
                evidence_references: [`Room Business Registry: ${this.trustedPropertyId}::${targetId} = NOT_FOR_SALE`],
              });
              continue;
            }

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
                ? Math.max(2, parsed.data.duration_hours ?? 2)
                : 2;

            const rawCheckin = parsed.data.checkin_datetime?.trim();
            const hasExplicitCheckin = Boolean(rawCheckin && rawCheckin.toUpperCase() !== 'UNSPECIFIED' && rawCheckin.length >= 10);

            let formattedQuoteRoomName = room.ten_phong;
            if (room.ma_phong === '601-50-sac-thai') {
              formattedQuoteRoomName = '50 — Sắc Thái (Mã 601)';
            } else {
              const rNum = room.ma_phong.split('-')[0];
              formattedQuoteRoomName = room.ten_phong.includes(rNum)
                ? room.ten_phong
                : `${rNum} — ${room.ten_phong}`;
            }

            const isHaDongHourly = this.trustedPropertyId === 'jacayl-ha-dong' && parsed.data.stay_type === 'nghi_gio';

            if (!hasExplicitCheckin && isHaDongHourly) {
              // Epistemic guard: Check-in date/hour not specified -> compute BOTH policy regimes instead of fabricating 14:00 Saturday
              const weekdayQuote = this.quoteEngine.getQuote({
                co_so_ma: this.trustedPropertyId,
                ma_phong: room.ma_phong,
                stay_type: 'nghi_gio',
                duration_hours: effectiveDuration,
                checkin_datetime: '2026-11-24T10:00:00+07:00',
              });
              const weekendQuote = this.quoteEngine.getQuote({
                co_so_ma: this.trustedPropertyId,
                ma_phong: room.ma_phong,
                stay_type: 'nghi_gio',
                duration_hours: effectiveDuration,
                checkin_datetime: '2026-11-28T10:00:00+07:00',
              });

              if (weekdayQuote.pricing_status === 'NOT_FOR_SALE') {
                quotes.push({
                  quote_id: `quote_${room.ma_phong}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  room_id: room.ma_phong,
                  room_name: formattedQuoteRoomName,
                  category: room.hang,
                  property_id: this.trustedPropertyId,
                  checkin_conditions: { checkin_datetime: 'UNSPECIFIED', stay_type: 'nghi_gio', duration_hours: effectiveDuration },
                  stay_type: weekdayQuote.stay_type,
                  duration_hours: weekdayQuote.duration_hours,
                  pricing_status: 'NOT_FOR_SALE',
                  price_breakdown_text: weekdayQuote.price_breakdown_text,
                  policy_version: weekdayQuote.policy_version,
                  evidence_references: weekdayQuote.evidence_references,
                });
                continue;
              }

              const wPrice = weekdayQuote.total_estimate ?? 0;
              const wePrice = weekendQuote.total_estimate ?? 0;
              const isSameAcrossTimes = wPrice === wePrice;

              const conditionalQuotes = [
                {
                  condition_label: 'Ngày thường (T2–T6), hoặc buổi sáng sớm trước 08:00 / buổi tối từ 18:00 trở đi mọi ngày',
                  base_2h_vnd: weekdayQuote.base_2h_price,
                  extra_hours: weekdayQuote.extra_hours,
                  extra_hour_rate: weekdayQuote.extra_hour_rate,
                  total_price_vnd: wPrice,
                  price_breakdown_text: weekdayQuote.price_breakdown_text,
                },
                {
                  condition_label: 'Ban ngày cuối tuần (T7–CN, nhận phòng 08:00–17:59)',
                  base_2h_vnd: weekendQuote.base_2h_price,
                  extra_hours: weekendQuote.extra_hours,
                  extra_hour_rate: weekendQuote.extra_hour_rate,
                  total_price_vnd: wePrice,
                  price_breakdown_text: weekendQuote.price_breakdown_text,
                },
              ];

              quotes.push({
                quote_id: `quote_${room.ma_phong}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                room_id: room.ma_phong,
                room_name: formattedQuoteRoomName,
                category: room.hang,
                property_id: this.trustedPropertyId,
                checkin_conditions: {
                  checkin_datetime: 'UNSPECIFIED',
                  assumption_type: 'CONDITIONAL_UNCONFIRMED_CHECKIN',
                  missing_inputs: ['checkin_day_or_date', 'checkin_hour'],
                  stay_type: 'nghi_gio',
                  duration_hours: effectiveDuration,
                },
                stay_type: 'nghi_gio',
                duration_hours: effectiveDuration,
                min_price_vnd: Math.min(wPrice, wePrice),
                max_price_vnd: Math.max(wPrice, wePrice),
                total_price_vnd: isSameAcrossTimes ? wPrice : null,
                conditional_quotes: conditionalQuotes,
                price_breakdown_text: isSameAcrossTimes
                  ? weekdayQuote.price_breakdown_text
                  : `Ngày thường/sau 18h/trước 08h: ${wPrice.toLocaleString('vi-VN')}đ (${weekdayQuote.price_breakdown_text}) | Ban ngày cuối tuần (T7–CN, 08:00–17:59): ${wePrice.toLocaleString('vi-VN')}đ (${weekendQuote.price_breakdown_text})`,
                policy_version: weekdayQuote.policy_version,
                pricing_status: isSameAcrossTimes ? 'RESOLVED_POLICY_INVARIANT' : 'CONDITIONAL_ON_CHECKIN_TIME',
                evidence_references: [
                  ...(weekdayQuote.evidence_references || []),
                  ...(weekendQuote.evidence_references || []),
                ],
              });
              continue;
            }

            const probeDatetime = hasExplicitCheckin ? rawCheckin! : '2026-11-24T10:00:00+07:00';
            const isOvernightOrDayNightIntent =
              parsed.data.stay_type === 'qua_dem' ||
              parsed.data.stay_type === 'ngay_dem' ||
              parsed.data.stay_intent === 'overnight_until_next_day' ||
              parsed.data.stay_intent === 'day_night';

            // Policy V1.4.3: Evaluate Stay Package Eligibility whenever checkin time + overnight/day-night intent is present
            if (hasExplicitCheckin && isOvernightOrDayNightIntent) {
              const requestedStay =
                parsed.data.stay_type === 'nghi_gio' && parsed.data.stay_intent === 'overnight_until_next_day'
                  ? 'qua_dem'
                  : parsed.data.stay_type;

              const eligibility = this.eligibilityResolver.resolve({
                facility_id: this.trustedPropertyId,
                room_composite_key: { co_so_ma: this.trustedPropertyId, ma_phong: room.ma_phong },
                requested_stay_type: requestedStay,
                requested_checkin_datetime: probeDatetime,
                requested_checkout_datetime: parsed.data.checkout_datetime ?? undefined,
                stay_until_next_day:
                  requestedStay === 'qua_dem' || parsed.data.stay_intent === 'overnight_until_next_day',
              });

              const requestedQuote = this.quoteEngine.getQuote({
                co_so_ma: this.trustedPropertyId,
                ma_phong: room.ma_phong,
                stay_type: requestedStay,
                duration_hours: 1,
                checkin_datetime: probeDatetime,
              });

              const policyMeta = getEffectivePolicyMetadata();
              const recommendedQuote = this.quoteEngine.getQuote({
                co_so_ma: this.trustedPropertyId,
                ma_phong: room.ma_phong,
                stay_type: eligibility.recommended_stay_type,
                duration_hours: 1,
                checkin_datetime: probeDatetime,
                checkout_datetime: parsed.data.checkout_datetime ?? undefined,
              });

              const unconfirmedConditions: string[] = [];
              if (parsed.data.checkin_confidence === 'INFERRED' || parsed.data.checkin_confidence === 'CONDITIONAL') {
                unconfirmedConditions.push(`Thời gian nhận phòng (${probeDatetime}) được suy luận từ ngữ cảnh (${parsed.data.checkin_confidence})`);
              }
              if (!parsed.data.checkout_datetime) {
                unconfirmedConditions.push('Giờ trả phòng chính xác chưa được khách nêu cụ thể (mặc định đối chiếu mốc 12:00 trưa hôm sau của gói)');
              } else if (recommendedQuote.late_checkout_applied && (recommendedQuote.actual_late_checkout_seconds ?? (recommendedQuote.actual_late_checkout_minutes ?? 0) * 60) > 0) {
                unconfirmedConditions.push(
                  'Không có kết nối PMS thời gian thực: báo giá trả phòng muộn chỉ tính theo biểu phí niêm yết, không mặc định xác nhận phòng trống hay khả năng kéo dài giờ trả phòng.'
                );
              }

              const eligiblePackages: any[] = [];
              const ineligiblePackages: any[] = [];

              if (eligibility.eligibility_status === 'NEEDS_POLICY_CLARIFICATION') {
                const hourlyRef = this.quoteEngine.getQuote({
                  co_so_ma: this.trustedPropertyId,
                  ma_phong: room.ma_phong,
                  stay_type: 'nghi_gio',
                  duration_hours: effectiveDuration,
                  checkin_datetime: probeDatetime,
                });
                const dayNightRef = this.quoteEngine.getQuote({
                  co_so_ma: this.trustedPropertyId,
                  ma_phong: room.ma_phong,
                  stay_type: 'ngay_dem',
                  duration_hours: 1,
                  checkin_datetime: probeDatetime,
                });
                ineligiblePackages.push({
                  stay_type: requestedStay,
                  reason: eligibility.customer_explanation,
                  policy_limit: 'Qua đêm: từ 22:00 (ân hạn sớm 21:40) – 12:00 hôm sau; Ngày đêm: từ 14:00 – 12:00 hôm sau.',
                });
                if (hourlyRef.total_estimate) {
                  eligiblePackages.push({
                    stay_type: 'nghi_gio',
                    label: `Nghỉ giờ tham khảo (${effectiveDuration}h tại giờ nhận ${probeDatetime.slice(11, 16)})`,
                    total_price_vnd: hourlyRef.total_estimate,
                    price_breakdown_text: hourlyRef.price_breakdown_text,
                  });
                }
                if (dayNightRef.total_estimate) {
                  eligiblePackages.push({
                    stay_type: 'ngay_dem_standard_ref',
                    label: 'Gói Ngày đêm tiêu chuẩn (nếu nhận từ 14:00 – 12:00 hôm sau)',
                    total_price_vnd: dayNightRef.total_estimate,
                    price_breakdown_text: dayNightRef.price_breakdown_text,
                    requires_reception_confirmation_for_early_checkin: true,
                  });
                }

                quotes.push({
                  quote_id: `quote_${room.ma_phong}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  room_id: room.ma_phong,
                  room_name: formattedQuoteRoomName,
                  category: room.hang,
                  property_id: this.trustedPropertyId,
                  room_identity: {
                    property_id: this.trustedPropertyId,
                    room_id: room.ma_phong,
                    composite_key: `${this.trustedPropertyId}::${room.ma_phong}`,
                    room_name: formattedQuoteRoomName,
                    category: room.hang,
                  },
                  checkin_conditions: {
                    checkin_datetime: rawCheckin!,
                    checkin_confidence: parsed.data.checkin_confidence ?? 'CONFIRMED',
                    checkout_datetime: parsed.data.checkout_datetime ?? 'UNSPECIFIED',
                    stay_type: requestedStay,
                  },
                  stay_type: requestedStay,
                  duration_hours: undefined,
                  total_price_vnd: null,
                  price_breakdown_text: eligibility.customer_explanation,
                  pricing_status: 'NEEDS_POLICY_CLARIFICATION',
                  stay_package_eligibility: {
                    requested_package: eligibility.requested_stay_type,
                    recommended_package: eligibility.recommended_stay_type,
                    eligibility_status: eligibility.eligibility_status,
                    explanation_reason_code: eligibility.explanation_reason_code,
                    business_reason: eligibility.customer_explanation,
                    eligible_packages: eligiblePackages,
                    ineligible_packages: ineligiblePackages,
                    applicable_window: 'Gói Ngày đêm từ 14:00; Gói Qua đêm từ 22:00 (ân hạn 21:40); nhận trước 14:00 ở đến trưa mai cần lễ tân xác nhận.',
                    unconfirmed_conditions: unconfirmedConditions,
                  },
                  policy_version: requestedQuote.policy_version,
                  effective_policy_version: policyMeta.effectivePolicyVersion,
                  applicable_policy_version: policyMeta.effectivePolicyVersion,
                  evidence_references: [
                    ...(requestedQuote.evidence_references || []),
                    ...eligibility.evidence_references,
                  ],
                });
                continue;
              }

              const applicableWindow =
                eligibility.recommended_stay_type === 'ngay_dem'
                  ? '14:00 hôm nay đến 12:00 trưa hôm sau'
                  : eligibility.eligibility_status === 'EARLY_CHECKIN_GRACE_APPLIED'
                    ? '21:40 hôm nay (ân hạn sớm 20 phút so với 22:00) đến 12:00 trưa hôm sau'
                    : '22:00 hôm nay đến 12:00 trưa hôm sau';

              if (recommendedQuote.pricing_status === 'INVALID_DATETIME') {
                quotes.push({
                  quote_id: `quote_${room.ma_phong}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  room_id: room.ma_phong,
                  room_name: formattedQuoteRoomName,
                  category: room.hang,
                  property_id: this.trustedPropertyId,
                  checkin_conditions: {
                    checkin_datetime: rawCheckin!,
                    checkin_confidence: parsed.data.checkin_confidence ?? 'CONFIRMED',
                    checkout_datetime: parsed.data.checkout_datetime ?? 'INVALID',
                    stay_type: eligibility.recommended_stay_type,
                  },
                  stay_type: eligibility.recommended_stay_type,
                  duration_hours: undefined,
                  total_price_vnd: null,
                  price_breakdown_text: recommendedQuote.price_breakdown_text,
                  pricing_status: 'INVALID_DATETIME',
                  policy_version: recommendedQuote.policy_version,
                  effective_policy_version: policyMeta.effectivePolicyVersion,
                  applicable_policy_version: policyMeta.effectivePolicyVersion,
                  evidence_references: recommendedQuote.evidence_references,
                });
                continue;
              }

              eligiblePackages.push({
                stay_type: eligibility.recommended_stay_type,
                label: eligibility.recommended_stay_type === 'ngay_dem' ? 'Ngày đêm' : 'Qua đêm',
                base_package_price_vnd: recommendedQuote.base_2h_price,
                extra_hours: recommendedQuote.billable_extra_hours ?? 0,
                extra_hour_subtotal_vnd: recommendedQuote.extra_hour_subtotal ?? 0,
                total_price_vnd: recommendedQuote.total_estimate,
                applicable_window: applicableWindow,
                price_breakdown_text: recommendedQuote.price_breakdown_text,
              });

              if (eligibility.eligibility_status === 'ALTERNATIVE_PACKAGE_RECOMMENDED') {
                const altWithCheckout = this.quoteEngine.getQuote({
                  co_so_ma: this.trustedPropertyId,
                  ma_phong: room.ma_phong,
                  stay_type: requestedStay,
                  duration_hours: 1,
                  checkin_datetime: eligibility.alternative_option?.checkin_time ?? probeDatetime,
                  checkout_datetime: parsed.data.checkout_datetime ?? undefined,
                });
                ineligiblePackages.push({
                  stay_type: requestedStay,
                  label: requestedStay === 'qua_dem' ? 'Qua đêm' : requestedStay,
                  reason: eligibility.customer_explanation,
                  alternative_if_delayed_to_21_40_vnd: altWithCheckout.total_estimate ?? requestedQuote.total_estimate,
                });
              }

              quotes.push({
                quote_id: `quote_${room.ma_phong}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                room_id: room.ma_phong,
                room_name: formattedQuoteRoomName,
                category: room.hang,
                property_id: this.trustedPropertyId,
                room_identity: {
                  property_id: this.trustedPropertyId,
                  room_id: room.ma_phong,
                  composite_key: `${this.trustedPropertyId}::${room.ma_phong}`,
                  room_name: formattedQuoteRoomName,
                  category: room.hang,
                },
                checkin_conditions: {
                  checkin_datetime: rawCheckin!,
                  checkin_confidence: parsed.data.checkin_confidence ?? 'CONFIRMED',
                  checkout_datetime: recommendedQuote.confirmed_checkout ?? parsed.data.checkout_datetime ?? 'UNSPECIFIED (package ends 12:00 next day)',
                  stay_type: eligibility.recommended_stay_type,
                },
                stay_type: eligibility.recommended_stay_type,
                duration_hours: undefined,
                base_price: recommendedQuote.base_2h_price,
                base_price_vnd: recommendedQuote.base_2h_price,
                base_package_price_vnd: recommendedQuote.base_2h_price,
                confirmed_checkin: recommendedQuote.checkin_applied ?? rawCheckin!,
                confirmed_checkout: recommendedQuote.confirmed_checkout ?? null,
                actual_checkout_datetime: recommendedQuote.confirmed_checkout ?? null,
                standard_checkout: recommendedQuote.standard_checkout ?? '12:00 hôm sau',
                standard_checkout_datetime: recommendedQuote.standard_checkout ?? '12:00 hôm sau',
                grace_period_minutes: recommendedQuote.grace_period_minutes ?? 10,
                grace_period_mode: recommendedQuote.grace_period_mode ?? 'EVERY_EXTRA_HOUR_BOUNDARY',
                actual_late_checkout_minutes: recommendedQuote.actual_late_checkout_minutes ?? 0,
                actual_late_checkout_seconds: recommendedQuote.actual_late_checkout_seconds ?? 0,
                actual_late_minutes: recommendedQuote.actual_late_checkout_minutes ?? 0,
                extra_hours: recommendedQuote.billable_extra_hours ?? 0,
                billable_extra_hours: recommendedQuote.billable_extra_hours ?? 0,
                extra_hour_rate: recommendedQuote.extra_hour_rate,
                extra_hour_rate_vnd: recommendedQuote.extra_hour_rate,
                extra_hour_rate_source: room.gia_goc_dataset.nguon_gio_phat_sinh,
                extra_hour_subtotal_vnd: recommendedQuote.extra_hour_subtotal ?? 0,
                additional_charges_vnd: recommendedQuote.extra_hour_subtotal ?? 0,
                late_checkout_applied: recommendedQuote.late_checkout_applied ?? false,
                total_price_vnd: recommendedQuote.total_estimate,
                price_breakdown_text: recommendedQuote.price_breakdown_text,
                policy_version: recommendedQuote.policy_version,
                effective_policy_version: recommendedQuote.effective_policy_version ?? policyMeta.effectivePolicyVersion,
                applicable_policy_version: recommendedQuote.effective_policy_version ?? policyMeta.effectivePolicyVersion,
                pricing_status: recommendedQuote.pricing_status,
                unconfirmed_conditions: unconfirmedConditions,
                stay_package_eligibility: {
                  requested_package: eligibility.requested_stay_type,
                  recommended_package: eligibility.recommended_stay_type,
                  eligibility_status: eligibility.eligibility_status,
                  explanation_reason_code: eligibility.explanation_reason_code,
                  business_reason: eligibility.customer_explanation,
                  eligible_packages: eligiblePackages,
                  ineligible_packages: ineligiblePackages,
                  applicable_window: applicableWindow,
                  alternative_option: eligibility.alternative_option,
                  unconfirmed_conditions: unconfirmedConditions,
                },
                evidence_references: [
                  ...(recommendedQuote.evidence_references || []),
                  ...eligibility.evidence_references,
                ],
              });
              continue;
            }

            const policyMeta = getEffectivePolicyMetadata();
            const quote = this.quoteEngine.getQuote({
              co_so_ma: this.trustedPropertyId,
              ma_phong: room.ma_phong,
              stay_type: parsed.data.stay_type,
              duration_hours: effectiveDuration,
              checkin_datetime: hasExplicitCheckin ? probeDatetime : undefined,
              checkout_datetime: parsed.data.checkout_datetime ?? undefined,
            });

            const unconfirmedFallback: string[] = [];
            if (!hasExplicitCheckin && isOvernightOrDayNightIntent) {
              unconfirmedFallback.push(
                'Giờ nhận phòng chưa được xác nhận; gói phù hợp (Qua đêm từ 22:00/21:40 vs Ngày đêm từ 14:00) phụ thuộc vào giờ nhận phòng thực tế.'
              );
            }
            if (quote.late_checkout_applied && (quote.actual_late_checkout_seconds ?? (quote.actual_late_checkout_minutes ?? 0) * 60) > 0) {
              unconfirmedFallback.push(
                'Không có kết nối PMS thời gian thực: báo giá trả phòng muộn chỉ tính theo biểu phí niêm yết, không mặc định xác nhận phòng trống hay khả năng kéo dài giờ trả phòng.'
              );
            }

            const quoteObj = {
              quote_id: `quote_${room.ma_phong}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              room_id: room.ma_phong,
              room_name: formattedQuoteRoomName,
              category: room.hang,
              property_id: this.trustedPropertyId,
              room_identity: {
                property_id: this.trustedPropertyId,
                room_id: room.ma_phong,
                composite_key: `${this.trustedPropertyId}::${room.ma_phong}`,
                room_name: formattedQuoteRoomName,
                category: room.hang,
              },
              checkin_conditions: {
                checkin_datetime: hasExplicitCheckin ? rawCheckin! : 'UNSPECIFIED',
                checkout_datetime: quote.confirmed_checkout ?? parsed.data.checkout_datetime ?? 'UNSPECIFIED',
                assumption_type: hasExplicitCheckin ? 'EXPLICIT_OR_RESOLVED' : 'POLICY_INVARIANT_RATE',
                stay_type: quote.stay_type,
                duration_hours: quote.stay_type === 'nghi_gio' ? quote.duration_hours : undefined,
              },
              stay_type: quote.stay_type,
              duration_hours: quote.stay_type === 'nghi_gio' ? quote.duration_hours : undefined,
              base_price: quote.base_2h_price,
              base_price_vnd: quote.base_2h_price,
              base_package_price_vnd: quote.base_2h_price,
              confirmed_checkin: hasExplicitCheckin ? (quote.checkin_applied ?? rawCheckin!) : null,
              confirmed_checkout: quote.confirmed_checkout ?? null,
              actual_checkout_datetime: quote.confirmed_checkout ?? null,
              standard_checkout: quote.standard_checkout ?? null,
              standard_checkout_datetime: quote.standard_checkout ?? null,
              grace_period_minutes: quote.grace_period_minutes ?? 10,
              grace_period_mode: quote.grace_period_mode ?? 'EVERY_EXTRA_HOUR_BOUNDARY',
              actual_late_checkout_minutes: quote.actual_late_checkout_minutes ?? 0,
              actual_late_checkout_seconds: quote.actual_late_checkout_seconds ?? 0,
              actual_late_minutes: quote.actual_late_checkout_minutes ?? 0,
              extra_hours: quote.extra_hours,
              billable_extra_hours: quote.billable_extra_hours ?? quote.extra_hours,
              extra_hour_rate: quote.extra_hour_rate,
              extra_hour_rate_vnd: quote.extra_hour_rate,
              extra_hour_rate_source: room.gia_goc_dataset.nguon_gio_phat_sinh,
              extra_hour_subtotal_vnd: quote.extra_hour_subtotal ?? (quote.extra_hours || 0) * (quote.extra_hour_rate || 0),
              additional_charges_vnd: quote.extra_hour_subtotal ?? (quote.extra_hours || 0) * (quote.extra_hour_rate || 0),
              late_checkout_applied: quote.late_checkout_applied ?? false,
              total_price_vnd: quote.total_estimate,
              price_breakdown_text: quote.price_breakdown_text,
              policy_version: quote.policy_version,
              effective_policy_version: quote.effective_policy_version ?? policyMeta.effectivePolicyVersion,
              applicable_policy_version: quote.effective_policy_version ?? policyMeta.effectivePolicyVersion,
              pricing_status:
                quote.pricing_status === 'INVALID_DATETIME'
                  ? 'INVALID_DATETIME'
                  : hasExplicitCheckin
                    ? quote.pricing_status
                    : 'RESOLVED_POLICY_INVARIANT',
              unconfirmed_conditions: unconfirmedFallback,
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

          // Attach same-category rate variation notes purely from dataset whenever sibling rooms differ
          const categoryPricingNotes: string[] = [];
          const seenCats = new Set<string>();
          for (const q of quotes) {
            const cat = q.category;
            if (!cat || seenCats.has(cat)) continue;
            seenCats.add(cat);
            const peers = this.dataset.phong.filter(
              (p) => p.co_so_ma === this.trustedPropertyId && p.hang === cat && !isRoomNotForSale(this.trustedPropertyId, p.ma_phong)
            );
            const extSet = new Set(peers.map((p) => p.gia_goc_dataset.gio_phat_sinh_ap_dung));
            if (extSet.size > 1) {
              const sortedExt = Array.from(extSet).sort((a, b) => a - b);
              const groupDesc = sortedExt
                .map((rate) => {
                  const rNames = peers.filter((p) => p.gia_goc_dataset.gio_phat_sinh_ap_dung === rate).map((p) => p.ten_phong);
                  return `${rate.toLocaleString('vi-VN')}đ/giờ (${rNames.join(', ')})`;
                })
                .join(' vs ');
              categoryPricingNotes.push(
                `Hạng ${cat} tại cơ sở có mức giờ phát sinh khác nhau giữa các phòng: ${groupDesc}. Khi tư vấn cả hạng cho gói > 2 giờ, phải nêu rõ từng nhóm phòng hoặc khoảng giá đầy đủ.`
              );
            }
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
              ...(categoryPricingNotes.length > 0 ? { category_pricing_notes: categoryPricingNotes } : {}),
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
