import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FACILITY_CATEGORY_CONFIGS, FacilityCategoryConfig } from '../pricing/category-mapper.js';
import { CoSoMa } from '../domain/types.js';
import { ImmutableBuildIdentity } from '../agent/agent-contracts.js';

/**
 * J Collection AI Concierge - Pricing Policy Configuration Loader (V1.4.3)
 * Loads versioned pricing policy configurations with strict consistency validation.
 */

export const DaytimeRateConfigSchema = z.object({
  days_of_week_iso: z.array(z.number()), // 1 = Mon ... 7 = Sun
  start: z.string(), // "08:00"
  end_exclusive: z.string(), // "18:00"
  rates_by_owner_category: z.record(z.string(), z.number()),
});

export const FacilityPricingConfigSchema = z.object({
  config_status: z.string(),
  time_windows: z.record(z.string(), z.any()).optional(),
  daytime_rates: z.array(DaytimeRateConfigSchema),
  after_18: z
    .object({
      days_of_week_iso: z.array(z.number()),
      start_inclusive: z.string(),
      until: z.string(),
      rate_source: z.string(),
      note: z.string(),
    })
    .optional(),
  fallback_rate_source: z.string().optional(),
  apply_ha_dong_rules: z.boolean().optional(),
  category_mapping: z.record(z.string(), z.any()).optional(),
  confirmed_decisions: z.record(z.string(), z.any()).optional(),
  unresolved: z.record(z.string(), z.any()).optional(),
  extra_hour_rates: z.record(z.string(), z.number()).optional(),
  notes: z.string().optional(),
});

export const PricingPolicyConfigSchema = z.object({
  schema_version: z.string(),
  config_id: z.string(),
  currency: z.literal('VND'),
  timezone: z.literal('Asia/Ho_Chi_Minh'),
  source_metadata: z.object({
    source_type: z.string(),
    source_recorded_on: z.string(),
    status: z.string(),
    base_dataset: z.string(),
    notes: z.string().optional(),
    effective_from: z.string().nullable().optional(),
  }),
  scope: z.object({
    stay_types: z.array(z.string()).optional(),
    stay_type: z.string().optional(),
    duration_minutes: z.number().optional(),
    minimum_hourly_duration: z.number().optional(),
    one_hour_package_available: z.boolean().optional(),
    applies_to: z.string().optional(),
    pricing_basis: z.string().optional(),
    cross_window_behavior: z.string().optional(),
    not_applied_to: z.array(z.string()).optional(),
  }),
  holiday_policy: z.record(z.string(), z.any()).optional(),
  stay_package_eligibility: z.record(z.string(), z.any()).optional(),
  overtime_grace_policy: z.record(z.string(), z.any()).optional(),
  facilities: z.record(z.string(), FacilityPricingConfigSchema),
  pricing_resolution: z.record(z.string(), z.any()).optional(),
  human_conversation_policy: z.record(z.string(), z.any()).optional(),
});

export type PricingPolicyConfig = z.infer<typeof PricingPolicyConfigSchema>;

export const BreakfastAddendumSchema = z.object({
  included_in_room_rate: z.boolean(),
  service_available: z.boolean().optional(),
  scope: z.string(),
  properties: z.array(z.string()),
  applies_to: z.array(z.string()),
  applies_to_all_categories: z.boolean().optional(),
  room_rates_modified: z.boolean().optional(),
  external_food_rules_confirmed: z.boolean().optional(),
  separate_service_availability: z.union([z.enum(['TRUE', 'FALSE', 'UNKNOWN']), z.boolean()]),
  official_statement: z.string(),
});

