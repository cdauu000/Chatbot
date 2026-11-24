import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { FACILITY_CATEGORY_CONFIGS, FacilityCategoryConfig } from '../pricing/category-mapper.js';
import { CoSoMa } from '../domain/types.js';

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

let cachedActivePricingPolicyConfig: PricingPolicyConfig | null = null;

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
}
