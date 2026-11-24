/**
 * Automatic Environment Loader
 * Loads .env file in Node.js 20.6+ environments if not already loaded.
 */
try {
  process.loadEnvFile?.();
} catch {
  // Ignore missing .env or non-file environments
}
