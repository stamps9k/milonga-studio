/**
 * Seed data so the API and schema can be exercised end-to-end before a
 * real step-editor UI exists to populate the database. This is
 * plausible-looking test data, not a technically accurate transcription
 * of real technique -- numbers are chosen to look reasonable, not to
 * match a syllabus.
 *
 * Figures live in db/figures/, one file each, written with defineFigure
 * (src/libs/dance/authoring.mts): steps are described relative to the
 * dancer ("forward 0.4", "close", "pivot 1/8 left"), and the helper works
 * out the model's absolute headings, feet, weights, timing and end pose,
 * and checks each figure's expectEnd. db/FIGURES.md is the guide.
 * Movements are straight lines only (including zero-distance weight
 * changes and pivots); arcs aren't authored yet.
 *
 * Figures:
 *   - Walking Step   (1 beat, tango)    -- a single forward/back step
 *   - Side Step      (1 beat, tango)    -- both partners step sideways together
 *   - Cruzada        (2 beats, tango)   -- forward/back step, then follow crosses
 *   - Ocho           (4 beats, tango)   -- follow pivots and zigzags, lead holds
 *                                          mostly still with two small adjusting steps
 *   - Forward Waltz  (3 beats, waltz)   -- forward, side, close (rise on the side step)
 *   - Balance Step   (3 beats, waltz)   -- side, close, side (a waltz balance/chasse)
 *   - Cha-Cha Basic  (4 beats, cha-cha) -- forward break, recover, cha-cha-cha back into place
 *   - Side Basic     (4 beats, cha-cha) -- side break, recover, cha-cha-cha back into place
 *
 * Sequences:
 *   - Practice: single walk   -- Walking Step
 *   - Basic Combination       -- Walking Step, Side Step, Cruzada
 *   - Ocho Combination        -- Walking Step, Ocho
 *   - Waltz Basics            -- Forward Waltz, Balance Step
 *   - Cha-Cha Basics          -- Cha-Cha Basic, Side Basic
 *
 * Each sequence chains its figures the same way the sequence builder in
 * the app does (useSequenceBuilder): the first entry sits at the floor
 * origin, and every later entry is placed with fitTransform so its
 * startPose lands on the previous entry's resolved endPose. Where two
 * figures' stances don't match exactly, fitTransform finds the closest
 * placement, and assessJoin (src/libs/dance/join.mts) reports what's
 * left over.
 *
 * Run with: tsx db/seed.mts
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { AuthoredFigure } from "../src/libs/dance/authoring.mts";
import { applyTransform, fitTransform } from "../src/libs/dance/floor.mts";
import { figures } from "./figures/index.mts";
import type { Pose } from "../src/libs/dance/pose.mts";
import type { FloorTransform } from "../src/libs/dance/sequence.mts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? join(__dirname, "milonga.sqlite");
const schemaPath = join(__dirname, "schema.sql");

if (!existsSync(dbPath)) {
  throw new Error(
    `No database at ${dbPath}. Run \`npm run db:reset\` to create and seed it, or build it first with:\n  sqlite3 ${dbPath} < ${schemaPath}`,
  );
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// The seed inserts rather than replaces, so running it on a database
// that already has data would add a second copy of every figure,
// sequence and dance. Refuse instead; `npm run db:reset` rebuilds the
// database from empty when that's what's wanted.
const existingFigures = (
  db.prepare("SELECT COUNT(*) AS n FROM figures").get() as { n: number }
).n;
if (existingFigures > 0) {
  db.close();
  throw new Error(
    `${dbPath} already has ${existingFigures} figures, so seeding again would duplicate them. Run \`npm run db:reset\` to rebuild it from empty instead.`,
  );
}

interface PartnerPoseSpec {
  orientation: number;
  rise: number;
  left: [number, number, number]; // [x, y, weight]
  right: [number, number, number];
}

interface PoseSpec {
  lead: PartnerPoseSpec;
  follow: PartnerPoseSpec;
}

const insertPose = db.prepare("INSERT INTO poses DEFAULT VALUES");
const insertPartnerPose = db.prepare(
  "INSERT INTO partner_poses (pose_id, partner, orientation, rise) VALUES (?, ?, ?, ?)",
);
const insertFootState = db.prepare(
  "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight) VALUES (?, ?, ?, ?, ?, ?)",
);
const insertMovement = db.prepare(
  "INSERT INTO movements (type) VALUES ('straight')",
);
const insertMovementStraight = db.prepare(
  "INSERT INTO movement_straight (movement_id, direction, distance) VALUES (?, ?, ?)",
);
const insertFigure = db.prepare(
  `INSERT INTO figures (name, style, beats_per_measure, beat_unit, start_pose_id, end_pose_id)
	 VALUES (?, ?, ?, ?, ?, ?)`,
);
const insertStep = db.prepare(
  `INSERT INTO dance_steps
	 (figure_id, step_index, partner, foot, movement_id, contact, weight, orientation, rise, beat, duration, label)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertTransform = db.prepare(
  "INSERT INTO floor_transforms (x, y, rotation) VALUES (?, ?, ?)",
);
const insertSequence = db.prepare(
  "INSERT INTO sequences (name, start_transform_id) VALUES (?, ?)",
);
const insertEntry = db.prepare(
  `INSERT INTO sequence_entries
	 (sequence_id, entry_index, figure_id, transform_id, resolved_start_pose_id, resolved_end_pose_id)
	 VALUES (?, ?, ?, ?, ?, ?)`,
);
const insertDance = db.prepare(
  `INSERT INTO dances (name, tempo, music, notes, created_at, updated_at, schema_version, sequence_id)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

function seedPose(spec: PoseSpec): number {
  const poseId = insertPose.run().lastInsertRowid as number;
  for (const partner of ["lead", "follow"] as const) {
    const p = spec[partner];
    insertPartnerPose.run(poseId, partner, p.orientation, p.rise);
    for (const foot of ["left", "right"] as const) {
      const [x, y, weight] = p[foot];
      insertFootState.run(poseId, partner, foot, x, y, weight);
    }
  }
  return poseId;
}

function seedTransform(transform: FloorTransform): number {
  return insertTransform.run(
    transform.position.x,
    transform.position.y,
    transform.rotation,
  ).lastInsertRowid as number;
}

/** A seeded figure's row id plus its poses as domain objects, which
 *  seedSequence needs to place each entry with fitTransform. */
