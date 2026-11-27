import { footHeading } from "../dance/pose.mts";
import type { HoldKind } from "../dance/authoring.mts";
import type { PartnerPose, Pose } from "../dance/pose.mts";
import { legContactFor, segmentDistance, slideKnees } from "./legContact.mts";
import { openUpperBodies } from "./shaping.mts";
import type { Foot, Partner } from "../dance/step.mts";
import { bodyPosition } from "../dance/weight.mts";
import { normalizeDegrees } from "../dance/heading.mts";
import { DEFAULT_PROPORTIONS } from "./proportions.mts";
import type { BodyProportions } from "./proportions.mts";
import {
  add,
  distance,
  dot,
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
 * The model supplies feet, weight and an optional pelvis displacement; the
 * rest of the body is worked out here, the way a dancer's body follows
 * their feet:
 * - the feet are planted where the model puts them, toes the way the
 *   foot direction specifies (defaulting to body facing), heels
 *   raised by the rise;
 * - the hips use bodyPosition (weighted feet plus any authored horizontal
 *   offset, shared with the 2D marker), facing the body heading, at standing
 *   height plus the rise -- lowered just enough for both legs to reach their feet
 *   when the feet are far apart (a long stride sinks the hips);
 * - the knees bend forwards to join hip and ankle (two-bone IK, keeping
 *   the thigh and shin lengths), swinging a little sideways where a leg
 *   would pass through the partner's (slideKnees, in solveSkeleton);
 * - the spine, neck and head stack straight up from the hips, except
 *   that where the partners' shoulders come close (promenade) the upper
 *   bodies tilt apart (openUpperBodies, in solveSkeleton), and where the
 *   follow comes level with the lead's right side his upper body turns
 *   towards her (upperBodyTurn, in solveSkeleton); no sway yet, since
 *   the model can't describe it;
 * - the arms take hold of the partner (connectHold, in solveSkeleton):
 *   the joined hands meet out beyond the couple, the lead's right hand
 *   is on the follow's left shoulder blade, his arm wrapping round her
 *   side under her left arm, and her left hand on his right upper arm,
 *   her arm lying along his; each hand points the way it lies
 *   (fingertips), its palm facing the partner (palms), and the joined
 *   hands are clasped (grips). A dancer solved alone
 *   (solvePartnerSkeleton) holds the same shape relative to their own
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
  /** Compass heading the pelvis faces: the body's facing turned by
   *  contra body movement (cbmTurn) where a leg crosses the body. */
  hipFacing: number;
  /** Compass heading the chest, shoulders and head face: the body's
   *  facing, turned where the lead's upper body turns towards his partner
   *  (upperBodyTurn). The arms are solved in this frame. */
  chestFacing: number;
  /** How far the hips are below standing height plus the rise, because
   *  the feet are too far apart for straight legs: 0 with the feet under
   *  the body, about 0.1 in a long stride. */
  hipDrop: number;
  /** How far each ankle is beyond the reach of its leg even with the
   *  hips lowered to the ankles' height: 0 when the leg reaches. More
   *  than 0 means the figure's data puts a foot where no leg could. */
  legShortfall: Record<Foot, number>;
  /** How far each knee is swung sideways from its natural bend, in
   *  degrees round the hip-ankle line, to slide past the partner's legs
   *  (slideKnees, in solveSkeleton): 0 when the legs don't meet. */
  kneeSwing: Record<Foot, number>;
  /** Where the tip of each hand's middle finger is (BodyProportions.hand
   *  from the wrist), which says which way the hand points: straight on
   *  from the forearm when the arm is free, laid along the partner's
   *  back or arm, or upright, in hold (connectHold). The joints alone
   *  end at the wrist, so without this a character model's hands stuck
   *  straight out past the partner. */
  fingertips: Record<Foot, Point3D>;
  /** Which way each palm faces (a unit vector at right angles to the
   *  way the hand points): in towards the body when the arm is free, onto
   *  the partner in hold, and palm to palm at the joined hands. */
  palms: Record<Foot, Point3D>;
  /** How far each hand's fingers close: 0 is the hand as modelled (open,
   *  fingers lightly bent), 1 a loose fist. The joined hands close round
   *  each other; a hand resting on the partner stays nearly open. */
  grips: Record<Foot, number>;
}

/** How a hand is held: the way its fingers point, the way its palm
 *  faces (both directions, normalized where used) and its grip. */
interface HandShape {
  fingers: Point3D;
  palm: Point3D;
  grip: number;
}

/** `direction` with its part along `axis` (a unit vector) removed,
 *  normalized; null if nothing is left. */
function square(direction: Point3D, axis: Point3D): Point3D | null {
  return normalize(sub(direction, scale(axis, dot(direction, axis))));
}

export type CoupleSkeleton = Record<Partner, PartnerSkeleton>;

const UP = vec(0, 0, 1);

/** How far a free foot may roll onto its ball or heel to reach,
 *  in degrees. Provisional: about as far as a foot points in a released
 *  back step. */
const MAX_PEEL_DEGREES = 50;
/** Half the width, in metres, of the band around "half a foot ahead of
 *  the hips" over which a free foot without footwork changes from
 *  rolling over its ball to rolling back on its heel. Provisional: wide
 *  enough that a foot carried across it by the body's turn changes over
 *  several frames. */
const PEEL_BLEND = 0.08;

/**
 * The legs are never quite straight: the hips stop this far below the
 * height at which a leg would lock out. Without it, the knee jumps
 * between straight and bent as the leg crosses full length.
 */
const KNEE_SLACK = 0.005;