export const LateCheckoutAddendumSchema = z.object({
  applies_to: z.array(z.enum(['qua_dem', 'ngay_dem'])),
  standard_checkout_time: z.string(),
  grace_period_minutes: z.number().int().min(0),
  grace_period_mode: z.enum(['EVERY_EXTRA_HOUR_BOUNDARY', 'FIRST_HOUR_ONLY']).optional(),
  charge_from_minute: z.number().int().min(1).optional(),
  billing_method: z.string(),
  rounding_method: z.string().optional(),
  rounding_rule: z.string().optional(),
  default_extra_hour_rate_vnd: z.number().positive(),
  room_specific_rate_priority: z.boolean(),
  exceptions: z.array(z.any()).default([]),
  official_statement: z.string().optional(),
});

export const OwnerPolicyAddendumSchema = z.object({
  schema_version: z.string(),
  policy_version: z.string().optional(),
  extends_policy_version: z.string().optional(),
  addendum_id: z.string(),
  base_policy_id: z.string(),
  currency: z.literal('VND'),
  timezone: z.literal('Asia/Ho_Chi_Minh'),
  source_metadata: z.object({
    source_type: z.string(),
    source_recorded_on: z.string(),
    effective_from: z.string().nullable().optional(),
    status: z.string(),
    notes: z.string().optional(),
  }),
  scope: z.string().optional(),
  change_history: z
    .array(
      z.object({
        version: z.string(),
        recorded_on: z.string(),
        source_type: z.string(),
        summary: z.string(),
      })
    )
    .optional(),
  breakfast: BreakfastAddendumSchema.optional(),
  late_checkout: LateCheckoutAddendumSchema.optional(),
});

export type OwnerPolicyAddendum = z.infer<typeof OwnerPolicyAddendumSchema>;
export type LateCheckoutAddendum = z.infer<typeof LateCheckoutAddendumSchema>;

export interface EffectivePolicyMetadata {
  basePolicyId: string;
  basePolicyVersion: string;
  effectivePolicyVersion: string;
  activeAddendumId: string | null;
  activeAddendumFilename: string | null;
  supersededVersions: string[];
}

export interface HolidayPolicyProvenance {
  status: 'FALSE' | 'UNKNOWN';
  hasHolidaySurcharge: false | 'UNKNOWN';
  confirmedByOwner: boolean;
  policyId: string;
  policyVersion: string;
  sourceType: string;
  approvalStatus: string;
  provenancePath: string;
  statement: string;
}

/**
 * Verifies Owner-approved holiday surcharge provenance dynamically from the loaded policy config.
 * Never infers 0 VND holiday surcharge unless an active OWNER_CONFIRMED policy explicitly sets has_holiday_surcharge === false.
 */
