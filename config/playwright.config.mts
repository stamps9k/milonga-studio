import { defineConfig, devices } from "@playwright/test";
import process from "node:process";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "../e2e",
  testMatch: "**/*.spec.mts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:58745",
    // The app retains its existing CDN assets. This also accommodates local
    // environments with an HTTPS-inspecting proxy, without changing the app.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node --import tsx e2e/server.mts",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: "http://127.0.0.1:58745/api/hello",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
