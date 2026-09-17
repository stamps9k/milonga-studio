import type { DanceStep, Figure, Foot, Movement, Partner } from "./step.mts";
import type { PartnerPose, Point2D, Pose } from "./pose.mts";
import type { FloorTransform } from "./sequence.mts";
import { applyTransform } from "./floor.mts";
import {
  RAD_TO_DEG,
  addPoints,
  headingToUnitVector,
  lerp,
  lerpAngleDegrees,
  rotatePoint,
  scalePoint,
  subPoints,
} from "./heading.mts";

/**
 * Folds a Figure's ordered DanceSteps forward from its startPose to
 * trace where each foot actually travels -- "A Figure is a fold: a
 * starting Pose plus an ordered list of DanceSteps produces a Pose at
 * every beat" (see the design comment on Pose in pose.mts).
 *
 * This is the piece db/seed.mts and floor.mts both flag as not existing
 * yet ("there's no fold/simulation helper yet, so this is on the seed
 * author to keep consistent" / "join compatibility is a check we've
 * deliberately deferred to later"). A Figure's stored startPose/endPose
 * are currently authored by hand and aren't guaranteed to exactly equal
 * what folding its own steps produces -- this module doesn't assume
 * they do.
 */

export type FootTrails = Record<Partner, Record<Foot, Point2D[]>>;

const PARTNERS: readonly Partner[] = ["lead", "follow"];
const FEET: readonly Foot[] = ["left", "right"];

function straightEndpoint(
  start: Point2D,
  direction: number,
  distance: number,
): Point2D {
  return addPoints(start, scalePoint(headingToUnitVector(direction), distance));
}

/**
 * Endpoint of an arc movement after travelling `arcLength` along it.
 * Movement.arc has no explicit starting heading of its own (unlike
 * `straight`, which specifies `direction` directly) -- this uses the
 * partner's frame orientation immediately before the step as the arc's
 * initial tangent heading, on the assumption that a curving step
 * continues whichever way the body was already facing. This is a
 * genuine, currently-unconfirmed modeling choice: no seeded figure uses
 * an arc movement yet (db/seed.mts deliberately leaves them out, for
 * exactly this reason), so it hasn't been checked against a real
 * example. Worth revisiting once one exists.
 */
function arcEndpoint(
  start: Point2D,
  initialHeading: number,
  curvature: number,
  arcLength: number,
): Point2D {
  const radius = 1 / curvature;
  const center = addPoints(
    start,
    scalePoint(headingToUnitVector(initialHeading + 90), radius),
  );
  const sweepDegrees = arcLength * curvature * RAD_TO_DEG;
  const relativeToCenter = subPoints(start, center);
  return addPoints(center, rotatePoint(relativeToCenter, sweepDegrees));
}

/** Where a movement ends up, having fully completed. */
function movementEndpoint(
  start: Point2D,
  headingBefore: number,
  movement: Movement,
): Point2D {
  return movement.type === "straight"
    ? straightEndpoint(start, movement.direction, movement.distance)
    : arcEndpoint(start, headingBefore, movement.curvature, movement.arcLength);
}

/** Where a movement is after covering `progress` (0..1) of it. For an
 *  arc this traces the actual curve (travelling a fraction of its
 *  arcLength), not a straight-line shortcut between endpoints. */
function movementPointAt(
  start: Point2D,
  headingBefore: number,
  movement: Movement,
  progress: number,
): Point2D {
  return movement.type === "straight"
    ? straightEndpoint(start, movement.direction, movement.distance * progress)
    : arcEndpoint(
        start,
        headingBefore,
        movement.curvature,
        movement.arcLength * progress,
      );
}

function emptyTrails(startPose: Pose): FootTrails {
  const trails = {} as FootTrails;
  for (const partner of PARTNERS) {
    trails[partner] = {} as Record<Foot, Point2D[]>;
    for (const foot of FEET) {
      trails[partner][foot] = [startPose[partner][foot].position];
    }
  }
  return trails;
}

/**
 * Traces each foot's ordered LOCAL-frame trail (in the figure's own
 * coordinates, unplaced) by folding startPose forward through the
 * figure's steps in beat order. Each trail starts at that foot's
 * startPose position and gains one point per step that moves it.
 */
function localFootTrails(figure: Figure): FootTrails {
  const positions: Record<Partner, Record<Foot, Point2D>> = {
    lead: {
      left: figure.startPose.lead.left.position,
      right: figure.startPose.lead.right.position,
    },
    follow: {
      left: figure.startPose.follow.left.position,
      right: figure.startPose.follow.right.position,
    },
  };
  const orientationBefore: Record<Partner, number> = {
    lead: figure.startPose.lead.orientation,
    follow: figure.startPose.follow.orientation,
  };

  const trails = emptyTrails(figure.startPose);

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );

  for (const step of orderedSteps) {
    const start = positions[step.partner][step.foot];
    const end = movementEndpoint(
      start,
      orientationBefore[step.partner],
      step.movement,
    );

    positions[step.partner][step.foot] = end;
    // The step's `orientation` is the partner's frame heading as of the
    // end of this step, regardless of which foot moved -- both feet of
    // a partner share one orientation (see PartnerPose).
    orientationBefore[step.partner] = step.orientation;
    trails[step.partner][step.foot].push(end);
  }

  return trails;
}

