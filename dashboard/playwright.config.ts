import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test', testMatch: '*.spec.ts', reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:18083', trace: 'retain-on-failure' },
  webServer: {
    command: 'node server/index.ts --dev', env: { DASHBOARD_PORT: '18083' },
    url: 'http://127.0.0.1:18083/api/health', timeout: 30_000,
  },
});
