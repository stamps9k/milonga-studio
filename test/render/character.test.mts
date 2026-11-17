import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { stancePose } from "../../src/libs/dance/authoring.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import type { Point3D } from "../../src/libs/body/vector3.mts";
import { CharacterRig } from "../../src/libs/render/character.mts";
import { toThree } from "../../src/libs/render/scene3d.mts";

/**
 * A small stand-in for a real character model: the bones CharacterRig
 * drives, named and laid out like Quaternius's Unreal-style rigs (facing
 * +Z, left side on +X, Y up, a 0.88 m leg, arms out in a T-pose), with a
 * spine bone the arms hang from.
 */
function testModel(): THREE.Object3D {
  const make = (name: string, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    return b;
  };
  const armature = new THREE.Object3D();
  const pelvis = make("pelvis", 0, 0.95, 0);
  armature.add(pelvis);
  const spine = make("spine_03", 0, 0.5, 0);
  pelvis.add(spine);
  for (const [side, sign] of [
    ["l", 1],
    ["r", -1],
  ] as const) {
    const thigh = make(`thigh_${side}`, 0.1 * sign, 0.02, 0);
    const calf = make(`calf_${side}`, 0, -0.43, 0);
    const foot = make(`foot_${side}`, 0, -0.45, -0.02);
    const ball = make(`ball_${side}`, 0, -0.07, 0.14);
    const toeEnd = make(`ball_leaf_${side}`, 0, 0, 0.08);
    pelvis.add(thigh);
    thigh.add(calf);
    calf.add(foot);
    foot.add(ball);
    ball.add(toeEnd);
    const upperArm = make(`upperarm_${side}`, 0.2 * sign, 0, 0);
    const lowerArm = make(`lowerarm_${side}`, 0.27 * sign, 0, 0);
    const hand = make(`hand_${side}`, 0.24 * sign, 0, 0);
    const middle = make(`middle_01_${side}`, 0.1 * sign, 0, 0.01);
    spine.add(upperArm);
    upperArm.add(lowerArm);
    lowerArm.add(hand);
    hand.add(middle);
  }
  return armature;
}

function at(rig: CharacterRig, name: string): THREE.Vector3 {
  const object = rig.object.getObjectByName(name);
  assert.ok(object, name);
  return object.getWorldPosition(new THREE.Vector3());
}

function assertNear(actual: THREE.Vector3, floor: Point3D, tolerance = 1e-6) {
  const expected = new THREE.Vector3(...toThree(floor));
  assert.ok(
    actual.distanceTo(expected) < tolerance,
    `expected ${expected.toArray()}, got ${actual.toArray()}`,
  );
}

function posed(pose: Pose) {
  const rig = new CharacterRig(testModel(), DEFAULT_PROPORTIONS.lead);
  const skeleton = solveSkeleton(pose).lead;
  rig.pose(skeleton);
  return { rig, skeleton };
}

test("CharacterRig: the model is scaled so its leg is as long as the dancer's", () => {
  const rig = new CharacterRig(testModel(), DEFAULT_PROPORTIONS.lead);
  const { thigh, shin } = DEFAULT_PROPORTIONS.lead;
  const modelLeg = 0.43 + Math.hypot(0.45, 0.02);
  assert.ok(Math.abs(rig.object.scale.x - (thigh + shin) / modelLeg) < 1e-9);
});

test("CharacterRig: hip joints on the hips, ankles on the ankles, toes on the toes", () => {
  const { rig, skeleton } = posed(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  const hips = at(rig, "thigh_l").add(at(rig, "thigh_r")).multiplyScalar(0.5);
  assertNear(hips, skeleton.joints.hips);
  assertNear(at(rig, "foot_l"), skeleton.joints.leftFoot);
  assertNear(at(rig, "foot_r"), skeleton.joints.rightFoot);
  // The model's foot is its own length, so the ball of its foot points
  // at our toes rather than sitting on them.
  const ankle = at(rig, "foot_l");
  const toward = new THREE.Vector3(...toThree(skeleton.joints.leftToes))
    .sub(ankle)
    .normalize();
  const ball = at(rig, "ball_l").sub(ankle).normalize();
  assert.ok(ball.angleTo(toward) < 1e-6);
  assertNear(at(rig, "hand_l"), skeleton.joints.leftHand);
  assertNear(at(rig, "hand_r"), skeleton.joints.rightHand);
});

test("CharacterRig: a long stride with the heel up, facing east, still lands the feet exactly", () => {
  // The lead mid-step: weight on the left foot, 0.5 east of the right,
  // facing east (90), risen 5 cm.
  const pose = stancePose("closed", { lead: "left", follow: "left" });
  pose.lead = {
    left: { position: { x: 0.5, y: 0.1 }, weight: 1 },
    right: { position: { x: 0, y: -0.1 }, weight: 0 },
    orientation: 90,
    rise: 0.05,
  };
  const { rig, skeleton } = posed(pose);
  assertNear(at(rig, "foot_l"), skeleton.joints.leftFoot);
  assertNear(at(rig, "foot_r"), skeleton.joints.rightFoot);
  // Facing east: the toes are east of the ankles (Three.js +x).
  assert.ok(at(rig, "ball_l").x > at(rig, "foot_l").x);
  // The knees bend forwards (east), not backwards.
  const hip = at(rig, "thigh_l");
  const ankle = at(rig, "foot_l");
  assert.ok(at(rig, "calf_l").x > (hip.x + ankle.x) / 2 - 1e-9);
});

test("CharacterRig: posing keeps the model's bone lengths and doesn't drift", () => {
  const { rig, skeleton } = posed(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  const scale = rig.object.scale.x;
  const length = (a: string, b: string) => at(rig, a).distanceTo(at(rig, b));
  assert.ok(Math.abs(length("thigh_l", "calf_l") - 0.43 * scale) < 1e-6);
  assert.ok(
    Math.abs(length("calf_l", "foot_l") - Math.hypot(0.45, 0.02) * scale) <
      1e-6,
  );
  assert.ok(Math.abs(length("upperarm_r", "lowerarm_r") - 0.27 * scale) < 1e-6);
  // Posing the same skeleton again gives exactly the same result.
  const before = at(rig, "calf_r").toArray();
  rig.pose(skeleton);
  rig.pose(skeleton);
  assert.deepEqual(at(rig, "calf_r").toArray(), before);
});

test("CharacterRig: the hands point at the skeleton's fingertips", () => {
  const { rig, skeleton } = posed(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  for (const side of ["l", "r"] as const) {
    const foot = side === "l" ? "left" : "right";
    const wrist = at(rig, `hand_${side}`);
    const toward = new THREE.Vector3(...toThree(skeleton.fingertips[foot]))
      .sub(wrist)
      .normalize();
    const finger = at(rig, `middle_01_${side}`).sub(wrist).normalize();
    assert.ok(finger.angleTo(toward) < 1e-6, `${side} hand`);
  }
});

test("CharacterRig: a model without the expected bones is refused with its name", () => {
  assert.throws(
    () => new CharacterRig(new THREE.Object3D(), DEFAULT_PROPORTIONS.lead),
    /no bone called "pelvis"/,
  );
});
