import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatScaleLength,
  niceScaleLength,
} from "../../src/components/scaleBar.mts";

test("niceScaleLength: picks the largest 1, 2 or 5 times a power of ten that fits", () => {
  assert.equal(niceScaleLength(0.7), 0.5);
  assert.equal(niceScaleLength(0.45), 0.2);
  assert.equal(niceScaleLength(0.19), 0.1);
  assert.equal(niceScaleLength(3.9), 2);
  assert.equal(niceScaleLength(12), 10);
});

test("niceScaleLength: an exact round value is kept, despite floating-point noise", () => {
  assert.equal(niceScaleLength(0.5), 0.5);
  assert.equal(niceScaleLength(1), 1);
  assert.equal(niceScaleLength(0.1 + 0.2 - 0.1), 0.2);
});

test("niceScaleLength: nothing to scale gives 0", () => {
  assert.equal(niceScaleLength(0), 0);
  assert.equal(niceScaleLength(-1), 0);
  assert.equal(niceScaleLength(Number.NaN), 0);
  assert.equal(niceScaleLength(Number.POSITIVE_INFINITY), 0);
});

test("formatScaleLength: centimetres under a metre, metres from one up", () => {
  assert.equal(formatScaleLength(0.5), "50 cm");
  assert.equal(formatScaleLength(0.2), "20 cm");
  assert.equal(formatScaleLength(1), "1 m");
  assert.equal(formatScaleLength(2), "2 m");
});
