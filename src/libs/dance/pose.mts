import type { Foot, Partner } from "./step.mts";

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
  /** Absolute heading the foot points, in degrees (same convention as
   *  PartnerPose.orientation). Left out when it points the way the body
   *  faces, which is the usual case: read it with footHeading. */
  direction?: number;
  /** How far the foot is tipped as it lands, in degrees: positive lifts
   *  the toes (a heel lead), negative lifts the heel (a toe lead). Only
   *  given partway through a step with footwork (DanceStep.footwork);
   *  left out when the foot is flat, which it always is between steps. */
  pitch?: number;
}

/** Resolved state of a single partner (lead or follow) at one instant. */
export interface PartnerPose {
  left: FootState;
  right: FootState;
  /** Heading of the hips and feet, in degrees — same convention as
   *  DanceStep.orientation. The upper body faces this way too unless
   *  chestTurn turns it (see chestFacing). */
  orientation: number;
  /** How far the chest, shoulders and hold are turned from
   *  `orientation`, in degrees clockwise (DanceStep.chestTurn). Left out
   *  when the upper body faces the way the hips do. */
  chestTurn?: number;
  /** Vertical displacement, matching DanceStep.rise. */
  rise: number;
  /** Horizontal pelvis displacement from the weighted feet, in metres in
   * floor space. Optional zero keeps legacy poses unchanged. */
  bodyOffset?: Point2D;
}

/** Fully resolved state of both partners at one instant. */
export type Pose = Record<Partner, PartnerPose>;

/** Which way the chest, shoulders and hold face: the body's facing,
 *  turned by any chestTurn. The hold is taken in this frame. */
export function chestFacing(partner: PartnerPose): number {
  const turned = partner.orientation + (partner.chestTurn ?? 0);
  return ((turned % 360) + 360) % 360;
}

/** Which way a foot points: its own direction, or the body's facing
 *  when it has none. */
export function footHeading(partner: PartnerPose, foot: Foot): number {
  return partner[foot].direction ?? partner.orientation;
}
