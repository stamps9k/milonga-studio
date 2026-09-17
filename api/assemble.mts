/**
 * Turns normalized rows from db/schema.sql into the fully assembled,
 * nested objects defined in src/libs/dance/*.mts. This is the one place
 * the join/reassembly logic lives -- the frontend consumes the domain
 * types directly and never needs to know the data was split across
 * eight tables.
 */

import { db } from "./db.mts";
import type {
  Partner,
  Foot,
  Contact,
  Movement,
  DanceStep,
  TimeSignature,
  Figure,
} from "../src/libs/dance/step.mts";
import type {
  Point2D,
  FootState,
  PartnerPose,
  Pose,
} from "../src/libs/dance/pose.mts";
import type {
  FloorTransform,
  SequenceEntry,
  Sequence,
} from "../src/libs/dance/sequence.mts";
import type { Dance } from "../src/libs/dance/dance.mts";

// ---------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------

interface PartnerPoseRow {
  partner: Partner;
  orientation: number;
  rise: number;
}

interface FootStateRow {
  partner: Partner;
  foot: Foot;
  x: number;
  y: number;
  weight: number;
}

const partnerPoseStmt = db.prepare(
  "SELECT partner, orientation, rise FROM partner_poses WHERE pose_id = ?",
);
const footStateStmt = db.prepare(
  "SELECT partner, foot, x, y, weight FROM foot_states WHERE pose_id = ?",
);

export function assemblePose(poseId: number): Pose {
  const partnerRows = partnerPoseStmt.all(poseId) as PartnerPoseRow[];
  const footRows = footStateStmt.all(poseId) as FootStateRow[];

  const buildPartnerPose = (partner: Partner): PartnerPose => {
    const partnerRow = partnerRows.find((row) => row.partner === partner);
    if (!partnerRow) {
      throw new Error(
        `Pose ${poseId} has no partner_poses row for '${partner}'`,
      );
    }

    const buildFootState = (foot: Foot): FootState => {
      const footRow = footRows.find(
        (row) => row.partner === partner && row.foot === foot,
      );
      if (!footRow) {
        throw new Error(
          `Pose ${poseId} has no foot_states row for '${partner}'/'${foot}'`,
        );
      }
      const position: Point2D = { x: footRow.x, y: footRow.y };
      return { position, weight: footRow.weight };
    };

    return {
      left: buildFootState("left"),
      right: buildFootState("right"),
      orientation: partnerRow.orientation,
      rise: partnerRow.rise,
    };
  };

  return {
    lead: buildPartnerPose("lead"),
    follow: buildPartnerPose("follow"),
  };
}

// ---------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------

interface MovementRow {
  id: number;
  type: "straight" | "arc";
}
interface MovementStraightRow {
  direction: number;
  distance: number;
}
interface MovementArcRow {
  curvature: number;
  arc_length: number;
}

const movementStmt = db.prepare("SELECT id, type FROM movements WHERE id = ?");
const movementStraightStmt = db.prepare(
  "SELECT direction, distance FROM movement_straight WHERE movement_id = ?",
);
const movementArcStmt = db.prepare(
  "SELECT curvature, arc_length FROM movement_arc WHERE movement_id = ?",
);

function assembleMovement(movementId: number): Movement {
  const row = movementStmt.get(movementId) as MovementRow | undefined;
  if (!row) {
    throw new Error(`No movement with id ${movementId}`);
  }

  if (row.type === "straight") {
    const straight = movementStraightStmt.get(
      movementId,
    ) as MovementStraightRow;
    return {
      type: "straight",
      direction: straight.direction,
      distance: straight.distance,
    };
  }

  const arc = movementArcStmt.get(movementId) as MovementArcRow;
  return { type: "arc", curvature: arc.curvature, arcLength: arc.arc_length };
}

// ---------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------

interface FigureRow {
  id: number;
  name: string;
  style: string;
  beats_per_measure: number;
  beat_unit: number;
  start_pose_id: number;
  end_pose_id: number;
}

interface DanceStepRow {
  id: number;
  partner: Partner;
  foot: Foot;
  movement_id: number;
  contact: Contact;
  weight: number;
  orientation: number;
  rise: number;
  beat: number;
  duration: number;
  label: string | null;
}

