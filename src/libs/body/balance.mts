import type { PartnerPose } from "../dance/pose.mts";
import { headingToUnitVector } from "../dance/heading.mts";
import { bodyPosition, centerOfWeight } from "../dance/weight.mts";
import type { PartnerSkeleton } from "./skeleton.mts";

/** Provisional ordinary-dance plausibility limits (2026-11-18), not measured
 * human fall thresholds. At 0.8 m above the ankles, 10 degrees allows 14 cm
 * of sideways pelvis displacement from the weighted support point. This
 * permits modest shaping but rejects large unsupported side leans. Using
 * actual height tightens the displacement allowance when the hips lower.
 *
 * The separate 20-degree leg limit is looser: it includes normal hip width
 * and the spread of both legs during weight transfer. RMS weighting makes
 * a fully loaded leg obey 20 degrees, ignores a free leg and changes smoothly
 * through split weight; opposite leg angles cannot cancel each other.
 *
 * These diagnostics ignore forward travel, inertia, centre-of-mass shifts
 * within the torso and partner support. They do not prove physical balance,
 * clamp playback or reject imports. Catalogue tests enforce them separately
 * from reach, lowering and collision checks.
 */
export const MAX_SUPPORT_LEAN_DEGREES = 10;
export const MAX_LOADED_LEG_LEAN_DEGREES = 20;

export interface LateralBalance {
  supported: boolean;
  supportLeanDegrees: number;
  loadedLegLeanDegrees: number;
  plausible: boolean;
}

/** Sideways means the dancer's right axis, irrespective of floor placement.
 * The support point follows the same normalised weights as centerOfWeight.
 * Leg angles use the solved hip/ankle joints (not thigh/knee flexion).
 */
export function assessLateralBalance(
  pose: PartnerPose,
  skeleton: PartnerSkeleton,
): LateralBalance {
  const total = pose.left.weight + pose.right.weight;
  if (total <= 0) {
    return {
      supported: false,
      supportLeanDegrees: Infinity,
      loadedLegLeanDegrees: Infinity,
      plausible: false,
    };
  }
  const right = headingToUnitVector(pose.orientation + 90);
  const sideways = (x: number, y: number) => x * right.x + y * right.y;
  const degrees = (across: number, height: number) =>
    height <= 0 ? 90 : (Math.atan2(Math.abs(across), height) * 180) / Math.PI;
  const body = bodyPosition(pose);
  const support = centerOfWeight(pose);
  const joints = skeleton.joints;
  let ankleHeight = 0;
  let legSquares = 0;
  for (const foot of ["left", "right"] as const) {
    const weight = pose[foot].weight / total;
    if (weight === 0) continue;
    const hip = joints[`${foot}UpperLeg`];
    const ankle = joints[`${foot}Foot`];
    ankleHeight += weight * ankle.z;
    const angle = degrees(
      sideways(hip.x - ankle.x, hip.y - ankle.y),
      hip.z - ankle.z,
    );
    legSquares += weight * angle * angle;
  }
  const supportLeanDegrees = degrees(
    sideways(body.x - support.x, body.y - support.y),
    joints.hips.z - ankleHeight,
  );
  const loadedLegLeanDegrees = Math.sqrt(legSquares);
  // Tolerance is numerical only (one billionth of a degree); values exactly
  // on a documented boundary pass, while a meaningful excess fails.
  const epsilon = 1e-9;
  return {
    supported: true,
    supportLeanDegrees,
    loadedLegLeanDegrees,
    plausible:
      supportLeanDegrees <= MAX_SUPPORT_LEAN_DEGREES + epsilon &&
      loadedLegLeanDegrees <= MAX_LOADED_LEG_LEAN_DEGREES + epsilon,
  };
}
