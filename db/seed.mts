/**
 * Seed data so the API and schema can be exercised end-to-end before a
 * real step-editor UI exists to populate the database. This is
 * plausible-looking test data, not a technically accurate transcription
 * of real technique -- numbers are chosen to look reasonable, not to
 * match a syllabus.
 *
 * All figures use straight-line movements only (including zero-distance
 * "pivot" steps). Arc movements are deliberately left out of this seed:
 * an arc's curvature/arcLength alone don't determine which way a foot
 * actually faces at the start of the arc, so computing a plausible
 * resulting position for one needs a decision this seed script isn't
 * making yet.
 *
 * Figures:
 *   - Walking Step   (1 beat, tango)    -- a single forward/back step
 *   - Side Step      (1 beat, tango)    -- both partners step sideways together
 *   - Cruzada        (2 beats, tango)   -- forward/back step, then follow crosses
 *   - Ocho           (4 beats, tango)   -- follow pivots and zigzags, lead holds
 *                                          mostly still with two small adjusting steps
 *   - Forward Waltz  (3 beats, waltz)   -- forward, side, close (rise on the side step)
 *   - Balance Step   (3 beats, waltz)   -- side, close, side (a waltz balance/chasse)
 *   - Cha-Cha Basic  (4 beats, cha-cha) -- forward break, recover, cha-cha-cha in place
 *   - Side Basic     (4 beats, cha-cha) -- side break, recover, cha-cha-cha in place
 *
 * Sequences:
 *   - Practice: single walk   -- Walking Step
 *   - Basic Combination       -- Walking Step, Side Step, Cruzada
 *   - Ocho Combination        -- Walking Step, Ocho
 *   - Waltz Basics            -- Forward Waltz, Balance Step
 *   - Cha-Cha Basics          -- Cha-Cha Basic, Side Basic
 *
 * All sequence entries use an identity floor transform (0, 0, 0), so
 * each figure's resolved poses are numerically identical to its own
 * local start/end poses. That's a simplification, not a claim that
 * these figures actually join up smoothly on the floor -- join
 * compatibility is a check we've deliberately deferred to later.
 *
 * Run with: tsx db/seed.mts
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? join(__dirname, "milonga.sqlite");
const schemaPath = join(__dirname, "schema.sql");

if (!existsSync(dbPath)) {
  throw new Error(
    `No database at ${dbPath}. Build it first, e.g.:\n  sqlite3 ${dbPath} < ${schemaPath}`,
  );
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

type PartnerName = "lead" | "follow";

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

interface StepSpec {
  partner: PartnerName;
  foot: "left" | "right";
  direction: number;
  distance: number;
  contact?: "floor" | "air";
  weight: number;
  orientation: number;
  rise: number;
  beat: number;
  duration: number;
  label: string;
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
  "INSERT INTO floor_transforms (x, y, rotation) VALUES (0, 0, 0)",
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

/** Inserts a figure and its steps. startPose/endPose are supplied
 *  directly (by hand) rather than derived from the steps -- there's no
 *  fold/simulation helper yet, so this is on the seed author to keep
 *  consistent, same as it would be for a step editor UI today. */
function seedFigure(
  name: string,
  style: string,
  beatsPerMeasure: number,
  beatUnit: number,
  startPose: PoseSpec,
  endPose: PoseSpec,
  steps: StepSpec[],
): { figureId: number; startPoseId: number; endPoseId: number } {
  const startPoseId = seedPose(startPose);
  const endPoseId = seedPose(endPose);

  const figureId = insertFigure.run(
    name,
    style,
    beatsPerMeasure,
    beatUnit,
    startPoseId,
    endPoseId,
  ).lastInsertRowid as number;

  steps.forEach((step, index) => {
    const movementId = insertMovement.run().lastInsertRowid as number;
    insertMovementStraight.run(movementId, step.direction, step.distance);
    insertStep.run(
      figureId,
      index,
      step.partner,
      step.foot,
      movementId,
      step.contact ?? "floor",
      step.weight,
      step.orientation,
      step.rise,
      step.beat,
      step.duration,
      step.label,
    );
  });

  return { figureId, startPoseId, endPoseId };
}

