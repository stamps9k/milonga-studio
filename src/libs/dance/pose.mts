import type { Partner } from "./step.mts";

/**
 * Resolved state of the couple at one instant in time.
 *
 * A DanceStep is a delta: it only says how one foot moved relative to
 * where it already was. It can't by itself say where the couple is,
 * because three of the four feet are just sitting wherever they were
 * last placed. Pose is that resolved snapshot — four foot positions and
 * two frame orientations — and is what the 2D renderer draws, what a
 * Figure's starting stance is expressed as, and what will eventually
 * seed IK targets for the 3D renderer.
 *
 * A Figure is a fold: a starting Pose plus an ordered list of DanceSteps
 * produces a Pose at every beat.
 */

export interface Point2D {
  x: number;
  y: number;
}

/** Resolved state of a single foot at one instant. */
export interface FootState {
  position: Point2D;
  /** 0–1, matching DanceStep.weight. */
  weight: number;
}

/** Resolved state of a single partner (lead or follow) at one instant. */
export interface PartnerPose {
  left: FootState;
  right: FootState;
  /** Frame/torso heading, in degrees — same convention as
   *  DanceStep.orientation. */
  orientation: number;
  /** Vertical displacement, matching DanceStep.rise. */
  rise: number;
}

/** Fully resolved state of both partners at one instant. */
export type Pose = Record<Partner, PartnerPose>;
