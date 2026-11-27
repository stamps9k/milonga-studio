import { test } from "node:test";
import assert from "node:assert/strict";

import { FigureError, defineFigure } from "../../src/libs/dance/authoring.mts";
import type { CurvedPath, StepRow } from "../../src/libs/dance/authoring.mts";
import { figureDurationBeats, poseAtBeat } from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";

// A step with `steadyBody` moves the body as if the stepping foot went
// straight to where it lands: the foot's curve (or its passing by the
// standing foot) stays out of the body's position.

function figure(path: CurvedPath | undefined, steadyBody: boolean): Figure {
  const steps: StepRow[] = [
    {
      lead: {
        go: "forward",
        by: 0.5,
        turn: { right: "1/4" },
        ...(path ? { path } : {}),
        ...(steadyBody ? { steadyBody: true } : {}),
      },
      length: "S",
    },
  ];
  const authored = defineFigure({
    name: "Steady",
    style: "test",
    time: "4/4",
    steps,
    skipChecks: ["crossed feet", "own feet", "partner spacing", "hold"],
  });
  return {
    ...authored,
    id: "steady",
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}

const body = (f: Figure, beat: number) =>
  bodyPosition(poseAtBeat(f, beat).lead);
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

test("steadyBody: the body ignores the foot's curve, travelling as for a straight step", () => {
  const curved = figure("around the standing foot", true);
  const straight = figure(undefined, true);
  const swinging = figure("around the standing foot", false);
  const end = figureDurationBeats(curved);
  let swing = 0;
  for (let i = 0; i <= 16; i++) {
    const beat = (i / 16) * end;
    assert.ok(gap(body(curved, beat), body(straight, beat)) < 1e-9);
    swing = Math.max(swing, gap(body(swinging, beat), body(curved, beat)));
  }
  // Without it, the curve pulls the body out partway through the step.
  assert.ok(swing > 0.05, `swing ${swing}`);
  // The foot itself still takes the curve, and lands in the same place.
  const middle = end / 2;
  assert.ok(
    gap(
      poseAtBeat(curved, middle).lead.left.position,
      poseAtBeat(straight, middle).lead.left.position,
    ) > 0.05,
  );
  assert.deepEqual(curved.endPose, swinging.endPose);
});

test("steadyBody: refused on a step that takes no weight", () => {
  assert.throws(
    () =>
      defineFigure({
        name: "Steady",
        style: "test",
        time: "4/4",
        steps: [
          {
            lead: {
              go: "forward",
              by: 0.4,
              weight: false,
              steadyBody: true,
            },
            length: "S",
          },
        ],
        skipChecks: ["crossed feet", "own feet", "partner spacing", "hold"],
      }),
    (error) =>
      error instanceof FigureError &&
      /needs a step that takes weight/.test(error.message),
  );
});
