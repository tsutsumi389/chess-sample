// Vitest 設定 — ユニットテストのみを対象とし、Playwright の E2E スペックは除外する
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
