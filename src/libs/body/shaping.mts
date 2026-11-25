import type { Partner } from "../dance/step.mts";
import { segmentDistance } from "./legContact.mts";
import type {
  CoupleSkeleton,
  JointName,
  PartnerSkeleton,
} from "./skeleton.mts";
import { add, normalize, scale, sub, vec } from "./vector3.mts";
import type { Point3D } from "./vector3.mts";

/**
 * Opening the upper bodies where the couple stands close.
 *
 * The solver stacks each upper body straight up over the hips. In a
 * promenade the hips nearly touch at the point of the V, so the near
 * shoulders (his right, her left) end up just as close, about 10 cm
 * apart in tango promenade, with no room for his right arm to pass
 * under her left arm. Real dancers keep the hips together and shape the
 * upper bodies away from each other.
 *
 * So where the partners' shoulder lines come closer than SHOULDER_ROOM,
 * each upper body tilts away from the other by half the shortfall,
 * pivoting at the hips: every joint above the hips moves sideways in
 * proportion to its height above them, so the hips, legs and feet stay
 * where the dance model put them. It depends only on how close the
 * shoulders are, not on naming a position, so it grows and shrinks
 * smoothly as a couple opens into promenade and closes again; in closed
 * hold the shoulders are far enough apart that nothing moves.
 */

/** How close the partners' shoulder lines (shoulder joint to shoulder
 *  joint) may come before the upper bodies tilt apart, in metres.
 *  Provisional: room for his upper arm (4 cm round) to pass under her
 *  shoulder (5 cm round) with a little to spare. */
export const SHOULDER_ROOM = 0.2;

/** The furthest an upper body tilts, measured as the sideways shift at
 *  shoulder height, in metres. Provisional: beyond this it would read
 *  as a lean, not shaping. */
export const MAX_SHAPING = 0.08;

/** The joints that move with the upper body: everything above the
 *  hips. */
const UPPER: readonly JointName[] = [
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
];

/** The skeleton with its upper body tilted from the hips so that its
 *  shoulders move `shift` (horizontal, metres) at shoulder height. */
function tilted(skeleton: PartnerSkeleton, shift: Point3D): PartnerSkeleton {
  const hips = skeleton.joints.hips;
  const shoulderZ =
    (skeleton.joints.leftUpperArm.z + skeleton.joints.rightUpperArm.z) / 2;
  const span = shoulderZ - hips.z;
  if (span <= 1e-9) return skeleton;
  const joints = { ...skeleton.joints };
  for (const name of UPPER) {
    const joint = joints[name];
    joints[name] = add(joint, scale(shift, (joint.z - hips.z) / span));
  }
  return { ...skeleton, joints };
}

/** How the shoulders' horizontal shift away from the partner, `amount`
 *  at shoulder height: along the horizontal line from the partner's
 *  shoulder line to this one's, at their closest. */
function awayFrom(
  self: PartnerSkeleton,
  other: PartnerSkeleton,
  amount: number,
): Point3D {
  const mid = (s: PartnerSkeleton) =>
    scale(add(s.joints.leftUpperArm, s.joints.rightUpperArm), 0.5);
  const apart = sub(mid(self), mid(other));
  const direction = normalize(vec(apart.x, apart.y, 0)) ?? vec(0, 0, 0);
  return scale(direction, amount);
}

/** The distance between the two shoulder lines. */
function shoulderGap(couple: CoupleSkeleton): number {
  const a = couple.lead.joints;
  const b = couple.follow.joints;
  return segmentDistance(
    a.leftUpperArm,
    a.rightUpperArm,
    b.leftUpperArm,
    b.rightUpperArm,
  );
}

/**
 * Tilts the partners' upper bodies apart where their shoulders are
 * closer than SHOULDER_ROOM (see the top of this file), each by half the
 * shortfall and at most MAX_SHAPING. Two passes, since tilting changes
 * where the shoulder lines are closest.
 */
export function openUpperBodies(couple: CoupleSkeleton): CoupleSkeleton {
  const total: Record<Partner, number> = { lead: 0, follow: 0 };
  let result = couple;
  for (let pass = 0; pass < 2; pass++) {
    const shortfall = SHOULDER_ROOM - shoulderGap(result);
    if (shortfall <= 0) break;
    const next: Record<Partner, PartnerSkeleton> = { ...result };
    for (const partner of ["lead", "follow"] as const) {
      const other = partner === "lead" ? "follow" : "lead";
      const amount = Math.min(shortfall / 2, MAX_SHAPING - total[partner]);
      if (amount <= 0) continue;
      total[partner] += amount;
      next[partner] = tilted(
        result[partner],
        awayFrom(result[partner], result[other], amount),
      );
    }
    result = next;
  }
  return result;
}
