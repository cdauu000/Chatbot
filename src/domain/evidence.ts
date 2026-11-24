import { z } from 'zod';

/**
 * J Collection AI Concierge - Milestone 0 Evidence & Provenance Model
 * Defines discriminated union Zod schemas separating 4 cognitive states:
 * - CONFIRMED_TRUE: Field has explicit verified evidence
 * - CONFIRMED_FALSE: Field has explicit evidence of non-existence
 * - UNKNOWN: Field is missing, not specified, or unconfirmed
 * - CONFLICTED: Discrepancy between two or more sources
 */

export const EvidenceSourceSchema = z.enum([
  'WEBSITE_EXPLICIT',
  'RAW_DATASET',
  'OWNER_DIRECT_POLICY',
  'IMAGE_VERIFIED',
  'POLICY_RULE',
  'FACILITY_LIMITATION',
  'PHYSICAL_AUDIT',
]);

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const FallbackActionSchema = z.enum([
  'DISCLAIM_UNKNOWN_TO_USER',
  'ROUTE_TO_HUMAN_STAFF',
  'USE_DEFAULT_FALLBACK',
]);

export type FallbackAction = z.infer<typeof FallbackActionSchema>;

export const ConflictResolutionSchema = z.enum([
  'FORCE_UNKNOWN',
  'NEED_OWNER_CONFIRMATION',
  'USE_CONSERVATIVE_VALUE',
]);

export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

// 1. Confirmed True Schema
export const ConfirmedTrueFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    status: z.literal('CONFIRMED_TRUE'),
    value: valueSchema,
    source: EvidenceSourceSchema,
    raw_reference: z.string().optional(),
    verified_at: z.string().datetime().optional(),
  });

// 2. Confirmed False Schema
export const ConfirmedFalseFieldSchema = z.object({
  status: z.literal('CONFIRMED_FALSE'),
  reason: z.string(),
  source: EvidenceSourceSchema,
  verified_at: z.string().datetime().optional(),
});

// 3. Unknown Schema
export const UnknownFieldSchema = z.object({
  status: z.literal('UNKNOWN'),
  reason: z.string(),
  fallback_action: FallbackActionSchema,
});

// 4. Conflicted Schema
export const ConflictedFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    status: z.literal('CONFLICTED'),
    conflicting_values: z.array(
      z.object({
        source: z.string(),
        value: valueSchema,
      })
    ),
    resolution: ConflictResolutionSchema,
  });

export type EvidenceField<T> =
  | { status: 'CONFIRMED_TRUE'; value: T; source: EvidenceSource; raw_reference?: string; verified_at?: string }
  | { status: 'CONFIRMED_FALSE'; reason: string; source: EvidenceSource; verified_at?: string }
  | { status: 'UNKNOWN'; reason: string; fallback_action: FallbackAction }
  | { status: 'CONFLICTED'; conflicting_values: Array<{ source: string; value: T }>; resolution: ConflictResolution };

/**
 * Factory helper: Create Confirmed True evidence field
 */
export function createConfirmedTrue<T>(
  value: T,
  source: EvidenceSource = 'RAW_DATASET',
  raw_reference?: string
): EvidenceField<T> {
  return {
    status: 'CONFIRMED_TRUE',
    value,
    source,
    raw_reference,
  };
}

/**
 * Factory helper: Create Confirmed False evidence field
 */
export function createConfirmedFalse(
  reason: string,
  source: EvidenceSource = 'POLICY_RULE'
): EvidenceField<never> {
  return {
    status: 'CONFIRMED_FALSE',
    reason,
    source,
  };
}

/**
 * Factory helper: Create Unknown evidence field
 */
export function createUnknown(
  reason: string,
  fallback_action: FallbackAction = 'DISCLAIM_UNKNOWN_TO_USER'
): EvidenceField<never> {
  return {
    status: 'UNKNOWN',
    reason,
    fallback_action,
  };
}

/**
 * Factory helper: Create Conflicted evidence field
 */
export function createConflicted<T>(
  conflicting_values: Array<{ source: string; value: T }>,
  resolution: ConflictResolution = 'NEED_OWNER_CONFIRMATION'
): EvidenceField<T> {
  return {
    status: 'CONFLICTED',
    conflicting_values,
    resolution,
  };
}
