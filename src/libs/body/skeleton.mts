import { footHeading } from "../dance/pose.mts";
import type { PartnerPose, Pose } from "../dance/pose.mts";
import type { Foot, Partner } from "../dance/step.mts";
import { centerOfWeight } from "../dance/weight.mts";
import { DEFAULT_PROPORTIONS } from "./proportions.mts";
import type { BodyProportions } from "./proportions.mts";
import {
  add,
  headingVector,
  normalize,
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
 * - the arms take hold of the partner (connectHold, in solveSkeleton):
 *   the joined hands meet out beyond the couple, the lead's right hand
 *   is on the follow's left shoulder blade and her left hand on his right
 *   upper arm. A dancer solved alone (solvePartnerSkeleton) holds the
 *   same shape relative to their own
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
 * The arms of a dancer solved without their partner, in metres from each
 * shoulder joint, in the dancer's own frame (forward, to the right, up),
 * for the left and right hands: a closed-hold shape. The lead's left
 * hand out to his left at about her eye level, his right hand forward
 * where her left shoulder blade would be; the follow mirrors the joined
 * hands, and her left hand is forward where his right upper arm would
 * be. With both dancers solved together, connectHold reaches for the
 * partner instead, and falls back to this shape only when the partner is
 * out of reach.
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

/**
 * The elbow and hand for an arm from `shoulder` reaching for `wrist`,
 * with the elbow bending down and out to the arm's own side (two-bone
 * IK). The hand ends where the forearm reaches, which is the wrist
 * target unless it's out of reach.
 */
function solveArm(
  shoulder: Point3D,
  wrist: Point3D,
  body: BodyProportions,
  facing: number,
  side: Foot,
): { elbow: Point3D; hand: Point3D } {
  const outwards = scale(headingVector(facing + 90), side === "left" ? -1 : 1);
  const elbow = twoBoneJoint(
    shoulder,
    wrist,
    body.upperArm,
    body.forearm,
    add(outwards, vec(0, 0, -1)),
  );
  const toWrist = sub(wrist, elbow);
  const reach = Math.hypot(toWrist.x, toWrist.y, toWrist.z);
  const hand =
    reach <= body.forearm + 1e-9
      ? wrist
      : add(elbow, scale(toWrist, body.forearm / reach));
  return { elbow, hand };
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
    // Along the foot: the way it points (footHeading), which is the
    // body's facing unless the step pointed it further round.
    const toes = headingVector(footHeading(pose, side));
    const alongFoot = (from: Point3D, f: number, u: number): Point3D =>
      add(from, add(scale(toes, f), scale(UP, u)));
    const middle = vec(pose[side].position.x, pose[side].position.y, 0);
    const heel = alongFoot(middle, -body.footLength / 2, pose.rise);
    const ball = alongFoot(middle, body.footLength / 2 - body.ballFromToe, 0);
    const toeTip = alongFoot(middle, body.footLength / 2, 0);
    const ankle = alongFoot(
      middle,
      -body.footLength / 2 + body.ankleFromHeel,
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
        const f = offset.x * toes.x + offset.y * toes.y;
        // A rotation in the (toes, up) plane by `angle` towards the
        // heel: a point behind the pivot goes up.
        const fNew = f * Math.cos(angle) + offset.z * Math.sin(angle);
        const zNew = -f * Math.sin(angle) + offset.z * Math.cos(angle);
        return add(pivot, add(scale(toes, fNew), vec(0, 0, zNew)));
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
    twoBoneJoint(
      hip,
      feet[side].ankle,
      body.thigh,
      body.shin,
      headingVector(footHeading(pose, side)),
    );

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

  // Arms: wrists at the solo hold shape (HOLD), elbows bending down
  // and out.
  const arm = (side: Foot) => {
    const shoulder = shoulderJoint(side);
    const hold = HOLD[partner][side];
    const wrist = along(shoulder, hold.forward, hold.right, hold.up);
    return {
      shoulder,
      ...solveArm(shoulder, wrist, body, pose.orientation, side),
    };
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

/**
 * How the couple's hold is shaped (metres). Standard ballroom closed
 * hold, as commonly taught; the exact distances are provisional
 * judgement calls (2026-11-17):
 * - JOINED_OUT: how far the joined hands (his left, her right) are out
 *   beyond the point between those two shoulders, away from the middle of
 *   the couple. In closed hold that is out to his left; in promenade it
 *   is towards the open side of the V, the way the couple travels.
 * - JOINED_ABOVE_HEAD: the joined hands' height above the base of the
 *   follow's skull, about her eye level.
 * - PALM: how far each wrist stops short of the point where the hands
 *   meet, so the two hands sit palm to palm rather than inside each other.
 * - The lead's right hand on her left shoulder blade: BLADE_BEHIND behind
 *   her left shoulder joint, BLADE_IN towards her spine, BLADE_DOWN below
 *   it.
 * - The follow's left hand on his right upper arm: UPPER_ARM_ALONG of the
 *   way from his shoulder to his elbow, resting on top (UPPER_ARM_ABOVE).
 */
const JOINED_OUT = 0.2;
const JOINED_ABOVE_HEAD = 0.06;
const PALM = 0.05;
const BLADE_BEHIND = 0.06;
const BLADE_IN = 0.1;
const BLADE_DOWN = 0.12;
const UPPER_ARM_ALONG = 0.35;
const UPPER_ARM_ABOVE = 0.05;

/**
 * When a hold point is further from the shoulder than the arm can reach,
 * the arm lets go and returns to the solo hold shape, gradually: fully
 * holding up to HOLD_LETS_GO_FROM times the arm's length, fully let go by
 * HOLD_LET_GO_BY times. Figures where the partners separate (an open
 * position, an Argentine ocho) then don't drag the arms out straight.
 */
const HOLD_LETS_GO_FROM = 1.05;
const HOLD_LET_GO_BY = 1.5;

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function lerp3(a: Point3D, b: Point3D, t: number): Point3D {
  return add(a, scale(sub(b, a), t));
}

/** Re-solves one arm of `skeleton` towards a hold point, blending back to
 *  the solo shape (the arm as solved alone) as the point gets out of
 *  reach. */
function reachFor(
  skeleton: PartnerSkeleton,
  side: Foot,
  target: Point3D,
  body: BodyProportions,
): PartnerSkeleton {
  const shoulder = skeleton.joints[`${side}UpperArm`];
  const solo = skeleton.joints[`${side}Hand`];
  const arm = body.upperArm + body.forearm;
  const away = Math.hypot(...Object.values(sub(target, shoulder)));
  const holding =
    1 - smoothstep(HOLD_LETS_GO_FROM * arm, HOLD_LET_GO_BY * arm, away);
  const wrist = lerp3(solo, target, holding);
  const { elbow, hand } = solveArm(
    shoulder,
    wrist,
    body,
    skeleton.facing,
    side,
  );
  return {
    ...skeleton,
    joints: {
      ...skeleton.joints,
      [`${side}LowerArm`]: elbow,
      [`${side}Hand`]: hand,
    },
  };
}

/**
 * Takes hold: points each dancer's arms at the partner, from where both
 * bodies are now. Because the hold points move with the bodies, the hold
 * keeps its shape through closed hold, promenade and every moment in
 * between, with no hold written in the figures.
 */
function connectHold(
  lead: PartnerSkeleton,
  follow: PartnerSkeleton,
  bodies: Record<Partner, BodyProportions>,
): CoupleSkeleton {
  const UP = vec(0, 0, 1);
  const middle = scale(add(lead.joints.hips, follow.joints.hips), 0.5);

  // The joined hands: out beyond the point between his left shoulder and
  // her right, away from the middle of the couple.
  const hisShoulder = lead.joints.leftUpperArm;
  const herShoulder = follow.joints.rightUpperArm;
  const between = scale(add(hisShoulder, herShoulder), 0.5);
  const outward =
    normalize(vec(between.x - middle.x, between.y - middle.y, 0)) ??
    scale(headingVector(lead.facing + 90), -1);
  const joined = {
    ...add(between, scale(outward, JOINED_OUT)),
    z: follow.joints.head.z + JOINED_ABOVE_HEAD,
  };
  const palmShort = (shoulder: Point3D) =>
    add(joined, scale(normalize(sub(shoulder, joined)) ?? UP, PALM));

  // His right hand on her left shoulder blade.
  const herForward = headingVector(follow.facing);
  const herRight = headingVector(follow.facing + 90);
  const blade = add(
    follow.joints.leftUpperArm,
    add(
      scale(herForward, -BLADE_BEHIND),
      add(scale(herRight, BLADE_IN), scale(UP, -BLADE_DOWN)),
    ),
  );

  let him = reachFor(lead, "left", palmShort(hisShoulder), bodies.lead);
  him = reachFor(him, "right", blade, bodies.lead);

  // Her left hand on his right upper arm, where his arm now is.
  const onHisArm = add(
    lerp3(him.joints.rightUpperArm, him.joints.rightLowerArm, UPPER_ARM_ALONG),
    scale(UP, UPPER_ARM_ABOVE),
  );
  let her = reachFor(follow, "right", palmShort(herShoulder), bodies.follow);
  her = reachFor(her, "left", onHisArm, bodies.follow);

  return { lead: him, follow: her };
}

/** Both dancers' skeletons at one instant (for example a Pose from
 *  sequencePoseAtBeat), in hold (connectHold). */
export function solveSkeleton(
  pose: Pose,
  bodies: Record<Partner, BodyProportions> = DEFAULT_PROPORTIONS,
): CoupleSkeleton {
  return connectHold(
    solvePartnerSkeleton(pose.lead, bodies.lead, "lead"),
    solvePartnerSkeleton(pose.follow, bodies.follow, "follow"),
    bodies,
  );
}
