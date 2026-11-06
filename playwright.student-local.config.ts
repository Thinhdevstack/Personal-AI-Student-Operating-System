import { defineConfig } from '@playwright/test';
import { browserOptions } from './tests/e2e/browser-options';

const port = Number(process.env.E2E_PORT) || 4399;
const fixturePort = 4405;
const distDir = process.env.OFFICE_DIST_DIR || '.next-student-demo';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'student-local.spec.ts',
  outputDir: 'test-results-student-local', workers: 1, timeout: 150000,
  expect: { timeout: 30000 },
  use: { ...browserOptions, baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: 'node tests/fixtures/ollama-server.mjs', url: `http://127.0.0.1:${fixturePort}/api/tags`, timeout: 30000, reuseExistingServer: false, env: { STUDENT_OLLAMA_FIXTURE: '1', OLLAMA_FIXTURE_PORT: String(fixturePort) } },
    { command: 'node scripts/student-local.mjs', url: `http://127.0.0.1:${port}/health`, timeout: 90000, reuseExistingServer: false,
      env: { OFFICE_PORT: String(port), OFFICE_DIST_DIR: distDir, OFFICE_DATA_DIR: `data/student-local-qa-${Date.now()}`,
        OLLAMA_BASE_URL: `http://127.0.0.1:${fixturePort}`, OLLAMA_EMBEDDING_DIMENSIONS: '64', AI_OFFLINE_MODE: '1', AI_CHAT_PROVIDER: 'gemini' } },
  ],
});
