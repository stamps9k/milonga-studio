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
 *   - Cha-Cha Basic  (4 beats, cha-cha) -- forward break, recover, cha-cha-cha back into place
 *   - Side Basic     (4 beats, cha-cha) -- side break, recover, cha-cha-cha back into place
 *
 * Every figure's hand-typed endPose must equal what folding its steps
 * from its startPose produces (poseAtBeat in src/libs/dance/fold.mts);
 * test/db/seed.test.mts checks this. Step directions are absolute floor
 * headings (0 = line of dance, clockwise), not relative to the dancer's
 * facing, and a step moves the partner's free (unweighted) foot.
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
import { applyTransform, fitTransform } from "../src/libs/dance/floor.mts";
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

function specToPose(spec: PoseSpec): Pose {
  const partner = (p: PartnerPoseSpec) => ({
    orientation: p.orientation,
    rise: p.rise,
    left: { position: { x: p.left[0], y: p.left[1] }, weight: p.left[2] },
    right: { position: { x: p.right[0], y: p.right[1] }, weight: p.right[2] },
  });
  return { lead: partner(spec.lead), follow: partner(spec.follow) };
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

/** Inserts a figure and its steps. startPose/endPose are supplied
 *  directly (by hand) rather than derived from the steps, so the two act
 *  as independent statements of the figure: the steps say how the couple
 *  moves, the endPose says where they should finish. test/db/seed.test.mts
 *  folds the steps and checks they agree. */
function seedFigure(
  name: string,
  style: string,
  beatsPerMeasure: number,
  beatUnit: number,
  startPose: PoseSpec,
  endPose: PoseSpec,
  steps: StepSpec[],
): SeededFigure {
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

  return {
    figureId,
    startPose: specToPose(startPose),
    endPose: specToPose(endPose),
  };
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

// NEUTRAL_STANCE with the weight on the other feet: lead's left /
// follow's right. Figures that start by moving lead's right foot (and
// follow's left) start from here, because a dancer can only step with
// the foot that isn't carrying their weight.
const LEAD_LEFT_WEIGHTED_STANCE: PoseSpec = {
  lead: { orientation: 0, rise: 0, left: [-0.1, 0, 1], right: [0.1, 0, 0] },
  follow: {
    orientation: 180,
    rise: 0,
    left: [0.1, 0.4, 0],
    right: [-0.1, 0.4, 1],
  },
};

// Heading of a step that goes 0.3 east for every 0.4 north (a 3-4-5
// triangle, so 0.5 travelled): atan2(0.3, 0.4) clockwise from line of
// dance, about 36.87 degrees. Used for Forward Waltz's diagonal side step.
const DIAGONAL_3_4_5 = (Math.atan2(0.3, 0.4) * 180) / Math.PI;

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
        // Directions are absolute floor headings (heading.mts), not
        // relative to the dancer's facing: the follow faces 180, so her
        // backward step travels north, direction 0.
        direction: 0,
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
  //
  // The "side" step travels diagonally forward and to the side, so the
  // moving foot finishes level with the foot that stepped forward, and
  // the close brings the other foot alongside it at the usual stance
  // width (0.2). The diagonal is a 3-4-5 triangle (0.3 across, 0.4
  // forward, 0.5 travelled), so its direction is atan2(0.3, 0.4) from
  // line of dance, about 36.87 degrees. The couple ends in the same
  // stance shape it started in, moved 0.3 east and 0.4 north, with
  // weight on lead's left / follow's right.
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
        left: [0.2, 0.4, 1],
        right: [0.4, 0.4, 0],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.4, 0.8, 0],
        right: [0.2, 0.8, 1],
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
        direction: 0,
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
        direction: DIAGONAL_3_4_5,
        distance: 0.5,
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
        direction: DIAGONAL_3_4_5,
        distance: 0.5,
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
        direction: 90,
        distance: 0.3,
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
        direction: 90,
        distance: 0.3,
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
  // Balance Step -- side, close, side. A waltz balance/chasse to the
  // lead's right (east), rising on the first side step like Forward
  // Waltz. Travelling east means the lead leads with his right foot
  // and the follow with her left, so the figure starts from
  // LEAD_LEFT_WEIGHTED_STANCE, which is also how Forward Waltz ends.
  // -----------------------------------------------------------------
  const balanceStep = seedFigure(
    "Balance Step",
    "waltz",
    3,
    4,
    LEAD_LEFT_WEIGHTED_STANCE,
    {
      lead: {
        orientation: 0,
        rise: 0,
        left: [0.2, 0, 0],
        right: [0.7, 0, 1],
      },
      follow: {
        orientation: 180,
        rise: 0,
        left: [0.7, 0.4, 1],
        right: [0.2, 0.4, 0],
      },
    },
    [
      {
        partner: "lead",
        foot: "right",
        direction: 90,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0.05,
        beat: 1,
        duration: 1,
        label: "side, rising",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 90,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0.05,
        beat: 1,
        duration: 1,
        label: "side, rising",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 90,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "close left to right",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 90,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "close right to left",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 90,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 1,
        label: "side again",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 90,
        distance: 0.3,
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
  // Cha-Cha Basic -- forward break, recover, then the cha-cha-cha back
  // into place. The triple is written as three steps on beats 3, 3.5
  // and 4 (half, half, whole beat) kept inside one measure, rather than
  // the classic "2,3,4&1" count that spans the barline -- easier to
  // represent here since a figure in this schema is one measure long.
  // The three durations fill the measure exactly, so the figure lasts 4
  // beats and no partner has two steps in progress at once.
  //
  // "Recover" and the in-place cha steps are weight changes onto a foot
  // that doesn't travel, written as zero-distance straight steps. The
  // couple ends where it started, with weight on lead's left / follow's
  // right (LEAD_LEFT_WEIGHTED_STANCE), which is where Side Basic starts.
  // -----------------------------------------------------------------
  const chaChaBasic = seedFigure(
    "Cha-Cha Basic",
    "cha-cha",
    4,
    4,
    NEUTRAL_STANCE,
    LEAD_LEFT_WEIGHTED_STANCE,
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
        direction: 0,
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
        direction: 0,
        distance: 0,
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
        direction: 0,
        distance: 0,
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
        direction: 180,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 0.5,
        label: "cha: step back",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 180,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3,
        duration: 0.5,
        label: "cha: step forward",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: in place",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: in place",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 4,
        duration: 1,
        label: "cha: in place",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 4,
        duration: 1,
        label: "cha: in place",
      },
    ],
  );

  // -----------------------------------------------------------------
  // Side Basic -- same break/recover/cha-cha-cha shape as Cha-Cha
  // Basic, but sideways instead of forward/back. It starts where
  // Cha-Cha Basic ends (weight on lead's left), so the free feet are
  // lead's right and follow's left: the break goes east and the cha
  // steps bring the couple back to NEUTRAL_STANCE.
  // -----------------------------------------------------------------
  const sideBasic = seedFigure(
    "Side Basic",
    "cha-cha",
    4,
    4,
    LEAD_LEFT_WEIGHTED_STANCE,
    NEUTRAL_STANCE,
    [
      {
        partner: "lead",
        foot: "right",
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
        foot: "left",
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
        foot: "left",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "recover weight",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 2,
        duration: 1,
        label: "recover weight",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 270,
        distance: 0.3,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3,
        duration: 0.5,
        label: "cha: side",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 270,
        distance: 0.3,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3,
        duration: 0.5,
        label: "cha: side",
      },
      {
        partner: "lead",
        foot: "left",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: in place",
      },
      {
        partner: "follow",
        foot: "right",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 3.5,
        duration: 0.5,
        label: "cha: in place",
      },
      {
        partner: "lead",
        foot: "right",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 4,
        duration: 1,
        label: "cha: in place",
      },
      {
        partner: "follow",
        foot: "left",
        direction: 0,
        distance: 0,
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 4,
        duration: 1,
        label: "cha: in place",
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
