import { createHash } from 'node:crypto';
import { NormalizedDataset } from '../../domain/normalized-schema.js';
import { CoSoMa, StayType } from '../../domain/types.js';
import {
  AgentState,
  BusinessEvidenceRecord,
  RoomPresentationBlock,
  RoomPresentationImage,
  ScopedRateFact,
  ToolResult,
} from '../../agent/agent-contracts.js';
import {
  computePolicyContentHash,
  loadActivePricingPolicyConfig,
  loadOwnerPolicyAddendums,
  OwnerPolicyAddendum,
  PricingPolicyConfig,
} from '../../data-loader/pricing-policy-loader.js';
import { parseVietnamDateTime } from '../../pricing/checkin-pricing-resolver.js';

export interface ParsedVndMention {
  raw: string;
  amountVnd: number;
  index: number;
  sentence: string;
  sentenceLower: string;
}

/**
 * Computes an authoritative SHA-256 content hash covering canonical room prices, amenities,
 * property metadata, and active policy/addendum configuration. Any mutation in rates, rooms,
 * amenities, or active policy deterministically produces a different revision hash.
 */
export function computeDatasetVersionHash(
  dataset: NormalizedDataset,
  policyConfig?: PricingPolicyConfig | null,
  policyAddendum?: OwnerPolicyAddendum | null
): string {
  const roomsCanonical = [...dataset.phong]
    .sort((a, b) => `${a.co_so_ma}::${a.ma_phong}`.localeCompare(`${b.co_so_ma}::${b.ma_phong}`))
    .map((p) => ({
      co_so_ma: p.co_so_ma,
      ma_phong: p.ma_phong,
      ten_phong: p.ten_phong,
      hang: p.hang,
      gia_goc_dataset: p.gia_goc_dataset,
      tien_nghi: {
        bon_tam: p.tien_nghi?.bon_tam?.status,
        ghe_tinh_yeu: p.tien_nghi?.ghe_tinh_yeu?.status,
        thang_may: p.tien_nghi?.thang_may?.status,
      },
      link_phong: p.link_phong,
      anh_count: p.anh?.length ?? 0,
      anh_urls: (p.anh || []).map((a) => a.url),
    }));
  const facilitiesCanonical = [...dataset.co_so]
    .sort((a, b) => a.ma.localeCompare(b.ma))
    .map((c) => ({ ...c }));
  const policyHash = computePolicyContentHash(
    policyConfig ?? loadActivePricingPolicyConfig(),
    policyAddendum === undefined ? loadOwnerPolicyAddendums() : policyAddendum
  );
  const canonicalPayload = JSON.stringify({
    quy_dinh_goc: dataset.quy_dinh_goc,
    co_so: facilitiesCanonical,
    phong: roomsCanonical,
    policyHash,
  });
  const digest = createHash('sha256').update(canonicalPayload).digest('hex').slice(0, 12);
  return `rev#${digest}`;
}

/**
 * Normalizes Vietnamese currency expressions (dots, commas, Unicode thin spaces, k/nghin/trieu, 0đ) into integer VND.
 * Regex is used strictly for technical numeric parsing, never semantic intent detection.
 */
export function extractVndMentions(text: string): ParsedVndMention[] {
  const results: ParsedVndMention[] = [];
  if (!text) return results;

  // Match number + optional decimal/grouping + currency unit with Unicode letter guard (avoid "12:00 trưa" matching "00 tr")
  const pattern = /(?<!:)(?<![\d.])(\d{1,3}(?:[.\s\u00a0\u202f,]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:(triệu|trieu|tr)(?![\p{L}\d])|(nghìn|nghin|ngàn|ngan|k)(?![\p{L}\d])|(vnđ|vnd|đồng|dong|đ)(?![\p{L}\d]))/giu;

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const rawNum = m[1].replace(/\u00a0|\u202f|\s/g, '');
    const unitRaw = (m[2] || m[3] || m[4] || '').toLowerCase();
    const startIdx = m.index;

    // Extract enclosing line/sentence for scoped role classification
    const lineStart = Math.max(0, text.lastIndexOf('\n', startIdx) + 1);
    const nextNl = text.indexOf('\n', startIdx);
    const lineEnd = nextNl === -1 ? text.length : nextNl;
    const sentence = text.slice(lineStart, lineEnd).trim();
    const sentenceLower = sentence.toLowerCase();

    // Ignore time expressions like 22h, 12h00 if somehow matched, or non-currency tokens
    let numericValue = NaN;
    if (m[2]) {
      // triệu / tr
      const cleanFloat = rawNum.replace(',', '.');
      numericValue = Math.round(parseFloat(cleanFloat) * 1_000_000);
    } else if (m[3]) {
      // k / nghìn / ngàn
      const cleanFloat = rawNum.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      numericValue = Math.round(parseFloat(cleanFloat) * 1_000);
    } else {
      // đ / vnd / đồng: strip thousand separators (159.000 or 1,180,000 -> 159000 / 1180000)
      const digitsOnly = rawNum.replace(/[.,](?=\d{3}\b)/g, '').replace(/,/g, '.');
      numericValue = Math.round(parseFloat(digitsOnly));
    }

    if (Number.isFinite(numericValue) && unitRaw.length > 0) {
      results.push({
        raw: m[0].trim(),
        amountVnd: numericValue,
        index: startIdx,
        sentence,
        sentenceLower,
      });
    }
  }

  return results;
}