interface SeededFigure {
  figureId: number;
  startPose: Pose;
  endPose: Pose;
}

function poseToSpec(pose: Pose): PoseSpec {
  const partner = (p: Pose["lead"]): PartnerPoseSpec => ({
    orientation: p.orientation,
    rise: p.rise,
    left: [p.left.position.x, p.left.position.y, p.left.weight],
    right: [p.right.position.x, p.right.position.y, p.right.weight],
  });
  return { lead: partner(pose.lead), follow: partner(pose.follow) };
}

/** Inserts a figure made with defineFigure (its poses and steps) and
 *  returns its row id with its poses, for chaining into sequences. */
function seedFigure(figure: AuthoredFigure): SeededFigure {
  const startPoseId = seedPose(poseToSpec(figure.startPose));
  const endPoseId = seedPose(poseToSpec(figure.endPose));

  const figureId = insertFigure.run(
    figure.name,
    figure.style,
    figure.timeSignature.beatsPerMeasure,
    figure.timeSignature.beatUnit,
    startPoseId,
    endPoseId,
  ).lastInsertRowid as number;

  figure.steps.forEach((step, index) => {
    // defineFigure only produces straight movements (including
    // zero-distance ones); arcs aren't authored yet.
    if (step.movement.type !== "straight") {
      throw new Error(`${figure.name}: arc movements can't be seeded yet`);
    }
    const movementId = insertMovement.run().lastInsertRowid as number;
    insertMovementStraight.run(
      movementId,
      step.movement.direction,
      step.movement.distance,
    );
    insertStep.run(
      figureId,
      index,
      step.partner,
      step.foot,
      movementId,
      step.contact,
      step.weight,
      step.orientation,
      step.rise,
      step.beat,
      step.duration,
      step.label ?? null,
    );
  });

  return { figureId, startPose: figure.startPose, endPose: figure.endPose };
}