/**
 * The arms are never quite straight either: a wrist target further than
 * this short of the arm's full length (upper arm plus forearm) is drawn
 * in to it, and the hand stops that much short. Near full length the
 * elbow's sideways offset changes very fast with the reach (as the
 * square root of how far short it is), so an arm stretched to reach the
 * partner (his right arm round her back in a spin turn) would make the
 * elbow jump between frames as the reach comes and goes. Provisional
 * judgement call: 2 cm, enough to keep it smooth, too little to see.
 */
const ARM_SLACK = 0.02;

/**
 * How far, in metres, the elbow's aim is pushed out to the arm's own side
 * when it bends towards a point on the partner (the hold's `arms`). Where
 * that point lies on or near the line from the shoulder to the wrist, it
 * says little about which way the elbow should go, and the elbow could
 * swing round the line between frames; this small push out decides it
 * the natural way. Provisional: the smallest push that kept every figure
 * smooth while pressing the partners' arms together least.
 */
const ELBOW_BIAS = 0.02;

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
 * IK), or towards a point on the partner (`bend`). The hand ends where
 * the forearm reaches, which is the wrist target unless it's out of
 * reach (or within ARM_SLACK of it).
 */
function solveArm(
  shoulder: Point3D,
  wrist: Point3D,
  body: BodyProportions,
  facing: number,
  side: Foot,
  /** A point the elbow bends towards, in place of out and down, by
   *  `amount` (1: fully; 0: the usual out and down). */
  bend?: { towards: Point3D; amount: number },
): {
  elbow: Point3D;
  hand: Point3D;
  fingertip: Point3D;
  palm: Point3D;
} {
  const outwards = scale(headingVector(facing + 90), side === "left" ? -1 : 1);
  const full = body.upperArm + body.forearm - ARM_SLACK;
  const toTarget = sub(wrist, shoulder);
  const away = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
  const reachable =
    away <= full ? wrist : add(shoulder, scale(toTarget, full / away));
  const outAndDown = add(outwards, vec(0, 0, -1));
  const pole =
    bend === undefined
      ? outAndDown
      : lerp3(
          outAndDown,
          add(
            sub(bend.towards, lerp3(shoulder, wrist, 0.5)),
            scale(outwards, ELBOW_BIAS),
          ),
          bend.amount,
        );
  const elbow = twoBoneJoint(
    shoulder,
    reachable,
    body.upperArm,
    body.forearm,
    pole,
  );
  const toWrist = sub(wrist, elbow);
  const reach = Math.hypot(toWrist.x, toWrist.y, toWrist.z);
  const hand =
    reach <= body.forearm + 1e-9
      ? wrist
      : add(elbow, scale(toWrist, body.forearm / reach));
  const fingertip = fingersOn(elbow, hand, body);
  // A free hand's palm faces in towards the body (away from `outwards`),
  // as an arm held up in front of you does.
  const pointing = normalize(sub(fingertip, hand)) ?? vec(0, 0, -1);
  const palm =
    square(scale(outwards, -1), pointing) ??
    square(vec(0, 0, -1), pointing) ??
    vec(1, 0, 0);
  return { elbow, hand, fingertip, palm };
}

/** A free hand's fingertip: straight on from the forearm. */
function fingersOn(
  elbow: Point3D,
  wrist: Point3D,
  body: BodyProportions,
): Point3D {
  const along = normalize(sub(wrist, elbow)) ?? vec(0, 0, -1);
  return add(wrist, scale(along, body.hand));
}

/** Contra body movement, provisional: the feet start to count as
 *  crossed once they are closer than this across the body, in metres
 *  (in an ordinary walk they track about a stance width apart). */
export const CBM_TRACK = 0.1;
/** How far one foot must be ahead of the other for the full turn, in
 *  metres; with the feet nearer level the turn shrinks to nothing, so it
 *  changes smoothly as a crossed foot passes the other. About half a
 *  foot. */
export const CBM_REACH = 0.15;
/** The most the pelvis turns from the body's facing, in degrees. */
export const MAX_CBM_DEGREES = 25;

/**
 * Contra body movement (CBM), in degrees clockwise: how far the pelvis
 * turns from the body's facing because the feet are placed across the
 * body (contra body movement position, CBMP). The hips follow the legs
 * while the upper body keeps the hold, so the two turn against each
 * other: with the right foot forward across the left's track, the pelvis
 * turns left, towards it, and the leg runs straight from its hip instead
 * of cutting across in front of the body (and into a partner standing
 * outside). The left foot forward across turns it right; a foot back
 * across, the other way.
 *
 * Worked out from the feet alone, in the body's frame: how far the right
 * foot is short of CBM_TRACK to the right of the left (0 for feet apart
 * as usual), and which is ahead by how much. The pelvis turns by the
 * angle that crossing makes over the distance between the feet
 * (atan2(crossing, ahead)), towards the foot that is ahead, scaled down
 * to nothing as the feet come level (within CBM_REACH), and capped at
 * MAX_CBM_DEGREES. Only the pelvis turns: the hold (chest, shoulders,
 * arms) keeps the body's facing, and nothing in the dance model or its
 * checks changes. Provisional: the amounts are judgement calls, not
 * measurements.
 */
export function cbmTurn(pose: PartnerPose): number {
  const forward = headingVector(pose.orientation);
  const right = headingVector(pose.orientation + 90);
  const dx = pose.right.position.x - pose.left.position.x;
  const dy = pose.right.position.y - pose.left.position.y;
  const apart = dx * right.x + dy * right.y;
  const ahead = dx * forward.x + dy * forward.y;
  const crossing = Math.max(0, CBM_TRACK - apart);
  if (crossing === 0) return 0;
  const angle =
    (Math.atan2(crossing, Math.max(Math.abs(ahead), CBM_REACH)) * 180) /
    Math.PI;
  const reach = Math.max(-1, Math.min(1, ahead / CBM_REACH));
  return Math.max(-MAX_CBM_DEGREES, Math.min(MAX_CBM_DEGREES, -reach * angle));
}

