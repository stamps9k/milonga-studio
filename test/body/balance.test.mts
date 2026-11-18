import { test } from "node:test";
import assert from "node:assert/strict";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { solvePartnerSkeleton } from "../../src/libs/body/skeleton.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import type { PartnerPose } from "../../src/libs/dance/pose.mts";

// Analytic fixtures isolate each diagnostic: ankles at z=.1, hips at z=.9,
// so the .8 m rise and tan(angle) give hand-checkable lateral distances.
function fixture(leftWeight = 1, rightWeight = 0) {
  const pose: PartnerPose = {
    left: { position: { x: 0, y: 0 }, weight: leftWeight },
    right: { position: { x: 0, y: 0 }, weight: rightWeight },
    orientation: 0,
    rise: 0,
  };
  const skeleton = solvePartnerSkeleton(pose, DEFAULT_PROPORTIONS.lead, "lead");
  skeleton.joints.hips = { x: 0, y: 0, z: 0.9 };
  for (const foot of ["left", "right"] as const) {
    skeleton.joints[`${foot}UpperLeg`] = { x: 0, y: 0, z: 0.9 };
    skeleton.joints[`${foot}Foot`] = { x: 0, y: 0, z: 0.1 };
  }
  return { pose, skeleton };
}
const atAngle = (degrees: number, height = 0.8) =>
  Math.tan((degrees * Math.PI) / 180) * height;

test("balance: pelvis support lean fails beyond 10 degrees on either side", () => {
  for (const sign of [-1, 1])
    for (const angle of [9.9, 10, 10.1, 30]) {
      const { pose, skeleton } = fixture();
      pose.bodyOffset = { x: sign * atAngle(angle), y: 0 };
      const result = assessLateralBalance(pose, skeleton);
      assert.ok(Math.abs(result.supportLeanDegrees - angle) < 1e-9);
      assert.equal(result.plausible, angle <= 10);
    }
});

test("balance: loaded leg inclination fails beyond 20 degrees on either side", () => {
  for (const sign of [-1, 1])
    for (const angle of [19.9, 20, 20.1, 40]) {
      const { pose, skeleton } = fixture();
      skeleton.joints.leftUpperLeg.x = sign * atAngle(angle);
      const result = assessLateralBalance(pose, skeleton);
      assert.ok(Math.abs(result.loadedLegLeanDegrees - angle) < 1e-9);
      assert.equal(result.plausible, angle <= 20);
    }
});

test("balance: free legs are ignored and split support uses RMS without cancellation", () => {
  const { pose, skeleton } = fixture();
  skeleton.joints.leftUpperLeg.x = atAngle(10);
  skeleton.joints.rightUpperLeg.x = -atAngle(30);
  assert.equal(assessLateralBalance(pose, skeleton).plausible, true);
  pose.left.weight = 0.5;
  pose.right.weight = 0.5;
  const split = assessLateralBalance(pose, skeleton);
  assert.ok(Math.abs(split.loadedLegLeanDegrees - Math.sqrt(500)) < 1e-9);
  assert.equal(split.plausible, false);
  // A smaller share on the inclined leg can be plausible during transfer.
  pose.left.weight = 0.8;
  pose.right.weight = 0.2;
  assert.equal(assessLateralBalance(pose, skeleton).plausible, true);
  pose.left.weight = 8;
  pose.right.weight = 2;
  assert.equal(assessLateralBalance(pose, skeleton).plausible, true);
  pose.left.weight = 0;
  pose.right.weight = 0;
  assert.equal(assessLateralBalance(pose, skeleton).supported, false);
  assert.equal(assessLateralBalance(pose, skeleton).plausible, false);
});

test("balance: displacement is measured from weighted support, not a fixed standing foot", () => {
  const { pose, skeleton } = fixture(0.5, 0.5);
  pose.left.position.x = -0.2;
  pose.right.position.x = 0.2;
  assert.equal(assessLateralBalance(pose, skeleton).supportLeanDegrees, 0);
  pose.left.weight = 1;
  pose.right.weight = 0;
  pose.bodyOffset = { x: 0.15, y: 0 };
  assert.equal(assessLateralBalance(pose, skeleton).plausible, false);
});

test("balance: height scales the allowance and lowering reduces it", () => {
  for (const height of [0.4, 0.8, 1.2]) {
    const { pose, skeleton } = fixture();
    skeleton.joints.hips.z = 0.1 + height;
    pose.bodyOffset = { x: atAngle(9.9, height), y: 0 };
    assert.equal(assessLateralBalance(pose, skeleton).plausible, true);
    skeleton.joints.hips.z = 0.1 + height * 0.9;
    assert.equal(assessLateralBalance(pose, skeleton).plausible, false);
  }
});

test("balance: floor rotation/translation preserve assessment and forward travel is separate", () => {
  const { pose } = fixture();
  pose.bodyOffset = { x: 0.06, y: 0.2 };
  const skeleton = solvePartnerSkeleton(pose, DEFAULT_PROPORTIONS.lead, "lead");
  const original = assessLateralBalance(pose, skeleton);
  const moved = applyTransform(
    { rotation: 123, position: { x: 4, y: -2 } },
    { lead: pose, follow: pose },
  ).lead;
  const actual = assessLateralBalance(
    moved,
    solvePartnerSkeleton(moved, DEFAULT_PROPORTIONS.lead, "lead"),
  );
  assert.ok(
    Math.abs(actual.supportLeanDegrees - original.supportLeanDegrees) < 1e-9,
  );
  assert.ok(
    Math.abs(actual.loadedLegLeanDegrees - original.loadedLegLeanDegrees) <
      1e-9,
  );
  const isolated = fixture();
  isolated.pose.bodyOffset = { x: 0, y: 0.5 };
  assert.ok(
    assessLateralBalance(isolated.pose, isolated.skeleton).supportLeanDegrees <
      1e-9,
  );
});

test("balance: an excessive real pelvis offset fails even though both legs still reach", () => {
  const { pose } = fixture(0, 1);
  pose.left.position.x = -0.1;
  pose.right.position.x = 0.1;
  pose.bodyOffset = { x: 0.2, y: 0 };
  const skeleton = solvePartnerSkeleton(pose, DEFAULT_PROPORTIONS.lead, "lead");
  assert.deepEqual(skeleton.legShortfall, { left: 0, right: 0 });
  assert.ok(skeleton.hipDrop < 0.16);
  assert.equal(assessLateralBalance(pose, skeleton).plausible, false);
});

test("balance: a pelvis at or below ankle height cannot count as balanced", () => {
  const { pose, skeleton } = fixture();
  skeleton.joints.hips.z = 0.1;
  skeleton.joints.leftUpperLeg.z = 0.1;
  const balance = assessLateralBalance(pose, skeleton);
  assert.equal(balance.supportLeanDegrees, 90);
  assert.equal(balance.loadedLegLeanDegrees, 90);
  assert.equal(balance.plausible, false);
});
