import * as fs from 'fs';
import * as path from 'path';
import { RawDataset, RawDatasetSchema } from '../domain/raw-schema.js';

/**
 * J Collection AI Concierge - Raw Data Loader
 * Safely loads and validates j_collection_dataset.json with read-only semantics and memory caching.
 */

let cachedRawDataset: RawDataset | null = null;

export interface RawLoaderOptions {
  datasetPath?: string;
  forceReload?: boolean;
}

export function getDefaultDatasetPath(): string {
  // Try relative to current working directory, then relative to project root
  const candidates = [
    path.resolve(process.cwd(), 'data', 'j_collection_dataset.json'),
    path.resolve(process.cwd(), '..', 'data', 'j_collection_dataset.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Loads the raw canonical dataset file with runtime Zod validation.
 * @throws Error if file does not exist or fails schema validation.
 */
export function loadRawDataset(options?: RawLoaderOptions): RawDataset {
  if (cachedRawDataset && !options?.forceReload) {
    return cachedRawDataset;
  }

  const filePath = options?.datasetPath ?? getDefaultDatasetPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(`Canonical dataset not found at: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, 'utf8');
  let jsonParsed: unknown;

  try {
    jsonParsed = JSON.parse(fileContent);
  } catch (err) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${(err as Error).message}`);
  }

  const parseResult = RawDatasetSchema.safeParse(jsonParsed);

  if (!parseResult.success) {
    const errorDetails = parseResult.error.format();
    throw new Error(
      `Dataset schema validation failed for ${filePath}:\n${JSON.stringify(errorDetails, null, 2)}`
    );
  }

  // Freeze object to enforce read-only semantics at runtime
  cachedRawDataset = Object.freeze(parseResult.data) as RawDataset;
  return cachedRawDataset;
}

/**
 * Clear cached dataset (for test isolation)
 */
export function clearRawDatasetCache(): void {
  cachedRawDataset = null;
}
