import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import { segmentDistance } from "../../src/libs/body/legContact.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import {
  CBM_REACH,
  CBM_TRACK,
  MAX_CBM_DEGREES,
  PELVIS_RADIUS,
  cbmTurn,
  solvePartnerSkeleton,
  solveSkeleton,
  type CoupleSkeleton,
} from "../../src/libs/body/skeleton.mts";
import { holdForStyle } from "../../src/libs/dance/authoring.mts";
import {
  figureDurationBeats,
  footEase,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import { normalizeDegrees } from "../../src/libs/dance/heading.mts";
import type { PartnerPose } from "../../src/libs/dance/pose.mts";

/** A dancer facing 0 (+y) with the left foot at `left` and the right at
 *  `right` ([x, y], x to the right), the weight between them. */
function dancer(
  left: [number, number],
  right: [number, number],
  orientation = 0,
): PartnerPose {
  return {
    left: { position: { x: left[0], y: left[1] }, weight: 0.5 },
    right: { position: { x: right[0], y: right[1] }, weight: 0.5 },
    orientation,
    rise: 0,
  };
}
const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const degrees = (radians: number) => (radians * 180) / Math.PI;

test("cbmTurn: feet apart as usual, standing or walking, leave the pelvis square", () => {
  assert.equal(cbmTurn(dancer([-0.1, 0], [0.1, 0])), 0);
  assert.equal(cbmTurn(dancer([-0.1, 0], [0.1, 0.5])), 0);
  assert.equal(cbmTurn(dancer([-0.06, 0.4], [0.06, 0])), 0);
});

test("cbmTurn: a foot forward across the other's track turns the pelvis towards it; back across, the other way", () => {
  // Right foot 40 cm ahead, 3 cm left of the left foot: 13 cm short of
  // tracking CBM_TRACK apart, over 40 cm.
  const expected = degrees(Math.atan2(CBM_TRACK + 0.03, 0.4));
  close(cbmTurn(dancer([0, 0], [-0.03, 0.4])), -expected);
  // The left foot forward across turns it the other way.
  close(cbmTurn(dancer([0.03, 0.4], [0, 0])), expected);
  // Back across: the right foot behind, across, turns it right.
  close(cbmTurn(dancer([0, 0], [-0.03, -0.4])), expected);
  // Measured in the dancer's own frame, whichever way they face.
  close(cbmTurn(dancer([0, 0], [-0.4, -0.03], 270)), -expected);
});

test("cbmTurn: grows smoothly from nothing as a crossed foot passes the other, and is capped", () => {
  let previous = cbmTurn(dancer([0, 0], [-0.05, -0.3]));
  for (let y = -0.3; y <= 0.3 + 1e-9; y += 0.001) {
    const turn = cbmTurn(dancer([0, 0], [-0.05, y]));
    // At most CBM_REACH's 45° over its 15 cm: 0.3° a millimetre.
    assert.ok(Math.abs(turn - previous) < 0.31, `jumps at ${y}`);
    if (Math.abs(y) < 1e-9) close(turn, 0);
    previous = turn;
  }
  assert.ok(Math.abs(cbmTurn(dancer([0, 0], [-0.05, CBM_REACH / 2]))) > 0);
  close(cbmTurn(dancer([0, 0], [-1, 0.2])), -MAX_CBM_DEGREES);
});

test("solvePartnerSkeleton: only the pelvis turns; the shoulders keep the body's facing", () => {
  const pose = dancer([0, 0], [-0.03, 0.4]);
  const square = solvePartnerSkeleton(
    pose,
    DEFAULT_PROPORTIONS.lead,
    "lead",
    "standard",
    0,
  );
  const turned = solvePartnerSkeleton(
    pose,
    DEFAULT_PROPORTIONS.lead,
    "lead",
    "standard",
  );
  close(
    normalizeDegrees(turned.hipFacing - turned.facing + 180) - 180,
    cbmTurn(pose),
  );
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    degrees(Math.atan2(b.y - a.y, b.x - a.x));
  close(
    line(turned.joints.leftUpperLeg, turned.joints.rightUpperLeg),
    -cbmTurn(pose),
    1e-6,
  );
  for (const joint of ["leftUpperArm", "rightUpperArm", "chest"] as const) {
    close(turned.joints[joint].x, square.joints[joint].x, 1e-6);
    close(turned.joints[joint].y, square.joints[joint].y, 1e-6);
  }
});

function pelvisGap(couple: CoupleSkeleton): number {
  const a = couple.lead.joints,
    b = couple.follow.joints;
  return (
    segmentDistance(
      a.leftUpperLeg,
      a.rightUpperLeg,
      b.leftUpperLeg,
      b.rightUpperLeg,
    ) -
    2 * PELVIS_RADIUS
  );
}

test("solveSkeleton: contra body movement never pushes the pelvises further into each other", () => {
  for (const figure of loadFigures()) {
    const f = {
      ...figure,
      id: figure.name,
      steps: figure.steps.map((step, i) => ({ ...step, id: String(i) })),
    };
    const hold = holdForStyle(f.style);
    for (const options of [{}, { footEasing: footEase }])
      for (let beat = 0; beat <= figureDurationBeats(f); beat += 1 / 64) {
        const pose = poseAtBeat(f, beat, options);
        const turned = pelvisGap(
          solveSkeleton(pose, DEFAULT_PROPORTIONS, hold),
        );
        const square = pelvisGap({
          lead: solvePartnerSkeleton(
            pose.lead,
            DEFAULT_PROPORTIONS.lead,
            "lead",
            hold,
            0,
          ),
          follow: solvePartnerSkeleton(
            pose.follow,
            DEFAULT_PROPORTIONS.follow,
            "follow",
            hold,
            0,
          ),
        });
        assert.ok(
          turned >= Math.min(0, square) - 1e-4,
          `${f.name} at ${beat}: ${turned} against ${square}`,
        );
      }
  }
});