export function getHolidayPolicyProvenance(config?: PricingPolicyConfig | null): HolidayPolicyProvenance {
  const cfg = config ?? loadActivePricingPolicyConfig();
  const srcStatus = cfg?.source_metadata?.status;
  const srcType = cfg?.source_metadata?.source_type ?? 'UNSPECIFIED';
  const hp: any = cfg?.holiday_policy;
  const hpStatus = hp?.status ?? srcStatus ?? 'UNCONFIRMED';
  const isOwnerApprovedSource =
    srcStatus === 'OWNER_CONFIRMED_ACTIVE' &&
    (srcType === 'OWNER_CONFIRMED_DIRECTIVE' || srcType === 'OWNER_DIRECT_INSTRUCTION');
  const confirmed =
    Boolean(hp) &&
    hp.has_holiday_surcharge === false &&
    hpStatus === 'OWNER_CONFIRMED_ACTIVE' &&
    isOwnerApprovedSource;

  return {
    status: confirmed ? 'FALSE' : 'UNKNOWN',
    hasHolidaySurcharge: confirmed ? false : 'UNKNOWN',
    confirmedByOwner: confirmed,
    policyId: cfg?.config_id ?? 'UNKNOWN',
    policyVersion: cfg?.schema_version ?? 'UNKNOWN',
    sourceType: srcType,
    approvalStatus: hpStatus,
    provenancePath: `data/j_collection_business_policy_${String(cfg?.schema_version || 'unknown').replace(/\./g, '_')}.json#holiday_policy`,
    statement: confirmed
      ? String(hp.statement || 'J Collection không áp dụng phụ thu hay tăng giá riêng vào các dịp lễ Tết.')
      : 'Chính sách phụ thu ngày lễ chưa có xác nhận chính thức từ Chủ dự án trong nguồn chính sách đang kích hoạt (UNKNOWN).',
  };
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  return `{${sortedKeys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`)
    .join(',')}}`;
}

let cachedDefaultPolicyHash: string | null = null;
let cachedDefaultPolicyCfgRef: PricingPolicyConfig | null = null;
let cachedDefaultPolicyAddRef: OwnerPolicyAddendum | null = null;

/**
 * Computes a deterministic SHA-256 content hash over the active pricing policy config and owner addendums.
 */
export function computePolicyContentHash(
  config?: PricingPolicyConfig | null,
  addendum?: OwnerPolicyAddendum | null
): string {
  const cfg = config ?? loadActivePricingPolicyConfig();
  const add = addendum === undefined ? loadOwnerPolicyAddendums() : addendum;
  if (
    !config &&
    addendum === undefined &&
    cachedDefaultPolicyHash &&
    cfg === cachedDefaultPolicyCfgRef &&
    add === cachedDefaultPolicyAddRef
  ) {
    return cachedDefaultPolicyHash;
  }
  const payload = canonicalJsonStringify({ cfg, add });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  if (!config && addendum === undefined) {
    cachedDefaultPolicyCfgRef = cfg;
    cachedDefaultPolicyAddRef = add;
    cachedDefaultPolicyHash = hash;
  }
  return hash;
}

let cachedImmutableBuildIdentity: ImmutableBuildIdentity | null = null;

/**
 * Resolves immutable compile-time build identity co-located with the running binary (build-identity.json),
 * falling back only to explicit IMMUTABLE_BUILD_COMMIT env or SOURCE_TS_RUNTIME — never shelling out to mutable `git HEAD`.
 */
export function getImmutableBuildIdentity(): ImmutableBuildIdentity {
  if (cachedImmutableBuildIdentity && !process.env.IMMUTABLE_BUILD_COMMIT) {
    return cachedImmutableBuildIdentity;
  }
  const envCommit = process.env.IMMUTABLE_BUILD_COMMIT?.trim();
  if (envCommit) {
    return {
      commit: envCommit,
      buildVersion: '3.0.0-llm-native-final',
      isImmutableStamp: true,
    };
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '..', 'build-identity.json'),
      path.resolve(here, '..', '..', 'build-identity.json'),
    ];
    for (const stampPath of candidates) {
      if (fs.existsSync(stampPath)) {
        const parsed = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
        if (parsed && typeof parsed.commit === 'string' && parsed.commit.trim().length > 0) {
          cachedImmutableBuildIdentity = {
            commit: parsed.commit.trim(),
            branch: typeof parsed.branch === 'string' ? parsed.branch : undefined,
            builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : undefined,
            buildVersion: typeof parsed.buildVersion === 'string' ? parsed.buildVersion : '3.0.0-llm-native-final',
            policyVersion: typeof parsed.policyVersion === 'string' ? parsed.policyVersion : undefined,
            binaryRoot: typeof parsed.binaryRoot === 'string' ? parsed.binaryRoot : undefined,
            isImmutableStamp: true,
          };
          return cachedImmutableBuildIdentity;
        }
      }
    }
  } catch {
    // Fall through to unstamped descriptor cleanly
  }
  return {
    commit: 'UNSTAMPED_SOURCE_RUNTIME',
    buildVersion: '3.0.0-llm-native-final',
    isImmutableStamp: false,
  };
}

let cachedActivePricingPolicyConfig: PricingPolicyConfig | null = null;
let cachedOwnerPolicyAddendum: OwnerPolicyAddendum | null = null;

/**
 * Resolves the highest-precedence Owner policy addendum file.
 * Precedence: V1.4.6 -> V1.4.5 -> V1.4.4.
 */
export function getOwnerPolicyAddendumPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'j_collection_business_policy_addendum_v1_4_6.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_business_policy_addendum_v1_4_6.json'),
    path.resolve(process.cwd(), 'data', 'j_collection_business_policy_addendum_v1_4_5.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_business_policy_addendum_v1_4_5.json'),
    path.resolve(process.cwd(), 'data', 'j_collection_business_policy_addendum_v1_4_4.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_business_policy_addendum_v1_4_4.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export function getV144PolicyAddendumPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'j_collection_business_policy_addendum_v1_4_4.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_business_policy_addendum_v1_4_4.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export function getV145PolicyAddendumPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'j_collection_business_policy_addendum_v1_4_5.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_business_policy_addendum_v1_4_5.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function comparePolicyVersions(a: string, b: string): number {
  const parseParts = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((n) => parseInt(n, 10));
  const pa = parseParts(a);
  const pb = parseParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

export function loadOwnerPolicyAddendums(addendumPath?: string): OwnerPolicyAddendum | null {
  if (cachedOwnerPolicyAddendum && !addendumPath) {
    return cachedOwnerPolicyAddendum;
  }
  if (addendumPath) {
    if (!fs.existsSync(addendumPath)) {
      return null;
    }
    const rawJson = JSON.parse(fs.readFileSync(addendumPath, 'utf8'));
    const parsed = OwnerPolicyAddendumSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new Error(`Owner policy addendum schema validation failed for ${addendumPath}`);
    }
    return Object.freeze(parsed.data);
  }

  // Load and cumulatively compose all present owner addendums in ascending version order
  // (1.4.4 -> 1.4.5 -> 1.4.6) so newer versions override only what they update and
  // preserve prior confirmed sections (such as V1.4.5 breakfast FALSE under V1.4.6).
  const dataDirs = [
    path.resolve(process.cwd(), 'data'),
    path.resolve(process.cwd(), '..', 'data'),
  ];
  const candidateFiles = [
    'j_collection_business_policy_addendum_v1_4_4.json',
    'j_collection_business_policy_addendum_v1_4_5.json',
    'j_collection_business_policy_addendum_v1_4_6.json',
  ];

  const loaded: Array<{ version: string; data: OwnerPolicyAddendum }> = [];
  const seenFilenames = new Set<string>();
  for (const dir of dataDirs) {
    for (const filename of candidateFiles) {
      if (seenFilenames.has(filename)) continue;
      const fp = path.join(dir, filename);
      if (fs.existsSync(fp)) {
        seenFilenames.add(filename);
        const rawJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const parsed = OwnerPolicyAddendumSchema.safeParse(rawJson);
        if (!parsed.success) {
          throw new Error(`Owner policy addendum schema validation failed for ${fp}`);
        }
        const version = parsed.data.policy_version ?? parsed.data.change_history?.[0]?.version ?? parsed.data.schema_version;
        loaded.push({ version, data: parsed.data });
      }
    }
  }

  if (loaded.length === 0) {
    return null;
  }

  loaded.sort((a, b) => comparePolicyVersions(a.version, b.version));
  let mergedBreakfast = loaded[0].data.breakfast;
  let mergedLateCheckout = loaded[0].data.late_checkout;
  for (let i = 1; i < loaded.length; i++) {
    const next = loaded[i].data;
    if (next.breakfast) {
      mergedBreakfast = mergedBreakfast ? { ...mergedBreakfast, ...next.breakfast } : next.breakfast;
    }
    if (next.late_checkout) {
      mergedLateCheckout = mergedLateCheckout
        ? { ...mergedLateCheckout, ...next.late_checkout }
        : next.late_checkout;
    }
  }

  const highest = loaded[loaded.length - 1].data;
  const composed: OwnerPolicyAddendum = {
    ...highest,
    ...(mergedBreakfast ? { breakfast: mergedBreakfast } : {}),
    ...(mergedLateCheckout ? { late_checkout: mergedLateCheckout } : {}),
  };
  const frozen = Object.freeze(composed);
  cachedOwnerPolicyAddendum = frozen;
  return frozen;
}

export function getEffectivePolicyMetadata(): EffectivePolicyMetadata {
  const base = loadActivePricingPolicyConfig();
  const addendum = loadOwnerPolicyAddendums();
  const addendumPath = getOwnerPolicyAddendumPath();
  const effectiveVersion =
    addendum?.policy_version ??
    addendum?.change_history?.[0]?.version ??
    base.schema_version;
  const historyVersions = (addendum?.change_history ?? [])
    .map((h) => h.version)
    .filter((v) => v && v !== effectiveVersion && v !== base.schema_version);
  const supersededVersions = Array.from(
    new Set([
      ...(addendum?.extends_policy_version ? [addendum.extends_policy_version] : []),
      ...historyVersions,
    ])
  );
  return {
    basePolicyId: base.config_id,
    basePolicyVersion: base.schema_version,
    effectivePolicyVersion: effectiveVersion,
    activeAddendumId: addendum?.addendum_id ?? null,
    activeAddendumFilename: addendum ? path.basename(addendumPath) : null,
    supersededVersions,
  };
}

export function getActivePricingConfigPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'j_collection_business_policy_v1_4_3.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_business_policy_v1_4_3.json'),
    path.resolve(process.cwd(), 'data', 'j_collection_pricing_policy_v1_4_2.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export function getV142PricingConfigPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'j_collection_pricing_policy_v1_4_2.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_pricing_policy_v1_4_2.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export function getLegacyPricingConfigPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'j_collection_pricing_policy_addendum_v1.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_pricing_policy_addendum_v1.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Loads and validates any pricing policy JSON file by path.
 */
export function loadPricingPolicyConfig(configPath?: string): PricingPolicyConfig {
  const targetPath = configPath ?? getActivePricingConfigPath();

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Pricing policy configuration not found at: ${targetPath}`);
  }

  const rawJson = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const parseResult = PricingPolicyConfigSchema.safeParse(rawJson);

  if (!parseResult.success) {
    throw new Error(
      `Pricing policy schema validation failed for ${targetPath}:\n${JSON.stringify(
        parseResult.error.format(),
        null,
        2
      )}`
    );
  }

  return Object.freeze(parseResult.data);
}

