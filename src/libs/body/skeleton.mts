import type { PartnerPose, Pose } from "../dance/pose.mts";
import type { Foot, Partner } from "../dance/step.mts";
import { centerOfWeight } from "../dance/weight.mts";
import { DEFAULT_PROPORTIONS } from "./proportions.mts";
import type { BodyProportions } from "./proportions.mts";
import {
  add,
  headingVector,
  scale,
  sub,
  twoBoneJoint,
  vec,
} from "./vector3.mts";
import type { Point3D } from "./vector3.mts";

/**
 * The body solver: turns the dance model's Pose (four feet on the floor,
 * the weight on each, a facing and a rise per dancer) into a full
 * skeleton for each dancer, for the 3D view to draw.
 *
 * The model says only where the feet are and where the weight is; the
 * rest of the body is worked out here, the way a dancer's body follows
 * their feet:
 * - the feet are planted where the model puts them, toes the way the
 *   body faces (the model has no separate foot direction yet), heels
 *   raised by the rise;
 * - the hips sit over the weight (centerOfWeight, as the 2D view's body
 *   marker does), facing the way the body faces, at standing height plus
 *   the rise -- lowered just enough for both legs to reach their feet
 *   when the feet are far apart (a long stride sinks the hips);
 * - the knees bend forwards to join hip and ankle (two-bone IK, keeping
 *   the thigh and shin lengths);
 * - the spine, neck and head stack straight up from the hips: no sway,
 *   CBM or shaping yet, since the model can't describe them;
 * - the arms hold a fixed closed-hold shape relative to the dancer's own
 *   chest (a placeholder until the model has a hold).
 *
 * Plain data and pure functions, no 3D library: any renderer (the
 * mannequin now, a character model later) draws from the same skeleton,
 * and it is tested under node:test like the dance model.
 *
 * Joint names follow the standard humanoid skeleton used by VRM and
 * Unity (hips, spine, chest, neck, head, leftUpperLeg = the hip joint,
 * leftLowerLeg = the knee, leftFoot = the ankle, leftToes = the ball of
 * the foot, leftShoulder = the inner end of the collarbone, leftUpperArm
 * = the shoulder joint, leftLowerArm = the elbow, leftHand = the wrist),
 * so a character model's bones can be matched by name. Each joint is a
 * point in 3D floor space (vector3.mts).
 */

export const JOINT_NAMES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/** The ends of a foot, which aren't joints but are needed to draw it. */
export interface FootEnds {
  heel: Point3D;
  toeTip: Point3D;
}

export interface PartnerSkeleton {
  joints: Record<JointName, Point3D>;
  feet: Record<Foot, FootEnds>;
  /** Compass heading the body faces (the model's orientation). */
  facing: number;
  /** How far the hips are below standing height plus the rise, because
   *  the feet are too far apart for straight legs: 0 with the feet under
   *  the body, about 0.1 in a long stride. */
  hipDrop: number;
  /** How far each ankle is beyond the reach of its leg even with the
   *  hips lowered to the ankles' height: 0 when the leg reaches. More
   *  than 0 means the figure's data puts a foot where no leg could. */
  legShortfall: Record<Foot, number>;
}

export type CoupleSkeleton = Record<Partner, PartnerSkeleton>;

const UP = vec(0, 0, 1);

/** How far a free foot may roll onto its ball or heel to reach,
 *  in degrees. Provisional: about as far as a foot points in a released
 *  back step. */
const MAX_PEEL_DEGREES = 50;

/**
 * The legs are never quite straight: the hips stop this far below the
 * height at which a leg would lock out. Without it, the knee jumps
 * between straight and bent as the leg crosses full length.
 */
const KNEE_SLACK = 0.005;

/**
 * Closed-hold placeholder for the arms, in metres from each shoulder
 * joint, in the dancer's own frame (forward, to the right, up), for the
 * left and right hands. The lead's left hand holds the follow's right
 * at about her eye level, out to his left; his right hand is on her left
 * shoulder blade. The follow mirrors the joined hands, and her left hand
 * rests on his right upper arm. Provisional (2026-11-17): fixed shapes,
 * not reaching for the partner's actual hands, until the model has a
 * hold (closed, promenade, apart) and the arms can follow it.
 */
const HOLD: Record<
  Partner,
  Record<Foot, { forward: number; right: number; up: number }>
> = {
  lead: {
    left: { forward: 0.15, right: -0.3, up: 0.12 },
    right: { forward: 0.3, right: -0.12, up: -0.12 },
  },
  follow: {
    left: { forward: 0.3, right: 0.05, up: -0.02 },
    right: { forward: 0.15, right: 0.3, up: 0.14 },
  },
};

