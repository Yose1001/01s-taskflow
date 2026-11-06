import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

// The tests start their own copy of the whole system, on their own ports and their own database,
// so they never touch the development servers or the development data.
const API_PORT = 8081
const WEB_PORT = 5174
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgres://taskflow:taskflow_dev@localhost:5432/taskflow_e2e?sslmode=disable'

export default defineConfig({
  testDir: './tests',
  // Every test makes its own users, so tests do not depend on each other and can run side by side.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // Kept only when a test fails, so there is something to look at.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The real Go API.
      command: 'go run ./cmd/api',
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/v1/ready`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL,
        // A fresh random secret for every run, so none is stored in the repository.
        JWT_SECRET: randomBytes(32).toString('hex'),
        // All test users come from one address, so the sign-in/sign-up limits are lifted here.
        // (Production keeps the strict defaults; a separate test checks that the limit still works.)
        LOGIN_RATE_LIMIT_PER_MINUTE: '100000',
        REGISTER_RATE_LIMIT_PER_MINUTE: '100000',
      },
    },
    {
      // The real web app (Vite), forwarding /api to the test API above.
      command: `pnpm --dir ../frontend exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
})
