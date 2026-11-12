import { defineConfig } from '@playwright/test';
import { browserOptions } from './tests/e2e/browser-options';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'study-assistant.spec.ts', outputDir: 'test-results-assistant', workers: 1, timeout: 90000,
  use: { ...browserOptions, baseURL: 'http://127.0.0.1:4398', viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: 'node tests/fixtures/ollama-server.mjs', url: 'http://127.0.0.1:4405/api/tags', reuseExistingServer: false, env: { STUDENT_OLLAMA_FIXTURE: '1', OLLAMA_FIXTURE_PORT: '4405' } },
    { command: 'node scripts/student-local.mjs', url: 'http://127.0.0.1:4398/health', timeout: 90000, reuseExistingServer: false, env: { OFFICE_PORT: '4398', OFFICE_DIST_DIR: '.next-p1-qa', OFFICE_DATA_DIR: `data/p2-browser-${Date.now()}`, OLLAMA_BASE_URL: 'http://127.0.0.1:4405', OLLAMA_EMBEDDING_DIMENSIONS: '64' } },
  ],
});
