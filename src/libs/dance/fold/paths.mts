/**
 * Where a foot is along a movement: straight and arc endpoints, a point
 * partway along, and an airborne step's out-and-back excursion.
 */

import {
  RAD_TO_DEG,
  addPoints,
  headingToUnitVector,
  rotatePoint,
  scalePoint,
  subPoints,
} from "../heading.mts";
import type { PartnerPose, Point2D } from "../pose.mts";
import type { Foot, Movement, Partner } from "../step.mts";

export const PARTNERS: readonly Partner[] = ["lead", "follow"];
export const FEET: readonly Foot[] = ["left", "right"];

export function straightEndpoint(
  start: Point2D,
  direction: number,
  distance: number,
): Point2D {
  return addPoints(start, scalePoint(headingToUnitVector(direction), distance));
}

/**
 * Endpoint of an arc movement after travelling `arcLength` along it,
 * setting off along `initialHeading` (see arcHeading).
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

/**
 * The heading an arc sets off along: the partner's facing just before
 * the step, turned by the arc's `setOff` (0 when left out, so the foot
 * sets off the way the body faces). An arc is stored relative to the
 * facing rather than with an absolute heading, so it reads the same
 * wherever a figure is placed on the floor. `path: "around the back"`
 * in a figure file sets `setOff` so the foot leaves diagonally back
 * (see curveAround in authoring.mts).
 */
function arcHeading(
  headingBefore: number,
  movement: Extract<Movement, { type: "arc" }>,
): number {
  return headingBefore + (movement.setOff ?? 0);
}

/** Where a movement ends up, having fully completed. */
export function movementEndpoint(
  start: Point2D,
  headingBefore: number,
  movement: Movement,
): Point2D {
  return movement.type === "straight"
    ? straightEndpoint(start, movement.direction, movement.distance)
    : arcEndpoint(
        start,
        arcHeading(headingBefore, movement),
        movement.curvature,
        movement.arcLength,
      );
}

/** Where a movement is after covering `progress` (0..1) of it. For an
 *  arc this traces the actual curve (travelling a fraction of its
 *  arcLength), not a straight-line shortcut between endpoints. */
export function movementPointAt(
  start: Point2D,
  headingBefore: number,
  movement: Movement,
  progress: number,
): Point2D {
  return movement.type === "straight"
    ? straightEndpoint(start, movement.direction, movement.distance * progress)
    : arcEndpoint(
        start,
        arcHeading(headingBefore, movement),
        movement.curvature,
        movement.arcLength * progress,
      );
}

export function positionsOf(partner: PartnerPose): Record<Foot, Point2D> {
  return { left: partner.left.position, right: partner.right.position };
}

/**
 * Where a foot is partway through an airborne (`contact: "air"`) step.
 *
 * Contact (step.mts) says an airborne action describes a path for
 * rendering but doesn't change where the foot rests for the next step.
 * The movement only describes one direction of travel, so the foot is
 * modelled as going out along that path for the first half of the step
 * and retracing it back to where it started for the second half. That
 * keeps the animated foot continuous at both ends of the step (no jump
 * back to the resting spot when the step finishes).
 *
 * Provisional modelling choice, not a confirmed technique rule: a real
 * boleo or gancho doesn't necessarily return along the same line, and
 * the out/back split need not be even. If air steps gain their own
 * timing or return path data, this is the function to change.
 */
export function airborneExcursionAt(
  rest: Point2D,
  headingBefore: number,
  movement: Movement,
  progress: number,
): Point2D {
  const outward = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
  return movementPointAt(rest, headingBefore, movement, outward);
}

/** How many straight pieces an arc is drawn with in a trail. */
export const ARC_TRAIL_SAMPLES = 12;
