import { test } from "node:test";
import assert from "node:assert/strict";

import { applyTransform, fitTransform } from "../../src/libs/dance/floor.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { FloorTransform } from "../../src/libs/dance/sequence.mts";

interface PoseOverrides {
  leadLeft?: [number, number];
  leadRight?: [number, number];
  followLeft?: [number, number];
  followRight?: [number, number];
  leadOrientation?: number;
  followOrientation?: number;
}

function makePose(overrides: PoseOverrides = {}): Pose {
  const {
    leadLeft = [-0.1, 0],
    leadRight = [0.1, 0],
    followLeft = [-0.1, 0.3],
    followRight = [0.1, 0.3],
    leadOrientation = 0,
    followOrientation = 180,
  } = overrides;

  return {
    lead: {
      left: { position: { x: leadLeft[0], y: leadLeft[1] }, weight: 0.5 },
      right: { position: { x: leadRight[0], y: leadRight[1] }, weight: 0.5 },
      orientation: leadOrientation,
      rise: 0,
    },
    follow: {
      left: {
        position: { x: followLeft[0], y: followLeft[1] },
        weight: 0.5,
      },
      right: {
        position: { x: followRight[0], y: followRight[1] },
        weight: 0.5,
      },
      orientation: followOrientation,
      rise: 0,
    },
  };
}

function assertPoseClose(actual: Pose, expected: Pose, epsilon = 1e-6) {
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      const a = actual[partner][foot].position;
      const e = expected[partner][foot].position;
      assert.ok(
        Math.abs(a.x - e.x) < epsilon && Math.abs(a.y - e.y) < epsilon,
        `${partner}.${foot} position mismatch: got (${a.x}, ${a.y}), expected (${e.x}, ${e.y})`,
      );
    }
    const a = actual[partner].orientation;
    const e = expected[partner].orientation;
    assert.ok(
      Math.abs(a - e) < epsilon,
      `${partner} orientation mismatch: got ${a}, expected ${e}`,
    );
  }
}

test("applyTransform: identity transform leaves a pose unchanged", () => {
  const pose = makePose();
  const identity: FloorTransform = { position: { x: 0, y: 0 }, rotation: 0 };
  assertPoseClose(applyTransform(identity, pose), pose, 1e-9);
});

test("applyTransform: rotates positions and orientations, translates positions, leaves rise alone", () => {
  const pose = makePose();
  const transform: FloorTransform = {
    position: { x: 5, y: -3 },
    rotation: 90,
  };
  const result = applyTransform(transform, pose);

  // Compass-bearing rotation (0 = +Y/north, clockwise as degrees
  // increase): a 90-degree rotation sends (x, y) -> (y, -x), then
  // translate. See rotatePoint's doc comment in floor.mts.
  assert.ok(Math.abs(result.lead.left.position.x - (0 + 5)) < 1e-9);
  assert.ok(Math.abs(result.lead.left.position.y - (0.1 - 3)) < 1e-9);
  assert.ok(Math.abs(result.lead.orientation - 90) < 1e-9);
  assert.ok(Math.abs(result.follow.orientation - 270) < 1e-9);
  assert.equal(result.lead.rise, pose.lead.rise);
});

test("applyTransform: rotation convention matches Movement.direction (0 = +Y/north, 90 = +X/east, clockwise) -- pinned against the seeded Side Step figure's real values", () => {
  // Side Step: direction=90, distance=0.35 moves a foot from
  // (-0.1, 0) to (0.25, 0) -- i.e. purely +X, matching how the seeded
  // data actually behaves (see api/dances.mts figure 2 / db/seed.mts).
  const pose = makePose({ leadLeft: [0, 1] }); // (0, 1) = "north"
  const transform: FloorTransform = { position: { x: 0, y: 0 }, rotation: 90 };
  const result = applyTransform(transform, pose);

  assert.ok(Math.abs(result.lead.left.position.x - 1) < 1e-9); // -> "east"
  assert.ok(Math.abs(result.lead.left.position.y - 0) < 1e-9);
});

test("fitTransform: recovers a known transform exactly when poses are congruent", () => {
  const source = makePose();
  const knownTransform: FloorTransform = {
    position: { x: 12, y: -4 },
    rotation: 37,
  };
  const target = applyTransform(knownTransform, source);

  const fitted = fitTransform(source, target);

  assert.ok(Math.abs(fitted.rotation - knownTransform.rotation) < 1e-6);
  assert.ok(Math.abs(fitted.position.x - knownTransform.position.x) < 1e-6);
  assert.ok(Math.abs(fitted.position.y - knownTransform.position.y) < 1e-6);
  assertPoseClose(applyTransform(fitted, source), target);
});

test("fitTransform: identical source and target yield the identity transform", () => {
  const pose = makePose();
  const fitted = fitTransform(pose, pose);
  assert.ok(Math.abs(fitted.rotation) < 1e-9);
  assert.ok(Math.abs(fitted.position.x) < 1e-9);
  assert.ok(Math.abs(fitted.position.y) < 1e-9);
});