/** Chains figures back-to-back the way the app's sequence builder does
 *  (useSequenceBuilder): the first entry at the floor origin, each later
 *  entry placed by fitTransform onto the previous entry's resolved
 *  endPose. Resolved poses are then the figure's own poses placed by
 *  the entry's transform, stored as new pose rows. */
function seedSequence(name: string, figures: SeededFigure[]): number {
  const origin: FloorTransform = { position: { x: 0, y: 0 }, rotation: 0 };
  const sequenceId = insertSequence.run(name, seedTransform(origin))
    .lastInsertRowid as number;

  let previousEnd: Pose | null = null;
  figures.forEach((figure, index) => {
    const transform =
      previousEnd === null
        ? origin
        : fitTransform(figure.startPose, previousEnd);
    const resolvedStart = applyTransform(transform, figure.startPose);
    const resolvedEnd = applyTransform(transform, figure.endPose);
    insertEntry.run(
      sequenceId,
      index,
      figure.figureId,
      seedTransform(transform),
      seedPose(poseToSpec(resolvedStart)),
      seedPose(poseToSpec(resolvedEnd)),
    );
    previousEnd = resolvedEnd;
  });

  return sequenceId;
}

function seedDance(
  name: string,
  tempo: number,
  notes: string,
  sequenceId: number,
): void {
  const now = new Date().toISOString();
  insertDance.run(name, tempo, null, notes, now, now, 1, sequenceId);
}

const seedAll = db.transaction(() => {
  // Figures are written with defineFigure, one per file in db/figures/
  // (see db/FIGURES.md); each file's expectEnd has already been checked
  // by the time it's imported.
  const walkingStep = seedFigure(figures.walkingStep);
  const sideStep = seedFigure(figures.sideStep);
  const cruzada = seedFigure(figures.cruzada);
  const ocho = seedFigure(figures.ocho);
  const forwardWaltz = seedFigure(figures.forwardWaltz);
  const balanceStep = seedFigure(figures.balanceStep);
  const chaChaBasic = seedFigure(figures.chaChaBasic);
  const sideBasic = seedFigure(figures.sideBasic);

  // -----------------------------------------------------------------
  // Sequences and dances
  // -----------------------------------------------------------------
  const singleWalkSequence = seedSequence("Practice: single walk", [
    walkingStep,
  ]);
  seedDance("My first walk", 72, "Seeded test data", singleWalkSequence);

  const basicCombination = seedSequence("Basic Combination", [
    walkingStep,
    sideStep,
    cruzada,
  ]);
  seedDance(
    "Basic tango combo",
    68,
    "Salida into side step and cross",
    basicCombination,
  );

  const ochoCombination = seedSequence("Ocho Combination", [walkingStep, ocho]);
  seedDance("Ocho practice", 66, "Working on back ochos", ochoCombination);

  const waltzBasics = seedSequence("Waltz Basics", [forwardWaltz, balanceStep]);
  seedDance(
    "Waltz box practice",
    90,
    "Forward waltz into a balance step",
    waltzBasics,
  );

  const chaChaBasics = seedSequence("Cha-Cha Basics", [chaChaBasic, sideBasic]);
  seedDance(
    "Cha-cha basics practice",
    120,
    "Forward basic into side basic",
    chaChaBasics,
  );
});

seedAll();
console.info("Seed complete: 8 figures, 5 sequences, 5 dances.");
db.close();
