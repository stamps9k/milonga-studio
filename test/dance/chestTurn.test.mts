import { test } from "node:test";
import assert from "node:assert/strict";

import { FigureError, defineFigure } from "../../src/libs/dance/authoring.mts";
import type {
  FigureDefinition,
  StepRow,
} from "../../src/libs/dance/authoring.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import { figureDurationBeats, poseAtBeat } from "../../src/libs/dance/fold.mts";
import { chestFacing } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

// A step's "chest" turns the upper body (chest, shoulders and hold) from
// the hips, which keep the step's facing: DanceStep.chestTurn.

const SKIP = ["crossed feet", "own feet", "partner spacing", "hold"] as const;

function define(steps: StepRow[], skip = true): Figure {
  const definition: FigureDefinition = {
    name: "Chest",
    style: "test",
    time: "4/4",
    steps,
    ...(skip ? { skipChecks: [...SKIP] } : {}),
  };
  const authored = defineFigure(definition);
  return {
    ...authored,
    id: "chest",
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}

const turned: StepRow[] = [
  {
    lead: { go: "forward", by: 0.3, chest: { right: "1/4" } },
    length: "S",
  },
  { lead: { go: "forward", by: 0.3 }, length: "S" },
];

test("chest: the turn grows steadily over its step and goes back over the next that leaves it out", () => {
  const figure = define(turned);
  const slow = figureDurationBeats(figure) / 2;
  const at = (beat: number) => poseAtBeat(figure, beat).lead;
  assert.equal(at(0).chestTurn, undefined);
  assert.ok(Math.abs((at(slow / 2).chestTurn ?? 0) - 45) < 1e-9);
  assert.ok(Math.abs((at(slow).chestTurn ?? 0) - 90) < 1e-9);
  assert.ok(Math.abs((at(1.5 * slow).chestTurn ?? 0) - 45) < 1e-9);
  assert.equal(at(2 * slow).chestTurn, undefined);
  // The hips and feet keep the step's facing; the chest faces round from it.
  assert.equal(at(slow).orientation, 0);
  assert.equal(chestFacing(at(slow)), 90);
});

test("chest: placing a pose on the floor keeps the turn, relative to the body", () => {
  const figure = define(turned);
  const pose = poseAtBeat(figure, figureDurationBeats(figure) / 2);
  const placed = applyTransform(
    { position: { x: 1, y: 2 }, rotation: 30 },
    pose,
  );
  assert.equal(placed.lead.chestTurn, pose.lead.chestTurn);
  assert.ok(Math.abs(chestFacing(placed.lead) - 120) < 1e-9);
});

test("chest: the hold check measures the partners by where their chests face", () => {
  // From closed hold the follow turns her hips a quarter to her left, as
  // if to walk across in front of him: her chest turned a quarter right
  // keeps her facing him, so the couple is still in closed hold. Then
  // her hips turn back and her chest comes square with them.
  const steps = (chest: boolean): StepRow[] => [
    {
      lead: "in place",
      follow: {
        go: "in place",
        turn: { left: "1/4" },
        ...(chest ? { chest: { right: "1/4" } } : {}),
      },
      length: "S",
    },
    {
      lead: "in place",
      follow: { go: "in place", turn: { right: "1/4" } },
      length: "S",
    },
  ];
  const holdOnly = (chest: boolean) =>
    defineFigure({
      name: "Chest",
      style: "test",
      time: "4/4",
      steps: steps(chest),
      skipChecks: ["crossed feet", "own feet", "partner spacing"],
    });
  assert.doesNotThrow(() => holdOnly(true));
  assert.throws(
    () => holdOnly(false),
    (error) =>
      error instanceof FigureError && /aren't in hold/.test(error.message),
  );
});

test("chest: refused on a step that takes no weight, beyond a quarter turn, and left turned at the end", () => {
  const refused = (steps: StepRow[], message: RegExp) =>
    assert.throws(
      () => define(steps),
      (error) => error instanceof FigureError && message.test(error.message),
    );
  refused(
    [
      {
        lead: {
          go: "forward",
          by: 0.3,
          weight: false,
          chest: { right: "1/8" },
        },
        length: "S",
      },
    ],
    /needs a step that takes weight/,
  );
  refused(
    [
      {
        lead: { go: "forward", by: 0.3, chest: { left: "3/8" } },
        length: "S",
      },
      { lead: { go: "forward", by: 0.3 }, length: "S" },
    ],
    /at most 90° either way/,
  );
  refused(
    [
      {
        lead: { go: "forward", by: 0.3, chest: { right: "1/8" } },
        length: "S",
      },
    ],
    /still turned 45° from the hips at the end/,
  );
});
