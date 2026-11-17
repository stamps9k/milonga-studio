import { test } from "node:test";
import assert from "node:assert/strict";

import { stancePose } from "../../src/libs/dance/authoring.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import type { PartnerPose } from "../../src/libs/dance/pose.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import {
  JOINT_NAMES,
  solvePartnerSkeleton,
  standingHipHeight,
  solveSkeleton,
} from "../../src/libs/body/skeleton.mts";
import type { PartnerSkeleton } from "../../src/libs/body/skeleton.mts";
import { distance, sub } from "../../src/libs/body/vector3.mts";

const LEAD = DEFAULT_PROPORTIONS.lead;

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

/** The bones keep their lengths, whatever the pose. */
function assertBoneLengths(skeleton: PartnerSkeleton) {
  const { joints } = skeleton;
  for (const side of ["left", "right"] as const) {
    close(
      distance(joints[`${side}UpperLeg`], joints[`${side}LowerLeg`]),
      LEAD.thigh,
    );
    close(
      distance(joints[`${side}LowerLeg`], joints[`${side}Foot`]),
      LEAD.shin,
    );
    close(
      distance(joints[`${side}UpperArm`], joints[`${side}LowerArm`]),
      LEAD.upperArm,
    );
    close(
      distance(joints[`${side}LowerArm`], joints[`${side}Hand`]),
      LEAD.forearm,
    );
  }
}

/** A lead standing with his feet at the given floor spots, facing north,
 *  with `weightLeft` of his weight on the left foot. */
function lead(
  left: [number, number],
  right: [number, number],
  weightLeft: number,
  rise = 0,
  orientation = 0,
): PartnerPose {
  return {
    left: { position: { x: left[0], y: left[1] }, weight: weightLeft },
    right: { position: { x: right[0], y: right[1] }, weight: 1 - weightLeft },
    orientation,
    rise,
  };
}

test("solvePartnerSkeleton: standing in closed stance, the legs are straight and the hips at standing height", () => {
  const skeleton = solvePartnerSkeleton(
    lead([-0.1, 0], [0.1, 0], 0.5),
    LEAD,
    "lead",
  );
  assert.deepEqual(Object.keys(skeleton.joints), [...JOINT_NAMES]);
  // The hips are at standing height, within a millimetre (the feet are
  // a touch wider than the hips).
  close(skeleton.joints.hips.z, standingHipHeight(LEAD), 1e-3);
  close(skeleton.hipDrop, 0, 1e-3);
  assert.deepEqual(skeleton.legShortfall, { left: 0, right: 0 });
  // Hips over the middle of the feet; head straight above.
  close(skeleton.joints.hips.x, 0);
  close(skeleton.joints.head.x, 0);
  close(
    skeleton.joints.head.z - skeleton.joints.hips.z,
    LEAD.headHeight - standingHipHeight(LEAD),
  );
  // Feet flat on the floor, the toes pointing north.
  close(skeleton.feet.left.heel.z, 0);
  close(skeleton.joints.leftToes.z, 0);
  assert.ok(skeleton.joints.leftToes.y > skeleton.joints.leftFoot.y);
  assertBoneLengths(skeleton);
});

test("solvePartnerSkeleton: knees bend forwards, the way the body faces", () => {
  // Lowered by a rise of -0.1 (a knee bend), facing east (90).
  const skeleton = solvePartnerSkeleton(
    lead([0, 0.1], [0, -0.1], 0.5, -0.1, 90),
    LEAD,
    "lead",
  );
  for (const side of ["left", "right"] as const) {
    const knee = skeleton.joints[`${side}LowerLeg`];
    const hip = skeleton.joints[`${side}UpperLeg`];
    const ankle = skeleton.joints[`${side}Foot`];
    // Facing east, the knee is east of the line from hip to ankle.
    assert.ok(knee.x > (hip.x + ankle.x) / 2 + 0.01);
  }
  assertBoneLengths(skeleton);
});

