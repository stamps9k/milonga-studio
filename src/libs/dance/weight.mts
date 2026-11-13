import type { PartnerPose, Point2D } from "./pose.mts";
import type { Foot } from "./step.mts";

/**
 * The point on the floor a partner's weight is over: the average of
 * their two foot positions, weighted by how much of their weight each
 * foot carries.
 *
 * With all the weight on the left foot it is exactly the left foot's
 * position; halfway through a transfer it is halfway between the feet;
 * once the transfer finishes it is on the new standing foot. Because
 * fold.mts interpolates FootState.weight across each step, this point
 * slides continuously from one foot to the other during a step, so a
 * renderer can show a weight transfer as the body moving rather than as
 * the feet changing shade. It is also where a 3D renderer would place
 * the hips over the base of support.
 *
 * Provisional modelling choice: this is the projection of the centre of
 * mass onto the floor *only* under the model's simplification that the
 * body sits directly over the weighted average of the feet. Real
 * dancers can hold their weight off-centre (a lunge, a contra body
 * position), which this can't express.
 *
 * Weights normally sum to 1 (fold.mts keeps them complementary). If
 * they don't, they're normalised; if both are 0 -- not a state the fold
 * produces, but possible in hand-authored data -- the midpoint between
 * the feet is returned rather than dividing by zero.
 */
export function centerOfWeight(partner: PartnerPose): Point2D {
  const { left, right } = partner;
  const total = left.weight + right.weight;
  if (total <= 0) {
    return {
      x: (left.position.x + right.position.x) / 2,
      y: (left.position.y + right.position.y) / 2,
    };
  }
  return {
    x:
      (left.position.x * left.weight + right.position.x * right.weight) / total,
    y:
      (left.position.y * left.weight + right.position.y * right.weight) / total,
  };
}

/** True for the foot carrying at least half of the partner's weight --
 *  the standing foot. At an exact 50/50 split both feet count. Used to
 *  draw feet as standing or free instead of shading them by weight. */
export function isStandingFoot(partner: PartnerPose, foot: Foot): boolean {
  return partner[foot].weight >= 0.5;
}
