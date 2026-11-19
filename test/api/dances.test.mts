import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type BetterSqlite3 from "better-sqlite3";

import { openTestDatabase } from "../support/database.mts";
import { loadFigures } from "../../db/figures/index.mts";

// HTTP-level tests for the routes in api/dances.mts, served from a
// seeded temporary database. The router is mounted on a bare Express
// app listening on an ephemeral port, rather than importing
// api/server.mts, which binds the real port and serves the frontend
// build as a side effect of being imported.

let cleanup: () => void;
let db: BetterSqlite3.Database;
let server: Server;
let baseUrl: string;
let assembleFigure: (id: number) => unknown;

interface ApiBody {
  success: boolean;
  message?: unknown;
  error?: string;
}

async function get(path: string): Promise<{ status: number; body: ApiBody }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as ApiBody };
}

before(async () => {
  ({ db, cleanup } = await openTestDatabase({ seed: true }));
  const { dance_routes } = await import("../../api/dances.mts");
  ({ assembleFigure } = await import("../../api/assemble.mts"));

  const app = express();
  app.use(express.json());
  app.use(dance_routes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  cleanup();
});

test("GET /api/hello: health check responds", async () => {
  const { status, body } = await get("/api/hello");
  assert.equal(status, 200);
  assert.deepEqual(body, { success: true, message: "hello" });
});

test("GET /api/figures: lists lightweight summaries sorted by name, with string ids", async () => {
  const { status, body } = await get("/api/figures");
  assert.equal(status, 200);
  assert.equal(body.success, true);

  const figures = body.message as Record<string, unknown>[];
  assert.equal(figures.length, loadFigures().length);
  const names = figures.map((figure) => figure.name as string);
  assert.deepEqual(names, [...names].sort());
  for (const figure of figures) {
    // Summaries only -- never the steps or poses.
    assert.deepEqual(Object.keys(figure).sort(), ["id", "name", "style"]);
    assert.equal(typeof figure.id, "string");
  }
});

test("GET /api/figures/:id: returns the same nested figure the assembler builds", async () => {
  const { status, body } = await get("/api/figures/3");
  assert.equal(status, 200);
  assert.deepEqual(body.message, assembleFigure(3));
});

test("GET /api/figures/:id: rejects ids that aren't positive integers with 400", async () => {
  for (const badId of ["abc", "0", "-1", "1.5", "1e3x"]) {
    const { status, body } = await get(`/api/figures/${badId}`);
    assert.equal(status, 400, `id ${badId}`);
    assert.equal(body.success, false);
    assert.match(body.error ?? "", /Invalid id/);
  }
});

test("GET /api/figures/:id: an unknown figure is a 404 with an error message", async () => {
  const { status, body } = await get("/api/figures/9999");
  assert.equal(status, 404);
  assert.equal(body.success, false);
  assert.match(body.error ?? "", /No figure with id 9999/);
});

test("GET /api/sequences/:id: returns an assembled sequence, 404 when missing", async () => {
  const found = await get("/api/sequences/2");
  assert.equal(found.status, 200);
  const sequence = found.body.message as { id: string; entries: unknown[] };
  assert.equal(sequence.id, "2");
  assert.ok(sequence.entries.length > 0);

  const missing = await get("/api/sequences/9999");
  assert.equal(missing.status, 404);
  assert.equal((await get("/api/sequences/zero")).status, 400);
});

test("GET /api/dances: lists dances, most recently updated first", async () => {
  const { status, body } = await get("/api/dances");
  assert.equal(status, 200);
  const dances = body.message as { updatedAt: string; tempo: number }[];
  assert.equal(dances.length, 8);
  const times = dances.map((dance) => Date.parse(dance.updatedAt));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
  for (const dance of dances) {
    assert.equal(typeof dance.tempo, "number");
  }
});

test("GET /api/dances: ids are strings, like every other endpoint", async () => {
  const { body } = await get("/api/dances");
  for (const dance of body.message as { id: unknown }[]) {
    assert.equal(typeof dance.id, "string");
  }
});

test("GET /api/dances/:id: returns an assembled dance with its sequence, 404 when missing", async () => {
  const found = await get("/api/dances/1");
  assert.equal(found.status, 200);
  const dance = found.body.message as {
    id: string;
    sequence: { entries: unknown[] };
  };
  assert.equal(dance.id, "1");
  assert.ok(dance.sequence.entries.length > 0);

  const missing = await get("/api/dances/9999");
  assert.equal(missing.status, 404);
  assert.match(missing.body.error ?? "", /No dance with id 9999/);
});

// Each mutation is rolled back before another test runs. Requests exercise the
// real SQL/assembly path rather than mocking its exports or matching messages.
async function withDatabaseChange(
  change: () => void,
  check: () => Promise<void>,
) {
  db.exec("SAVEPOINT api_error_regression");
  try {
    change();
    await check();
  } finally {
    db.exec("ROLLBACK TO api_error_regression; RELEASE api_error_regression");
  }
}

for (const entity of ["figures", "sequences", "dances"]) {
  test(`GET /api/${entity}/:id: invalid and unsafe ids return 400; missing records return 404`, async (t) => {
    const log = t.mock.method(console, "error", () => {});
    for (const id of [
      "abc",
      "0",
      "-1",
      "1.5",
      "1e3x",
      "Infinity",
      "9007199254740992",
      "1e100",
    ]) {
      const response = await get(`/api/${entity}/${id}`);
      assert.equal(response.status, 400, id);
      assert.deepEqual(response.body, {
        success: false,
        error: `Invalid id: ${id}`,
      });
    }
    const missing = await get(`/api/${entity}/9999`);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, {
      success: false,
      error: `No ${entity.slice(0, -1)} with id 9999`,
    });
    assert.equal(
      log.mock.callCount(),
      0,
      "expected client errors are not logged as internal failures",
    );
  });
}

