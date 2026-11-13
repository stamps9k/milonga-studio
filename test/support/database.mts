import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Gives a test file its own throwaway SQLite database, built from
 * db/schema.sql and (optionally) filled by db/seed.mts.
 *
 * api/db.mts opens its connection as a side effect of being imported,
 * reading DB_PATH at that moment, and db/seed.mts likewise runs as soon
 * as it's imported. So this helper points DB_PATH at a fresh temp file
 * *before* dynamically importing either, and test files must import
 * anything that touches the database (api/assemble.mts, api/dances.mts)
 * dynamically after calling it. `node --test` runs each test file in
 * its own process, so every file gets its own module instances and its
 * own database; files never share state.
 *
 * This file is deliberately not named *.test.mts, so the test runner
 * doesn't pick it up as a suite.
 */
export async function openTestDatabase({ seed }: { seed: boolean }) {
  const directory = mkdtempSync(join(tmpdir(), "milonga-test-"));
  process.env.DB_PATH = join(directory, "test.sqlite");

  // db.mts and seed.mts both log a line on success; keep test output
  // readable by silencing console.info just for the setup.
  const originalInfo = console.info;
  console.info = () => {};
  try {
    // A missing database file makes db.mts create it from schema.sql.
    const { db } = await import("../../api/db.mts");
    if (seed) {
      await import("../../db/seed.mts");
    }
    return {
      db,
      cleanup() {
        db.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } finally {
    console.info = originalInfo;
  }
}
