/**
 * Continuous-time playback: a Figure's or Sequence's Pose at any
 * instant, not just at each step's boundary (what the scrubber and the
 * renderers need), and which steps are in progress.
 */

import { applyTransform } from "../floor.mts";
import {
  angleBetweenDegrees,
  lerp,
  lerpAngleDegrees,
  lerpPoint,
} from "../heading.mts";
import { footHeading } from "../pose.mts";
import type { PartnerPose, Point2D, Pose } from "../pose.mts";
import type { FloorTransform } from "../sequence.mts";
import type { DanceStep, Figure, Foot, Partner } from "../step.mts";
import { stepPassings, stepPointAt } from "./passing.mts";
import { airborneExcursionAt, movementEndpoint } from "./paths.mts";
import {
  figureDurationBeats,
  footPitchAt,
  risePhase,
  stepPhases,
  swivelStandingFoot,
} from "./timing.mts";
import type { PoseOptions } from "./timing.mts";

export function poseAtBeat(
  figure: Figure,
  localBeat: number,
  options: PoseOptions = {},
): Pose {
  const easeFoot = options.footEasing ?? ((progress: number) => progress);
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
  const bodyOffsets: Record<Partner, Point2D> = {
    lead: figure.startPose.lead.bodyOffset ?? { x: 0, y: 0 },
    follow: figure.startPose.follow.bodyOffset ?? { x: 0, y: 0 },
  };
  // How far each foot is tipped (footPitchAt): only a foot partway
  // through a step with footwork is.
  const pitches: Record<Partner, Record<Foot, number>> = {
    lead: { left: 0, right: 0 },
    follow: { left: 0, right: 0 },
  };
  // Which way each foot points. A stepping foot turns to the step's
  // footDirection (the body's facing when it has none); the other foot
  // swivels with the body or holds (swivelStandingFoot).
  const directions: Record<Partner, Record<Foot, number>> = {
    lead: {
      left: footHeading(figure.startPose.lead, "left"),
      right: footHeading(figure.startPose.lead, "right"),
    },
    follow: {
      left: footHeading(figure.startPose.follow, "left"),
      right: footHeading(figure.startPose.follow, "right"),
    },
  };

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );
  const passings = stepPassings(figure);

  for (const step of orderedSteps) {
    const stepStart = step.beat - 1;
    const stepEnd = stepStart + step.duration;
    const otherFoot: Foot = step.foot === "left" ? "right" : "left";

    if (localBeat >= stepEnd) {
      // Fully complete by the queried time -- commit its result and
      // move on to whatever comes next. An airborne step has returned
      // to where it started, so its position is left unchanged; its
      // weight (normally 0, putting all weight on the standing foot),
      // orientation and rise still apply.
      if (step.contact !== "air") {
        positions[step.partner][step.foot] = movementEndpoint(
          positions[step.partner][step.foot],
          orientations[step.partner],
          step.movement,
        );
      }
      weights[step.partner][step.foot] = step.weight;
      weights[step.partner][otherFoot] = 1 - step.weight;
      directions[step.partner][otherFoot] = swivelStandingFoot(
        directions[step.partner][otherFoot],
        orientations[step.partner],
        step.orientation,
      );
      directions[step.partner][step.foot] =
        step.footDirection ?? step.orientation;
      orientations[step.partner] = step.orientation;
      rises[step.partner] = step.rise;
      bodyOffsets[step.partner] = step.bodyOffset ?? { x: 0, y: 0 };
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
    const { foot: footPhase, weight: weightProgress } = stepPhases(
      step,
      progress,
    );
    const footProgress = easeFoot(footPhase);
    positions[step.partner][step.foot] =
      step.contact === "air"
        ? airborneExcursionAt(
            positions[step.partner][step.foot],
            orientations[step.partner],
            step.movement,
            footProgress,
          )
        : stepPointAt(
            positions[step.partner][step.foot],
            orientations[step.partner],
            step.movement,
            footProgress,
            passings.get(step),
          );
    weights[step.partner][step.foot] = lerp(
      weights[step.partner][step.foot],
      step.weight,
      weightProgress,
    );
    weights[step.partner][otherFoot] = 1 - weights[step.partner][step.foot];
    const bodyNow = lerpAngleDegrees(
      orientations[step.partner],
      step.orientation,
      progress,
    );
    directions[step.partner][otherFoot] = swivelStandingFoot(
      directions[step.partner][otherFoot],
      orientations[step.partner],
      bodyNow,
    );
    // The stepping foot turns as it travels, arriving pointed when it
    // lands.
    directions[step.partner][step.foot] = lerpAngleDegrees(
      directions[step.partner][step.foot],
      step.footDirection ?? step.orientation,
      footProgress,
    );
    orientations[step.partner] = bodyNow;
    rises[step.partner] = lerp(
      rises[step.partner],
      step.rise,
      risePhase(step, progress),
    );
    bodyOffsets[step.partner] = lerpPoint(
      bodyOffsets[step.partner],
      step.bodyOffset ?? { x: 0, y: 0 },
      progress,
    );
    pitches[step.partner][step.foot] = footPitchAt(step, footProgress);
  }

  // A foot's direction is only given when it differs from the body's
  // facing (see FootState.direction), so poses of figures that never
  // point a foot are unchanged.
  const footState = (partner: Partner, foot: Foot) => {
    const direction = directions[partner][foot];
    const pointed =
      Math.abs(angleBetweenDegrees(orientations[partner], direction)) > 1e-9;
    const pitch = pitches[partner][foot];
    return {
      position: positions[partner][foot],
      weight: weights[partner][foot],
      ...(pointed ? { direction } : {}),
      ...(Math.abs(pitch) > 1e-9 ? { pitch } : {}),
    };
  };
  const buildPartnerPose = (partner: Partner): PartnerPose => ({
    left: footState(partner, "left"),
    right: footState(partner, "right"),
    orientation: orientations[partner],
    rise: rises[partner],
    ...(Math.hypot(bodyOffsets[partner].x, bodyOffsets[partner].y) > 1e-12
      ? { bodyOffset: bodyOffsets[partner] }
      : {}),
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
  /** Position of `entry` in the entries array. */
  index: number;
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
      return { entry, index: i, localBeat };
    }
    elapsed += duration;
  }

  // Unreachable: the loop above always returns by its last iteration
  // (isLast becomes true), given entries.length > 0 was checked above.
  throw new Error("locateEntry: unreachable");
}