/** The skeleton of one dancer at one instant. */
export function solvePartnerSkeleton(
  pose: PartnerPose,
  body: BodyProportions,
  partner: Partner,
  hold: HoldKind = "standard",
  cbmShare = 1,
): PartnerSkeleton {
  const forward = headingVector(pose.orientation);
  const right = headingVector(pose.orientation + 90);
  const along = (from: Point3D, f: number, r: number, u: number): Point3D =>
    add(from, add(scale(forward, f), add(scale(right, r), scale(UP, u))));

  // Hips: at the authored horizontal body position, at standing height
  // plus rise (less tango's knee flex) unless the legs can't reach their
  // feet from there.
  const weight = bodyPosition(pose);
  const pelvisFloor = vec(weight.x, weight.y, 0);
  const leg = body.thigh + body.shin - KNEE_SLACK;
  // The pelvis turns with contra body movement (cbmTurn): the hip joints
  // lie across the pelvis's own facing, not the body's.
  const hipFacing = pose.orientation + cbmShare * cbmTurn(pose);
  const hipAcross = headingVector(hipFacing + 90);
  const hipJointFloor = (side: Foot) =>
    add(
      pelvisFloor,
      scale(hipAcross, (side === "left" ? -1 : 1) * (body.hipWidth / 2)),
    );
  const standing =
    standingHipHeight(body) +
    pose.rise -
    (hold === "tango" ? TANGO_KNEE_FLEX : 0);

  // Feet: the model's foot position is the middle of the foot (as the
  // 2D view draws it). With a rise the heel lifts and the ball stays on
  // the floor. A foot losing its weight may also peel to reach further
  // (gradually as its weight falls from half to a quarter, fully below
  // that, so the hips don't jump as the weight passes): beside or behind the body its heel lifts,
  // rolling over the ball (a back foot released as the weight goes
  // forward, or a free foot resting on its ball); well in front (more
  // than half a foot ahead of the hips) its toes lift, rolling back on
  // the heel (a heel lead). It peels only
  // as far as its leg needs to reach the hips at standing height, up to
  // MAX_PEEL_DEGREES. A foot landing with footwork is tipped by its
  // pitch first (FootState.pitch: toes up for a heel lead, heel up for a
  // toe lead), and any further peel rolls it the same way. A standing
  // foot otherwise stays flat (apart from the rise).
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
    // Rolling the foot over its ball (lifting the heel) or back on its
    // heel (lifting the toes) by `degrees`, in the vertical plane along
    // the foot.
    const roll = (overBall: boolean, degrees: number) => {
      const pivot = overBall ? ball : heel;
      const angle = ((degrees * Math.PI) / 180) * (overBall ? 1 : -1);
      const turn = (point: Point3D) => {
        const offset = sub(point, pivot);
        const f = offset.x * toes.x + offset.y * toes.y;
        // A rotation in the (toes, up) plane by `angle` towards the
        // heel: a point behind the pivot goes up.
        const fNew = f * Math.cos(angle) + offset.z * Math.sin(angle);
        const zNew = -f * Math.sin(angle) + offset.z * Math.cos(angle);
        return add(pivot, add(scale(toes, fNew), vec(0, 0, zNew)));
      };
      return {
        ankle: turn(ankle),
        ball: turn(ball),
        ends: { heel: turn(heel), toeTip: turn(toeTip) },
      };
    };

    // A foot landing with footwork (FootState.pitch, from footPitchAt)
    // is tipped as it lands: positive lifts the toes (a heel lead),
    // negative the heel (a toe lead).
    const pitch = pose[side].pitch ?? 0;
    const overBallForPitch = pitch < 0;
    const landing =
      pitch === 0
        ? { ankle, ball, ends: { heel, toeTip } }
        : roll(overBallForPitch, Math.abs(pitch));
    // How far this foot may peel grows as its weight goes: not at all
    // while it carries half the weight or more (so a foot shared evenly
    // stays flat), fully once it carries a quarter or less, and
    // gradually between, so the hips don't jump as the weight passes.
    const freedom = smoothstep(0.5, 0.25, pose[side].weight);
    if (freedom <= 0) return landing;

    const hip = add(hipJointFloor(side), vec(0, 0, standing));
    const reaches = (point: Point3D) =>
      Math.hypot(point.x - hip.x, point.y - hip.y, point.z - hip.z) <= leg;
    if (reaches(landing.ankle)) return landing;
    // Which end the foot rolls over to reach further: the one its
    // footwork tips it over, or without footwork the heel if the foot is
    // well in front of the hips (a heel lead), otherwise the ball. Near
    // that boundary (within PEEL_BLEND of half a foot ahead) the foot is
    // a blend of the two rolls, so a free foot out to the side, which the
    // body's turn carries across the boundary, doesn't flip from heel up
    // to toes up in one frame (and the hips with it).
    const peel = (overBall: boolean) => {
      let low = Math.abs(pitch);
      let high = Math.max(MAX_PEEL_DEGREES * freedom, low);
      if (!reaches(roll(overBall, high).ankle)) return roll(overBall, high);
      for (let i = 0; i < 30; i++) {
        const mid = (low + high) / 2;
        if (reaches(roll(overBall, mid).ankle)) high = mid;
        else low = mid;
      }
      return roll(overBall, high);
    };
    if (pitch !== 0) return peel(overBallForPitch);
    const ahead =
      (middle.x - pelvisFloor.x) * forward.x +
      (middle.y - pelvisFloor.y) * forward.y;
    const onHeel = smoothstep(
      body.footLength / 2 - PEEL_BLEND,
      body.footLength / 2 + PEEL_BLEND,
      ahead,
    );
    if (onHeel <= 0) return peel(true);
    if (onHeel >= 1) return peel(false);
    const ballRoll = peel(true);
    const heelRoll = peel(false);
    return {
      ankle: lerp3(ballRoll.ankle, heelRoll.ankle, onHeel),
      ball: lerp3(ballRoll.ball, heelRoll.ball, onHeel),
      ends: {
        heel: lerp3(ballRoll.ends.heel, heelRoll.ends.heel, onHeel),
        toeTip: lerp3(ballRoll.ends.toeTip, heelRoll.ends.toeTip, onHeel),
      },
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
    hipFacing: normalizeDegrees(hipFacing),
    chestFacing: pose.orientation,
    hipDrop: standing - hipZ,
    legShortfall,
    kneeSwing: { left: 0, right: 0 },
    fingertips: { left: leftArm.fingertip, right: rightArm.fingertip },
    palms: { left: leftArm.palm, right: rightArm.palm },
    grips: { left: 0, right: 0 },
  };
}

