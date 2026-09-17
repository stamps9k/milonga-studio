/**
 * Minimal seed data so the API and schema can be exercised end-to-end
 * before a real step-editor UI exists to populate the database. Inserts
 * one figure (a single forward walking step for each partner), one
 * sequence containing it, and one dance wrapping that sequence.
 *
 * Run with: tsx db/seed.mts
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? join(__dirname, "milonga.sqlite");

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const insertPose = db.prepare("INSERT INTO poses DEFAULT VALUES");
const insertPartnerPose = db.prepare(
  "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, ?, ?, ?)",
);
const insertFootState = db.prepare(
  "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, ?, ?, ?, ?, ?)",
);

function seedPose(feet: {
  lead: {
    orientation: number;
    rise: number;
    left: [number, number, number];
    right: [number, number, number];
  };
  follow: {
    orientation: number;
    rise: number;
    left: [number, number, number];
    right: [number, number, number];
  };
}): number {
  const poseId = insertPose.run().lastInsertRowid as number;
  for (const partner of ["lead", "follow"] as const) {
    const p = feet[partner];
    insertPartnerPose.run(poseId, partner, p.orientation, p.rise);
    for (const foot of ["left", "right"] as const) {
      const [x, y, weight] = p[foot];
      insertFootState.run(poseId, partner, foot, x, y, weight);
    }
  }
  return poseId;
}

const seedAll = db.transaction(() => {
  // Start pose: closed embrace, weight on lead's right / follow's left,
  // facing 0 degrees, standing at the figure's local origin.
  const startPoseId = seedPose({
    lead: { orientation: 0, rise: 0, left: [-0.1, 0, 0], right: [0.1, 0, 1] },
    follow: {
      orientation: 180,
      rise: 0,
      left: [0.1, 0.4, 1],
      right: [-0.1, 0.4, 0],
    },
  });

  // End pose: lead has stepped forward with the left foot, follow has
  // stepped back with the right foot -- a single walking step.
  const endPoseId = seedPose({
    lead: { orientation: 0, rise: 0, left: [-0.1, 0.6, 1], right: [0.1, 0, 0] },
    follow: {
      orientation: 180,
      rise: 0,
      left: [0.1, 0.4, 0],
      right: [-0.1, 1.0, 1],
    },
  });

  const insertMovement = db.prepare("INSERT INTO movements (type) VALUES (?)");
  const insertMovementStraight = db.prepare(
    "INSERT INTO movement_straight (movement_id, direction, distance) VALUES (?, ?, ?)",
  );

  const leadMovementId = insertMovement.run("straight")
    .lastInsertRowid as number;
  insertMovementStraight.run(leadMovementId, 0, 0.6);

  const followMovementId = insertMovement.run("straight")
    .lastInsertRowid as number;
  insertMovementStraight.run(followMovementId, 180, 0.6);

  const insertFigure = db.prepare(
    `INSERT INTO figures (name, style, beats_per_measure, beat_unit, start_pose_id, end_pose_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const figureId = insertFigure.run(
    "Walking Step",
    "tango",
    4,
    4,
    startPoseId,
    endPoseId,
  ).lastInsertRowid as number;

  const insertStep = db.prepare(
    `INSERT INTO dance_steps
		 (figure_id, step_index, partner, foot, movement_id, contact, weight, orientation, rise, beat, duration, label)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertStep.run(
    figureId,
    0,
    "lead",
    "left",
    leadMovementId,
    "floor",
    1,
    0,
    0,
    1,
    1,
    "walk forward",
  );
  insertStep.run(
    figureId,
    1,
    "follow",
    "right",
    followMovementId,
    "floor",
    1,
    180,
    0,
    1,
    1,
    "walk back",
  );

  const insertTransform = db.prepare(
    "INSERT INTO floor_transforms (x, y, rotation) VALUES (?, ?, ?)",
  );
  const startTransformId = insertTransform.run(0, 0, 0)
    .lastInsertRowid as number;
  const entryTransformId = insertTransform.run(0, 0, 0)
    .lastInsertRowid as number;

  const insertSequence = db.prepare(
    "INSERT INTO sequences (name, start_transform_id) VALUES (?, ?)",
  );
  const sequenceId = insertSequence.run(
    "Practice: single walk",
    startTransformId,
  ).lastInsertRowid as number;

  const insertEntry = db.prepare(
    `INSERT INTO sequence_entries
		 (sequence_id, entry_index, figure_id, transform_id, resolved_start_pose_id, resolved_end_pose_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertEntry.run(
    sequenceId,
    0,
    figureId,
    entryTransformId,
    startPoseId,
    endPoseId,
  );

  const now = new Date().toISOString();
  const insertDance = db.prepare(
    `INSERT INTO dances (name, tempo, music, notes, created_at, updated_at, schema_version, sequence_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertDance.run(
    "My first walk",
    72,
    null,
    "Seeded test data",
    now,
    now,
    1,
    sequenceId,
  );
});

seedAll();
console.info("Seed complete.");
db.close();
