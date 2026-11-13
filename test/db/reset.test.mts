import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// db/reset.mts and db/seed.mts are command-line scripts that do their
// work as soon as they're loaded, so these tests run them the way
// `npm run db:reset` does -- as separate Node processes with tsx -- each
// pointed at a throwaway database via DB_PATH.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

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
  assert.equal(countRows("figures"), 8);
  assert.equal(countRows("sequences"), 5);
  assert.equal(countRows("dances"), 5);
});

test("db:reset can run again without duplicating data", () => {
  assert.equal(runScript("db/reset.mts").status, 0);
  assert.equal(runScript("db/reset.mts").status, 0);
  assert.equal(countRows("figures"), 8);
  assert.equal(countRows("dances"), 5);
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
  assert.equal(countRows("dances"), 5);
});

test("db:reset removes a stale rollback journal left next to the database", () => {
  // A journal left over from an interrupted write could otherwise be
  // replayed into the new database when it's first opened.
  writeFileSync(`${dbPath}-journal`, "stale");
  assert.equal(runScript("db/reset.mts").status, 0);
  assert.equal(existsSync(`${dbPath}-journal`), false);
  assert.equal(countRows("figures"), 8);
});

test("the seed script refuses to run on a database that already has data", () => {
  assert.equal(runScript("db/reset.mts").status, 0);

  const result = runScript("db/seed.mts");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already has 8 figures/);
  assert.match(result.stderr, /npm run db:reset/);
  // Nothing was added.
  assert.equal(countRows("figures"), 8);
});

test("the seed script points to db:reset when there's no database", () => {
  rmSync(dbPath, { force: true });
  const result = runScript("db/seed.mts");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No database at/);
  assert.match(result.stderr, /npm run db:reset/);
});
