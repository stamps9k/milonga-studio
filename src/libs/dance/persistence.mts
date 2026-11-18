import type { Dance } from "./dance.mts";
import type { Figure, DanceStep, Movement } from "./step.mts";
import type { Pose, PartnerPose, FootState, Point2D } from "./pose.mts";
import type { FloorTransform, Sequence } from "./sequence.mts";
import { applyTransform } from "./floor.mts";
import { normalizeDegrees } from "./heading.mts";
import { FALLBACK_TEMPO, MIN_TEMPO, MAX_TEMPO } from "./tempo.mts";
import { entriesToSequence } from "./serialize.mts";

export const DANCE_SCHEMA_VERSION = 1;
// Resource limits for files, local records and decompressed links. They bound
// renderer work, not dance technique. In particular, total beats are bounded
// because the metronome allocates a click for every half beat.
export const MAX_DANCE_BYTES = 2_000_000;
const MAX_ENTRIES = 500;
const MAX_STEPS = 500;
const MAX_TOTAL_STEPS = 20_000;
const MAX_TOTAL_BEATS = 10_000;

function invalid(path: string): never {
  throw new Error(`Invalid dance: ${path}`);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(path);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max = 200): string {
  if (typeof value !== "string" || value.length > max) invalid(path);
  return value;
}
function number(
  value: unknown,
  path: string,
  min = -1_000_000,
  max = 1_000_000,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    invalid(path);
  return value;
}
function angle(value: unknown, path: string): number {
  return normalizeDegrees(number(value, path));
}
function choice<const T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  if (!choices.includes(value as T)) invalid(path);
  return value as T;
}
function point(value: unknown, path: string): Point2D {
  const row = record(value, path);
  return { x: number(row.x, `${path}.x`), y: number(row.y, `${path}.y`) };
}
function foot(value: unknown, path: string): FootState {
  const row = record(value, path);
  return {
    position: point(row.position, `${path}.position`),
    weight: number(row.weight, `${path}.weight`, 0, 1),
    ...(row.direction === undefined
      ? {}
      : { direction: angle(row.direction, `${path}.direction`) }),
  };
}
function partner(value: unknown, path: string): PartnerPose {
  const row = record(value, path);
  return {
    left: foot(row.left, `${path}.left`),
    right: foot(row.right, `${path}.right`),
    orientation: angle(row.orientation, `${path}.orientation`),
    rise: number(row.rise, `${path}.rise`),
    ...(row.bodyOffset === undefined
      ? {}
      : { bodyOffset: point(row.bodyOffset, `${path}.bodyOffset`) }),
  };
}
function pose(value: unknown, path: string): Pose {
  const row = record(value, path);
  return {
    lead: partner(row.lead, `${path}.lead`),
    follow: partner(row.follow, `${path}.follow`),
  };
}
function transform(value: unknown, path: string): FloorTransform {
  const row = record(value, path);
  return {
    position: point(row.position, `${path}.position`),
    rotation: angle(row.rotation, `${path}.rotation`),
  };
}
function movement(value: unknown, path: string): Movement {
  const row = record(value, path);
  if (row.type === "straight")
    return {
      type: "straight",
      direction: angle(row.direction, `${path}.direction`),
      distance: number(row.distance, `${path}.distance`, 0),
    };
  if (row.type !== "arc") invalid(`${path}.type`);
  const curvature = number(row.curvature, `${path}.curvature`);
  if (curvature === 0 || Math.abs(curvature) < 1e-9)
    invalid(`${path}.curvature`);
  return {
    type: "arc",
    curvature,
    arcLength: number(row.arcLength, `${path}.arcLength`, 0),
    ...(row.setOff === undefined
      ? {}
      : { setOff: angle(row.setOff, `${path}.setOff`) }),
  };
}
function step(value: unknown, path: string): DanceStep {
  const row = record(value, path);
  return {
    id: text(row.id, `${path}.id`),
    partner: choice(row.partner, ["lead", "follow"], `${path}.partner`),
    foot: choice(row.foot, ["left", "right"], `${path}.foot`),
    movement: movement(row.movement, `${path}.movement`),
    contact: choice(row.contact, ["floor", "air"], `${path}.contact`),
    weight: number(row.weight, `${path}.weight`, 0, 1),
    orientation: angle(row.orientation, `${path}.orientation`),
    rise: number(row.rise, `${path}.rise`),
    ...(row.bodyOffset === undefined
      ? {}
      : { bodyOffset: point(row.bodyOffset, `${path}.bodyOffset`) }),
    beat: number(row.beat, `${path}.beat`, 1, MAX_TOTAL_BEATS),
    duration: number(row.duration, `${path}.duration`, 1e-6, MAX_TOTAL_BEATS),
    ...(row.footDirection === undefined
      ? {}
      : { footDirection: angle(row.footDirection, `${path}.footDirection`) }),
    ...(row.weightTiming === undefined
      ? {}
      : {
          weightTiming: choice(
            row.weightTiming,
            ["even", "late"],
            `${path}.weightTiming`,
          ),
        }),
    ...(row.riseTiming === undefined
      ? {}
      : {
          riseTiming: choice(
            row.riseTiming,
            ["even", "late"],
            `${path}.riseTiming`,
          ),
        }),
    ...(row.footwork === undefined
      ? {}
      : { footwork: text(row.footwork, `${path}.footwork`, 30) }),
    ...(row.label === undefined
      ? {}
      : { label: text(row.label, `${path}.label`, 1000) }),
  };
}
function figure(value: unknown, path: string): Figure {
  const row = record(value, path);
  if (!Array.isArray(row.steps) || row.steps.length > MAX_STEPS)
    invalid(`${path}.steps`);
  const steps = row.steps.map((value, index) =>
    step(value, `${path}.steps[${index}]`),
  );
  // The fold assumes at most one step per partner is in progress. Validate
  // that structural contract without re-running provisional technique checks.
  for (const partner of ["lead", "follow"] as const) {
    let end = 1;
    for (const step of steps
      .filter((step) => step.partner === partner)
      .sort((a, b) => a.beat - b.beat)) {
      if (step.beat < end - 1e-9)
        invalid(`${path}.steps overlap for ${partner}`);
      if (step.contact === "air" && step.weight !== 0)
        invalid(`${path}.airborne weight`);
      end = step.beat + step.duration;
    }
  }
  const signature = record(row.timeSignature, `${path}.timeSignature`);
  const beatsPerMeasure = number(
    signature.beatsPerMeasure,
    `${path}.beatsPerMeasure`,
    1,
    64,
  );
  const beatUnit = number(signature.beatUnit, `${path}.beatUnit`, 1, 64);
  if (!Number.isInteger(beatsPerMeasure) || !Number.isInteger(beatUnit))
    invalid(`${path}.timeSignature`);
  return {
    id: text(row.id, `${path}.id`),
    name: text(row.name, `${path}.name`),
    style: text(row.style, `${path}.style`),
    timeSignature: { beatsPerMeasure, beatUnit },
    steps,
    startPose: pose(row.startPose, `${path}.startPose`),
    endPose: pose(row.endPose, `${path}.endPose`),
  };
}
function sequence(value: unknown): Sequence {
  const row = record(value, "sequence");
  if (!Array.isArray(row.entries) || row.entries.length > MAX_ENTRIES)
    invalid("sequence.entries");
  let totalSteps = 0;
  let totalBeats = 0;
  const entries = row.entries.map((value, index) => {
    const path = `sequence.entries[${index}]`;
    const row = record(value, path);
    const parsedFigure = figure(row.figure, `${path}.figure`);
    totalSteps += parsedFigure.steps.length;
    totalBeats += Math.max(
      0,
      ...parsedFigure.steps.map((step) => step.beat - 1 + step.duration),
    );
    if (totalSteps > MAX_TOTAL_STEPS || totalBeats > MAX_TOTAL_BEATS)
      invalid("sequence is too large");
    const placement = transform(row.transform, `${path}.transform`);
    // These poses are caches, never trusted input. Preserve authored start/end
    // poses (which need not match folding) and the saved floor placement.
    return {
      figure: parsedFigure,
      transform: placement,
      resolvedStartPose: applyTransform(placement, parsedFigure.startPose),
      resolvedEndPose: applyTransform(placement, parsedFigure.endPose),
    };
  });
  return {
    id: text(row.id, "sequence.id"),
    name: text(row.name, "sequence.name"),
    startTransform: transform(row.startTransform, "sequence.startTransform"),
    entries,
  };
}