/**
 * Loads the ACTIVE V1.4.3 pricing policy with strict enforcement of Owner confirmed decisions.
 * REJECTS legacy V1.0 configs with obsolete unconfirmed statuses.
 */
export function loadActivePricingPolicyConfig(configPath?: string): PricingPolicyConfig {
  if (cachedActivePricingPolicyConfig && !configPath) {
    return cachedActivePricingPolicyConfig;
  }

  const targetPath = configPath ?? getActivePricingConfigPath();
  const config = loadPricingPolicyConfig(targetPath);

  // Release Blocker: Ensure active config is V1.4.3 and not obsolete V1.0 or V1.4.2
  if (config.schema_version !== '1.4.3') {
    throw new Error(
      `Invalid active pricing policy version: ${config.schema_version}. Active policy must be version 1.4.3. (Target: ${targetPath})`
    );
  }

  if (config.config_id !== 'J_COLLECTION_BUSINESS_POLICY_V1_4_3') {
    throw new Error(
      `Invalid active pricing policy ID: ${config.config_id}. Expected "J_COLLECTION_BUSINESS_POLICY_V1_4_3".`
    );
  }

  // Verify Hà Đông Suite mapping is OWNER_CONFIRMED
  const hdConfig = config.facilities['jacayl-ha-dong'];
  if (!hdConfig) {
    throw new Error('Active pricing policy missing required facility configuration for "jacayl-ha-dong".');
  }

  const suiteMapping = hdConfig.category_mapping?.['Suite'];
  if (!suiteMapping || suiteMapping.status !== 'OWNER_CONFIRMED' || suiteMapping.dataset_hang !== 'Concept') {
    throw new Error(
      'Active pricing policy must specify Suite -> Concept with status "OWNER_CONFIRMED" at Jacayl Hà Đông.'
    );
  }

  // Verify pricing basis and cross-window rules
  if (
    config.scope.pricing_basis !== 'CHECKIN_TIMESTAMP' ||
    config.scope.cross_window_behavior !== 'KEEP_CHECKIN_BASE_PRICE'
  ) {
    throw new Error(
      'Active pricing policy must specify pricing_basis = "CHECKIN_TIMESTAMP" and cross_window_behavior = "KEEP_CHECKIN_BASE_PRICE".'
    );
  }

  // Run consistency validation against CategoryMapper
  validatePolicyCategoryConsistency(config, FACILITY_CATEGORY_CONFIGS);

  cachedActivePricingPolicyConfig = config;
  return cachedActivePricingPolicyConfig;
}