/** Chains figures back-to-back with an identity transform on every
 *  entry, so each entry's resolved poses reuse the figure's own local
 *  poses directly rather than duplicating identical rows. */
function seedSequence(
  name: string,
  figures: { figureId: number; startPoseId: number; endPoseId: number }[],
): number {
  const startTransformId = insertTransform.run().lastInsertRowid as number;
  const sequenceId = insertSequence.run(name, startTransformId)
    .lastInsertRowid as number;

  figures.forEach((figure, index) => {
    const transformId = insertTransform.run().lastInsertRowid as number;
    insertEntry.run(
      sequenceId,
      index,
      figure.figureId,
      transformId,
      figure.startPoseId,
      figure.endPoseId,
    );
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

// The stance most of these figures start and many end from: closed
// embrace, facing 0/180 degrees, weight on lead's right / follow's left.
const NEUTRAL_STANCE: PoseSpec = {
  lead: { orientation: 0, rise: 0, left: [-0.1, 0, 0], right: [0.1, 0, 1] },
  follow: {
    orientation: 180,
    rise: 0,
    left: [0.1, 0.4, 1],
    right: [-0.1, 0.4, 0],
  },
};

const seedAll = db.transaction(() => {
  // -----------------------------------------------------------------
  // Walking Step
  // -----------------------------------------------------------------
  const walkingStep = seedFigure(
    "Walking Step",
    "tango",
    4,
    4,
    NEUTRAL_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [-0.1, 0.6, 1],
        right: [0.1, 0, 0],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.1, 0.4, 0],
        right: [-0.1, 1.0, 1],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 0,
        distance: 0.6,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "walk forward",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 180,
        distance: 0.6,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "walk back",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Side Step -- both partners step sideways together, same direction.
  // -----------------------------------------------------------------
  const sideStep = seedFigure(
    "Side Step",
    "tango",
    4,
    4,
    NEUTRAL_STANCE,
    {
      lead: { orientation: 0, rise: 0, left: [0.25, 0, 1], right: [0.1, 0, 0] },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.1, 0.4, 0],
        right: [0.25, 0.4, 1],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 90,
        distance: 0.35,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "side step",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 90,
        distance: 0.35,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "side step (mirrored)",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Cruzada -- forward/back step, then follow closes/crosses behind.
  // Lead only moves on beat 1; the cross on beat 2 is follow's alone.
  // -----------------------------------------------------------------
  const cruzada = seedFigure(
    "Cruzada",
    "tango",
    4,
    4,
    NEUTRAL_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [-0.1, 0.3, 1],
        right: [0.1, 0, 0],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.1, 0.25, 1],
        right: [-0.1, 0.1, 0],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 0,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "forward, leading the cross",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 180,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "back, preparing cross",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 180,
        distance: 0.15,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "cross left behind right",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Ocho -- follow pivots and zigzags backward across two pivot/step
  // pairs; lead takes two small steps to lead the rotation and mostly
  // holds otherwise. Pivots are zero-distance steps (direction is
  // meaningless for them, left at 0) that only change `orientation`.
  // -----------------------------------------------------------------
  const ocho = seedFigure(
    "Ocho",
    "tango",
    4,
    4,
    NEUTRAL_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [-0.065, 0.197, 0],
        right: [0.065, 0.197, 1],
      },
      follow: {
        orientation: 45,
        rise: 0,
        left: [0.312, 0.188, 1],
        right: [-0.312, 0.188, 0],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 10,
        distance: 0.2,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "small lead step",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 135,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "pivot on left",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 225,
        distance: 0.3,
        weight: 1,
        orientation: 135,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "back ocho step",
      },
      {
        partner: "lead",
        foot: "right",
        direction: -10,
        distance: 0.2,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "small lead step",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 45,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "pivot on right",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 135,
        distance: 0.3,
        weight: 1,
        orientation: 45,
        rise: 0,
        beat: 4,
        duration: 1,
        label: "back ocho step",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Forward Waltz -- forward, side, close. Three beats, one measure.
  // The side step carries a small rise (the characteristic waltz
  // rise-and-fall), settling flat again on the close.
  // -----------------------------------------------------------------
  const forwardWaltz = seedFigure(
    "Forward Waltz",
    "waltz",
    3,
    4,
    NEUTRAL_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [0.05, 0.6, 1],
        right: [0.05, 0.6, 0],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.05, 1.0, 0],
        right: [0.05, 1.0, 1],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 0,
        distance: 0.4,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "step forward",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 180,
        distance: 0.4,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "step back",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 90,
        distance: 0.2,
        weight: 1,
        orientation: 0,
        rise: 0.05,
        beat: 2,
        duration: 1,
        label: "side, rising",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 90,
        distance: 0.2,
        weight: 1,
        orientation: 180,
        rise: 0.05,
        beat: 2,
        duration: 1,
        label: "side, rising",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 270,
        distance: 0.15,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "close left to right",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 270,
        distance: 0.15,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "close right to left",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Balance Step -- side, close, side. A waltz balance/chasse in place,
  // rising on the first side step like Forward Waltz.
  // -----------------------------------------------------------------
  const balanceStep = seedFigure(
    "Balance Step",
    "waltz",
    3,
    4,
    NEUTRAL_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [0.5, 0, 1],
        right: [0.35, 0, 0],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.35, 0.4, 0],
        right: [0.5, 0.4, 1],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 90,
        distance: 0.35,
        weight: 1,
        orientation: 0,
        rise: 0.05,
        beat: 1,
        duration: 1,
        label: "side, rising",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 90,
        distance: 0.35,
        weight: 1,
        orientation: 180,
        rise: 0.05,
        beat: 1,
        duration: 1,
        label: "side, rising",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 90,
        distance: 0.15,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "close right to left",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 90,
        distance: 0.15,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "close left to right",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 90,
        distance: 0.15,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "side again",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 90,
        distance: 0.15,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "side again",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Cha-Cha Basic -- forward break, recover, then the cha-cha-cha
  // triple back in place. The triple is written as three quick steps
  // (beats 3, 3.5, 4) kept inside one measure, rather than the
  // classic "2,3,4&1" count that spans the barline -- easier to
  // represent here since a figure in this schema is one measure long.
  // -----------------------------------------------------------------
  const chaChaBasic = seedFigure(
    "Cha-Cha Basic",
    "cha-cha",
    4,
    4,
    NEUTRAL_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [-0.1, 0.05, 1],
        right: [0.1, 0.05, 0],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.1, 0.35, 0],
        right: [-0.1, 0.35, 1],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 0,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "rock forward",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 180,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "rock back",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 180,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "recover weight back",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 0,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "recover weight forward",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 180,
        distance: 0.15,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "cha: step back",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 0,
        distance: 0.15,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "cha: step forward",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 0,
        distance: 0.1,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: close",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 180,
        distance: 0.1,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: close",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 180,
        distance: 0.1,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 4,
        duration: 0.5,
        label: "cha: step back",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 0,
        distance: 0.1,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 4,
        duration: 0.5,
        label: "cha: step forward",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Side Basic -- same break/recover/cha-cha-cha shape as Cha-Cha
  // Basic, but sideways instead of forward/back.
  // -----------------------------------------------------------------
  const sideBasic = seedFigure(
    "Side Basic",
    "cha-cha",
    4,
    4,
    NEUTRAL_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [-0.05, 0, 1],
        right: [0.05, 0, 0],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.05, 0.4, 0],
        right: [-0.05, 0.4, 1],
      },
    },
    [
      {
        partner: "lead",
        foot: "left",
        direction: 90,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "side break",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 90,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
        label: "side break",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 270,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "recover weight",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 270,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "recover weight",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 270,
        distance: 0.15,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "cha: side",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 270,
        distance: 0.15,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "cha: side",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 90,
        distance: 0.1,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: close",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 90,
        distance: 0.1,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: close",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 270,
        distance: 0.1,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 4,
        duration: 0.5,
        label: "cha: side",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 270,
        distance: 0.1,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 4,
        duration: 0.5,
        label: "cha: side",
      },
    ],
  );

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
