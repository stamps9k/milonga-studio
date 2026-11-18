import { test } from "node:test";
import assert from "node:assert/strict";
import { defineFigure } from "../../src/libs/dance/authoring.mts";
import { poseAtBeat } from "../../src/libs/dance/fold.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import { bodyPosition, centerOfWeight } from "../../src/libs/dance/weight.mts";
import {
  parseDance,
  parseDanceJSON,
} from "../../src/libs/dance/persistence.mts";
import { sampleDance } from "../support/dance.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

const authored = defineFigure({
  name: "Body placement",
  style: "test",
  time: "4/4",
  start: "closed",
  slow: 1,
  steps: [
    { both: "forward", by: 0.3, length: "S", bodyOffset: { forward: 0.08 } },
    { both: "forward", by: 0.3, length: "S" },
  ],
});
const figure: Figure = {
  ...authored,
  id: "offset",
  steps: authored.steps.map((step, i) => ({ ...step, id: String(i) })),
};
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("bodyOffset: authoring uses each partner's facing and folding interpolates then resets to zero", () => {
  close(figure.steps[0].bodyOffset!.y, 0.08);
  close(figure.steps[1].bodyOffset!.y, -0.08);
  for (const [beat, offset] of [
    [0.5, 0.04],
    [1, 0.08],
    [1.5, 0.04],
    [2, 0],
  ]) {
    const p = poseAtBeat(figure, beat).lead;
    close(bodyPosition(p).y - centerOfWeight(p).y, offset);
  }
  assert.equal(poseAtBeat(figure, 2).lead.bodyOffset, undefined);
  assert.deepEqual(
    bodyPosition(figure.startPose.lead),
    centerOfWeight(figure.startPose.lead),
  );
});

test("bodyOffset: floor placement rotates the displacement without translating it", () => {
  const pose = poseAtBeat(figure, 1);
  const transformed = applyTransform(
    { position: { x: 4, y: 7 }, rotation: 90 },
    pose,
  );
  close(transformed.lead.bodyOffset!.x, 0.08);
  close(transformed.lead.bodyOffset!.y, 0);
  const before = bodyPosition(pose.lead),
    after = bodyPosition(transformed.lead);
  close(after.x, 4 + before.y);
  close(after.y, 7 - before.x);
});

test("bodyOffset: snapshot round trip preserves step and pose offsets and rejects malformed vectors", () => {
  const dance = sampleDance();
  const entry = dance.sequence.entries[0];
  entry.figure.startPose.lead.bodyOffset = { x: 0.03, y: -0.02 };
  entry.figure.steps[0].bodyOffset = { x: 0.02, y: 0.04 };
  const parsed = parseDanceJSON(JSON.stringify(dance));
  assert.deepEqual(parsed.sequence.entries[0].figure.steps[0].bodyOffset, {
    x: 0.02,
    y: 0.04,
  });
  assert.deepEqual(
    parsed.sequence.entries[0].figure.startPose.lead.bodyOffset,
    { x: 0.03, y: -0.02 },
  );
  for (const offset of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 0 }]) {
    const malformed = structuredClone(dance);
    Object.assign(malformed.sequence.entries[0].figure.steps[0], {
      bodyOffset: offset,
    });
    assert.throws(() => parseDance(malformed), /bodyOffset/);
  }
});