/**
 * How the couple's hold is shaped (metres). Standard ballroom closed
 * hold, as commonly taught; the exact distances are provisional
 * judgement calls (2026-11-17):
 * - joinedOut: how far the joined hands (his left, her right) are out
 *   beyond the point between those two shoulders, away from the middle of
 *   the couple. In closed hold that is out to his left; in promenade it
 *   is towards the open side of the V, the way the couple travels.
 * - joinedAboveHead: the joined hands' height above the base of the
 *   follow's skull, about her eye level.
 * - PALM: how far each wrist stops short of the point where the hands
 *   meet, so the two hands sit palm to palm rather than inside each other.
 *   2.5 cm each: about half a hand's thickness, so the palms touch.
 * - The lead's right hand on her left shoulder blade: bladeBehind behind
 *   her left shoulder joint, bladeIn towards her spine, bladeDown below
 *   it. That is the wrist, at the outer edge of the blade, so the hand
 *   laid across her back (HAND_DOWN) ends near her spine.
 * - The follow's left hand on his right upper arm: upperArmAlong of the
 *   way from his shoulder to his elbow, resting on top (upperArmAbove).
 *   That is her wrist; her hand lies on along his arm from there, so the
 *   fingers reach his shoulder, not past it.
 * - His right elbow and her left elbow (`arms`): his upper arm wraps
 *   round her side under her left arm, and her left arm lies along the
 *   top of his, her elbow resting above his, as the closed hold is
 *   commonly taught. The standard hold carries his elbow higher than
 *   tango's, for its wider frame. Bent out and down to their own side
 *   instead, both elbows would aim at the same spot on the closed side
 *   of a promenade, and his arm would pass into her chest.
 *
 * These place the wrists and aim the elbows; which way each hand then
 * points is set in connectHold (and HAND_DOWN, OVER_HIS_ARM below).
 *
 * Ballroom tango's hold (HoldKind "tango") is more compact, as commonly
 * taught: the joined hands lower (about her chin) and drawn in, so his
 * left elbow bends more; his right hand further round her back and a
 * little lower; his right arm passing under her left arm; and her left
 * arm lying along the top of his, her hand round the back of his upper
 * arm (`underArm`), palm down, rather than resting on top of it. The
 * owner confirmed the arms against published descriptions of the tango
 * hold. The distances are provisional judgement calls.
 */
interface HoldPlacement {
  joinedOut: number;
  joinedAboveHead: number;
  bladeBehind: number;
  bladeIn: number;
  bladeDown: number;
  upperArmAlong: number;
  upperArmAbove: number;
  /** Her left hand under his upper arm, behind it by this much (tango),
   *  rather than on top of it (0). */
  underArm: number;
  /**
   * Where the elbows of his right arm and her left arm bend to: his
   * right elbow aims `armpitOut` out to her left of her left shoulder
   * joint and `armpitDown` below it, beside her armpit; her left elbow
   * aims `herElbowAbove` above his. These aim the elbows (solveArm's
   * `bend`) rather than place them: each elbow still lies where the arm
   * reaches its hand.
   */
  arms: { armpitOut: number; armpitDown: number; herElbowAbove: number };
  /**
   * The joined hands never come so close to his left shoulder or her
   * right that the elbow would bend tighter than this, in degrees
   * between upper arm and forearm (180: straight). Where they would, as
   * where her right shoulder comes close beside his left in promenade or
   * with her outside, the hands move further out (see connectHold). Each
   * value is about the elbow's bend in that style's closed hold, so
   * closed hold keeps its shape. Provisional.
   */
  joinedMinElbow: number;
}
const HOLD_PLACEMENT: Record<HoldKind, HoldPlacement> = {
  standard: {
    joinedOut: 0.2,
    joinedAboveHead: 0.06,
    bladeBehind: 0.06,
    bladeIn: 0.02,
    bladeDown: 0.12,
    upperArmAlong: 0.6,
    upperArmAbove: 0.05,
    underArm: 0,
    arms: { armpitOut: 0.15, armpitDown: 0.1, herElbowAbove: 0.07 },
    joinedMinElbow: 45,
  },
  tango: {
    joinedOut: 0.12,
    joinedAboveHead: -0.03,
    bladeBehind: 0.07,
    bladeIn: 0.08,
    bladeDown: 0.16,
    upperArmAlong: 0.5,
    upperArmAbove: 0.02,
    underArm: 0.07,
    arms: { armpitOut: 0.15, armpitDown: 0.14, herElbowAbove: 0.06 },
    joinedMinElbow: 30,
  },
};
const PALM = 0.025;

