/**
 * Folds a Figure's ordered DanceSteps forward from its startPose to
 * trace where each foot actually travels -- "A Figure is a fold: a
 * starting Pose plus an ordered list of DanceSteps produces a Pose at
 * every beat" (see the design comment on Pose in pose.mts).
 *
 * A Figure's stored startPose/endPose are authored by hand and aren't
 * guaranteed to exactly equal what folding its own steps produces --
 * this module doesn't assume they do. (For the seeded figures,
 * test/db/seed.test.mts checks that they agree.)
 *
 * The code is in ./fold/: paths.mts (where a foot is along a movement),
 * passing.mts (footprint geometry and passing routes), trails.mts (foot
 * trails), timing.mts (timing within a step) and playback.mts (poses at
 * any beat, for figures and sequences). This file is the public entry
 * point; import from here.
 */

export {
  PASSING_GAP,
  FOOTPRINT_LENGTH,
  FOOTPRINT_WIDTH,
  footprintGap,
  passingPoint,
} from "./fold/passing.mts";
export type { FootTrails, TrailGap } from "./fold/trails.mts";
export {
  figureFootTrails,
  sequenceTrailSegments,
  sequenceFootTrails,
} from "./fold/trails.mts";
export type { PoseOptions } from "./fold/timing.mts";
export {
  figureDurationBeats,
  LATE_WEIGHT_FOOT_SHARE,
  LATE_RISE_SHARE,
  risePhase,
  LEAD_PITCH,
  footPitchAt,
  stepPhases,
  footEase,
  swivelStandingFoot,
  SWIVEL_POINT_AHEAD,
  swivelShift,
  standingShare,
  standingSwivelShift,
  turnsOnTheSpot,
  bodyArcOffset,
} from "./fold/timing.mts";
export type { EntrySpan, ActiveStepInfo } from "./fold/playback.mts";
export {
  poseAtBeat,
  sequenceDurationBeats,
  sequenceEntrySpans,
  sequenceEntryIndexAtBeat,
  sequencePoseAtBeat,
  currentStepsAtBeat,
  sequenceCurrentStepsAtBeat,
} from "./fold/playback.mts";
