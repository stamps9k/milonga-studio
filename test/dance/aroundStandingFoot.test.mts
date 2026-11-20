import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defineFigure,
  parseFigureDefinition,
} from "../../src/libs/dance/authoring.mts";
import { poseAtBeat, footEase } from "../../src/libs/dance/fold.mts";
import { rotatePoint } from "../../src/libs/dance/heading.mts";

/** One lead step from closed hold: his left foot steps to land `apart`
 *  metres to the left of his right foot in the facing he ends in, while
 *  he turns `turn` degrees to the left. The follow doesn't move, so the
 *  hold and partner checks are left out; this tests one dancer's feet. */
function bigTurn(turn: number, apart: number, path?: string) {
  const end = rotatePoint({ x: -apart, y: 0 }, 360 - turn);
  // Closed stance: his left foot at (-0.1, 0), his right at (0.1, 0).
  const go = { forward: end.y, right: 0.1 + end.x + 0.1 };
  return defineFigure(
    parseFigureDefinition(
      {
        name: "Big left turn",
        style: "waltz",
        time: "3/4",
        notes: "test",
        skipChecks: ["hold", "partner spacing"],
        steps: [
          {
            beat: 1,
            lead: {
              go,
              foot: "L",
              turn: { left: `${turn}/360` },
              ...(path ? { path } : {}),
            },
          },
        ],
        expectBeats: 3,
      },
      "test",
    ),
  );
}

test('"around the standing foot": a big turn that clips the standing foot when straight goes cleanly round it', () => {
  for (const turn of [150, 165]) {
    assert.throws(() => bigTurn(turn, 0.4), /lead's feet overlap/);
    const figure = bigTurn(turn, 0.4, "around the standing foot");
    // It lands exactly where the step says.
    const end = figure.endPose.lead;
    const fromRight = rotatePoint(
      {
        x: end.left.position.x - end.right.position.x,
        y: end.left.position.y - end.right.position.y,
      },
      -end.orientation,
    );
    assert.ok(Math.abs(fromRight.x + 0.4) < 1e-9, `across ${fromRight.x}`);
    assert.ok(Math.abs(fromRight.y) < 1e-9, `along ${fromRight.y}`);
  }
});

test('"around the standing foot": the moving foot keeps its side of the body and its distance from the standing foot', () => {
  const authored = bigTurn(165, 0.4, "around the standing foot");
  const figure = {
    ...authored,
    id: "t",
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
  for (const options of [{}, { footEasing: footEase }])
    for (let i = 0; i <= 96; i++) {
      const p = poseAtBeat(figure, (3 * i) / 96, options).lead;
      const rel = rotatePoint(
        {
          x: p.left.position.x - p.right.position.x,
          y: p.left.position.y - p.right.position.y,
        },
        -p.orientation,
      );
      // Started 0.2 to the left, lands 0.4 to the left: the circle round
      // the standing foot never comes closer than the nearer of the two.
      assert.ok(rel.x < 0, `left foot crossed at ${i}`);
      assert.ok(Math.hypot(rel.x, rel.y) > 0.19, `too close at ${i}`);
    }
});

test('"around the standing foot": goes round the way the body turns, and needs a turn', () => {
  const figure = bigTurn(150, 0.4, "around the standing foot");
  const step = figure.steps[0];
  assert.equal(step.movement.type, "arc");
  // Left turn: anticlockwise, so the curve bends left (negative curvature).
  assert.ok(step.movement.type === "arc" && step.movement.curvature < 0);
  assert.throws(
    () =>
      defineFigure(
        parseFigureDefinition(
          {
            name: "No turn",
            style: "waltz",
            time: "3/4",
            notes: "test",
            skipChecks: ["hold", "partner spacing"],
            steps: [
              {
                beat: 1,
                lead: {
                  go: { forward: -0.3, right: 0 },
                  foot: "L",
                  path: "around the standing foot",
                },
              },
            ],
            expectBeats: 3,
          },
          "test",
        ),
      ),
    /needs a `turn`/,
  );
  assert.throws(
    () =>
      defineFigure(
        parseFigureDefinition(
          {
            name: "Set off given",
            style: "waltz",
            time: "3/4",
            notes: "test",
            skipChecks: ["hold", "partner spacing"],
            steps: [
              {
                beat: 1,
                lead: {
                  go: { forward: -0.3, right: 0.3 },
                  foot: "L",
                  turn: { left: "1/4" },
                  path: "around the standing foot",
                  pathSetOff: 30,
                },
              },
            ],
            expectBeats: 3,
          },
          "test",
        ),
      ),
    /leave out "pathSetOff"/,
  );
});
