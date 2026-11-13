import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FigureError,
  PARTNER_DISTANCE,
  STANCE_WIDTH,
  defineFigure,
} from "../../src/libs/dance/authoring.mts";
import type {
  FigureDefinition,
  StepRow,
} from "../../src/libs/dance/authoring.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";

// Worked examples for defineFigure. Closed hold: lead's feet at
// (-0.1, 0) and (0.1, 0) facing north (0), follow's at (0.1, 0.4) [left]
// and (-0.1, 0.4) [right] facing south (180).

function figure(
  steps: StepRow[],
  extra: Partial<FigureDefinition> = {},
): ReturnType<typeof defineFigure> {
  return defineFigure({
    name: "Test",
    style: "test",
    time: "4/4",
    steps,
    ...extra,
  });
}

function pointClose(
  actual: { x: number; y: number },
  expected: [number, number],
) {
  assert.ok(
    Math.hypot(actual.x - expected[0], actual.y - expected[1]) < 1e-9,
    `expected (${expected[0]}, ${expected[1]}), got (${actual.x}, ${actual.y})`,
  );
}

function standing(pose: Pose) {
  return {
    lead: pose.lead.left.weight === 1 ? "left" : "right",
    follow: pose.follow.left.weight === 1 ? "left" : "right",
  };
}

test("closed stance uses the shared measurements, partners facing each other", () => {
  const { startPose } = figure([{ both: "forward", by: 0.3, length: "Q" }]);
  pointClose(startPose.lead.left.position, [-STANCE_WIDTH / 2, 0]);
  pointClose(startPose.lead.right.position, [STANCE_WIDTH / 2, 0]);
  pointClose(startPose.follow.left.position, [
    STANCE_WIDTH / 2,
    PARTNER_DISTANCE,
  ]);
  pointClose(startPose.follow.right.position, [
    -STANCE_WIDTH / 2,
    PARTNER_DISTANCE,
  ]);
  assert.equal(startPose.lead.orientation, 0);
  assert.equal(startPose.follow.orientation, 180);
});

test("both: the follow mirrors with the other foot, travelling the same way on the floor", () => {
  const { steps, endPose } = figure([
    { both: "forward", by: 0.4, length: "Q" },
  ]);
  const [lead, follow] = steps;
  assert.equal(lead.foot, "left");
  assert.equal(follow.foot, "right");
  // Lead forward = north; follow back (she faces south) = also north.
  pointClose(endPose.lead.left.position, [-0.1, 0.4]);
  pointClose(endPose.follow.right.position, [-0.1, 0.8]);
  assert.equal(follow.label, "back");
});

test("both: side and diagonal steps mirror to the same floor direction", () => {
  const side = figure([{ both: "side left", by: 0.3, length: "Q" }]);
  pointClose(side.endPose.lead.left.position, [-0.4, 0]);
  pointClose(side.endPose.follow.right.position, [-0.4, 0.4]);
  assert.equal(side.steps[1].label, "side right");

  const diagonal = figure([
    { both: "diagonal forward right", by: Math.SQRT2 * 0.1, length: "Q" },
  ]);
  pointClose(diagonal.endPose.lead.left.position, [0, 0.1]);
  pointClose(diagonal.endPose.follow.right.position, [0, 0.5]);
  assert.equal(diagonal.steps[1].label, "diagonal back left");
});

test("the moving foot is the free one, and the start weight is worked out from the first step", () => {
  // No foot given: lead steps off his left, so he starts standing on
  // his right; the follow mirrors.
  const plain = figure([{ both: "forward", by: 0.3, length: "Q" }]);
  assert.deepEqual(standing(plain.startPose), {
    lead: "right",
    follow: "left",
  });

  // Starting on the lead's right foot means standing on the left.
  const fromRight = figure([
    { both: "side right", foot: "R", by: 0.3, length: "Q" },
  ]);
  assert.deepEqual(standing(fromRight.startPose), {
    lead: "left",
    follow: "right",
  });
  assert.equal(fromRight.steps[0].foot, "right");
  assert.equal(fromRight.steps[1].foot, "left");

  // Later steps alternate feet without being told.
  const walk = figure([
    { both: "forward", by: 0.3, length: "Q" },
    { both: "forward", by: 0.3, length: "Q" },
  ]);
  assert.deepEqual(
    walk.steps.map((step) => `${step.partner} ${step.foot}`),
    ["lead left", "follow right", "lead right", "follow left"],
  );
});