function classifyCheckinTimeBucket(iso?: string): string | null {
  if (!iso || iso === 'UNSPECIFIED' || iso.startsWith('CHECKIN_') || iso.startsWith('UNSPECIFIED')) return null;
  const parts = parseVietnamDateTime(iso);
  if (!parts) return null;
  const isWknd = parts.dayOfWeekIso === 6 || parts.dayOfWeekIso === 7;
  const mins = parts.hour * 60 + parts.minute;
  const slot = mins < 480 ? 'early_before_08' : mins < 1080 ? 'day_08_18' : mins < 1300 ? 'eve_18_2140' : 'overnight_2140_plus';
  return `${isWknd ? 'wknd' : 'wkd'}::${slot}`;
}

/**
 * Marks previously gathered quote evidence invalid when constraints materially change
 * (stay package, duration, check-in/window, checkout, dataset/policy revision, or property).
 */
export function invalidateStaleBusinessEvidence(
  state: AgentState,
  currentConstraints: {
    propertyId: CoSoMa;
    stayType?: StayType;
    durationHours?: number;
    checkinDatetime?: string;
    checkoutDatetime?: string;
    effectivePolicyVersion: string;
    datasetVersion?: string;
  }
): void {
  const list = state.verifiedBusinessEvidence;
  if (!list || list.length === 0) return;

  for (const ev of list) {
    if (!ev.isValid) continue;

    if (ev.propertyId !== currentConstraints.propertyId) {
      ev.isValid = false;
      ev.invalidatedReason = `PROPERTY_CHANGED (${ev.propertyId} -> ${currentConstraints.propertyId})`;
      continue;
    }

    if (ev.effectivePolicyVersion !== currentConstraints.effectivePolicyVersion) {
      ev.isValid = false;
      ev.invalidatedReason = `POLICY_VERSION_CHANGED (${ev.effectivePolicyVersion} -> ${currentConstraints.effectivePolicyVersion})`;
      continue;
    }

    if (currentConstraints.datasetVersion && ev.datasetVersion !== currentConstraints.datasetVersion) {
      ev.isValid = false;
      ev.invalidatedReason = `DATASET_HASH_CHANGED (${ev.datasetVersion} -> ${currentConstraints.datasetVersion})`;
      continue;
    }

    if (ev.evidenceType === 'QUOTE') {
      // If guest changes stay package (e.g. nghi_gio -> qua_dem or ngay_dem), prior QUOTE is stale
      if (
        currentConstraints.stayType &&
        ev.stayPackage &&
        ev.stayPackage !== 'ALL' &&
        ev.stayPackage !== currentConstraints.stayType
      ) {
        ev.isValid = false;
        ev.invalidatedReason = `STAY_TYPE_CHANGED (${ev.stayPackage} -> ${currentConstraints.stayType})`;
        continue;
      }
      // If guest now asks about a different duration on hourly stay
      if (
        currentConstraints.durationHours &&
        ev.stayPackage === 'nghi_gio' &&
        ev.durationHours &&
        ev.durationHours !== currentConstraints.durationHours
      ) {
        ev.isValid = false;
        ev.invalidatedReason = `DURATION_CHANGED (${ev.durationHours}h -> ${currentConstraints.durationHours}h)`;
        continue;
      }
      // If guest explicitly updates check-in or crosses weekday/weekend or time-window tier
      if (
        currentConstraints.checkinDatetime &&
        ev.checkinDatetime &&
        ev.checkinDatetime !== 'UNSPECIFIED' &&
        currentConstraints.checkinDatetime !== ev.checkinDatetime
      ) {
        const prevBucket = classifyCheckinTimeBucket(ev.checkinDatetime);
        const nextBucket = classifyCheckinTimeBucket(currentConstraints.checkinDatetime);
        ev.isValid = false;
        ev.invalidatedReason =
          prevBucket && nextBucket && prevBucket !== nextBucket
            ? `CHECKIN_WINDOW_SHIFTED (${prevBucket} -> ${nextBucket})`
            : `CHECKIN_CHANGED (${ev.checkinDatetime} -> ${currentConstraints.checkinDatetime})`;
        continue;
      }
      if (
        currentConstraints.checkoutDatetime &&
        ev.checkoutDatetime &&
        currentConstraints.checkoutDatetime !== ev.checkoutDatetime
      ) {
        ev.isValid = false;
        ev.invalidatedReason = `CHECKOUT_CHANGED (${ev.checkoutDatetime} -> ${currentConstraints.checkoutDatetime})`;
        continue;
      }
    }
  }
}

