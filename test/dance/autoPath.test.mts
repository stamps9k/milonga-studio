import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_PATH_CLEARANCE,
  AUTO_PATH_MAX_BULGE,
  AUTO_PATH_MAX_LENGTH_RATIO,
  defineFigure,
  type FigureDefinition,
} from "../../src/libs/dance/authoring.mts";
import {
  footEase,
  footprintGap,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

// One lead step from closed hold (he stands on his right, the follow
// changes weight in place), with the hold and partner checks off so the
// lead's route is the only thing under test.
function oneStep(lead: object): FigureDefinition {
  return {
    name: "Test",
    style: "test",
    time: "4/4",
    steps: [{ beat: 1, lead, follow: { go: "in place" } }],
    skipChecks: ["hold", "partner spacing"],
  } as FigureDefinition;
}
function figure(definition: FigureDefinition): Figure {
  const authored = defineFigure(definition);
  return {
    ...authored,
    id: "test",
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('path "auto": a step that passes clear stays exactly as it was', () => {
  const plain = figure(oneStep({ go: "forward", by: 0.5 }));
  const auto = figure(oneStep({ go: "forward", by: 0.5, path: "auto" }));
  assert.deepEqual(auto.steps, plain.steps);
  assert.deepEqual(auto.endPose, plain.endPose);
});

test('path "auto": a foot crossing behind the standing foot curves round it, landing where the step says', () => {
  // His left foot goes back across behind his right (CBMP): straight,
  // it would cut through the right foot's heel.
  const go = { forward: -0.35, right: 0.45 };
  const straight = figure(oneStep({ go, cross: true }));
  const auto = figure(oneStep({ go, cross: true, path: "auto" }));
  const [plainStep] = straight.steps.filter((s) => s.partner === "lead");
  const [autoStep] = auto.steps.filter((s) => s.partner === "lead");
  assert.equal(plainStep.movement.type, "straight");
  assert.equal(autoStep.movement.type, "arc");
  for (const foot of ["left", "right"] as const) {
    close(
      auto.endPose.lead[foot].position.x,
      straight.endPose.lead[foot].position.x,
    );
    close(
      auto.endPose.lead[foot].position.y,
      straight.endPose.lead[foot].position.y,
    );
  }
  // Within the flow limits: for an arc turning through 2θ over a chord c,
  // the bulge is c/2 tan(θ/2) and the length c θ / sin θ.
  if (
    autoStep.movement.type !== "arc" ||
    plainStep.movement.type !== "straight"
  )
    return;
  const chord = plainStep.movement.distance;
  const theta = Math.asin((autoStep.movement.curvature * chord) / 2);
  assert.ok((chord / 2) * Math.tan(Math.abs(theta) / 2) <= AUTO_PATH_MAX_BULGE);
  assert.ok(autoStep.movement.arcLength / chord <= AUTO_PATH_MAX_LENGTH_RATIO);
  // And the outlines stay clear all the way, linear and eased.
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 4; beat += 1 / 128) {
      const lead = poseAtBeat(auto, beat, options).lead;
      const gap = footprintGap(
        lead.left.position,
        footHeading(lead, "left"),
        lead.right.position,
        footHeading(lead, "right"),
      );
      assert.ok(
        gap >= AUTO_PATH_CLEARANCE - 1e-3,
        `gap ${gap} at beat ${beat}`,
      );
    }
});

test('path "auto": refuses a step no gentle curve can clear, saying how close it came', () => {
  // Straight across, landing 10 cm beside the standing foot: getting
  // round its toe or heel would need a far bigger bulge than allowed.
  assert.throws(
    () =>
      defineFigure(oneStep({ go: { right: 0.3 }, cross: true, path: "auto" })),
    /"auto" found no route within the flow limits .* the best comes within/,
  );
});

test('path "auto": chooses its own set-off', () => {
  assert.throws(
    () =>
      defineFigure(
        oneStep({ go: "forward", by: 0.5, path: "auto", pathSetOff: 10 }),
      ),
    /"auto" chooses its own set-off/,
  );
});
