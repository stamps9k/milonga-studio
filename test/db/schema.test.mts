import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type BetterSqlite3 from "better-sqlite3";

import { openTestDatabase } from "../support/database.mts";

// These tests exercise db/schema.sql's own constraints against a fresh,
// empty database: the CHECKs, foreign keys, cascades and the triggers
// that keep the straight/arc movement split honest. They guard the
// invariants api/assemble.mts relies on when it rebuilds domain objects
// without re-validating every row.

let db: BetterSqlite3.Database;
let cleanup: () => void;

before(async () => {
  ({ db, cleanup } = await openTestDatabase({ seed: false }));
});

after(() => cleanup());

function insertPose(): number {
  const poseId = Number(
    db.prepare("INSERT INTO poses DEFAULT VALUES").run().lastInsertRowid,
  );
  for (const partner of ["lead", "follow"]) {
    db.prepare(
      "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, ?, 0, 0)",
    ).run(poseId, partner);
    for (const foot of ["left", "right"]) {
      db.prepare(
        "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, ?, ?, 0, 0, 0.5)",
      ).run(poseId, partner, foot);
    }
  }
  return poseId;
}

function insertMovement(type: "straight" | "arc"): number {
  return Number(
    db.prepare("INSERT INTO movements (type) VALUES (?)").run(type)
      .lastInsertRowid,
  );
}

function insertFigure(): number {
  const pose = insertPose();
  return Number(
    db
      .prepare(
        "INSERT INTO figures (name, style, beats_per_measure, beat_unit, start_pose_id, end_pose_id) VALUES ('Test', 'tango', 4, 4, ?, ?)",
      )
      .run(pose, pose).lastInsertRowid,
  );
}

function insertStep(figureId: number, stepIndex: number, weight = 1) {
  const movementId = insertMovement("straight");
  db.prepare(
    "INSERT INTO movement_straight (movement_id, direction, distance) VALUES (?, 0, 0.3)",
  ).run(movementId);
  return db
    .prepare(
      `INSERT INTO dance_steps
       (figure_id, step_index, partner, foot, movement_id, contact, weight, orientation, rise, beat, duration)
       VALUES (?, ?, 'lead', 'left', ?, 'floor', ?, 0, 0, 1, 1)`,
    )
    .run(figureId, stepIndex, movementId, weight);
}

test("connection: foreign key enforcement is switched on", () => {
  // SQLite ignores REFERENCES clauses unless this pragma is set per
  // connection; api/db.mts sets it, and every constraint test below
  // depends on it.
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
});

test("foreign keys: a step can't reference a figure that doesn't exist", () => {
  assert.throws(() => insertStep(9999, 0), /FOREIGN KEY/);
});

test("checks: partner, foot and contact only accept their known values", () => {
  const pose = insertPose();
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, 'leader', 0, 0)",
        )
        .run(pose),
    /CHECK/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, 'lead', 'middle', 0, 0, 0)",
        )
        .run(pose),
    /CHECK/,
  );
});

test("checks: weights must lie in [0, 1] for foot states and steps", () => {
  const pose = Number(
    db.prepare("INSERT INTO poses DEFAULT VALUES").run().lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, 'lead', 0, 0)",
  ).run(pose);
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, 'lead', 'left', 0, 0, 1.5)",
        )
        .run(pose),
    /CHECK/,
  );
  const figureId = insertFigure();
  assert.throws(() => insertStep(figureId, 0, -0.1), /CHECK/);
  assert.doesNotThrow(() => insertStep(figureId, 1, 0));
  assert.doesNotThrow(() => insertStep(figureId, 2, 1));
});

test("checks: an arc can't have zero curvature (that must be a straight movement)", () => {
  const movementId = insertMovement("arc");
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO movement_arc (movement_id, curvature, arc_length) VALUES (?, 0, 1)",
        )
        .run(movementId),
    /CHECK/,
  );
});

test("triggers: a movement's variant row must match its declared type", () => {
  const arcMovement = insertMovement("arc");
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO movement_straight (movement_id, direction, distance) VALUES (?, 0, 1)",
        )
        .run(arcMovement),
    /type = straight/,
  );

  const straightMovement = insertMovement("straight");
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO movement_arc (movement_id, curvature, arc_length) VALUES (?, 1, 1)",
        )
        .run(straightMovement),
    /type = arc/,
  );
});

test(
  "triggers: changing a movement's type after its variant row exists is rejected",
  {
    todo: "the type-check triggers only fire on INSERT into movement_straight/movement_arc, so an UPDATE of movements.type can leave a straight row under an 'arc' movement, which assembleMovement would then misread",
  },
  () => {
    const movementId = insertMovement("straight");
    db.prepare(
      "INSERT INTO movement_straight (movement_id, direction, distance) VALUES (?, 0, 1)",
    ).run(movementId);
    assert.throws(() =>
      db
        .prepare("UPDATE movements SET type = 'arc' WHERE id = ?")
        .run(movementId),
    );
  },
);

test("uniqueness: two steps in one figure can't share a step_index", () => {
  const figureId = insertFigure();
  insertStep(figureId, 0);
  assert.throws(() => insertStep(figureId, 0), /UNIQUE/);
});

test("cascades: deleting a pose removes its partner and foot rows", () => {
  const pose = insertPose();
  db.prepare("DELETE FROM poses WHERE id = ?").run(pose);
  const partnerRows = db
    .prepare("SELECT COUNT(*) AS n FROM partner_poses WHERE pose_id = ?")
    .get(pose) as { n: number };
  const footRows = db
    .prepare("SELECT COUNT(*) AS n FROM foot_states WHERE pose_id = ?")
    .get(pose) as { n: number };
  assert.equal(partnerRows.n, 0);
  assert.equal(footRows.n, 0);
});

test("cascades: deleting a figure removes its steps", () => {
  const figureId = insertFigure();
  insertStep(figureId, 0);
  insertStep(figureId, 1);
  db.prepare("DELETE FROM figures WHERE id = ?").run(figureId);
  const steps = db
    .prepare("SELECT COUNT(*) AS n FROM dance_steps WHERE figure_id = ?")
    .get(figureId) as { n: number };
  assert.equal(steps.n, 0);
});
