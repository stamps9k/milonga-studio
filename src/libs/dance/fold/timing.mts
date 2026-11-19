/**
 * Timing within a step: a figure's length in beats, the split of a
 * step into foot travel and weight change, when rise happens, a landing
 * foot's pitch, foot easing and how the standing foot swivels.
 */

import { angleBetweenDegrees, normalizeDegrees } from "../heading.mts";
import type { DanceStep, Figure } from "../step.mts";

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