export function emptyDance(now = new Date().toISOString()): Dance {
  return {
    id: "local-dance",
    name: "Untitled Dance",
    tempo: FALLBACK_TEMPO,
    createdAt: now,
    updatedAt: now,
    schemaVersion: DANCE_SCHEMA_VERSION,
    sequence: entriesToSequence([]),
  };
}

/** Accepts current Dance records and the old bare Sequence JSON export.
 * Unknown fields are discarded; future schema versions fail explicitly rather
 * than being silently misread. No database/catalogue lookup is needed. */
export function parseDance(value: unknown): Dance {
  const row = record(value, "expected an object");
  if (
    row.schemaVersion === undefined &&
    row.sequence === undefined &&
    Array.isArray(row.entries)
  ) {
    return {
      ...emptyDance(),
      name: text(row.name, "sequence.name"),
      sequence: sequence(row),
    };
  }
  if (row.schemaVersion !== DANCE_SCHEMA_VERSION)
    throw new Error("Unsupported dance version. This app supports version 1.");
  const date = (value: unknown, path: string) => {
    const result = text(value, path, 50);
    if (!Number.isFinite(Date.parse(result))) invalid(path);
    return result;
  };
  const name = text(row.name, "name").trim();
  if (!name) invalid("name is required");
  return {
    id: text(row.id, "id"),
    name,
    tempo: number(row.tempo, "tempo", MIN_TEMPO, MAX_TEMPO),
    createdAt: date(row.createdAt, "createdAt"),
    updatedAt: date(row.updatedAt, "updatedAt"),
    schemaVersion: DANCE_SCHEMA_VERSION,
    sequence: sequence(row.sequence),
    ...(row.notes === undefined
      ? {}
      : { notes: text(row.notes, "notes", 10_000) }),
    ...(row.music === undefined
      ? {}
      : { music: text(row.music, "music", 2000) }),
  };
}

export function parseDanceJSON(json: string): Dance {
  if (new TextEncoder().encode(json).byteLength > MAX_DANCE_BYTES)
    throw new Error("Dance files must be smaller than 2 MB.");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  return parseDance(value);
}
