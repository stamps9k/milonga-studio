/**
 * Timing within a step: a figure's length in beats, the split of a
 * step into foot travel and weight change, when rise happens, a landing
 * foot's pitch, foot easing and how the standing foot swivels.
 */

import {
  angleBetweenDegrees,
  headingToUnitVector,
  lerpAngleDegrees,
  normalizeDegrees,
} from "../heading.mts";
import type { Point2D } from "../pose.mts";
import type { DanceStep, Figure, SwivelPoint } from "../step.mts";

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
 * a snap. A renderer can ease the foot's travel instead (PoseOptions).
 */
/**
 * For a "late" step (see WeightTiming in step.mts), the share of the step
 * the foot takes to arrive; the weight then changes over the rest. Two
 * thirds leaves the last third of the count for the weight change, so on
 * a close the feet visibly come together before the body moves across.
 * Provisional: a judgement call, not a technique rule.
 */
export const LATE_WEIGHT_FOOT_SHARE = 2 / 3;

/** For a step with `riseTiming: "late"`, how far through the step the
 *  rise starts to change: it holds until two thirds and changes over the
 *  last third. Provisional (2026-11-17): a chart's "at end of" doesn't
 *  say how long the change takes; this matches LATE_WEIGHT_FOOT_SHARE. */
export const LATE_RISE_SHARE = 2 / 3;

/** How far through a step's rise change it is at `progress` (0 to 1)
 *  through the step (see RiseTiming). */
export function risePhase(
  step: Pick<DanceStep, "riseTiming">,
  progress: number,
): number {
  if (step.riseTiming !== "late") return progress;
  return Math.max(0, (progress - LATE_RISE_SHARE) / (1 - LATE_RISE_SHARE));
}

/** The most a foot tips as it lands with a heel or toe lead, in
 *  degrees. Provisional (2026-11-17): enough to read clearly in the 3D
 *  view; real dancers vary. */
export const LEAD_PITCH = 20;

/**
 * How far a stepping foot is tipped (degrees: positive toes up, negative
 * heel up) at `footProgress` (0 to 1) through its travel, from the first
 * letter of its footwork: "H" (heel) lands heel first, toes up; "T"
 * (toe) or "B" (ball) lands toe first, heel up; anything else, or no
 * footwork, lands flat. The tip grows over the middle of the travel to
 * LEAD_PITCH by seven tenths of the way, as the foot reaches for the
 * floor, then the foot rolls flat as it arrives, so it's flat when it
 * lands (and stays up on the ball only if the dancer has risen, which
 * the body solver draws from the rise). Provisional (2026-11-17).
 */
export function footPitchAt(
  step: Pick<DanceStep, "footwork" | "contact">,
  footProgress: number,
): number {
  if (step.contact === "air") return 0;
  const lead = step.footwork?.[0];
  const sign = lead === "H" ? 1 : lead === "T" || lead === "B" ? -1 : 0;
  if (sign === 0) return 0;
  const peak = 0.7;
  const t = Math.min(1, Math.max(0, footProgress));
  const shape =
    t <= 0.3
      ? 0
      : t <= peak
        ? footEase((t - 0.3) / (peak - 0.3))
        : footEase((1 - t) / (1 - peak));
  return sign * LEAD_PITCH * shape;
}

/**
 * How far through its travel the foot is, and how far through its weight
 * change, at `progress` (0 to 1) through a step. For an "even" step both
 * follow the step's own progress. For a "late" step the foot arrives at
 * LATE_WEIGHT_FOOT_SHARE and stays, and only then does the weight move.
 * Orientation and rise still follow the step's own progress.
 */
export function stepPhases(
  step: Pick<DanceStep, "weightTiming">,
  progress: number,
): { foot: number; weight: number } {
  if (step.weightTiming !== "late") return { foot: progress, weight: progress };
  return {
    foot: Math.min(1, progress / LATE_WEIGHT_FOOT_SHARE),
    weight: Math.max(
      0,
      (progress - LATE_WEIGHT_FOOT_SHARE) / (1 - LATE_WEIGHT_FOOT_SHARE),
    ),
  };
}