/**
 * Traces each foot's floor-space trail for one occurrence of a Figure:
 * its steps folded from startPose, then placed on the floor by
 * `transform` (see applyTransform/fitTransform in floor.mts, which use
 * the same rotation convention).
 */
export function figureFootTrails(
  figure: Figure,
  transform: FloorTransform,
): FootTrails {
  const local = localFootTrails(figure);
  const place = (point: Point2D): Point2D =>
    addPoints(rotatePoint(point, transform.rotation), transform.position);

  const placed = {} as FootTrails;
  for (const partner of PARTNERS) {
    placed[partner] = {} as Record<Foot, Point2D[]>;
    for (const foot of FEET) {
      placed[partner][foot] = local[partner][foot].map(place);
    }
  }
  return placed;
}

/** Concatenates the floor-space trails of a whole Sequence's entries,
 *  one figureFootTrails call per entry using that entry's own
 *  transform, joined end to end in order. */
export function sequenceFootTrails(
  entries: { figure: Figure; transform: FloorTransform }[],
): FootTrails {
  const combined: FootTrails = {
    lead: { left: [], right: [] },
    follow: { left: [], right: [] },
  };

  entries.forEach((entry, index) => {
    const trails = figureFootTrails(entry.figure, entry.transform);
    for (const partner of PARTNERS) {
      for (const foot of FEET) {
        const points = trails[partner][foot];
        // Skip each entry's first point after the first entry -- it's
        // the same point as the previous entry's last (that's the
        // continuity fitTransform is for), so keeping it would just
        // duplicate a vertex in the rendered trail.
        const toAppend = index === 0 ? points : points.slice(1);
        combined[partner][foot].push(...toAppend);
      }
    }
  });

  return combined;
}

// -----------------------------------------------------------------
// Continuous-time playback: a Figure/Sequence's Pose at any instant,
// not just at each step's boundary -- what the scrubber/Timeline needs.
// -----------------------------------------------------------------

/** How many beats one full playthrough of a figure takes: the latest
 *  point any step finishes at (beat is 1-indexed, so a step's own local
 *  interval is [beat - 1, beat - 1 + duration)). A figure with no steps
 *  takes 0 beats. */
export function figureDurationBeats(figure: Figure): number {
  return figure.steps.reduce(
    (max, step) => Math.max(max, step.beat - 1 + step.duration),
    0,
  );
}

/**
 * Interpolated Pose at a continuous local-beat position within one
 * figure (0 = startPose, figureDurationBeats(figure) = endPose).
 *
 * Foot position is interpolated smoothly along its movement's actual
 * path (a straight line, or the real arc, not a shortcut between
 * endpoints). Weight, orientation and rise are interpolated linearly
 * across the same step interval -- a simplification, since the schema
 * only states their value at a step's end, not how they move through
 * it, but it reads as a smooth, believable weight transfer rather than
 * a snap.
 */
export function poseAtBeat(figure: Figure, localBeat: number): Pose {
  const positions: Record<Partner, Record<Foot, Point2D>> = {
    lead: {
      left: figure.startPose.lead.left.position,
      right: figure.startPose.lead.right.position,
    },
    follow: {
      left: figure.startPose.follow.left.position,
      right: figure.startPose.follow.right.position,
    },
  };
  const weights: Record<Partner, Record<Foot, number>> = {
    lead: {
      left: figure.startPose.lead.left.weight,
      right: figure.startPose.lead.right.weight,
    },
    follow: {
      left: figure.startPose.follow.left.weight,
      right: figure.startPose.follow.right.weight,
    },
  };
  const orientations: Record<Partner, number> = {
    lead: figure.startPose.lead.orientation,
    follow: figure.startPose.follow.orientation,
  };
  const rises: Record<Partner, number> = {
    lead: figure.startPose.lead.rise,
    follow: figure.startPose.follow.rise,
  };

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );

  for (const step of orderedSteps) {
    const stepStart = step.beat - 1;
    const stepEnd = stepStart + step.duration;
    const otherFoot: Foot = step.foot === "left" ? "right" : "left";

    if (localBeat >= stepEnd) {
      // Fully complete by the queried time -- commit its result and
      // move on to whatever comes next.
      positions[step.partner][step.foot] = movementEndpoint(
        positions[step.partner][step.foot],
        orientations[step.partner],
        step.movement,
      );
      weights[step.partner][step.foot] = step.weight;
      weights[step.partner][otherFoot] = 1 - step.weight;
      orientations[step.partner] = step.orientation;
      rises[step.partner] = step.rise;
      continue;
    }

    if (localBeat <= stepStart) {
      // This step hasn't started yet -- leave it alone. Steps are only
      // sorted by beat, so a *different* foot/partner's step can share
      // this same beat (a normal case: both partners usually step on
      // the same count), so later entries still need checking rather
      // than assuming everything after this one is also in the future.
      continue;
    }

    // In progress: interpolate this one step, then keep going -- a
    // simultaneous step for the other partner (or a foot's later step)
    // can still need processing at this same localBeat.
    const progress = (localBeat - stepStart) / step.duration;
    positions[step.partner][step.foot] = movementPointAt(
      positions[step.partner][step.foot],
      orientations[step.partner],
      step.movement,
      progress,
    );
    weights[step.partner][step.foot] = lerp(
      weights[step.partner][step.foot],
      step.weight,
      progress,
    );
    weights[step.partner][otherFoot] = 1 - weights[step.partner][step.foot];
    orientations[step.partner] = lerpAngleDegrees(
      orientations[step.partner],
      step.orientation,
      progress,
    );
    rises[step.partner] = lerp(rises[step.partner], step.rise, progress);
  }

  const buildPartnerPose = (partner: Partner): PartnerPose => ({
    left: { position: positions[partner].left, weight: weights[partner].left },
    right: {
      position: positions[partner].right,
      weight: weights[partner].right,
    },
    orientation: orientations[partner],
    rise: rises[partner],
  });

  return { lead: buildPartnerPose("lead"), follow: buildPartnerPose("follow") };
}

