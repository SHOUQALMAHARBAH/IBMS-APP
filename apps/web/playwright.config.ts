import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  /**
   * Capped, not left to Playwright's CPU/2 default.
   *
   * The default over-subscribes memory on a developer machine running the app
   * server, Postgres in Docker and several Chromium instances at once. The
   * symptom is not a slow suite — it is four tests failing with
   * `net::ERR_INSUFFICIENT_RESOURCES` and `Target crashed`, in whichever files
   * happen to be running when memory runs out. Those same files pass 6/6 in
   * 16 seconds on their own, so the failures say nothing about the code.
   *
   * Measured, not guessed: the default produced 268 passed / 4 failed in 3.8
   * minutes; `--workers=2` produced 272 passed / 0 failed in 3.6 minutes. The
   * extra parallelism was buying nothing and costing determinism, and a gate
   * that goes red for elapsed resources rather than for a defect trains people
   * to ignore it (ibms-brain/meta/lex/definition-of-done.md).
   *
   * Overridable for a machine with more headroom.
   */
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // turbo's task graph (see turbo.json: "e2e" depends on "build")
        // already built web before this runs — just start it. `next start`
        // logs a harmless warning about `output: "standalone"` (that mode
        // is for the Docker image only, via apps/web/Dockerfile — it still
        // serves correctly here).
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
