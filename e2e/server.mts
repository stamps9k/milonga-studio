import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// Never reset a developer's database or reuse a running server. Playwright
// starts this process once per run; all tests only read its seeded presets.
const directory = mkdtempSync(join(tmpdir(), "milonga-e2e-"));
process.env.DB_PATH = join(directory, "test.sqlite");
process.env.API_PORT = "58745";
delete process.env.FIGURES_DIR;
await import("../db/reset.mts");
const { db } = await import("../api/db.mts");
process.on("exit", () => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
await import("../api/server.mts");