/** Total beats for a whole Sequence: each entry's figure played end to
 *  end, back to back. */
export function sequenceDurationBeats(entries: { figure: Figure }[]): number {
  return entries.reduce(
    (total, entry) => total + figureDurationBeats(entry.figure),
    0,
  );
}

interface LocatedEntry<E extends { figure: Figure }> {
  entry: E;
  /** globalBeat translated into that entry's own [0, figureDurationBeats]
   *  range, already clamped. */
  localBeat: number;
}

/** Which entry a globalBeat falls into, and its beat translated into
 *  that entry's own local range -- the shared delegation logic behind
 *  both sequencePoseAtBeat and sequenceCurrentStepsAtBeat, so the two
 *  can't disagree about which entry/localBeat is "current". */
function locateEntry<E extends { figure: Figure }>(
  entries: E[],
  globalBeat: number,
): LocatedEntry<E> | null {
  if (entries.length === 0) return null;

  let elapsed = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const duration = figureDurationBeats(entry.figure);
    const isLast = i === entries.length - 1;

    if (globalBeat < elapsed + duration || isLast) {
      const localBeat = Math.min(Math.max(globalBeat - elapsed, 0), duration);
      return { entry, localBeat };
    }
    elapsed += duration;
  }

  // Unreachable: the loop above always returns by its last iteration
  // (isLast becomes true), given entries.length > 0 was checked above.
  throw new Error("locateEntry: unreachable");
}

/**
 * Interpolated Pose at a continuous position along a whole Sequence, in
 * floor space (already placed by whichever entry's transform is
 * current). 0 is the very start; sequenceDurationBeats(entries) is the
 * very end. Null if there are no entries yet.
 */
export function sequencePoseAtBeat(
  entries: { figure: Figure; transform: FloorTransform }[],
  globalBeat: number,
): Pose | null {
  const located = locateEntry(entries, globalBeat);
  if (located === null) return null;

  return applyTransform(
    located.entry.transform,
    poseAtBeat(located.entry.figure, located.localBeat),
  );
}

/** Each partner's most recently *started* step as of `localBeat` --
 *  whichever is currently in progress, or the last one to have
 *  completed if nothing's in progress right now. Steps are grouped by
 *  partner (not "one active step" for the whole figure) because both
 *  partners normally step at once, and can be doing different things
 *  with different durations. Null for a partner that hasn't taken a
 *  step yet at this point in the figure. */
export function currentStepsAtBeat(
  figure: Figure,
  localBeat: number,
): Record<Partner, DanceStep | null> {
  const current: Record<Partner, DanceStep | null> = {
    lead: null,
    follow: null,
  };

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );

  for (const step of orderedSteps) {
    const stepStart = step.beat - 1;
    if (localBeat < stepStart) continue; // hasn't started yet
    // Started (in progress or since completed) -- later-sorted steps
    // for the same partner correctly overwrite this as localBeat
    // advances past them in turn.
    current[step.partner] = step;
  }

  return current;
}

export interface ActiveStepInfo {
  figureId: string;
  figureName: string;
  steps: Record<Partner, DanceStep | null>;
}

/** Sequence-level version of currentStepsAtBeat: which entry globalBeat
 *  falls into (see locateEntry), and each partner's current step within
 *  it. Null if there are no entries yet. */
export function sequenceCurrentStepsAtBeat(
  entries: { figure: Figure; transform: FloorTransform }[],
  globalBeat: number,
): ActiveStepInfo | null {
  const located = locateEntry(entries, globalBeat);
  if (located === null) return null;

  return {
    figureId: located.entry.figure.id,
    figureName: located.entry.figure.name,
    steps: currentStepsAtBeat(located.entry.figure, located.localBeat),
  };
}
