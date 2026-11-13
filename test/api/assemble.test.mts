import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type BetterSqlite3 from "better-sqlite3";

import { openTestDatabase } from "../support/database.mts";

// api/assemble.mts is the one place normalized rows become nested
// domain objects. These tests insert their own small fixtures (rather
// than relying on seed contents) so each mapping can be checked
// precisely: snake_case columns to camelCase fields, numeric row ids to
// string ids, explicit ordinal columns to array order, and NULL
// optional columns to absent properties.

type Assemble = typeof import("../../api/assemble.mts");

let db: BetterSqlite3.Database;
let cleanup: () => void;
let assemble: Assemble;

before(async () => {
  ({ db, cleanup } = await openTestDatabase({ seed: false }));
  assemble = await import("../../api/assemble.mts");
});

after(() => cleanup());

function insertPose(leadX = 0, followOrientation = 180): number {
  const poseId = Number(
    db.prepare("INSERT INTO poses DEFAULT VALUES").run().lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, 'lead', 0, 0.05)",
  ).run(poseId);
  db.prepare(
    "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, 'follow', ?, 0)",
  ).run(poseId, followOrientation);
  const foot = db.prepare(
    "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, ?, ?, ?, ?, ?)",
  );
  foot.run(poseId, "lead", "left", leadX - 0.1, 0, 1);
  foot.run(poseId, "lead", "right", leadX + 0.1, 0, 0);
  foot.run(poseId, "follow", "left", 0.1, 0.4, 0);
  foot.run(poseId, "follow", "right", -0.1, 0.4, 1);
  return poseId;
}

function insertTransform(x: number, y: number, rotation: number): number {
  return Number(
    db
      .prepare("INSERT INTO floor_transforms (x, y, rotation) VALUES (?, ?, ?)")
      .run(x, y, rotation).lastInsertRowid,
  );
}

/** A two-step figure whose steps are inserted out of step_index order,
 *  with one arc movement and one unlabelled step. */
function insertFigure(name: string): number {
  const startPose = insertPose(0);
  const endPose = insertPose(0.3);
  const figureId = Number(
    db
      .prepare(
        "INSERT INTO figures (name, style, beats_per_measure, beat_unit, start_pose_id, end_pose_id) VALUES (?, 'waltz', 3, 4, ?, ?)",
      )
      .run(name, startPose, endPose).lastInsertRowid,
  );

  const arcMovement = Number(
    db.prepare("INSERT INTO movements (type) VALUES ('arc')").run()
      .lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO movement_arc (movement_id, curvature, arc_length) VALUES (?, -2.5, 0.4)",
  ).run(arcMovement);

  const straightMovement = Number(
    db.prepare("INSERT INTO movements (type) VALUES ('straight')").run()
      .lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO movement_straight (movement_id, direction, distance) VALUES (?, 90, 0.2)",
  ).run(straightMovement);

  const step = db.prepare(
    `INSERT INTO dance_steps
     (figure_id, step_index, partner, foot, movement_id, contact, weight, orientation, rise, beat, duration, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Second step inserted first, so only ORDER BY step_index can put
  // them back in order.
  step.run(
    figureId,
    1,
    "follow",
    "left",
    straightMovement,
    "air",
    0,
    180,
    0,
    2,
    1,
    null,
  );
  step.run(
    figureId,
    0,
    "lead",
    "right",
    arcMovement,
    "floor",
    1,
    20,
    0.05,
    1,
    1,
    "curving step",
  );
  return figureId;
}

test("assembleFigure: maps rows to the nested Figure type", () => {
  const figureId = insertFigure("Assembly Test");
  const figure = assemble.assembleFigure(figureId);

  assert.equal(figure.id, String(figureId));
  assert.equal(figure.name, "Assembly Test");
  assert.equal(figure.style, "waltz");
  assert.deepEqual(figure.timeSignature, { beatsPerMeasure: 3, beatUnit: 4 });
  assert.equal(figure.startPose.lead.rise, 0.05);
  assert.deepEqual(figure.startPose.lead.left, {
    position: { x: -0.1, y: 0 },
    weight: 1,
  });
  assert.deepEqual(figure.endPose.lead.right.position, { x: 0.4, y: 0 });
  assert.equal(figure.startPose.follow.orientation, 180);
});

test("assembleFigure: orders steps by step_index, not insertion order", () => {
  const figure = assemble.assembleFigure(insertFigure("Ordering Test"));
  assert.deepEqual(
    figure.steps.map((step) => [step.partner, step.foot, step.beat]),
    [
      ["lead", "right", 1],
      ["follow", "left", 2],
    ],
  );
});

test("assembleFigure: rebuilds both movement variants, with camelCase fields", () => {
  const [arcStep, straightStep] = assemble.assembleFigure(
    insertFigure("Movement Test"),
  ).steps;
  assert.deepEqual(arcStep.movement, {
    type: "arc",
    curvature: -2.5,
    arcLength: 0.4,
  });
  assert.deepEqual(straightStep.movement, {
    type: "straight",
    direction: 90,
    distance: 0.2,
  });
});

test("assembleFigure: step ids are strings, a NULL label is omitted, and contact is kept", () => {
  const [labelled, unlabelled] = assemble.assembleFigure(
    insertFigure("Label Test"),
  ).steps;
  assert.equal(typeof labelled.id, "string");
  assert.equal(labelled.label, "curving step");
  assert.equal(labelled.contact, "floor");
  assert.equal("label" in unlabelled, false);
  assert.equal(unlabelled.contact, "air");
});

test("assembleFigure: a missing figure throws a descriptive error", () => {
  assert.throws(
    () => assemble.assembleFigure(424242),
    /No figure with id 424242/,
  );
});

test("assemblePose: a pose missing a partner row throws instead of returning a half-built pose", () => {
  const poseId = Number(
    db.prepare("INSERT INTO poses DEFAULT VALUES").run().lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, 'lead', 0, 0)",
  ).run(poseId);
  for (const foot of ["left", "right"]) {
    db.prepare(
      "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, 'lead', ?, 0, 0, 0.5)",
    ).run(poseId, foot);
  }
  assert.throws(
    () => assemble.assemblePose(poseId),
    /no partner_poses row for 'follow'/,
  );
});

test("assemblePose: a pose missing a foot row throws", () => {
  const poseId = Number(
    db.prepare("INSERT INTO poses DEFAULT VALUES").run().lastInsertRowid,
  );
  for (const partner of ["lead", "follow"]) {
    db.prepare(
      "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, ?, 0, 0)",
    ).run(poseId, partner);
  }
  db.prepare(
    "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, 'lead', 'left', 0, 0, 1)",
  ).run(poseId);
  assert.throws(
    () => assemble.assemblePose(poseId),
    /no foot_states row for 'lead'\/'right'/,
  );
});

function insertSequence(name: string, figureIds: number[]): number {
  const sequenceId = Number(
    db
      .prepare("INSERT INTO sequences (name, start_transform_id) VALUES (?, ?)")
      .run(name, insertTransform(1, 2, 90)).lastInsertRowid,
  );
  // Inserted in reverse so only ORDER BY entry_index restores the order.
  [...figureIds].reverse().forEach((figureId, reversedIndex) => {
    const entryIndex = figureIds.length - 1 - reversedIndex;
    db.prepare(
      `INSERT INTO sequence_entries
       (sequence_id, entry_index, figure_id, transform_id, resolved_start_pose_id, resolved_end_pose_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      sequenceId,
      entryIndex,
      figureId,
      insertTransform(entryIndex, 0, 0),
      insertPose(entryIndex),
      insertPose(entryIndex + 0.3),
    );
  });
  return sequenceId;
}

