import { test } from "node:test";
import assert from "node:assert/strict";

import { FigureError, defineFigure } from "../../src/libs/dance/authoring.mts";
import type { StepRow } from "../../src/libs/dance/authoring.mts";
import {
  bodyArcOffset,
  figureDurationBeats,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import type { Point2D } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";

// A step with `bodyArc` takes the body round an arc that turns with the
// step's turn, instead of straight from where the weighted feet leave it
// to where they put it. It starts and ends in the same places.

function figure(bodyArc: boolean): Figure {
  const steps: StepRow[] = [
    {
      lead: {
        go: "forward",
        by: 0.4,
        turn: { right: "1/4" },
        ...(bodyArc ? { bodyArc: true } : {}),
      },
      length: "S",
    },
  ];
  const authored = defineFigure({
    name: "Arc",
    style: "test",
    time: "4/4",
    steps,
    skipChecks: ["crossed feet", "own feet", "partner spacing", "hold"],
  });
  return {
    ...authored,
    id: "arc",
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}

const body = (f: Figure, beat: number) =>
  bodyPosition(poseAtBeat(f, beat).lead);
const near = (a: Point2D, b: Point2D, tolerance = 1e-9) =>
  assert.ok(
    Math.hypot(a.x - b.x, a.y - b.y) <= tolerance,
    `expected (${b.x}, ${b.y}), got (${a.x}, ${a.y})`,
  );

test("bodyArc: the body starts and ends where the weighted feet put it", () => {
  const curved = figure(true);
  const straight = figure(false);
  const end = figureDurationBeats(curved);
  near(body(curved, 0), body(straight, 0));
  near(body(curved, end), body(straight, end));
  assert.deepEqual(curved.endPose, straight.endPose);
});

test("bodyArc: between, it rounds a circular arc turning with the step", () => {
  const curved = figure(true);
  const straight = figure(false);
  const end = figureDurationBeats(curved);
  const from = body(straight, 0);
  const to = body(straight, end);
  const travel = { x: to.x - from.x, y: to.y - from.y };
  // The weight moves evenly through the step, so halfway in time the
  // body is halfway round.
  for (const share of [0.25, 0.5, 0.75]) {
    const off = bodyArcOffset(travel, 90, share);
    const s = body(straight, share * end);
    near(body(curved, share * end), { x: s.x + off.x, y: s.y + off.y });
  }
  // Halfway round a quarter circle the arc is (chord / 2) · tan(22.5°)
  // off the chord, on the outside of the turn: turning right, the body
  // sets off left of the chord and curves round to the right, so the arc
  // bulges to the left of it (its centre is on the right).
  const chord = Math.hypot(travel.x, travel.y);
  const middle = bodyArcOffset(travel, 90, 0.5);
  assert.ok(
    Math.abs(
      Math.hypot(middle.x, middle.y) -
        (chord / 2) * Math.tan((22.5 * Math.PI) / 180),
    ) < 1e-9,
  );
  assert.ok(middle.x * travel.y - middle.y * travel.x < 0, "bulges left");
});

test("bodyArc: a turn to the left bends the other way", () => {
  const right = bodyArcOffset({ x: 0, y: 1 }, 90, 0.5);
  const left = bodyArcOffset({ x: 0, y: 1 }, -90, 0.5);
  near(left, { x: -right.x, y: right.y });
  near(bodyArcOffset({ x: 0, y: 1 }, 0, 0.5), { x: 0, y: 0 });
});

test("bodyArc: on a step that doesn't turn, it is refused", () => {
  assert.throws(
    () =>
      defineFigure({
        name: "Arc",
        style: "test",
        time: "4/4",
        steps: [
          { lead: { go: "forward", by: 0.4, bodyArc: true }, length: "S" },
        ],
        skipChecks: ["crossed feet", "own feet", "partner spacing", "hold"],
      }),
    (error) =>
      error instanceof FigureError &&
      /needs a step that turns/.test(error.message),
  );
});
