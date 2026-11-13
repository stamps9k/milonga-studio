import { test } from "node:test";
import assert from "node:assert/strict";

import {
  headingToUnitVector,
  lerp,
  lerpAngleDegrees,
  lerpPoint,
  normalizeDegrees,
  rotatePoint,
} from "../../src/libs/dance/heading.mts";

// heading.mts defines the one angle convention every heading in the
// model shares: 0 degrees = +Y ("north" / line of dance), increasing
// clockwise like a compass bearing. These tests pin that convention
// with hand-checkable values, so a change to the maths (for example a
// switch to the usual counterclockwise-from-+X convention) fails here
// first rather than surfacing as mirrored figures in the renderer.

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  assertClose(actual.x, expected.x);
  assertClose(actual.y, expected.y);
}

test("normalizeDegrees: maps any angle into [0, 360)", () => {
  assert.equal(normalizeDegrees(0), 0);
  assert.equal(normalizeDegrees(90), 90);
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(720), 0);
  assert.equal(normalizeDegrees(450), 90);
  // Negative angles wrap forward rather than staying negative -- the
  // seeded Ocho figure stores a direction of -10, which must read as
  // 350 wherever headings are compared.
  assert.equal(normalizeDegrees(-10), 350);
  assert.equal(normalizeDegrees(-90), 270);
  assert.equal(normalizeDegrees(-360), 0);
  assert.equal(normalizeDegrees(-450), 270);
});

test("headingToUnitVector: compass convention, 0 = north (+Y), 90 = east (+X), clockwise", () => {
  assertPointClose(headingToUnitVector(0), { x: 0, y: 1 });
  assertPointClose(headingToUnitVector(90), { x: 1, y: 0 });
  assertPointClose(headingToUnitVector(180), { x: 0, y: -1 });
  assertPointClose(headingToUnitVector(270), { x: -1, y: 0 });
  // 45 degrees is north-east, not north-west: clockwise from +Y.
  const diagonal = Math.SQRT1_2;
  assertPointClose(headingToUnitVector(45), { x: diagonal, y: diagonal });
  // Equivalent angles give the same direction.
  assertPointClose(headingToUnitVector(-90), headingToUnitVector(270));
  assertPointClose(headingToUnitVector(360), headingToUnitVector(0));
});

test("headingToUnitVector: always returns a unit-length vector", () => {
  for (let degrees = -720; degrees <= 720; degrees += 17) {
    const v = headingToUnitVector(degrees);
    assertClose(Math.hypot(v.x, v.y), 1);
  }
});

test("rotatePoint: rotates clockwise about the origin and preserves distance", () => {
  // East rotated a further 90 degrees clockwise points south.
  assertPointClose(rotatePoint({ x: 1, y: 0 }, 90), { x: 0, y: -1 });
  assertPointClose(rotatePoint({ x: 2, y: 3 }, 180), { x: -2, y: -3 });
  assertPointClose(rotatePoint({ x: 2, y: 3 }, 0), { x: 2, y: 3 });

  const point = { x: 0.3, y: -1.7 };
  const rotated = rotatePoint(point, 123);
  assertClose(Math.hypot(rotated.x, rotated.y), Math.hypot(point.x, point.y));
});

test("rotatePoint: rotating by an angle and then by its negative is the identity", () => {
  const point = { x: 0.4, y: 1.25 };
  assertPointClose(rotatePoint(rotatePoint(point, 77), -77), point);
  // Composition: two rotations add.
  assertPointClose(
    rotatePoint(rotatePoint(point, 30), 45),
    rotatePoint(point, 75),
  );
});

test("lerp and lerpPoint: linear interpolation with exact endpoints", () => {
  assert.equal(lerp(2, 6, 0), 2);
  assert.equal(lerp(2, 6, 1), 6);
  assert.equal(lerp(2, 6, 0.25), 3);
  assertPointClose(lerpPoint({ x: 0, y: 0 }, { x: 2, y: -4 }, 0.5), {
    x: 1,
    y: -2,
  });
});

test("lerpAngleDegrees: takes the shortest way round, wrapping through 0/360", () => {
  // 350 -> 10 is a 20-degree clockwise turn through north, so halfway
  // is 0 (not 180, which the naive linear midpoint would give).
  assertClose(lerpAngleDegrees(350, 10, 0.5), 0);
  // The reverse direction, 10 -> 350, turns counterclockwise.
  assertClose(lerpAngleDegrees(10, 350, 0.5), 0);
  assertClose(lerpAngleDegrees(10, 350, 0.25), 5);
  // Ordinary non-wrapping case.
  assertClose(lerpAngleDegrees(0, 90, 0.5), 45);
});

test("lerpAngleDegrees: endpoints are exact (normalized) and the result stays in [0, 360)", () => {
  assertClose(lerpAngleDegrees(350, 10, 0), 350);
  assertClose(lerpAngleDegrees(350, 10, 1), 10);
  assertClose(lerpAngleDegrees(-30, 30, 1), 30);
  for (let t = 0; t <= 1; t += 0.1) {
    const value = lerpAngleDegrees(300, 60, t);
    assert.ok(value >= 0 && value < 360, `out of range: ${value}`);
  }
});

test("lerpAngleDegrees: a turn of more than 180 degrees is taken the short way (model limitation)", () => {
  // Orientation is stored as an absolute heading at the end of each
  // step, not as a signed turn, so a 270-degree clockwise pivot from 0
  // to 270 is indistinguishable from a 90-degree counterclockwise one
  // and is animated as the latter. This pins the current behaviour; if
  // the model gains a way to express large turns, this test should
  // change with it.
  assertClose(lerpAngleDegrees(0, 270, 0.5), 315);
});
