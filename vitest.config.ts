import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile?.();
} catch {}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
  },
});