/**
 * Records verified backend tool results into scoped BusinessEvidenceRecord store
 * and caches canonical room media blocks on AgentState.
 */
export function recordToolResultAsEvidence(
  state: AgentState,
  toolName: string,
  res: ToolResult,
  dataset: NormalizedDataset,
  effectivePolicyVersion: string
): BusinessEvidenceRecord[] {
  if (res.status !== 'SUCCESS' || !res.data) return [];

  if (!state.verifiedBusinessEvidence) state.verifiedBusinessEvidence = [];
  if (!state.mediaEvidenceCache) state.mediaEvidenceCache = {};

  const datasetVersion = computeDatasetVersionHash(dataset);
  const created: BusinessEvidenceRecord[] = [];
  const nextIdx = () => state.verifiedBusinessEvidence!.length + created.length + 1;

  if (toolName === 'search_rooms') {
    const allCands = Array.isArray(res.data?.candidates) ? res.data.candidates : [];
    const byCat = new Map<
      string,
      {
        base2hVnds: Set<number>;
        overnightVnds: Set<number>;
        dayNightVnds: Set<number>;
        extraHourRateVnds: Set<number>;
        hourlyExtendedVnds: Set<number>;
      }
    >();
    const amounts = new Set<number>();
    const roomIds: string[] = [];
    const scopedRates: ScopedRateFact[] = [];

    for (const c of allCands) {
      if (c.room_id) roomIds.push(c.room_id);
      const bp = c.base_pricing;
      if (!bp) continue;
      const cat = c.category || 'Standard';
      if (typeof bp.nghi_gio_2h === 'number') {
        amounts.add(bp.nghi_gio_2h);
        scopedRates.push({ amountVnd: bp.nghi_gio_2h, role: 'BASE_2H', roomId: c.room_id, category: cat, stayPackage: 'nghi_gio', durationHours: 2 });
      }
      if (typeof bp.qua_dem === 'number') {
        amounts.add(bp.qua_dem);
        scopedRates.push({ amountVnd: bp.qua_dem, role: 'PACKAGE_RATE', roomId: c.room_id, category: cat, stayPackage: 'qua_dem' });
      }
      if (typeof bp.ngay_dem === 'number') {
        amounts.add(bp.ngay_dem);
        scopedRates.push({ amountVnd: bp.ngay_dem, role: 'PACKAGE_RATE', roomId: c.room_id, category: cat, stayPackage: 'ngay_dem' });
      }
      if (typeof bp.gio_tiep_theo === 'number') {
        amounts.add(bp.gio_tiep_theo);
        scopedRates.push({ amountVnd: bp.gio_tiep_theo, role: 'EXTRA_HOUR_RATE', roomId: c.room_id, category: cat, stayPackage: 'EXTRA_HOUR' });
      }
      const prev = byCat.get(cat) || {
        base2hVnds: new Set<number>(),
        overnightVnds: new Set<number>(),
        dayNightVnds: new Set<number>(),
        extraHourRateVnds: new Set<number>(),
        hourlyExtendedVnds: new Set<number>(),
      };
      if (typeof bp.nghi_gio_2h === 'number') prev.base2hVnds.add(bp.nghi_gio_2h);
      if (typeof bp.qua_dem === 'number') prev.overnightVnds.add(bp.qua_dem);
      if (typeof bp.ngay_dem === 'number') prev.dayNightVnds.add(bp.ngay_dem);
      if (typeof bp.gio_tiep_theo === 'number') prev.extraHourRateVnds.add(bp.gio_tiep_theo);
      byCat.set(cat, prev);
    }

    created.push({
      evidenceId: `ev_search_t${state.turnCount}_${nextIdx()}`,
      propertyId: state.trustedPropertyId,
      evidenceType: 'CATALOG_SEARCH',
      toolSource: 'search_rooms',
      stayPackage: 'ALL',
      alternateAmountsVnd: Array.from(amounts),
      scopedRates,
      catalogRoomIds: roomIds,
      categoryRateSnapshots: Array.from(byCat.entries()).map(([category, r]) => ({
        category,
        base2hVnd: r.base2hVnds.size > 0 ? Math.min(...r.base2hVnds) : undefined,
        overnightVnd: r.overnightVnds.size > 0 ? Math.min(...r.overnightVnds) : undefined,
        dayNightVnd: r.dayNightVnds.size > 0 ? Math.min(...r.dayNightVnds) : undefined,
        extraHourRateVnd: r.extraHourRateVnds.size > 0 ? Math.min(...r.extraHourRateVnds) : undefined,
        base2hVnds: Array.from(r.base2hVnds),
        overnightVnds: Array.from(r.overnightVnds),
        dayNightVnds: Array.from(r.dayNightVnds),
        extraHourRateVnds: Array.from(r.extraHourRateVnds),
        hourlyExtendedVnds: Array.from(r.hourlyExtendedVnds),
      })),
      effectivePolicyVersion,
      datasetVersion,
      validityScope: 'SESSION_WHILE_VALID',
      isValid: true,
      recordedTurn: state.turnCount,
    });
  } else if (toolName === 'quote_price') {
    const quoteList = Array.isArray(res.data?.quotes) && res.data.quotes.length > 0 ? res.data.quotes : [res.data];
    for (const q of quoteList) {
      if (!q || !q.room_id) continue;
      const altSet = new Set<number>();
      const scopedRates: ScopedRateFact[] = [];
      const durHours = typeof q.duration_hours === 'number' ? q.duration_hours : undefined;
      const pushRate = (fact: ScopedRateFact) => {
        altSet.add(fact.amountVnd);
        scopedRates.push(fact);
      };

      if (typeof q.total_price_vnd === 'number') {
        pushRate({
          amountVnd: q.total_price_vnd,
          role: 'TOTAL',
          roomId: q.room_id,
          category: q.category,
          stayPackage: q.stay_type,
          durationHours: durHours,
          timeCondition: q.checkin_conditions?.checkin_datetime,
          eligible: true,
        });
      }
      const primaryBase = q.base_package_price_vnd ?? q.base_price_vnd;
      if (typeof primaryBase === 'number') {
        pushRate({
          amountVnd: primaryBase,
          role: q.stay_type === 'nghi_gio' ? 'BASE_2H' : 'PACKAGE_RATE',
          roomId: q.room_id,
          category: q.category,
          stayPackage: q.stay_type,
          durationHours: q.stay_type === 'nghi_gio' ? 2 : durHours,
          timeCondition: q.checkin_conditions?.checkin_datetime,
          eligible: true,
        });
      }
      const primaryExtraRate = q.extra_hour_rate_vnd ?? q.extra_hour_rate;
      if (typeof primaryExtraRate === 'number' && primaryExtraRate > 0) {
        pushRate({ amountVnd: primaryExtraRate, role: 'EXTRA_HOUR_RATE', roomId: q.room_id, category: q.category, stayPackage: 'EXTRA_HOUR', eligible: true });
      }
      if (typeof q.extra_hour_subtotal_vnd === 'number') {
        pushRate({
          amountVnd: q.extra_hour_subtotal_vnd,
          role: 'EXTRA_HOUR_SUBTOTAL',
          roomId: q.room_id,
          category: q.category,
          stayPackage: q.stay_type,
          durationHours: durHours,
          timeCondition: q.checkin_conditions?.checkin_datetime,
          eligible: true,
        });
      }

      if (Array.isArray(q.conditional_quotes)) {
        for (const cq of q.conditional_quotes) {
          const rawLabel = String(cq.condition_label || cq.checkin_window || cq.condition || 'conditional');
          const condTag = /cuối tuần|t7|chủ nhật|weekend/iu.test(rawLabel)
            ? 'weekend_daytime'
            : /ngày thường|sau 18|trước 08|weekday/iu.test(rawLabel)
              ? 'weekday_or_after_18'
              : rawLabel;
          if (typeof cq.total_price_vnd === 'number') {
            pushRate({ amountVnd: cq.total_price_vnd, role: 'TOTAL', roomId: q.room_id, category: q.category, stayPackage: q.stay_type, durationHours: durHours, timeCondition: condTag, eligible: true });
          }
          if (typeof cq.base_2h_vnd === 'number') {
            pushRate({ amountVnd: cq.base_2h_vnd, role: 'BASE_2H', roomId: q.room_id, category: q.category, stayPackage: q.stay_type, durationHours: 2, timeCondition: condTag, eligible: true });
          }
          if (typeof cq.extra_hour_rate === 'number' && cq.extra_hour_rate > 0) {
            pushRate({ amountVnd: cq.extra_hour_rate, role: 'EXTRA_HOUR_RATE', roomId: q.room_id, category: q.category, stayPackage: 'EXTRA_HOUR', timeCondition: condTag, eligible: true });
          }
          if (typeof cq.extra_hours === 'number' && typeof cq.extra_hour_rate === 'number') {
            pushRate({ amountVnd: cq.extra_hours * cq.extra_hour_rate, role: 'EXTRA_HOUR_SUBTOTAL', roomId: q.room_id, category: q.category, stayPackage: q.stay_type, durationHours: durHours, timeCondition: condTag, eligible: true });
          } else if (typeof cq.total_price_vnd === 'number' && typeof cq.base_2h_vnd === 'number') {
            pushRate({ amountVnd: Math.max(0, cq.total_price_vnd - cq.base_2h_vnd), role: 'EXTRA_HOUR_SUBTOTAL', roomId: q.room_id, category: q.category, stayPackage: q.stay_type, durationHours: durHours, timeCondition: condTag, eligible: true });
          }
        }
      }
      const elig = q.stay_package_eligibility;
      if (elig) {
        const eligibleList = (elig.eligible_packages || []).map((p: any) => ({ ...p, _elig: true }));
        const ineligibleList = (elig.ineligible_packages || []).map((p: any) => ({ ...p, _elig: false }));
        for (const pkg of [...eligibleList, ...ineligibleList]) {
          const rawPkgType = String(pkg.stay_type ?? q.stay_type);
          const pkgType = (rawPkgType.startsWith('ngay_dem') ? 'ngay_dem' : rawPkgType) as StayType;
          const pkgCond = pkg.applicable_window || (pkg.requires_reception_confirmation_for_early_checkin ? 'early_before_14_requires_reception' : undefined);
          if (typeof pkg.total_price_vnd === 'number') {
            pushRate({
              amountVnd: pkg.total_price_vnd,
              role: 'TOTAL',
              roomId: q.room_id,
              category: q.category,
              stayPackage: pkgType,
              durationHours: pkg.duration_hours ?? durHours,
              timeCondition: pkgCond,
              eligible: pkg._elig,
              ineligibilityReason: pkg._elig ? undefined : String(pkg.reason || elig.business_reason || ''),
            });
          }
          if (typeof pkg.base_package_price_vnd === 'number') {
            pushRate({
              amountVnd: pkg.base_package_price_vnd,
              role: 'PACKAGE_RATE',
              roomId: q.room_id,
              category: q.category,
              stayPackage: pkgType,
              timeCondition: pkgCond,
              eligible: pkg._elig,
              ineligibilityReason: pkg._elig ? undefined : String(pkg.reason || elig.business_reason || ''),
            });
          }
          if (typeof pkg.extra_hour_subtotal_vnd === 'number' && pkg.extra_hour_subtotal_vnd > 0) {
            pushRate({
              amountVnd: pkg.extra_hour_subtotal_vnd,
              role: 'EXTRA_HOUR_SUBTOTAL',
              roomId: q.room_id,
              category: q.category,
              stayPackage: pkgType,
              durationHours: pkg.duration_hours ?? durHours,
              timeCondition: pkgCond,
              eligible: pkg._elig,
            });
          }
          if (typeof pkg.alternative_if_delayed_to_21_40_vnd === 'number') {
            pushRate({ amountVnd: pkg.alternative_if_delayed_to_21_40_vnd, role: 'ALT_21_40', roomId: q.room_id, category: q.category, stayPackage: 'qua_dem', timeCondition: 'delayed_to_21_40', eligible: true });
          }
        }
      }

      const conditions: string[] = [];
      if (q.pricing_status) conditions.push(String(q.pricing_status));
      if (q.checkin_conditions?.assumption_type) conditions.push(String(q.checkin_conditions.assumption_type));
      if (q.late_checkout_applied) conditions.push('LATE_CHECKOUT_APPLIED');
      const isOverallEligible = !elig || (elig.eligible_packages && elig.eligible_packages.length > 0 && elig.requested_package === elig.recommended_package);

      created.push({
        evidenceId: `ev_quote_${q.room_id}_t${state.turnCount}_${nextIdx()}`,
        propertyId: state.trustedPropertyId,
        roomId: q.room_id,
        roomCode: String(q.room_id).split('-')[0],
        roomName: q.room_name,
        category: q.category,
        evidenceType: 'QUOTE',
        toolSource: 'quote_price',
        stayPackage: q.stay_type,
        amountVnd: typeof q.total_price_vnd === 'number' ? q.total_price_vnd : undefined,
        basePriceVnd: q.base_package_price_vnd ?? q.base_price_vnd,
        extraHourRateVnd: q.extra_hour_rate_vnd ?? q.extra_hour_rate ?? q.conditional_quotes?.[0]?.extra_hour_rate,
        extraHourSubtotalVnd: q.extra_hour_subtotal_vnd,
        alternateAmountsVnd: Array.from(altSet),
        scopedRates,
        fieldRefs: {
          total: typeof q.total_price_vnd === 'number' ? q.total_price_vnd : null,
          base_2h: q.stay_type === 'nghi_gio' ? (q.base_package_price_vnd ?? q.base_price_vnd ?? null) : null,
          package_rate: q.stay_type !== 'nghi_gio' ? (q.base_package_price_vnd ?? q.base_price_vnd ?? null) : null,
          extra_hour_rate: q.extra_hour_rate_vnd ?? q.extra_hour_rate ?? q.conditional_quotes?.[0]?.extra_hour_rate ?? null,
          extra_hour_subtotal: q.extra_hour_subtotal_vnd ?? null,
          checkin_window: q.confirmed_checkin ?? q.checkin_conditions?.checkin_datetime ?? null,
          eligible: isOverallEligible,
        },
        eligible: isOverallEligible,
        timeCondition: classifyCheckinTimeBucket(q.confirmed_checkin ?? q.checkin_conditions?.checkin_datetime) ?? undefined,
        ineligibilityReason: elig?.ineligible_packages?.[0]?.reason,
        checkinDatetime: q.confirmed_checkin ?? q.checkin_conditions?.checkin_datetime,
        checkoutDatetime: q.confirmed_checkout ?? undefined,
        durationHours: typeof q.duration_hours === 'number' ? q.duration_hours : undefined,
        conditions,
        effectivePolicyVersion: q.effective_policy_version ?? effectivePolicyVersion,
        datasetVersion,
        validityScope: q.pricing_status === 'CONDITIONAL_ON_CHECKIN_TIME' ? 'CONDITIONAL' : 'SESSION_WHILE_VALID',
        isValid: true,
        recordedTurn: state.turnCount,
      });
    }
  } else if (toolName === 'get_room_facts') {
    const ps = res.data?.pricing_snapshot;
    const altSet = new Set<number>();
    const scopedRates: ScopedRateFact[] = [];
    const rId = res.data?.room_id;
    const rCat = res.data?.category;
    if (ps) {
      if (typeof ps.nghi_gio_2h === 'number') {
        altSet.add(ps.nghi_gio_2h);
        scopedRates.push({ amountVnd: ps.nghi_gio_2h, role: 'BASE_2H', roomId: rId, category: rCat, stayPackage: 'nghi_gio', durationHours: 2 });
      }
      if (typeof ps.qua_dem === 'number') {
        altSet.add(ps.qua_dem);
        scopedRates.push({ amountVnd: ps.qua_dem, role: 'PACKAGE_RATE', roomId: rId, category: rCat, stayPackage: 'qua_dem' });
      }
      if (typeof ps.ngay_dem === 'number') {
        altSet.add(ps.ngay_dem);
        scopedRates.push({ amountVnd: ps.ngay_dem, role: 'PACKAGE_RATE', roomId: rId, category: rCat, stayPackage: 'ngay_dem' });
      }
    }
    if (typeof res.data?.extra_hour_rate === 'number') {
      altSet.add(res.data.extra_hour_rate);
      scopedRates.push({ amountVnd: res.data.extra_hour_rate, role: 'EXTRA_HOUR_RATE', roomId: rId, category: rCat, stayPackage: 'EXTRA_HOUR' });
    }

    created.push({
      evidenceId: `ev_facts_${res.data?.room_id || 'unknown'}_t${state.turnCount}_${nextIdx()}`,
      propertyId: state.trustedPropertyId,
      roomId: res.data?.room_id,
      roomCode: res.data?.room_id ? String(res.data.room_id).split('-')[0] : undefined,
      roomName: res.data?.room_name,
      category: res.data?.category,
      evidenceType: 'ROOM_FACTS',
      toolSource: 'get_room_facts',
      stayPackage: 'ALL',
      extraHourRateVnd: res.data?.extra_hour_rate,
      alternateAmountsVnd: Array.from(altSet),
      scopedRates,
      roomAmenities: res.data?.room_id
        ? {
            [String(res.data.room_id)]: {
              bon_tam: res.data?.has_bathtub === 'TRUE' ? 'TRUE' : res.data?.has_bathtub === 'FALSE' ? 'FALSE' : 'UNKNOWN',
              ghe_tinh_yeu: res.data?.has_love_chair === 'TRUE' || res.data?.has_love_chair === true ? 'TRUE' : res.data?.has_love_chair === 'FALSE' ? 'FALSE' : 'UNKNOWN',
            },
          }
        : undefined,
      categoryRateSnapshots: res.data?.category
        ? [
          {
            category: res.data.category,
            base2hVnd: ps?.nghi_gio_2h,
            overnightVnd: ps?.qua_dem,
            dayNightVnd: ps?.ngay_dem,
            extraHourRateVnd: res.data?.extra_hour_rate,
          },
        ]
        : undefined,
      conditions: res.data?.commercial_status ? [String(res.data.commercial_status)] : undefined,
      effectivePolicyVersion,
      datasetVersion,
      validityScope: 'SESSION_WHILE_VALID',
      isValid: true,
      recordedTurn: state.turnCount,
    });
  } else if (toolName === 'get_room_media') {
    const rId = res.data?.room_id;
    const pId = (res.data?.property_id ?? state.trustedPropertyId) as CoSoMa;
    const groupImgs: RoomPresentationImage[] = (res.data?.images || []).map((img: any, idx: number) => ({
      url: img.url,
      caption: img.caption || `${res.data?.room_name || 'Ảnh phòng'} — Ảnh ${idx + 1}`,
      order: typeof img.order === 'number' ? img.order : idx,
      label: img.label,
      alt: img.alt ?? null,
      propertyId: img.propertyId ?? pId,
      roomId: img.roomId ?? rId,
      roomCode: img.roomCode ?? res.data?.room_code ?? String(rId || '').split('-')[0],
      roomName: img.roomName ?? res.data?.room_name,
    }));

    if (rId && groupImgs.length > 0) {
      const compositeKey = `${pId}::${rId}`;
      state.mediaEvidenceCache[compositeKey] = {
        propertyId: pId,
        roomId: rId,
        roomCode: res.data?.room_code ?? String(rId).split('-')[0],
        roomName: res.data?.room_name ?? rId,
        category: res.data?.category,
        displayOrder: 0,
        bookingLink: res.data?.booking_link,
        images: groupImgs,
      };
    }

    created.push({
      evidenceId: `ev_media_${rId || 'unknown'}_t${state.turnCount}_${nextIdx()}`,
      propertyId: pId,
      roomId: rId,
      roomCode: rId ? String(rId).split('-')[0] : undefined,
      roomName: res.data?.room_name,
      category: res.data?.category,
      evidenceType: 'ROOM_MEDIA',
      toolSource: 'get_room_media',
      conditions: [`PHOTO_COUNT_${groupImgs.length}`],
      effectivePolicyVersion,
      datasetVersion,
      validityScope: 'SESSION_WHILE_VALID',
      isValid: true,
      recordedTurn: state.turnCount,
    });
  } else if (toolName === 'get_policies') {
    const struct = res.data?.structured;
    const topicStr = String(res.data?.topic || 'general').toLowerCase();
    const altSet = new Set<number>();
    const scopedRates: ScopedRateFact[] = [];
    if (typeof struct?.default_extra_hour_rate_vnd === 'number') {
      altSet.add(struct.default_extra_hour_rate_vnd);
      scopedRates.push({
        amountVnd: struct.default_extra_hour_rate_vnd,
        role: 'POLICY_RATE',
        stayPackage: 'EXTRA_HOUR',
        isDefaultPolicyRate: true,
      });
    }
    if (struct?.room_specific_extra_hour_rates_vnd) {
      for (const [roomKey, v] of Object.entries(struct.room_specific_extra_hour_rates_vnd)) {
        if (typeof v === 'number') {
          altSet.add(v);
          scopedRates.push({ amountVnd: v, role: 'EXTRA_HOUR_RATE', roomId: roomKey, stayPackage: 'EXTRA_HOUR' });
        }
      }
    }
    // Policy V1.4.5/V1.4.6 explicit rule: room-specific extra-hour rates come from each property room in dataset
    if (
      struct ||
      /late_checkout|checkout|stay_hours|early_late|gio/.test(topicStr)
    ) {
      for (const rm of dataset.phong.filter((p) => p.co_so_ma === state.trustedPropertyId)) {
        const rate = rm.gia_goc_dataset?.gio_phat_sinh_ap_dung;
        if (typeof rate === 'number' && rate > 0) {
          altSet.add(rate);
          scopedRates.push({
            amountVnd: rate,
            role: 'EXTRA_HOUR_RATE',
            roomId: rm.ma_phong,
            category: rm.hang,
            stayPackage: 'EXTRA_HOUR',
          });
        }
      }
    }
    if (topicStr.includes('holiday') || topicStr.includes('le') || topicStr.includes('tet')) {
      if (struct?.approved_by_owner && struct?.holiday_surcharge_status === 'FALSE' && struct?.holiday_surcharge_vnd === 0) {
        altSet.add(0);
        scopedRates.push({ amountVnd: 0, role: 'POLICY_RATE', stayPackage: 'ALL', timeCondition: 'holiday_no_surcharge' });
      }
    }
    created.push({
      evidenceId: `ev_policy_${res.data?.topic || 'general'}_t${state.turnCount}_${nextIdx()}`,
      propertyId: state.trustedPropertyId,
      evidenceType: 'POLICY',
      toolSource: 'get_policies',
      alternateAmountsVnd: Array.from(altSet),
      scopedRates,
      holidayZeroConfirmed: Boolean(struct?.approved_by_owner && struct?.holiday_surcharge_status === 'FALSE'),
      holidayProvenance: struct?.provenance,
      conditions: [String(res.data?.topic || 'general')],
      effectivePolicyVersion: res.data?.effective_policy_version ?? effectivePolicyVersion,
      datasetVersion,
      validityScope: 'SESSION_WHILE_VALID',
      isValid: true,
      recordedTurn: state.turnCount,
    });
  }

  state.verifiedBusinessEvidence.push(...created);
  // Keep session evidence bounded to avoid unbounded growth across long multi-turn dialogs
  if (state.verifiedBusinessEvidence.length > 24) {
    const valid = state.verifiedBusinessEvidence.filter((e) => e.isValid);
    const invalid = state.verifiedBusinessEvidence.filter((e) => !e.isValid);
    state.verifiedBusinessEvidence = [...invalid.slice(-6), ...valid.slice(-18)].slice(-24);
  }
  return created;
}