/** Where one entry sits on a sequence's beat timeline. */
export interface EntrySpan {
  /** Global beat where the entry's figure starts. */
  startBeat: number;
  /** Global beat where it ends (startBeat + the figure's duration). */
  endBeat: number;
}

/**
 * Each entry's [startBeat, endBeat) span on the sequence's beat
 * timeline, in order. Entries play back to back, so each span starts
 * where the previous one ends; a zero-length figure gets an empty span.
 * Used to divide a scrubber into one segment per figure.
 */
export function sequenceEntrySpans(entries: { figure: Figure }[]): EntrySpan[] {
  let elapsed = 0;
  return entries.map((entry) => {
    const startBeat = elapsed;
    elapsed += figureDurationBeats(entry.figure);
    return { startBeat, endBeat: elapsed };
  });
}

/**
 * Index of the entry that is current at `globalBeat` -- the same one
 * sequencePoseAtBeat and sequenceCurrentStepsAtBeat use, so anything
 * highlighting "the current figure" agrees with what's drawn. A beat
 * exactly on a boundary belongs to the entry starting there; zero-length
 * entries are never current (except as the last entry); positions past
 * either end clamp to the first or last entry. Null for an empty
 * sequence.
 */
export function sequenceEntryIndexAtBeat(
  entries: { figure: Figure }[],
  globalBeat: number,
): number | null {
  return locateEntry(entries, globalBeat)?.index ?? null;
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
  options: PoseOptions = {},
): Pose | null {
  const located = locateEntry(entries, globalBeat);
  if (located === null) return null;

  return applyTransform(
    located.entry.transform,
    poseAtBeat(located.entry.figure, located.localBeat, options),
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