/**
 * How to draw the motion between the states the model records, for a
 * renderer that wants something other than steady speed. These don't
 * change where anything ends up, only how it gets there.
 */
export interface PoseOptions {
  /**
   * Maps how far through its travel a moving foot is (0 to 1) to how far
   * along its path to draw it. Left out, a foot travels at a steady
   * speed. The renderers pass footEase, so a foot sets off gently and
   * lands softly instead of sliding at a constant speed and stopping
   * dead. Weight, orientation and rise stay linear, so the body keeps
   * moving steadily from step to step.
   */
  footEasing?: (progress: number) => number;
}

/**
 * Smoothstep: starts and ends at rest, fastest in the middle, and
 * symmetric, so halfway through the time the foot is halfway along.
 * Provisional (2026-11-17): a stand-in for real foot timing, which
 * differs by dance (a tango step is quick and then held).
 */
export function footEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * (3 - 2 * t);
}

/**
 * Which way the foot that isn't stepping points after the body turns
 * from `bodyBefore` to `bodyAfter` over it (degrees, compass headings).
 *
 * The rule (provisional, 2026-11-17): a standing foot is never twisted
 * further from the body than it already was. Its offset from the body's
 * facing can only shrink towards zero, never grow or change sign:
 * - while the body turns towards the way the foot points, the foot
 *   stays put and the body catches up (a ballroom chart's "body
 *   completes the turn" over a foot already placed further round);
 * - once the body faces the way the foot points, or when it turns away
 *   from it, the foot swivels with the body (turning on the ball of the
 *   standing foot).
 * With the foot pointing the way the body faces (offset 0), this is
 * the foot turning with the body, which is how every foot moved before
 * feet had their own direction, so figures that don't point a foot
 * play exactly as before.
 */
export function swivelStandingFoot(
  direction: number,
  bodyBefore: number,
  bodyAfter: number,
): number {
  const offset = angleBetweenDegrees(bodyBefore, direction);
  const turn = angleBetweenDegrees(bodyBefore, bodyAfter);
  const wanted = offset - turn;
  const kept =
    offset >= 0
      ? Math.min(Math.max(wanted, 0), offset)
      : Math.max(Math.min(wanted, 0), offset);
  return normalizeDegrees(bodyAfter + kept);
}

/**
 * How far in front of the middle of a footprint each swivel point is, in
 * metres (the heel's is behind it). A footprint is FOOTPRINT_LENGTH
 * (26 cm) long, centred on the foot's position; the ball is about 7 cm
 * behind the tip of the toes, as in the body proportions
 * (src/libs/body/proportions.mts), and a turn on the heel pivots about
 * 4 cm in from its back. Provisional.
 */
export const SWIVEL_POINT_AHEAD: Record<SwivelPoint, number> = {
  ball: 0.06,
  heel: -0.09,
};

/**
 * How far the middle of a foot (its position) moves as the foot, on the
 * floor, turns from pointing `before` to pointing `after` (compass
 * headings) about the point `about` (DanceStep.swivel). The pivot P lies
 * SWIVEL_POINT_AHEAD along the foot from its middle and stays put, so the
 * middle goes from P - k·before to P - k·after. Nothing moves when no
 * swivel point is given: the foot turns about its middle.
 */
export function swivelShift(
  about: SwivelPoint | undefined,
  before: number,
  after: number,
): Point2D {
  if (about === undefined) return { x: 0, y: 0 };
  const ahead = SWIVEL_POINT_AHEAD[about];
  const from = headingToUnitVector(before);
  const to = headingToUnitVector(after);
  return { x: ahead * (from.x - to.x), y: ahead * (from.y - to.y) };
}