test("directions are measured from the facing before the step's turn, and the facing turns", () => {
  // Forward while turning a quarter right: travels north, ends facing
  // east. The follow turns the same way (clockwise) with the couple.
  const { steps } = figure([
    { both: "forward", by: 0.3, turn: { right: 1 / 4 }, length: "Q" },
  ]);
  assert.equal(steps[0].movement.type, "straight");
  if (steps[0].movement.type === "straight") {
    assert.equal(steps[0].movement.direction, 0);
  }
  assert.equal(steps[0].orientation, 90);
  assert.equal(steps[1].orientation, 270);
});

test("close lands beside the standing foot at stance width, across the facing after any turn", () => {
  const { endPose } = figure([
    { both: "forward", by: 0.4, length: "Q" },
    { both: "close", length: "Q" },
  ]);
  pointClose(endPose.lead.left.position, [-0.1, 0.4]);
  pointClose(endPose.lead.right.position, [0.1, 0.4]);
  pointClose(endPose.follow.right.position, [-0.1, 0.8]);
  pointClose(endPose.follow.left.position, [0.1, 0.8]);

  // Closing while turning a quarter right: the feet end side by side
  // across the new facing (east), so one in front of the other on the
  // floor -- the right foot south (to the right) of the standing left.
  const turned = figure([
    { both: "forward", by: 0.4, length: "Q" },
    { lead: "close", turn: { right: 1 / 4 }, length: "Q" },
  ]);
  pointClose(turned.endPose.lead.right.position, [-0.1, 0.4 - STANCE_WIDTH]);
});

test("in place changes weight without moving; pivot turns on the standing foot", () => {
  const recover = figure([
    { both: "forward", by: 0.3, length: "Q" },
    { both: "in place", length: "Q" },
  ]);
  pointClose(recover.endPose.lead.right.position, [0.1, 0]);
  assert.equal(recover.endPose.lead.right.weight, 1);
  assert.equal(recover.endPose.lead.left.weight, 0);

  const pivot = figure([
    { follow: { go: "pivot", turn: { left: 1 / 8 } }, length: "Q" },
  ]);
  const step = pivot.steps[0];
  // The follow stands on her left by default, so that's the pivot foot.
  assert.equal(step.foot, "left");
  assert.equal(step.orientation, 135);
  assert.equal(step.label, "pivot 1/8 left");
  pointClose(pivot.endPose.follow.left.position, [0.1, 0.4]);
});

test("weight: false moves the foot but leaves the weight; air leaves the foot where it was", () => {
  const tap = figure([
    { lead: "side left", by: 0.2, weight: false, length: "Q" },
  ]);
  pointClose(tap.endPose.lead.left.position, [-0.3, 0]);
  assert.equal(tap.endPose.lead.left.weight, 0);
  assert.equal(tap.endPose.lead.right.weight, 1);

  const boleo = figure([
    { follow: { go: "side left", by: 0.3, air: true }, length: "Q" },
  ]);
  assert.equal(boleo.steps[0].contact, "air");
  assert.equal(boleo.steps[0].weight, 0);
  pointClose(boleo.endPose.follow.right.position, [-0.1, 0.4]);
});

test("timing: S and Q chain one after another; beats last until the partner's next step or the end of the measure", () => {
  const slowQuick = figure([
    { both: "forward", by: 0.3, length: "S" },
    { both: "forward", by: 0.3, length: "Q" },
    { both: "forward", by: 0.3, length: "Q" },
  ]);
  assert.deepEqual(
    slowQuick.steps
      .filter((step) => step.partner === "lead")
      .map((step) => [step.beat, step.duration]),
    [
      [1, 2],
      [3, 1],
      [4, 1],
    ],
  );

  const tangoCount = figure([{ both: "forward", by: 0.3, length: "S" }], {
    slow: 1,
  });
  assert.equal(tangoCount.steps[0].duration, 1);

  const counted = figure([
    { both: "forward", by: 0.3, beat: 1 },
    { both: "in place", beat: 2 },
    { both: "back", by: 0.3, beat: 3 },
    { both: "in place", beat: 3.5 },
  ]);
  assert.deepEqual(
    counted.steps
      .filter((step) => step.partner === "lead")
      .map((step) => [step.beat, step.duration]),
    [
      [1, 1],
      [2, 1],
      [3, 0.5],
      [3.5, 1.5],
    ],
  );
});

