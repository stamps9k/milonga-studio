/**
 * Seed data so the API and schema can be exercised end-to-end before a
 * real step-editor UI exists to populate the database. This is
 * plausible-looking test data, not a technically accurate transcription
 * of real technique -- numbers are chosen to look reasonable, not to
 * match a syllabus.
 *
 * Figures live in db/figures/, one JSON file each, and every *.json file
 * there is seeded -- adding or removing a figure needs no code change.
 * Steps are described relative to the dancer ("forward 0.4", "close",
 * "pivot 1/8 left"); defineFigure (src/libs/dance/authoring.mts) works
 * out the model's absolute headings, feet, weights, timing and end pose,
 * and checks each figure's expectEnd. db/FIGURES.md is the guide.
 * Movements are straight lines only (including zero-distance weight
 * changes and pivots), except steps marked to curve "around the front".
 *
 * The figures are whatever files are in db/figures/. Each file's
 * expectBeats and expectEnd state its length and where it finishes, and
 * the tests count the files rather than keeping their own list.
 *
 * Sample sequences (SAMPLE_DANCES below; skipped if a figure is missing):
 *   - Practice: single walk   -- Walking Step
 *   - Basic Combination       -- Walking Step, Side Step, Cruzada
 *   - Ocho Combination        -- Walking Step, Ocho
 *   - Waltz Basics            -- LF Closed Change, Balance Step
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
import { loadFigures } from "./figures/index.mts";
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
  left: [number, number, number, number | null]; // [x, y, weight, direction]
  right: [number, number, number, number | null];
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
  "INSERT INTO foot_states (pose_id, partner, foot, x, y, weight, direction) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const insertMovement = db.prepare("INSERT INTO movements (type) VALUES (?)");
const insertMovementStraight = db.prepare(
  "INSERT INTO movement_straight (movement_id, direction, distance) VALUES (?, ?, ?)",
);
const insertMovementArc = db.prepare(
  "INSERT INTO movement_arc (movement_id, curvature, arc_length, set_off) VALUES (?, ?, ?, ?)",
);
const insertFigure = db.prepare(
  `INSERT INTO figures (name, style, beats_per_measure, beat_unit, start_pose_id, end_pose_id)
	 VALUES (?, ?, ?, ?, ?, ?)`,
);
const insertStep = db.prepare(
  `INSERT INTO dance_steps
	 (figure_id, step_index, partner, foot, movement_id, contact, weight, weight_timing, orientation, foot_direction, rise, rise_timing, footwork, beat, duration, label)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      const [x, y, weight, direction] = p[foot];
      insertFootState.run(poseId, partner, foot, x, y, weight, direction);
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
    left: [
      p.left.position.x,
      p.left.position.y,
      p.left.weight,
      p.left.direction ?? null,
    ],
    right: [
      p.right.position.x,
      p.right.position.y,
      p.right.weight,
      p.right.direction ?? null,
    ],
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
    // Straight movements (including zero-distance ones), or arcs from
    // steps with `path: "around the front"` or `"around the back"`.
    const movementId = insertMovement.run(step.movement.type)
      .lastInsertRowid as number;
    if (step.movement.type === "straight") {
      insertMovementStraight.run(
        movementId,
        step.movement.direction,
        step.movement.distance,
      );
    } else {
      insertMovementArc.run(
        movementId,
        step.movement.curvature,
        step.movement.arcLength,
        step.movement.setOff ?? 0,
      );
    }
    insertStep.run(
      figureId,
      index,
      step.partner,
      step.foot,
      movementId,
      step.contact,
      step.weight,
      step.weightTiming ?? "even",
      step.orientation,
      step.footDirection ?? null,
      step.rise,
      step.riseTiming ?? "even",
      step.footwork ?? null,
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

// Every *.json file in db/figures/ is loaded, checked and seeded --
// nothing here needs editing when figures are added or removed. A
// mistake in any file stops the seed before the database is touched.
// FIGURES_DIR points at a different folder of figure files, for trying
// out a set of figures without touching db/figures/ (and for tests).
const figures = loadFigures(process.env.FIGURES_DIR || undefined);

/** Sample sequences and the dances built on them, by figure name. A
 *  sequence whose figures aren't all present (a figure file was renamed
 *  or removed) is skipped with a warning rather than failing the seed,
 *  so editing figure files never requires a code change here. */
const SAMPLE_DANCES: {
  sequence: string;
  figures: string[];
  dance: string;
  tempo: number;
  notes: string;
}[] = [
  {
    sequence: "Practice: single walk",
    figures: ["Walking Step"],
    dance: "My first walk",
    tempo: 72,
    notes: "Seeded test data",
  },
  {
    sequence: "Basic Combination",
    figures: ["Walking Step", "Side Step", "Cruzada"],
    dance: "Basic tango combo",
    tempo: 68,
    notes: "Salida into side step and cross",
  },
  {
    sequence: "Ocho Combination",
    figures: ["Walking Step", "Ocho"],
    dance: "Ocho practice",
    tempo: 66,
    notes: "Working on back ochos",
  },
  {
    sequence: "Waltz Basics",
    figures: ["LF Closed Change", "Balance Step"],
    dance: "Waltz box practice",
    tempo: 90,
    notes: "Forward waltz into a balance step",
  },
  {
    sequence: "Cha-Cha Basics",
    figures: ["Cha-Cha Basic", "Side Basic"],
    dance: "Cha-cha basics practice",
    tempo: 120,
    notes: "Forward basic into side basic",
  },
];

let seededSequences = 0;

const seedAll = db.transaction(() => {
  const seededByName = new Map<string, SeededFigure>();
  for (const figure of figures) {
    seededByName.set(figure.name, seedFigure(figure));
  }

  for (const sample of SAMPLE_DANCES) {
    const missing = sample.figures.filter((name) => !seededByName.has(name));
    if (missing.length > 0) {
      console.warn(
        `Skipping sample sequence "${sample.sequence}": no figure named ${missing
          .map((name) => `"${name}"`)
          .join(", ")} in db/figures/.`,
      );
      continue;
    }
    const sequenceId = seedSequence(
      sample.sequence,
      sample.figures.map((name) => seededByName.get(name)!),
    );
    seedDance(sample.dance, sample.tempo, sample.notes, sequenceId);
    seededSequences++;
  }
});

seedAll();
console.info(
  `Seed complete: ${figures.length} figures, ${seededSequences} sequences, ${seededSequences} dances.`,
);
db.close();
