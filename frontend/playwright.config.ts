import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDatabase =
  process.env.HW1_TEST_DB ??
  join(mkdtempSync(join(tmpdir(), "neural3d-hw1-")), "annotations.sqlite3");
const browserName =
  process.env.HW1_BROWSER === "firefox" ? "firefox" : "chromium";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // A cold dev server may still compile worker imports on the first load.
  // Tests use small fixtures; allow compilation and software WebGL setup time.
  expect: { timeout: 15_000 },
  use: {
    browserName,
    headless: process.env.HW1_HEADED !== "1",
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1080 },
    launchOptions: {
      executablePath: browserName === "chromium" ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE : undefined,
      args:
        browserName === "chromium"
          ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
          : [],
      firefoxUserPrefs: { "webgl.force-enabled": true },
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${process.env.HW1_PYTHON ?? "python3"} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: "../backend",
      env: { DATABASE_PATH: testDatabase },
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      env: { VITE_VIEWER_DIAGNOSTICS: "1" },
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