test("expectEnd passes when the figure ends there, by stance or by exact feet", () => {
  assert.doesNotThrow(() =>
    figure(
      [
        { both: "forward", by: 0.4, beat: 1 },
        { both: "close", beat: 2 },
      ],
      {
        // Forward on the left, then the right closes and takes the weight.
        expectEnd: {
          stance: "closed",
          moved: { forward: 0.4 },
          leadStandingOn: "R",
        },
      },
    ),
  );
  assert.doesNotThrow(() =>
    figure([{ both: "forward", by: 0.6, length: "Q" }], {
      expectEnd: {
        feet: {
          lead: { L: [-0.1, 0.6], R: [0.1, 0] },
          follow: { L: [0.1, 0.4], R: [-0.1, 1.0] },
        },
        facing: { lead: 0, follow: 180 },
      },
    }),
  );
});

test("expectEnd fails with the feet that are off when the figure ends elsewhere", () => {
  assert.throws(
    () =>
      figure([{ both: "forward", by: 0.4, length: "Q" }], {
        name: "Short Walk",
        expectEnd: { stance: "closed", moved: { forward: 0.4 } },
      }),
    (error: unknown) =>
      error instanceof FigureError &&
      /Short Walk: the steps don't end where expectEnd says/.test(
        error.message,
      ) &&
      /lead right foot ends at \(0\.100, 0\.000\), expected \(0\.100, 0\.400\)/.test(
        error.message,
      ),
  );
});

test("mistakes are reported with the figure and step, not silently corrected", () => {
  const cases: [StepRow[], RegExp][] = [
    [
      [
        { lead: "forward", by: 0.3, length: "Q" },
        { lead: { go: "forward", foot: "L", by: 0.3 }, length: "Q" },
      ],
      /step 2 \(lead\): the left foot is carrying the weight/,
    ],
    [[{ lead: "pivot", length: "Q" }], /a pivot needs a `turn`/],
    [[{ both: "forward", length: "Q" }], /needs a positive `by`/],
    [
      [{ both: "close", by: 0.2, length: "Q" }],
      /"close" finds its own distance/,
    ],
    [
      [
        { both: "forward", by: 0.3, beat: 1 },
        { both: "forward", by: 0.3, length: "Q" },
      ],
      /not a mix/,
    ],
    [[{ both: "forward", by: 0.3 }], /needs a `beat` or a `length`/],
    [
      [
        { both: "forward", by: 0.3, beat: 2 },
        { both: "forward", by: 0.3, beat: 1 },
      ],
      /in beat order/,
    ],
    [[{ both: "forward", by: 0.3, beat: 0 }], /beats count from 1/],
    [
      [{ both: "forward", lead: "back", by: 0.3, length: "Q" }],
      /either `both` or `lead`\/`follow`/,
    ],
    [
      [
        { lead: "forward", by: 0.3, beat: 1 },
        { lead: "forward", by: 0.3, beat: 1 },
      ],
      /the lead has two steps starting on beat 1/,
    ],
  ];
  for (const [steps, pattern] of cases) {
    assert.throws(
      () => figure(steps),
      (error: unknown) =>
        error instanceof FigureError &&
        error.message.startsWith("Test") &&
        pattern.test(error.message),
      `expected ${pattern}`,
    );
  }
  // Pivoting on the free foot is an error too.
  assert.throws(
    () =>
      figure([
        { both: "forward", by: 0.3, length: "Q" },
        {
          lead: { go: "pivot", foot: "R", turn: { left: 1 / 8 } },
          length: "Q",
        },
      ]),
    /can't pivot on the right foot, which isn't carrying the weight/,
  );
});

test("the end pose is the folded steps, ready to store", () => {
  const authored = figure([
    { both: "forward", by: 0.4, beat: 1, rise: 0.05 },
    { both: "close", beat: 2 },
  ]);
  pointClose(authored.endPose.lead.left.position, [-0.1, 0.4]);
  pointClose(authored.endPose.lead.right.position, [0.1, 0.4]);
  assert.equal(authored.endPose.lead.rise, 0);
  assert.deepEqual(authored.timeSignature, { beatsPerMeasure: 4, beatUnit: 4 });
  assert.equal(
    authored.steps.every((step) => !("id" in step)),
    true,
  );
});