test("chaining: fitting a figure's startPose onto the previous entry's resolvedEndPose keeps the couple's position continuous", () => {
  const firstEnd = makePose({
    leadLeft: [0.4, 0.2],
    leadRight: [0.6, 0.2],
    followLeft: [0.4, 0.5],
    followRight: [0.6, 0.5],
    leadOrientation: 25,
    followOrientation: 205,
  });
  const firstResolvedEnd = applyTransform(
    { position: { x: 0, y: 0 }, rotation: 0 },
    firstEnd,
  );

  // The second figure's own local startPose happens to be firstEnd
  // shifted/rotated by some arbitrary local transform -- i.e. it's
  // authored to connect to the first figure, just not already sitting
  // at the same floor position.
  const localShift: FloorTransform = { position: { x: 3, y: 1 }, rotation: 60 };
  const secondStart = applyTransform(localShift, firstEnd);
  const secondEnd = applyTransform(
    localShift,
    makePose({
      leadLeft: [1, 1],
      leadRight: [1.2, 1],
      followLeft: [1, 1.3],
      followRight: [1.2, 1.3],
    }),
  );

  const secondTransform = fitTransform(secondStart, firstResolvedEnd);
  const secondResolvedStart = applyTransform(secondTransform, secondStart);
  const secondResolvedEnd = applyTransform(secondTransform, secondEnd);

  assertPoseClose(secondResolvedStart, firstResolvedEnd);
  // Sanity check it's a real, non-trivial transform and not a no-op.
  assert.ok(
    Math.abs(secondResolvedEnd.lead.left.position.x) > 1e-6 ||
      Math.abs(secondResolvedEnd.lead.left.position.y) > 1e-6,
  );
});

test("applyTransform: normalizes rotated orientations into [0, 360)", () => {
  // Lead faces 350, follow 170; a further 20 degrees takes the lead
  // past north, which must read as 10, not 370.
  const pose = makePose({ leadOrientation: 350, followOrientation: 170 });
  const placed = applyTransform(
    { position: { x: 0, y: 0 }, rotation: 20 },
    pose,
  );
  assert.ok(Math.abs(placed.lead.orientation - 10) < 1e-9);
  assert.ok(Math.abs(placed.follow.orientation - 190) < 1e-9);
});

test("applyTransform: leaves weights untouched", () => {
  const pose = makePose();
  pose.lead.left.weight = 1;
  pose.lead.right.weight = 0;
  const placed = applyTransform(
    { position: { x: 3, y: 4 }, rotation: 123 },
    pose,
  );
  assert.equal(placed.lead.left.weight, 1);
  assert.equal(placed.lead.right.weight, 0);
  assert.equal(placed.follow.left.weight, 0.5);
});

test("fitTransform: a counterclockwise placement comes back as a normalized clockwise rotation", () => {
  // -30 degrees (30 counterclockwise) is the same placement as 330;
  // FloorTransform.rotation shares the [0, 360) heading convention, so
  // the fit must report 330 rather than -30.
  const source = makePose();
  const target = applyTransform(
    { position: { x: -2, y: 1.5 }, rotation: -30 },
    source,
  );
  const fitted = fitTransform(source, target);
  assert.ok(
    Math.abs(fitted.rotation - 330) < 1e-6,
    `expected 330, got ${fitted.rotation}`,
  );
  assertPoseClose(applyTransform(fitted, source), target);
});

test("fitTransform: a half-turn placement is recovered (rotation 180)", () => {
  const source = makePose();
  const target = applyTransform(
    { position: { x: 1, y: 1 }, rotation: 180 },
    source,
  );
  const fitted = fitTransform(source, target);
  assert.ok(Math.abs(fitted.rotation - 180) < 1e-6);
  assertPoseClose(applyTransform(fitted, source), target);
});

test("fitTransform: when poses don't match exactly, the best fit still lines up their foot centroids", () => {
  // A least-squares rigid fit always maps the source feet's centroid
  // exactly onto the target feet's centroid, even when the leftover
  // shape mismatch means no transform can line up every foot. This is
  // what keeps a sequence from drifting when two figures' stances don't
  // quite connect.
  const source = makePose();
  const target = makePose({
    leadLeft: [0.9, 2.1],
    leadRight: [1.2, 2.0],
    followLeft: [0.95, 2.5],
    followRight: [1.3, 2.35],
  });
  const fitted = fitTransform(source, target);
  const placed = applyTransform(fitted, source);

  const centroid = (pose: Pose) => {
    const feet = [
      pose.lead.left,
      pose.lead.right,
      pose.follow.left,
      pose.follow.right,
    ].map((foot) => foot.position);
    return {
      x: feet.reduce((sum, p) => sum + p.x, 0) / 4,
      y: feet.reduce((sum, p) => sum + p.y, 0) / 4,
    };
  };
  const placedCentroid = centroid(placed);
  const targetCentroid = centroid(target);
  assert.ok(Math.abs(placedCentroid.x - targetCentroid.x) < 1e-9);
  assert.ok(Math.abs(placedCentroid.y - targetCentroid.y) < 1e-9);
});

test("fitTransform: a degenerate pose (all feet at one point) falls back to no rotation", () => {
  // With every foot at the same spot there is no shape to align, so the
  // rotation is undefined; fitTransform reports 0 and translates the
  // point onto the target instead of returning NaN.
  const collapsed = makePose({
    leadLeft: [0, 0],
    leadRight: [0, 0],
    followLeft: [0, 0],
    followRight: [0, 0],
  });
  const target = makePose({
    leadLeft: [2, 3],
    leadRight: [2, 3],
    followLeft: [2, 3],
    followRight: [2, 3],
  });
  const fitted = fitTransform(collapsed, target);
  assert.equal(fitted.rotation, 0);
  assert.ok(Math.abs(fitted.position.x - 2) < 1e-9);
  assert.ok(Math.abs(fitted.position.y - 3) < 1e-9);
});
