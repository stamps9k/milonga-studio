import { test } from "node:test";
import assert from "node:assert/strict";

import { segmentDistance } from "../../src/libs/body/legContact.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import {
  MAX_SHAPING,
  SHOULDER_ROOM,
  openUpperBodies,
} from "../../src/libs/body/shaping.mts";
import {
  solvePartnerSkeleton,
  solveSkeleton,
} from "../../src/libs/body/skeleton.mts";
import type { CoupleSkeleton } from "../../src/libs/body/skeleton.mts";
import { stancePose } from "../../src/libs/dance/authoring.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";

function apart(couple: CoupleSkeleton): number {
  const a = couple.lead.joints;
  const b = couple.follow.joints;
  return segmentDistance(
    a.leftUpperArm,
    a.rightUpperArm,
    b.leftUpperArm,
    b.rightUpperArm,
  );
}

function solved(pose: Pose): CoupleSkeleton {
  return {
    lead: solvePartnerSkeleton(
      pose.lead,
      DEFAULT_PROPORTIONS.lead,
      "lead",
      "tango",
    ),
    follow: solvePartnerSkeleton(
      pose.follow,
      DEFAULT_PROPORTIONS.follow,
      "follow",
      "tango",
    ),
  };
}

test("openUpperBodies: in closed hold the shoulders have room and nothing moves", () => {
  const couple = solved(
    stancePose("closed", { lead: "right", follow: "left" }, "tango"),
  );
  assert.ok(apart(couple) >= SHOULDER_ROOM);
  assert.deepEqual(openUpperBodies(couple), couple);
});

test("openUpperBodies: in tango promenade the upper bodies tilt apart from the hips", () => {
  const couple = solved(
    stancePose("tango promenade", { lead: "right", follow: "left" }, "tango"),
  );
  const before = apart(couple);
  assert.ok(before < SHOULDER_ROOM, `shoulders ${before} m apart`);
  const opened = openUpperBodies(couple);
  assert.ok(
    apart(opened) >= SHOULDER_ROOM - 0.005,
    `shoulders only ${apart(opened)} m apart`,
  );
  for (const partner of ["lead", "follow"] as const) {
    const was = couple[partner].joints;
    const now = opened[partner].joints;
    // Hips, legs and feet stay where they were; the upper body tilts.
    for (const joint of [
      "hips",
      "leftUpperLeg",
      "rightUpperLeg",
      "leftFoot",
      "rightFoot",
    ] as const)
      assert.deepEqual(now[joint], was[joint]);
    const shift = Math.hypot(now.neck.x - was.neck.x, now.neck.y - was.neck.y);
    assert.ok(shift > 0 && shift <= MAX_SHAPING * 1.2);
    // Heights barely change: a tilt, not a lift.
    assert.ok(Math.abs(now.neck.z - was.neck.z) < 1e-9);
  }
});

test("solveSkeleton: the shaping is part of the solved couple", () => {
  const pose = stancePose(
    "tango promenade",
    { lead: "right", follow: "left" },
    "tango",
  );
  const couple = solveSkeleton(pose, DEFAULT_PROPORTIONS, "tango");
  assert.ok(apart(couple) >= SHOULDER_ROOM - 0.02);
});