/** How far the wrist is from the shoulder joint when the elbow bends to
 *  `elbow` degrees between upper arm and forearm (law of cosines). */
function reachAtElbow(body: BodyProportions, elbow: number): number {
  const { upperArm: u, forearm: f } = body;
  return Math.sqrt(
    u * u + f * f - 2 * u * f * Math.cos((elbow * Math.PI) / 180),
  );
}

/**
 * How far `point` must move along the horizontal unit vector `direction`
 * to be at least `least` from `from` and stay so as it moves on: 0 if it
 * already is. A point behind `from` (along `direction`) also moves at
 * least level with it; without that, the move would jump from nothing
 * to across `from` as the point's distance fell to `least`.
 */
function pushFrom(
  point: Point3D,
  direction: Point3D,
  from: Point3D,
  least: number,
): number {
  const offset = sub(point, from);
  const along = dot(offset, direction);
  const short = dot(offset, offset) - least * least;
  return Math.max(0, -along + Math.sqrt(Math.max(0, along * along - short)));
}

/**
 * How far ballroom tango's posture lowers the hips below standing
 * height, in metres: the knees stay slightly flexed throughout, with no
 * rise. Owner's choice of a slight flex (about 4 cm). It moves the
 * standing height itself, so hipDrop still measures only the extra
 * lowering a leg needs to reach its foot.
 */
export const TANGO_KNEE_FLEX = 0.04;
/**
 * Which way the lead's right hand points on her back: across it towards
 * her spine (her right, level with her back), tilted HAND_DOWN downwards
 * for each metre across. A provisional judgement call (2026-11-17),
 * matching the usual description of the hold: hand on the shoulder
 * blade, fingers together, pointing towards her spine and a little
 * down.
 */
const HAND_DOWN = 0.3;
/** How far the follow's left hand tips out to his right and down, over
 *  the outside of his arm, for each metre it points along his upper arm
 *  towards his shoulder. With her wrist upperArmAlong down his arm,
 *  this puts her fingertips about 5 cm from the line of his upper arm
 *  (on its surface) at his shoulder, in closed hold and promenade.
 *  Provisional (2026-11-17). */
const OVER_HIS_ARM = 0.2;
/**
 * The joined hands' clasp. JOINED_CROSS (radians) is how far each hand
 * leans from upright, his out away from the couple and hers in towards
 * it, so the hands cross a little rather than lying finger on finger and
 * her fingers come over the web of his thumb. JOINED_GRIP is how far the
 * fingers close round the other hand, and RESTING_GRIP how far a hand
 * resting on the partner (his on her back, hers on his arm) curves to
 * them. Provisional judgement calls (2026-11-17), from the usual
 * description of the hold: her right hand in his left, palms together,
 * his fingers closing gently round her hand.
 */
const JOINED_CROSS = (20 * Math.PI) / 180;
const JOINED_GRIP = 0.6;
const RESTING_GRIP = 0.15;

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
 *  reach. `shape` is how the hand is held while it holds: the way it
 *  points, the way its palm faces and its grip. As the arm lets go the
 *  hand turns back to the free hand's shape (pointing straight on from
 *  the forearm, palm in, open), by the same amount as the wrist, and an
 *  elbow aimed at the partner (`elbowTowards`) back to bending out and
 *  down. */
function reachFor(
  skeleton: PartnerSkeleton,
  side: Foot,
  target: Point3D,
  shape: HandShape,
  body: BodyProportions,
  elbowTowards?: Point3D,
): PartnerSkeleton {
  const shoulder = skeleton.joints[`${side}UpperArm`];
  const solo = skeleton.joints[`${side}Hand`];
  const arm = body.upperArm + body.forearm;
  const away = Math.hypot(...Object.values(sub(target, shoulder)));
  const holding =
    1 - smoothstep(HOLD_LETS_GO_FROM * arm, HOLD_LET_GO_BY * arm, away);
  const wrist = lerp3(solo, target, holding);
  const { elbow, hand, fingertip, palm } = solveArm(
    shoulder,
    wrist,
    body,
    skeleton.chestFacing,
    side,
    elbowTowards && { towards: elbowTowards, amount: holding },
  );
  const free = sub(fingertip, hand);
  const held = scale(normalize(shape.fingers) ?? free, body.hand);
  const pointing =
    normalize(lerp3(free, held, holding)) ?? scale(free, 1 / body.hand);
  const facing =
    square(lerp3(palm, normalize(shape.palm) ?? palm, holding), pointing) ??
    square(palm, pointing) ??
    palm;
  return {
    ...skeleton,
    joints: {
      ...skeleton.joints,
      [`${side}LowerArm`]: elbow,
      [`${side}Hand`]: hand,
    },
    fingertips: {
      ...skeleton.fingertips,
      [side]: add(hand, scale(pointing, body.hand)),
    },
    palms: { ...skeleton.palms, [side]: facing },
    grips: { ...skeleton.grips, [side]: shape.grip * holding },
  };
}

/** Where the lead's right hand holds: the follow's left shoulder blade
 *  (HoldPlacement's blade distances, in her chest's frame). */
function herBlade(follow: PartnerSkeleton, place: HoldPlacement): Point3D {
  const herForward = headingVector(follow.chestFacing);
  const herRight = headingVector(follow.chestFacing + 90);
  return add(
    follow.joints.leftUpperArm,
    add(
      scale(herForward, -place.bladeBehind),
      add(
        scale(herRight, place.bladeIn),
        scale(vec(0, 0, 1), -place.bladeDown),
      ),
    ),
  );
}

