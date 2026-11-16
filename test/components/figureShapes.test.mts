import { test } from "node:test";
import assert from "node:assert/strict";

import { FOOT_OUTLINES } from "../../src/components/figureShapes.mts";

// Outlines are in screen-local metres, toe towards -y. A foot's inner
// side is towards the other foot: -x for the right foot, +x for the left.
const pointsOf = (foot: "left" | "right") => [
  FOOT_OUTLINES[foot].start,
  ...FOOT_OUTLINES[foot].curves.flat(),
];

test("foot outlines: the arch narrows the inner side, so left and right can be told apart", () => {
  // Across the middle of the foot, the inner edge comes closer to the
  // centre line than the outer edge does.
  const midfoot = (foot: "left" | "right") =>
    pointsOf(foot).filter(([, y]) => Math.abs(y) <= 0.06);
  const right = midfoot("right");
  const rightInner = Math.max(...right.filter(([x]) => x < 0).map(([x]) => x));
  const rightOuter = Math.max(...right.map(([x]) => x));
  assert.ok(-rightInner < rightOuter, "right foot's arch is on its left");

  const left = midfoot("left");
  const leftInner = Math.min(...left.filter(([x]) => x > 0).map(([x]) => x));
  const leftOuter = Math.min(...left.map(([x]) => x));
  assert.ok(leftInner < -leftOuter, "left foot's arch is on its right");
});

test("foot outlines: the left foot is the mirror image of the right", () => {
  const right = pointsOf("right");
  pointsOf("left").forEach(([x, y], index) => {
    assert.equal(x, -right[index][0]);
    assert.equal(y, right[index][1]);
  });
});

test("foot outlines: the toes point up the screen (forward), the heel down", () => {
  const ys = pointsOf("right").map(([, y]) => y);
  assert.ok(Math.min(...ys) < -0.13 && Math.max(...ys) > 0.12);
});
