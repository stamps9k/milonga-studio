import type { Figure } from "./step.mts";
import type { Pose, Point2D } from "./pose.mts";

/**
 * Rigid transform placing a Figure's local frame (which always starts at
 * the origin, facing 0°) onto an actual spot on the floor. Figures are
 * authored once and reused anywhere, so this transform — not the figure
 * itself — carries where and which way the couple is actually facing for
 * one specific occurrence in a sequence.
 */
export interface FloorTransform {
  position: Point2D;
  /** Degrees, same convention as Pose/DanceStep orientation. */
  rotation: number;
}

/**
 * One figure's occurrence within a Sequence.
 *
 * `figure.startPose`/`figure.endPose` are the figure's own intrinsic
 * definition, in its local frame — unaffected by where it sits in any
 * given sequence. `resolvedStartPose`/`resolvedEndPose` are derived: the
 * local poses after applying `transform`, cached here so consumers (the
 * renderer, a scrubber, compatibility checks against the next entry)
 * don't re-derive them from scratch. If `figure` or `transform` changes,
 * these need recomputing — they are not a second source of truth.
 */
export interface SequenceEntry {
  figure: Figure;
  transform: FloorTransform;
  resolvedStartPose: Pose;
  resolvedEndPose: Pose;
}

export interface Sequence {
  id: string;
  name: string;
  /** Where the couple starts on the floor before the first entry. There's
   *  no previous figure to derive this from, so the sequence anchors
   *  itself explicitly. */
  startTransform: FloorTransform;
  entries: SequenceEntry[];
}