/**
 * The lead's upper body turning towards the follow, from the chest up.
 *
 * His right hand holds her left shoulder blade. Where she comes level
 * with his right side or passes behind it (count 2 of the Open Natural
 * Turn, the Weave and the Promenade Walk and Close, as she turns out of
 * promenade), that blade is behind his right shoulder, and an upper body
 * kept square to his feet would have to swing the upper arm far back
 * behind it, up to about 80 degrees. A dancer turns the upper body to
 * the right with her instead, keeping her in front of the frame.
 *
 * So his chest, shoulders, head and arms turn right about the vertical
 * through his chest, the smallest turn that brings her blade level with
 * his right shoulder joint along the way his chest faces
 * (BLADE_BEHIND_SHOULDER), up to MAX_UPPER_BODY_TURN. The hips and legs
 * stay as the dance model put them; the twist is in the spine between
 * them. With her in front, as in closed hold and most of promenade,
 * nothing turns. Provisional.
 */
export const MAX_UPPER_BODY_TURN = 45;
/** How far behind his right shoulder joint her blade may be before his
 *  upper body turns, in metres along his chest's facing. Provisional:
 *  level with it keeps the upper arm within about 45 degrees behind the
 *  body. */
const BLADE_BEHIND_SHOULDER = -0.05;

/**
 * How far in front of her left shoulder joint, along the way her chest
 * faces, the follow's left hand must rest on the lead's upper arm, in
 * metres. Her hand usually rests part way down his upper arm
 * (HoldPlacement.upperArmAlong); where that is behind her, because she
 * is level with his right side and his upper arm reaches back round her
 * (as after his upper body turns, upperBodyTurn), reaching it would
 * swing her upper arm about 60 degrees behind her body. Her hand slides
 * up his arm towards his shoulder instead, as far as needed. Provisional.
 */
const HAND_AHEAD_OF_SHOULDER = 0.05;

/**
 * The tightest the follow's left elbow bends, in degrees between upper
 * arm and forearm, with her hand resting on the lead's arm. His right
 * shoulder is only about 25 cm from her left in closed hold, and less in
 * promenade, so her hand at its usual place part way down his upper arm
 * (HoldPlacement.upperArmAlong) can fold her arm almost shut. Where it
 * would, her hand rests further up his arm, towards his shoulder, so her
 * elbow keeps this bend and her arm lies along the top of his. Where even
 * his shoulder is too near hers, as she passes level with his right side
 * (count 2 of the Weave), the hand goes on over his shoulder onto the top
 * of his back, up to ONTO_HIS_BACK behind it. Provisional.
 */
const HER_LEFT_MIN_ELBOW = 45;
const ONTO_HIS_BACK = 0.2;

/** The way fingers point when a hand lies along a body: from the point
 *  `from` metres along `path` (a polyline, here up his arm and over his
 *  shoulder) to the point a hand's length further on, so the fingers
 *  follow the path round a bend. Past the path's end, the last
 *  segment's direction. */
function fingersAlong(
  path: Point3D[],
  from: number,
  handLength: number,
): Point3D {
  const at = (arc: number): Point3D => {
    let left = arc;
    for (let i = 0; i + 1 < path.length; i++) {
      const piece = distance(path[i], path[i + 1]);
      if (left <= piece || i + 2 === path.length) {
        return lerp3(path[i], path[i + 1], piece > 1e-9 ? left / piece : 0);
      }
      left -= piece;
    }
    return path[path.length - 1];
  };
  return (
    normalize(sub(at(from + handLength), at(from))) ??
    normalize(sub(path[path.length - 1], path[path.length - 2])) ??
    vec(0, 0, 1)
  );
}

/** The joints that turn with the upper body: the chest and everything
 *  above it. */
const TURNING: readonly JointName[] = [
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

/** `v` turned clockwise (as compass headings turn) about the vertical by
 *  `degrees`. */
function turnedClockwise(v: Point3D, degrees: number): Point3D {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r),
    s = Math.sin(r);
  return vec(v.x * c + v.y * s, -v.x * s + v.y * c, v.z);
}

/** The skeleton with its chest and everything above it turned clockwise
 *  by `degrees` about the vertical through the chest. */
function turnUpperBody(
  skeleton: PartnerSkeleton,
  degrees: number,
): PartnerSkeleton {
  if (degrees === 0) return skeleton;
  const axis = skeleton.joints.chest;
  const about = (point: Point3D) =>
    add(axis, turnedClockwise(sub(point, axis), degrees));
  const joints = { ...skeleton.joints };
  for (const name of TURNING) joints[name] = about(joints[name]);
  return {
    ...skeleton,
    joints,
    chestFacing: normalizeDegrees(skeleton.chestFacing + degrees),
    fingertips: {
      left: about(skeleton.fingertips.left),
      right: about(skeleton.fingertips.right),
    },
    palms: {
      left: turnedClockwise(skeleton.palms.left, degrees),
      right: turnedClockwise(skeleton.palms.right, degrees),
    },
  };
}

/** How far, in degrees clockwise, the lead's upper body turns towards
 *  the follow (see MAX_UPPER_BODY_TURN): the smallest turn that brings
 *  her blade no further back than BLADE_BEHIND_SHOULDER, found to a
 *  hundredth of a degree, or the most it may turn. */