/**
 * How much of a step's time its standing foot spends on the floor, as a
 * share from 0 to 1: all of it, unless the same partner's next step on
 * that foot sets off before this one ends (a free foot moving off while
 * the body is still turning on the other), when it is the share up to
 * then. The standing foot swivels about the step's swivel point only
 * while it is on the floor; once it moves, its own step carries it.
 */
export function standingShare(step: DanceStep, steps: DanceStep[]): number {
  const start = step.beat - 1;
  const end = start + step.duration;
  let share = 1;
  for (const other of steps) {
    if (other.partner !== step.partner || other.foot === step.foot) continue;
    const otherStart = other.beat - 1;
    if (otherStart >= start - 1e-9 && otherStart < end - 1e-9)
      share = Math.min(
        share,
        Math.max(0, (otherStart - start) / step.duration),
      );
  }
  return share;
}

/**
 * How far a standing foot has moved by `share` of a step (0 to 1, never
 * past standingShare) because it swivels with the body about `about`
 * (the step's swivel point): from pointing `directionBefore` to where
 * swivelStandingFoot has it with the body turned that share of the way
 * from `bodyBefore` to `bodyAfter` (the body turns evenly through the
 * step).
 */
export function standingSwivelShift(
  about: SwivelPoint | undefined,
  directionBefore: number,
  bodyBefore: number,
  bodyAfter: number,
  share: number,
): Point2D {
  if (about === undefined) return { x: 0, y: 0 };
  const directionNow = swivelStandingFoot(
    directionBefore,
    bodyBefore,
    lerpAngleDegrees(bodyBefore, bodyAfter, share),
  );
  return swivelShift(about, directionBefore, directionNow);
}

/** Whether a step turns its own foot on the spot (a pivot, or "in
 *  place"): on the floor, without travelling. */
export function turnsOnTheSpot(step: DanceStep): boolean {
  return (
    step.contact !== "air" &&
    step.movement.type === "straight" &&
    step.movement.distance === 0
  );
}

/**
 * How far a dancer's body is off the straight line from where a step
 * starts it (B0) to where it ends it (B1), `share` of the way along (0 to
 * 1), when the step asks for the body to travel round an arc
 * (DanceStep.bodyArc) while it turns `turn` degrees (clockwise
 * positive): `travel` is B1 - B0.
 *
 * Walking round a partner, the body goes round, as a walker turning a
 * corner does, instead of cutting straight across: a circular arc from
 * B0 to B1 whose direction turns with the body, through `turn` over the
 * whole way, so turning right it sets off left of the straight line and
 * bulges to that side, with the centre of the turn on the right. The
 * offset is that arc's point less the straight line's point at the same
 * share; it is nothing at both ends, so the body still starts and ends
 * the step exactly where the weighted feet put it. In
 * the complex plane (x, y as real and imaginary parts) the arc is
 * B0 + travel · (e^{iφs} - 1) / (e^{iφ} - 1), with φ the turn in
 * radians, anticlockwise positive (so a turn to the right is negative).
 */
export function bodyArcOffset(
  travel: Point2D,
  turn: number,
  share: number,
): Point2D {
  if (share <= 0 || share >= 1) return { x: 0, y: 0 };
  const phi = (-turn * Math.PI) / 180;
  const endX = Math.cos(phi) - 1,
    endY = Math.sin(phi);
  const endSize = endX * endX + endY * endY;
  if (Math.abs(phi) < 1e-9 || endSize < 1e-12) return { x: 0, y: 0 };
  const nowX = Math.cos(phi * share) - 1,
    nowY = Math.sin(phi * share);
  // g = now / end, as complex numbers; the offset is travel · (g - share).
  const gX = (nowX * endX + nowY * endY) / endSize - share;
  const gY = (nowY * endX - nowX * endY) / endSize;
  return {
    x: travel.x * gX - travel.y * gY,
    y: travel.x * gY + travel.y * gX,
  };
}
