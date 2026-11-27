import type { Foot } from "../dance/step.mts";
import type { PartnerSkeleton } from "./skeleton.mts";
import { dot, length, normalize, scale, sub, vec } from "./vector3.mts";

/**
 * Arm range of motion: whether each arm of a solved skeleton is in a
 * position a dancer's arm can comfortably take.
 *
 * The body solver places each hand on a hold point and works out the
 * elbow (two-bone IK), so nothing in the solver itself stops an arm
 * folding shut, swinging far behind the body, reaching round behind the
 * back or across in front of the chest. These diagnostics measure that,
 * in the frame of the dancer's own chest, so they hold however the
 * upper body is turned (upperBodyTurn) or tilted (openUpperBodies):
 * - up runs from the hips to the base of the neck;
 * - right runs along the shoulder line, square to up;
 * - forward is square to both, the way the chest faces.
 *
 * The limits are provisional plausibility limits for ballroom holds,
 * agreed with the owner, not measured joint ranges. Like
 * the balance diagnostics, they don't change the pose: catalogue tests
 * enforce them.
 */

/** The tightest bend of the elbow, in degrees between upper arm and
 *  forearm (180: straight). Tighter, the hand would be almost on the
 *  shoulder. */
export const MIN_ELBOW_DEGREES = 30;
/** How far the upper arm may point behind the chest, in degrees from the
 *  plane of the shoulders and spine (shoulder extension). A shoulder goes
 *  back to about 50-60 degrees at most; a dancer in hold stays well
 *  short of that. */
export const MAX_ARM_BEHIND_DEGREES = 45;

export interface ArmRange {
  /** The bend at the elbow, degrees between upper arm and forearm. */
  elbowDegrees: number;
  /** How far the upper arm points behind the chest, in degrees (negative
   *  in front). */
  behindDegrees: number;
  /** Whether the hand is behind the back: further back than the back of
   *  the chest (BACK_DEPTH behind the chest joint) and within the
   *  width of the shoulders. */
  handBehindBack: boolean;
  /** Whether the hand has crossed in front of the body past the other
   *  shoulder joint. */
  handAcrossBody: boolean;
  plausible: boolean;
}

/** How far the back of the chest is behind the chest joint, in metres:
 *  the mannequin's chest radius (scene3d.mts). */
export const BACK_DEPTH = 0.11;

/** Both arms of `skeleton`, measured in its chest's frame. */
export function assessArmRange(
  skeleton: PartnerSkeleton,
): Record<Foot, ArmRange> {
  const j = skeleton.joints;
  const up = normalize(sub(j.neck, j.hips)) ?? vec(0, 0, 1);
  const shoulders = sub(j.rightUpperArm, j.leftUpperArm);
  const halfWidth = length(shoulders) / 2;
  const right =
    normalize(sub(shoulders, scale(up, dot(shoulders, up)))) ?? vec(1, 0, 0);
  const forward = vec(
    up.y * right.z - up.z * right.y,
    up.z * right.x - up.x * right.z,
    up.x * right.y - up.y * right.x,
  );
  const degrees = (cosine: number) =>
    (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
  const arm = (side: Foot): ArmRange => {
    const shoulder = j[`${side}UpperArm`];
    const elbow = j[`${side}LowerArm`];
    const hand = j[`${side}Hand`];
    const upper = normalize(sub(elbow, shoulder)) ?? scale(up, -1);
    const lower = normalize(sub(hand, elbow)) ?? upper;
    const elbowDegrees = degrees(-dot(upper, lower));
    const behindDegrees = 90 - degrees(-dot(upper, forward));
    const fromChest = sub(hand, j.chest);
    const outwards = side === "right" ? 1 : -1;
    const toOwnSide = outwards * dot(fromChest, right);
    const handBehindBack =
      dot(fromChest, forward) < -BACK_DEPTH && Math.abs(toOwnSide) < halfWidth;
    const handAcrossBody = toOwnSide < -halfWidth;
    // A billionth of a degree of rounding: values on a limit pass.
    const epsilon = 1e-9;
    return {
      elbowDegrees,
      behindDegrees,
      handBehindBack,
      handAcrossBody,
      plausible:
        elbowDegrees >= MIN_ELBOW_DEGREES - epsilon &&
        behindDegrees <= MAX_ARM_BEHIND_DEGREES + epsilon &&
        !handBehindBack &&
        !handAcrossBody,
    };
  };
  return { left: arm("left"), right: arm("right") };
}