function upperBodyTurn(
  lead: PartnerSkeleton,
  follow: PartnerSkeleton,
  place: HoldPlacement,
): number {
  const blade = herBlade(follow, place);
  const axis = lead.joints.chest;
  const shoulder = sub(lead.joints.rightUpperArm, axis);
  const ahead = (degrees: number) =>
    dot(
      sub(blade, add(axis, turnedClockwise(shoulder, degrees))),
      headingVector(lead.chestFacing + degrees),
    ) + BLADE_BEHIND_SHOULDER;
  if (ahead(0) >= 0) return 0;
  let low = 0;
  for (let degrees = 1; degrees <= MAX_UPPER_BODY_TURN; degrees++) {
    if (ahead(degrees) >= 0) {
      let high = degrees;
      while (high - low > 0.01) {
        const mid = (low + high) / 2;
        if (ahead(mid) >= 0) high = mid;
        else low = mid;
      }
      return high;
    }
    low = degrees;
  }
  return MAX_UPPER_BODY_TURN;
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
  hold: HoldKind = "standard",
): CoupleSkeleton {
  const UP = vec(0, 0, 1);
  const place = HOLD_PLACEMENT[hold];
  const middle = scale(add(lead.joints.hips, follow.joints.hips), 0.5);

  // The joined hands: out beyond the point between his left shoulder and
  // her right, away from the middle of the couple.
  const hisShoulder = lead.joints.leftUpperArm;
  const herShoulder = follow.joints.rightUpperArm;
  const between = scale(add(hisShoulder, herShoulder), 0.5);
  const outward =
    normalize(vec(between.x - middle.x, between.y - middle.y, 0)) ??
    scale(headingVector(lead.chestFacing + 90), -1);
  const placed = {
    ...add(between, scale(outward, place.joinedOut)),
    z: follow.joints.head.z + place.joinedAboveHead,
  };
  // Further out where either shoulder is too close for a natural bend
  // of the elbow (place.joinedMinElbow), as where her right shoulder
  // comes close beside his left: square to the line between the two
  // shoulders, on the outward side, which is where both arms reach with
  // that bend. Pushed straight outward instead, the hands could end up
  // beside both shoulders, with the two forearms coming from the same
  // side and passing through each other.
  const across = sub(herShoulder, hisShoulder);
  const squareTo = normalize(vec(across.y, -across.x, 0)) ?? outward;
  const clear = dot(squareTo, outward) < 0 ? scale(squareTo, -1) : squareTo;
  const joinedOut = Math.max(
    pushFrom(
      placed,
      clear,
      hisShoulder,
      reachAtElbow(bodies.lead, place.joinedMinElbow) + PALM,
    ),
    pushFrom(
      placed,
      clear,
      herShoulder,
      reachAtElbow(bodies.follow, place.joinedMinElbow) + PALM,
    ),
  );
  const joined = add(placed, scale(clear, joinedOut));
  const palmShort = (shoulder: Point3D) =>
    add(joined, scale(normalize(sub(shoulder, joined)) ?? UP, PALM));

  // His right hand on her left shoulder blade.
  const herForward = headingVector(follow.chestFacing);
  const herRight = headingVector(follow.chestFacing + 90);
  const blade = herBlade(follow, place);

  // How each hand is held:
  // - The joined hands (his left, her right) clasp, palm to palm: his
  //   palm faces her hand and hers faces his. Both point upwards, crossed
  //   a little (JOINED_CROSS) -- his fingers lean out away from the
  //   couple, hers in over the web of his thumb -- and close round each
  //   other (JOINED_GRIP), so his fingers wrap the back of her hand and
  //   hers lie over his.
  // - His right hand lies flat on her back, palm on her (facing the way
  //   she faces), fingers towards her spine and a little down.
  // - Her left hand lies along his upper arm, palm down on it, fingers
  //   towards his shoulder, tipped a little out and down over the outside
  //   of it (OVER_HIS_ARM), so the fingertips rest on the cap of his
  //   shoulder, slightly cupped round it (RESTING_GRIP). Pointed out to
  //   his side instead, the hand stuck out past his arm into the air.
  const hisJoined = palmShort(hisShoulder);
  const herJoined = palmShort(herShoulder);
  const towardsHer = normalize(sub(herJoined, hisJoined)) ?? herForward;
  const lean = (sign: number) =>
    add(
      scale(UP, Math.cos(JOINED_CROSS)),
      scale(outward, sign * Math.sin(JOINED_CROSS)),
    );
  const acrossHerBack = add(herRight, scale(UP, -HAND_DOWN));

  let him = reachFor(
    lead,
    "left",
    hisJoined,
    { fingers: lean(1), palm: towardsHer, grip: JOINED_GRIP },
    bodies.lead,
  );
  // His right elbow goes out beside her left armpit, so the upper arm
  // wraps round her side under her arm (place.arms).
  const herLeft = headingVector(follow.chestFacing - 90);
  const besideHerArmpit = add(
    follow.joints.leftUpperArm,
    add(
      scale(herLeft, place.arms.armpitOut),
      scale(UP, -place.arms.armpitDown),
    ),
  );
  him = reachFor(
    him,
    "right",
    blade,
    { fingers: acrossHerBack, palm: herForward, grip: RESTING_GRIP },
    bodies.lead,
    besideHerArmpit,
  );

  // Her left hand on his right upper arm, where his arm now is: on top
  // of it, or in tango under it, behind the arm with the fingers along
  // its back towards his shoulder and the palm down.
  const hisBack = scale(headingVector(him.chestFacing), -1);
  // Up his arm towards his shoulder where the usual place would be
  // behind her (HAND_AHEAD_OF_SHOULDER).
  const aheadOfHer = (point: Point3D) =>
    dot(sub(point, follow.joints.leftUpperArm), herForward) -
    HAND_AHEAD_OF_SHOULDER;
  const atShoulder = aheadOfHer(him.joints.rightUpperArm);
  const atElbow = aheadOfHer(him.joints.rightLowerArm);
  const usual = atShoulder + (atElbow - atShoulder) * place.upperArmAlong;
  const along =
    usual >= 0
      ? place.upperArmAlong
      : atShoulder > 0
        ? atShoulder / (atShoulder - atElbow)
        : 0;
  // No nearer her own shoulder than a natural bend of her elbow allows
  // (HER_LEFT_MIN_ELBOW): further up his arm, and past his shoulder onto
  // the top of his back (ONTO_HIS_BACK) where even his shoulder is too
  // near hers.
  const restAt = (t: number) =>
    add(
      t >= 0
        ? lerp3(him.joints.rightUpperArm, him.joints.rightLowerArm, t)
        : add(him.joints.rightUpperArm, scale(hisBack, -t * ONTO_HIS_BACK)),
      add(scale(UP, place.upperArmAbove), scale(hisBack, place.underArm)),
    );
  const least = reachAtElbow(bodies.follow, HER_LEFT_MIN_ELBOW);
  const farEnough = (t: number) =>
    distance(restAt(t), follow.joints.leftUpperArm) >= least;
  let rest = along;
  if (!farEnough(rest)) {
    let low = -1,
      high = rest;
    if (farEnough(low)) {
      for (let i = 0; i < 30; i++) {
        const mid = (low + high) / 2;
        if (farEnough(mid)) low = mid;
        else high = mid;
      }
    }
    rest = low;
  }
  const onHisArm = restAt(rest);
  // Her fingers point on up his arm from where the hand rests, bending
  // over the cap of his shoulder towards his neck where the hand is
  // within a hand's length of it (fingersAlong).
  const upHisArm = fingersAlong(
    [
      him.joints.rightLowerArm,
      him.joints.rightUpperArm,
      him.joints.rightShoulder,
      him.joints.neck,
    ],
    (1 - Math.max(0, rest)) *
      distance(him.joints.rightLowerArm, him.joints.rightUpperArm),
    bodies.follow.hand,
  );
  const overHisArm =
    place.underArm > 0
      ? add(upHisArm, scale(hisBack, 0.5))
      : add(
          upHisArm,
          scale(sub(headingVector(him.chestFacing + 90), UP), OVER_HIS_ARM),
        );
  let her = reachFor(
    follow,
    "right",
    herJoined,
    { fingers: lean(-1), palm: scale(towardsHer, -1), grip: JOINED_GRIP },
    bodies.follow,
  );
  her = reachFor(
    her,
    "left",
    onHisArm,
    { fingers: overHisArm, palm: scale(UP, -1), grip: RESTING_GRIP },
    bodies.follow,
    add(him.joints.rightLowerArm, scale(UP, place.arms.herElbowAbove)),
  );

  return { lead: him, follow: her };
}

