import { defineConfig } from '@playwright/test';
import { browserOptions } from './tests/e2e/browser-options';

const port = Number(process.env.E2E_PORT) || 4397;
const distDir = process.env.OFFICE_DIST_DIR || '.next-student-demo';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'student-demo.spec.ts',
  outputDir: 'test-results-student-demo', workers: 1, timeout: 150000,
  expect: { timeout: 30000 },
  use: { ...browserOptions, baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'node scripts/student-demo.mjs', url: `http://127.0.0.1:${port}/health`, timeout: 60000, reuseExistingServer: false,
    env: { OFFICE_PORT: String(port), OFFICE_DIST_DIR: distDir, OFFICE_STUDENT_DEMO_SUBDIR: 'qa-' + Date.now(),
      // Deliberately conflicting values: the launcher must override these before providers initialize.
      AI_OFFLINE_MODE: '0', OPENAI_API_KEY: 'test-unused-openai', GEMINI_API_KEY: 'test-unused-gemini', DEEPSEEK_API_KEY: 'test-unused-deepseek' },
  },
});