test("assembleSequence: orders entries by entry_index and assembles each entry's figure and transform", () => {
  const first = insertFigure("First");
  const second = insertFigure("Second");
  const sequenceId = insertSequence("Two Figures", [first, second]);

  const sequence = assemble.assembleSequence(sequenceId);
  assert.equal(sequence.id, String(sequenceId));
  assert.equal(sequence.name, "Two Figures");
  assert.deepEqual(sequence.startTransform, {
    position: { x: 1, y: 2 },
    rotation: 90,
  });
  assert.deepEqual(
    sequence.entries.map((entry) => entry.figure.name),
    ["First", "Second"],
  );
  assert.deepEqual(sequence.entries[1].transform, {
    position: { x: 1, y: 0 },
    rotation: 0,
  });
  assert.deepEqual(sequence.entries[1].resolvedStartPose.lead.left.position, {
    x: 0.9,
    y: 0,
  });
});

test("assembleSequence: a missing sequence throws a descriptive error", () => {
  assert.throws(
    () => assemble.assembleSequence(424242),
    /No sequence with id 424242/,
  );
});

test("assembleDance: maps metadata, omits NULL music/notes, and nests the sequence", () => {
  const sequenceId = insertSequence("Dance Sequence", [insertFigure("Solo")]);
  const insertDance = db.prepare(
    `INSERT INTO dances (name, tempo, music, notes, created_at, updated_at, schema_version, sequence_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const withExtras = Number(
    insertDance.run(
      "Full",
      120,
      "Por una cabeza",
      "Practice slowly",
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      1,
      sequenceId,
    ).lastInsertRowid,
  );
  const bare = Number(
    insertDance.run(
      "Bare",
      90,
      null,
      null,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      1,
      sequenceId,
    ).lastInsertRowid,
  );

  const full = assemble.assembleDance(withExtras);
  assert.equal(full.id, String(withExtras));
  assert.equal(full.tempo, 120);
  assert.equal(full.music, "Por una cabeza");
  assert.equal(full.notes, "Practice slowly");
  assert.equal(full.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(full.updatedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(full.schemaVersion, 1);
  assert.equal(full.sequence.name, "Dance Sequence");

  const minimal = assemble.assembleDance(bare);
  assert.equal("music" in minimal, false);
  assert.equal("notes" in minimal, false);
});

test("assembleDance: a missing dance throws a descriptive error", () => {
  assert.throws(
    () => assemble.assembleDance(424242),
    /No dance with id 424242/,
  );
});