/** The mannequin's pelvis capsule radius (the bar between the hip
 *  joints in scene3d.mts), in metres. */
export const PELVIS_RADIUS = 0.08;

/** The room between the partners' pelvis capsules, in metres: negative
 *  where they press into each other. */
function pelvisGap(couple: CoupleSkeleton): number {
  const his = couple.lead.joints,
    hers = couple.follow.joints;
  return (
    segmentDistance(
      his.leftUpperLeg,
      his.rightUpperLeg,
      hers.leftUpperLeg,
      hers.rightUpperLeg,
    ) -
    2 * PELVIS_RADIUS
  );
}

/** Both dancers' skeletons at one instant (for example a Pose from
 *  sequencePoseAtBeat), with the knees sliding past each other where
 *  the legs meet (slideKnees), the upper bodies opened apart
 *  (openUpperBodies) and his turned towards her (upperBodyTurn), in hold
 *  (connectHold), shaped for the given hold: ballroom tango's has its
 *  own arms and knee flex. */
export function solveSkeleton(
  pose: Pose,
  bodies: Record<Partner, BodyProportions> = DEFAULT_PROPORTIONS,
  hold: HoldKind = "standard",
): CoupleSkeleton {
  const solve = (cbmShare: number): CoupleSkeleton => ({
    lead: solvePartnerSkeleton(pose.lead, bodies.lead, "lead", hold, cbmShare),
    follow: solvePartnerSkeleton(
      pose.follow,
      bodies.follow,
      "follow",
      hold,
      cbmShare,
    ),
  });
  // Contra body movement turns each pelvis (cbmTurn), which can swing a
  // hip into the partner's where the hips are close, as in promenade.
  // Then both turns are scaled back, as little as needed, until the
  // pelvises are no deeper into each other than without it.
  let couple = solve(1);
  if (cbmTurn(pose.lead) !== 0 || cbmTurn(pose.follow) !== 0) {
    const pressed = pelvisGap(couple);
    if (pressed < 0) {
      const floor = Math.min(0, pelvisGap(solve(0)));
      if (pressed < floor) {
        let low = 0,
          high = 1;
        for (let i = 0; i < 12; i++) {
          const mid = (low + high) / 2;
          if (pelvisGap(solve(mid)) >= floor) low = mid;
          else high = mid;
        }
        couple = solve(low);
      }
    }
  }
  const legs = slideKnees(couple, legContactFor(hold));
  const opened = openUpperBodies(legs);
  const lead = turnUpperBody(
    opened.lead,
    upperBodyTurn(opened.lead, opened.follow, HOLD_PLACEMENT[hold]),
  );
  return connectHold(lead, opened.follow, bodies, hold);
}
