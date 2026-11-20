import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { loadFigures } from "../../db/figures/index.mts";

// db/reset.mts and db/seed.mts are command-line scripts that do their
// work as soon as they're loaded, so these tests run them the way
// `npm run db:reset` does -- as separate Node processes with tsx -- each
// pointed at a throwaway database via DB_PATH.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// However many figure files db/figures/ has, so adding one never needs a
// change here.
const FIGURE_COUNT = loadFigures().length;

let directory: string;
let dbPath: string;

before(() => {
  directory = mkdtempSync(join(tmpdir(), "milonga-reset-test-"));
  dbPath = join(directory, "test.sqlite");
});

after(() => rmSync(directory, { recursive: true, force: true }));

function runScript(script: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", join(repoRoot, script)],
    {
      cwd: repoRoot,
      env: { ...process.env, DB_PATH: dbPath },
      encoding: "utf8",
    },
  );
}

function countRows(table: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  } finally {
    db.close();
  }
}

test("db:reset creates and seeds a database that doesn't exist yet", () => {
  assert.equal(existsSync(dbPath), false);
  const result = runScript("db/reset.mts");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(countRows("figures"), FIGURE_COUNT);
  assert.equal(countRows("sequences"), 10);
  assert.equal(countRows("dances"), 10);
});

test("db:reset can run again without duplicating data", () => {
  assert.equal(runScript("db/reset.mts").status, 0);
  assert.equal(runScript("db/reset.mts").status, 0);
  assert.equal(countRows("figures"), FIGURE_COUNT);
  assert.equal(countRows("dances"), 10);
});

test("db:reset throws away data and tables that aren't in the schema", () => {
  const db = new Database(dbPath);
  db.exec("CREATE TABLE leftover (id INTEGER)");
  db.prepare("DELETE FROM dances").run();
  db.close();

  assert.equal(runScript("db/reset.mts").status, 0);

  const rebuilt = new Database(dbPath, { readonly: true });
  const leftover = rebuilt
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'leftover'",
    )
    .get() as { n: number };
  rebuilt.close();
  assert.equal(leftover.n, 0);
  assert.equal(countRows("dances"), 10);
});

test("db:reset removes a stale rollback journal left next to the database", () => {
  // A journal left over from an interrupted write could otherwise be
  // replayed into the new database when it's first opened.
  writeFileSync(`${dbPath}-journal`, "stale");
  assert.equal(runScript("db/reset.mts").status, 0);
  assert.equal(existsSync(`${dbPath}-journal`), false);
  assert.equal(countRows("figures"), FIGURE_COUNT);
});

test("the seed script refuses to run on a database that already has data", () => {
  assert.equal(runScript("db/reset.mts").status, 0);

  const result = runScript("db/seed.mts");
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    new RegExp(`already has ${FIGURE_COUNT} figures`),
  );
  assert.match(result.stderr, /npm run db:reset/);
  // Nothing was added.
  assert.equal(countRows("figures"), FIGURE_COUNT);
});

test("the seed script points to db:reset when there's no database", () => {
  rmSync(dbPath, { force: true });
  const result = runScript("db/seed.mts");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No database at/);
  assert.match(result.stderr, /npm run db:reset/);
});

test("db:reset seeds whatever figure files are in the folder, skipping sample sequences that need a missing figure", () => {
  const figuresDir = mkdtempSync(join(directory, "figures-"));
  writeFileSync(
    join(figuresDir, "walking-step.json"),
    JSON.stringify({
      name: "Walking Step",
      style: "tango",
      time: "4/4",
      steps: [{ both: "forward", by: 0.6, length: "Q" }],
    }),
  );
  writeFileSync(
    join(figuresDir, "my-figure.json"),
    JSON.stringify({
      name: "My Figure",
      style: "tango",
      time: "4/4",
      steps: [{ both: "side left", by: 0.3, length: "Q" }],
    }),
  );

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(repoRoot, "db/reset.mts")],
    {
      cwd: repoRoot,
      env: { ...process.env, DB_PATH: dbPath, FIGURES_DIR: figuresDir },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(countRows("figures"), 2);
  // Only "Practice: single walk" uses nothing but Walking Step; the
  // other four sample sequences need figures that aren't there.
  assert.equal(countRows("sequences"), 1);
  assert.equal(countRows("dances"), 1);
  assert.match(result.stderr, /Skipping sample sequence "Basic Combination"/);
  assert.match(
    result.stdout,
    /Seed complete: 2 figures, 1 sequences, 1 dances\./,
  );
});

test("db:reset leaves the existing database alone when a figure file has a problem", () => {
  // Start from a fully seeded database.
  assert.equal(runScript("db/reset.mts").status, 0);
  assert.equal(countRows("figures"), FIGURE_COUNT);

  const figuresDir = mkdtempSync(join(directory, "bad-figures-"));
  writeFileSync(
    join(figuresDir, "broken.json"),
    JSON.stringify({
      name: "Broken",
      style: "tango",
      time: "4/4",
      steps: [{ both: "forward", length: "Q" }], // no `by`
    }),
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(repoRoot, "db/reset.mts")],
    {
      cwd: repoRoot,
      env: { ...process.env, DB_PATH: dbPath, FIGURES_DIR: figuresDir },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /broken\.json/);
  assert.doesNotMatch(result.stdout, /Recreated/);
  // The database was never deleted, so the old data is still there.
  assert.equal(countRows("figures"), FIGURE_COUNT);
  assert.equal(countRows("dances"), 10);
});