/**
 * Produces a concise, token-efficient summary of VALID prior-turn evidence for the LLM prompt,
 * strictly avoiding raw history dumps or full decision step accumulation.
 */
export function formatValidEvidenceForPrompt(state: AgentState): string {
  const validPrior = (state.verifiedBusinessEvidence || []).filter(
    (ev) => ev.isValid && ev.recordedTurn < state.turnCount
  );
  const mediaKeys = Object.keys(state.mediaEvidenceCache || {});
  if (validPrior.length === 0 && mediaKeys.length === 0) {
    return 'None.';
  }

  const lines: string[] = [];
  // Keep only the latest valid quote per (roomId, stayPackage, durationHours) and latest catalog/facts/policy
  const dedupedQuotes = new Map<string, BusinessEvidenceRecord>();
  let latestCatalog: BusinessEvidenceRecord | undefined;
  const factsByRoom = new Map<string, BusinessEvidenceRecord>();

  for (const ev of validPrior) {
    if (ev.evidenceType === 'QUOTE' && ev.roomId) {
      dedupedQuotes.set(`${ev.roomId}::${ev.stayPackage || ''}::${ev.durationHours || ''}`, ev);
    } else if (ev.evidenceType === 'CATALOG_SEARCH') {
      latestCatalog = ev;
    } else if (ev.evidenceType === 'ROOM_FACTS' && ev.roomId) {
      factsByRoom.set(ev.roomId, ev);
    }
  }

  if (latestCatalog?.categoryRateSnapshots && latestCatalog.categoryRateSnapshots.length > 0) {
    const fmtVals = (vals?: number[], fallback?: number) => {
      const list = vals && vals.length > 0 ? vals : typeof fallback === 'number' ? [fallback] : [];
      if (list.length === 0) return '?';
      const mn = Math.min(...list);
      const mx = Math.max(...list);
      return mn === mx ? `${mn}đ` : `${mn}đ–${mx}đ`;
    };
    const snap = latestCatalog.categoryRateSnapshots
      .map(
        (c) =>
          `${c.category}(2h=${fmtVals(c.base2hVnds, c.base2hVnd)}, qua_dem=${fmtVals(c.overnightVnds, c.overnightVnd)}, ngay_dem=${fmtVals(c.dayNightVnds, c.dayNightVnd)}, extra=${fmtVals(c.extraHourRateVnds, c.extraHourRateVnd)})`
      )
      .join(' | ');
    lines.push(`[${latestCatalog.evidenceId} CATALOG]: ${snap}`);
  }

  for (const ev of Array.from(dedupedQuotes.values()).slice(-6)) {
    const amt = typeof ev.amountVnd === 'number' ? `${ev.amountVnd.toLocaleString('vi-VN')}đ` : `alts=[${(ev.alternateAmountsVnd || []).join(',')}]`;
    const eligTag = ev.eligible === false ? `INELIGIBLE(${ev.ineligibilityReason || 'window_mismatch'})` : 'ELIGIBLE';
    const roleHints = (ev.scopedRates || [])
      .filter((r) => r.eligible !== false)
      .slice(0, 4)
      .map((r) => `${r.role}=${r.amountVnd}${r.timeCondition ? `@${r.timeCondition}` : ''}`)
      .join(', ');
    lines.push(
      `[${ev.evidenceId} QUOTE | rev=${ev.datasetVersion} | ${eligTag}]: ${ev.roomName || ev.roomId} (${ev.stayPackage || 'pkg'}, ${ev.durationHours ?? '?'}h, checkin=${ev.checkinDatetime || 'UNSPECIFIED'}) => ${amt}${roleHints ? ` [roles: ${roleHints}]` : ''}`
    );
  }

  for (const ev of Array.from(factsByRoom.values()).slice(-4)) {
    lines.push(`[${ev.evidenceId} FACTS]: ${ev.roomName || ev.roomId} (${ev.category}) verified`);
  }

  if (mediaKeys.length > 0) {
    const albums = mediaKeys.map((k) => {
      const blk = state.mediaEvidenceCache![k];
      return `${k} (${blk.roomName}, ${blk.images.length} photos)`;
    });
    lines.push(`[CACHED_MEDIA_ALBUMS — reuse via media_refs without re-calling tool]: ${albums.join(' | ')}`);
  }

  return lines.join('\n');
}