/**
 * The height of the hip joints when standing still with the feet flat
 * under the hips, legs as straight as KNEE_SLACK allows. A little under
 * the table's hip height: the model puts the weight over the middle of
 * the foot, and the ankle is a few centimetres behind it, so the leg
 * leans slightly. `hipDrop` is measured from here, so standing still
 * drops nothing.
 */
export function standingHipHeight(body: BodyProportions): number {
  const leg = body.thigh + body.shin - KNEE_SLACK;
  const ankleBehind = body.footLength / 2 - body.ankleFromHeel;
  return body.ankleHeight + Math.sqrt(leg * leg - ankleBehind * ankleBehind);
}

/** The skeleton of one dancer at one instant. */
export function solvePartnerSkeleton(
  pose: PartnerPose,
  body: BodyProportions,
  partner: Partner,
): PartnerSkeleton {
  const forward = headingVector(pose.orientation);
  const right = headingVector(pose.orientation + 90);
  const along = (from: Point3D, f: number, r: number, u: number): Point3D =>
    add(from, add(scale(forward, f), add(scale(right, r), scale(UP, u))));

  // Hips: over the weight (horizontally), at standing height plus the
  // rise unless the legs can't reach their feet from there.
  const weight = centerOfWeight(pose);
  const pelvisFloor = vec(weight.x, weight.y, 0);
  const leg = body.thigh + body.shin - KNEE_SLACK;
  const hipJointFloor = (side: Foot) =>
    along(pelvisFloor, 0, (side === "left" ? -1 : 1) * (body.hipWidth / 2), 0);
  const standing = standingHipHeight(body) + pose.rise;

  // Feet: the model's foot position is the middle of the foot (as the
  // 2D view draws it). With a rise the heel lifts and the ball stays on
  // the floor. A free foot (carrying less than half the weight) may also
  // peel to reach further: beside or behind the body its heel lifts,
  // rolling over the ball (a back foot released as the weight goes
  // forward, or a free foot resting on its ball); well in front (more
  // than half a foot ahead of the hips) its toes lift, rolling back on
  // the heel (a heel lead). It peels only
  // as far as its leg needs to reach the hips at standing height, up to
  // MAX_PEEL_DEGREES. A standing foot stays flat (apart from the rise).
  const foot = (side: Foot) => {
    const middle = vec(pose[side].position.x, pose[side].position.y, 0);
    const heel = along(middle, -body.footLength / 2, 0, pose.rise);
    const ball = along(middle, body.footLength / 2 - body.ballFromToe, 0, 0);
    const toeTip = along(middle, body.footLength / 2, 0, 0);
    const ankle = along(
      middle,
      -body.footLength / 2 + body.ankleFromHeel,
      0,
      body.ankleHeight + pose.rise,
    );
    const flat = { ankle, ball, ends: { heel, toeTip } };
    if (pose[side].weight >= 0.5) return flat;

    const hip = add(hipJointFloor(side), vec(0, 0, standing));
    const reaches = (point: Point3D) =>
      Math.hypot(point.x - hip.x, point.y - hip.y, point.z - hip.z) <= leg;
    if (reaches(ankle)) return flat;
    // Which end the foot rolls over: the heel if the foot is well in
    // front of the hips, otherwise the ball.
    const behind =
      (middle.x - pelvisFloor.x) * forward.x +
        (middle.y - pelvisFloor.y) * forward.y <
      body.footLength / 2;
    const pivot = behind ? ball : heel;
    const peel = (degrees: number) => {
      // Rotate about the pivot in the vertical plane along the foot,
      // lifting the far end: positive angles lift the heel when rolling
      // over the ball, and the toes when rolling over the heel.
      const angle = ((degrees * Math.PI) / 180) * (behind ? 1 : -1);
      const turn = (point: Point3D) => {
        const offset = sub(point, pivot);
        const f = offset.x * forward.x + offset.y * forward.y;
        // A rotation in the (forward, up) plane by `angle` towards the
        // back: a point behind the pivot goes up.
        const fNew = f * Math.cos(angle) + offset.z * Math.sin(angle);
        const zNew = -f * Math.sin(angle) + offset.z * Math.cos(angle);
        return add(pivot, add(scale(forward, fNew), vec(0, 0, zNew)));
      };
      return turn;
    };
    let low = 0;
    let high = MAX_PEEL_DEGREES;
    if (!reaches(peel(high)(ankle))) low = high;
    else {
      for (let i = 0; i < 30; i++) {
        const mid = (low + high) / 2;
        if (reaches(peel(mid)(ankle))) high = mid;
        else low = mid;
      }
      low = high;
    }
    const turn = peel(low);
    return {
      ankle: turn(ankle),
      ball: turn(ball),
      ends: { heel: turn(heel), toeTip: turn(toeTip) },
    };
  };
  const feet = { left: foot("left"), right: foot("right") };

  // Lower the hips if a leg still can't reach its ankle. A leg reaches
  // from a hip joint `across` metres away horizontally when the hip is
  // at most sqrt(leg^2 - across^2) above the ankle.
  let hipZ = standing;
  const legShortfall: Record<Foot, number> = { left: 0, right: 0 };
  for (const side of ["left", "right"] as const) {
    const ankle = feet[side].ankle;
    const offset = sub(ankle, hipJointFloor(side));
    const across = Math.hypot(offset.x, offset.y);
    if (across >= leg) {
      legShortfall[side] = across - leg;
      hipZ = Math.min(hipZ, ankle.z);
    } else {
      hipZ = Math.min(hipZ, ankle.z + Math.sqrt(leg * leg - across * across));
    }
  }
  const pelvis = add(pelvisFloor, vec(0, 0, hipZ));
  const hipJoint = (side: Foot) => add(hipJointFloor(side), vec(0, 0, hipZ));

  // Legs: knees bend forwards, the way the toes point.
  const leftUpperLeg = hipJoint("left");
  const rightUpperLeg = hipJoint("right");
  const knee = (side: Foot, hip: Point3D) =>
    twoBoneJoint(hip, feet[side].ankle, body.thigh, body.shin, forward);

  // Torso: straight up from the hips, keeping its standing proportions.
  const above = (height: number) =>
    add(pelvis, vec(0, 0, height - standingHipHeight(body)));
  const neck = above(body.neckHeight);
  // Shoulder joints a little below the base of the neck (0.818 of
  // height in the segment table, against 0.83 for the neck).
  const shoulderZ = body.neckHeight - 0.012 * body.height;
  const shoulderJoint = (side: Foot) =>
    along(
      above(shoulderZ),
      0,
      (side === "left" ? -1 : 1) * (body.shoulderWidth / 2),
      0,
    );
  const collar = (side: Foot) =>
    along(neck, 0, (side === "left" ? -1 : 1) * 0.02 * body.height, 0);

  // Arms: wrists at the hold placeholder, elbows bending down and out.
  const arm = (side: Foot) => {
    const shoulder = shoulderJoint(side);
    const hold = HOLD[partner][side];
    const wrist = along(shoulder, hold.forward, hold.right, hold.up);
    const outwards = scale(right, side === "left" ? -1 : 1);
    const elbow = twoBoneJoint(
      shoulder,
      wrist,
      body.upperArm,
      body.forearm,
      add(outwards, vec(0, 0, -1)),
    );
    // The hand ends where the forearm reaches, which is the wrist target
    // unless it's out of reach.
    const toWrist = sub(wrist, elbow);
    const reach = Math.hypot(toWrist.x, toWrist.y, toWrist.z);
    const hand =
      reach <= body.forearm + 1e-9
        ? wrist
        : add(elbow, scale(toWrist, body.forearm / reach));
    return { shoulder, elbow, hand };
  };
  const leftArm = arm("left");
  const rightArm = arm("right");

  return {
    joints: {
      hips: pelvis,
      spine: above(body.spineHeight),
      chest: above(body.chestHeight),
      neck,
      head: above(body.headHeight),
      leftUpperLeg,
      leftLowerLeg: knee("left", leftUpperLeg),
      leftFoot: feet.left.ankle,
      leftToes: feet.left.ball,
      rightUpperLeg,
      rightLowerLeg: knee("right", rightUpperLeg),
      rightFoot: feet.right.ankle,
      rightToes: feet.right.ball,
      leftShoulder: collar("left"),
      leftUpperArm: leftArm.shoulder,
      leftLowerArm: leftArm.elbow,
      leftHand: leftArm.hand,
      rightShoulder: collar("right"),
      rightUpperArm: rightArm.shoulder,
      rightLowerArm: rightArm.elbow,
      rightHand: rightArm.hand,
    },
    feet: { left: feet.left.ends, right: feet.right.ends },
    facing: pose.orientation,
    hipDrop: standing - hipZ,
    legShortfall,
  };
}

/** Both dancers' skeletons at one instant (for example a Pose from
 *  sequencePoseAtBeat). */
export function solveSkeleton(
  pose: Pose,
  bodies: Record<Partner, BodyProportions> = DEFAULT_PROPORTIONS,
): CoupleSkeleton {
  return {
    lead: solvePartnerSkeleton(pose.lead, bodies.lead, "lead"),
    follow: solvePartnerSkeleton(pose.follow, bodies.follow, "follow"),
  };
}