/**
 * Validates cross-consistency between FacilityCategoryMapper and PricingPolicyConfig.
 * Throws an Error if any conflict or mismatch is detected.
 */
export function validatePolicyCategoryConsistency(
  policyConfig: PricingPolicyConfig,
  categoryConfigs: Record<CoSoMa, FacilityCategoryConfig>
): void {
  const hdPolicy = policyConfig.facilities['jacayl-ha-dong'];
  const hdCategories = categoryConfigs['jacayl-ha-dong'];

  if (!hdPolicy || !hdCategories) {
    throw new Error('Missing Jacayl Hà Đông configuration for consistency check.');
  }

  // 1. Verify Concept -> Suite mapping in CategoryMapper is OWNER_CONFIRMED
  const mapperConcept = hdCategories.mappings['Concept'];
  if (!mapperConcept || mapperConcept.mapped_owner_tier !== 'Suite' || mapperConcept.confirmation_status !== 'OWNER_CONFIRMED') {
    throw new Error('CategoryMapper Jacayl Hà Đông Concept must map to Suite with OWNER_CONFIRMED status.');
  }

  // 2. Verify Policy Config category_mapping matches
  const policySuite = hdPolicy.category_mapping?.['Suite'];
  if (!policySuite || policySuite.dataset_hang !== 'Concept' || policySuite.status !== 'OWNER_CONFIRMED') {
    throw new Error('PricingPolicyConfig Jacayl Hà Đông category_mapping.Suite must match Concept with OWNER_CONFIRMED.');
  }

  // 3. Verify Standard and Deluxe mappings
  const mapperStandard = hdCategories.mappings['Standard'];
  if (!mapperStandard || mapperStandard.mapped_owner_tier !== 'Standard') {
    throw new Error('CategoryMapper Jacayl Hà Đông Standard must map to Standard.');
  }

  const mapperDeluxe = hdCategories.mappings['Deluxe'];
  if (!mapperDeluxe || mapperDeluxe.mapped_owner_tier !== 'Deluxe') {
    throw new Error('CategoryMapper Jacayl Hà Đông Deluxe must map to Deluxe.');
  }

  // 4. Verify rates for all mapped tiers exist in policy daytime rates
  for (const rateGroup of hdPolicy.daytime_rates) {
    for (const tier of ['Standard', 'Deluxe', 'Suite'] as const) {
      if (typeof rateGroup.rates_by_owner_category[tier] !== 'number') {
        throw new Error(`PricingPolicyConfig daytime rates missing price for tier: ${tier}`);
      }
    }
  }

  // 5. Verify weekend Standard rate is exactly 180,000đ
  const weekendGroup = hdPolicy.daytime_rates.find(
    (rg) => rg.days_of_week_iso.includes(6) && rg.days_of_week_iso.includes(7)
  );
  if (!weekendGroup || weekendGroup.rates_by_owner_category['Standard'] !== 180000) {
    throw new Error('PricingPolicyConfig weekend Standard daytime rate must be exactly 180,000đ.');
  }
}

export function clearPricingPolicyConfigCache(): void {
  cachedActivePricingPolicyConfig = null;
  cachedOwnerPolicyAddendum = null;
}