for (const [path, table] of [
  ["/api/figures", "figures"],
  ["/api/dances", "dances"],
  ["/api/figures/3", "figures"],
  ["/api/sequences/2", "sequences"],
  ["/api/dances/1", "dances"],
]) {
  test(`GET ${path}: database failures return generic 500 JSON and log details`, async (t) => {
    const log = t.mock.method(console, "error", () => {});
    await withDatabaseChange(
      () => db.exec(`ALTER TABLE ${table} RENAME TO unavailable_${table}`),
      async () => {
        const response = await get(path);
        assert.equal(response.status, 500);
        assert.deepEqual(response.body, {
          success: false,
          error: "Internal server error.",
        });
        assert.equal(log.mock.callCount(), 1);
        const [context, error] = log.mock.calls[0].arguments;
        assert.equal(context, `API GET ${path} failed`);
        assert.ok(error instanceof Error);
        assert.match(error.message, /no such table/i);
        assert.ok(error.stack);
      },
    );
    assert.equal(
      (await get(path)).status,
      200,
      "restoring the database restores successful requests",
    );
  });
}

test("GET /api/figures/:id: an incomplete stored pose is an internal assembly failure", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  await withDatabaseChange(
    () =>
      db
        .prepare(
          "DELETE FROM foot_states WHERE pose_id = (SELECT start_pose_id FROM figures WHERE id = 3) AND partner = 'lead' AND foot = 'left'",
        )
        .run(),
    async () => {
      const response = await get("/api/figures/3");
      assert.equal(response.status, 500);
      assert.deepEqual(response.body, {
        success: false,
        error: "Internal server error.",
      });
      assert.equal(log.mock.callCount(), 1);
      const error = log.mock.calls[0].arguments[1];
      assert.ok(error instanceof Error);
      assert.match(error.message, /no foot_states row/);
    },
  );
});

for (const [path, change] of [
  [
    "/api/sequences/2",
    "DELETE FROM figures WHERE id = (SELECT figure_id FROM sequence_entries WHERE sequence_id = 2 LIMIT 1)",
  ],
  [
    "/api/dances/1",
    "DELETE FROM sequences WHERE id = (SELECT sequence_id FROM dances WHERE id = 1)",
  ],
]) {
  test(`GET ${path}: a missing child is 500 rather than a misleading parent 404`, async (t) => {
    const log = t.mock.method(console, "error", () => {});
    // Simulate a legacy/corrupt reference. Production connections always keep
    // foreign keys enabled; restore this test-only setting even on failure.
    db.pragma("foreign_keys = OFF");
    try {
      await withDatabaseChange(
        () => db.exec(change),
        async () => {
          const response = await get(path);
          assert.equal(response.status, 500);
          assert.deepEqual(response.body, {
            success: false,
            error: "Internal server error.",
          });
          assert.equal(log.mock.callCount(), 1);
          const error = log.mock.calls[0].arguments[1];
          assert.ok(error instanceof Error);
          assert.equal(error.name, "RecordNotFoundError");
        },
      );
    } finally {
      db.pragma("foreign_keys = ON");
    }
    assert.equal((await get(path)).status, 200);
  });
}