const figureStmt = db.prepare("SELECT * FROM figures WHERE id = ?");
const figureStepsStmt = db.prepare(
  `SELECT id, partner, foot, movement_id, contact, weight, orientation, rise, beat, duration, label
	 FROM dance_steps WHERE figure_id = ? ORDER BY step_index`,
);

export function assembleFigure(figureId: number): Figure {
  const row = figureStmt.get(figureId) as FigureRow | undefined;
  if (!row) {
    throw new Error(`No figure with id ${figureId}`);
  }

  const stepRows = figureStepsStmt.all(figureId) as DanceStepRow[];
  const steps: DanceStep[] = stepRows.map((step) => ({
    id: String(step.id),
    partner: step.partner,
    foot: step.foot,
    movement: assembleMovement(step.movement_id),
    contact: step.contact,
    weight: step.weight,
    orientation: step.orientation,
    rise: step.rise,
    beat: step.beat,
    duration: step.duration,
    ...(step.label !== null ? { label: step.label } : {}),
  }));

  const timeSignature: TimeSignature = {
    beatsPerMeasure: row.beats_per_measure,
    beatUnit: row.beat_unit,
  };

  return {
    id: String(row.id),
    name: row.name,
    style: row.style,
    timeSignature,
    steps,
    startPose: assemblePose(row.start_pose_id),
    endPose: assemblePose(row.end_pose_id),
  };
}

// ---------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------

interface SequenceRow {
  id: number;
  name: string;
  start_transform_id: number;
}

interface TransformRow {
  x: number;
  y: number;
  rotation: number;
}

interface SequenceEntryRow {
  figure_id: number;
  transform_id: number;
  resolved_start_pose_id: number;
  resolved_end_pose_id: number;
}

const sequenceStmt = db.prepare("SELECT * FROM sequences WHERE id = ?");
const floorTransformStmt = db.prepare(
  "SELECT x, y, rotation FROM floor_transforms WHERE id = ?",
);
const sequenceEntriesStmt = db.prepare(
  `SELECT figure_id, transform_id, resolved_start_pose_id, resolved_end_pose_id
	 FROM sequence_entries WHERE sequence_id = ? ORDER BY entry_index`,
);

function assembleFloorTransform(transformId: number): FloorTransform {
  const row = floorTransformStmt.get(transformId) as TransformRow | undefined;
  if (!row) {
    throw new Error(`No floor_transform with id ${transformId}`);
  }
  return { position: { x: row.x, y: row.y }, rotation: row.rotation };
}

export function assembleSequence(sequenceId: number): Sequence {
  const row = sequenceStmt.get(sequenceId) as SequenceRow | undefined;
  if (!row) {
    throw new Error(`No sequence with id ${sequenceId}`);
  }

  const entryRows = sequenceEntriesStmt.all(sequenceId) as SequenceEntryRow[];
  const entries: SequenceEntry[] = entryRows.map((entry) => ({
    figure: assembleFigure(entry.figure_id),
    transform: assembleFloorTransform(entry.transform_id),
    resolvedStartPose: assemblePose(entry.resolved_start_pose_id),
    resolvedEndPose: assemblePose(entry.resolved_end_pose_id),
  }));

  return {
    id: String(row.id),
    name: row.name,
    startTransform: assembleFloorTransform(row.start_transform_id),
    entries,
  };
}

// ---------------------------------------------------------------------
// Dance
// ---------------------------------------------------------------------

interface DanceRow {
  id: number;
  name: string;
  tempo: number;
  music: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  schema_version: number;
  sequence_id: number;
}

const danceStmt = db.prepare("SELECT * FROM dances WHERE id = ?");

export function assembleDance(danceId: number): Dance {
  const row = danceStmt.get(danceId) as DanceRow | undefined;
  if (!row) {
    throw new Error(`No dance with id ${danceId}`);
  }

  return {
    id: String(row.id),
    name: row.name,
    tempo: row.tempo,
    ...(row.music !== null ? { music: row.music } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
    sequence: assembleSequence(row.sequence_id),
  };
}