test("solvePartnerSkeleton: a rise lifts the body and the heels; the balls of the feet stay down", () => {
  const flat = solvePartnerSkeleton(
    lead([-0.1, 0], [0.1, 0], 0.5),
    LEAD,
    "lead",
  );
  const risen = solvePartnerSkeleton(
    lead([-0.1, 0], [0.1, 0], 0.5, 0.1),
    LEAD,
    "lead",
  );
  close(risen.joints.hips.z - flat.joints.hips.z, 0.1);
  close(risen.joints.head.z - flat.joints.head.z, 0.1);
  close(risen.feet.left.heel.z, 0.1);
  close(risen.joints.leftToes.z, 0);
  close(risen.feet.left.toeTip.z, 0);
});

test("solvePartnerSkeleton: in a long stride the back heel releases and the hips sink a little", () => {
  // All the weight on the left foot, 0.5 ahead of the right (a waltz
  // forward step just completed).
  const skeleton = solvePartnerSkeleton(
    lead([-0.1, 0.5], [0.1, 0], 1),
    LEAD,
    "lead",
  );
  // The back foot rolls onto its ball: heel up, ball down.
  assert.ok(skeleton.feet.right.heel.z > 0.05);
  close(skeleton.joints.rightToes.z, 0);
  // The standing foot stays flat.
  close(skeleton.feet.left.heel.z, 0);
  // The hips sink, but only a few centimetres.
  assert.ok(skeleton.hipDrop > 0 && skeleton.hipDrop < 0.1);
  assert.deepEqual(skeleton.legShortfall, { left: 0, right: 0 });
  // The legs still join hip and ankle with their own lengths.
  assertBoneLengths(skeleton);
});

test("solvePartnerSkeleton: a foot no leg can reach is reported, not hidden", () => {
  const skeleton = solvePartnerSkeleton(
    lead([-0.1, 0], [3, 0], 1),
    LEAD,
    "lead",
  );
  assert.ok(skeleton.legShortfall.right > 1);
  close(skeleton.legShortfall.left, 0);
});

test("solveSkeleton: placing a pose on the floor moves the skeleton with it", () => {
  // Closed hold, then the same pose turned a quarter right and moved:
  // every joint turns and moves the same way, so the solver works in
  // floor space with the model's heading convention.
  const pose = stancePose("closed", { lead: "right", follow: "left" });
  const transform = { position: { x: 2, y: 1 }, rotation: 90 };
  const here = solveSkeleton(pose);
  const there = solveSkeleton(applyTransform(transform, pose));
  for (const partner of ["lead", "follow"] as const) {
    for (const joint of JOINT_NAMES) {
      const a = here[partner].joints[joint];
      const b = there[partner].joints[joint];
      // Turning 90° clockwise takes (x, y) to (y, -x).
      close(b.x, a.y + 2, 1e-9);
      close(b.y, -a.x + 1, 1e-9);
      close(b.z, a.z, 1e-9);
    }
  }
});

test("solveSkeleton: in closed hold the partners face each other with the hold placeholder's hands", () => {
  const { lead: him, follow: her } = solveSkeleton(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  // The follow is in front of the lead (north of him), facing him.
  assert.ok(her.joints.hips.y > him.joints.hips.y);
  close(her.facing, 180);
  // His left hand is out to his left at about head height; his right
  // hand is in front of him, towards her back.
  assert.ok(him.joints.leftHand.x < him.joints.leftUpperArm.x - 0.1);
  assert.ok(him.joints.leftHand.z > him.joints.leftUpperArm.z);
  assert.ok(him.joints.rightHand.y > him.joints.chest.y + 0.2);
  // Each partner's joined hand is on the same side of the couple: his
  // left and her right are both west of the couple's middle.
  assert.ok(him.joints.leftHand.x < 0 && her.joints.rightHand.x < 0);
  // The elbows bend down, below the line from shoulder to hand.
  for (const skeleton of [him, her]) {
    for (const side of ["left", "right"] as const) {
      const shoulder = skeleton.joints[`${side}UpperArm`];
      const hand = skeleton.joints[`${side}Hand`];
      const elbow = skeleton.joints[`${side}LowerArm`];
      assert.ok(elbow.z < (shoulder.z + hand.z) / 2);
    }
  }
  // Her bones are her own (1.70 m), not his.
  const herThigh = sub(her.joints.leftUpperLeg, her.joints.leftLowerLeg);
  close(
    Math.hypot(herThigh.x, herThigh.y, herThigh.z),
    DEFAULT_PROPORTIONS.follow.thigh,
  );
});
