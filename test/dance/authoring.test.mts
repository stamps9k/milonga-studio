import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FigureError,
  HOLD_OFFSET,
  PARTNER_DISTANCE,
  STANCE_WIDTH,
  defineFigure,
  parseFigureDefinition,
} from "../../src/libs/dance/authoring.mts";
import type {
  FigureDefinition,
  StepRow,
} from "../../src/libs/dance/authoring.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import { poseAtBeat } from "../../src/libs/dance/fold.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";

// Worked examples for defineFigure. Closed hold: lead's feet at
// (-0.1, 0) and (0.1, 0) facing north (0), follow's at (0.2, 0.4) [left]
// and (0, 0.4) [right] facing south (180): 0.4 in front of him and
// offset 0.1 to his right (HOLD_OFFSET).

// Most tests here check one calculation with one dancer moving on their
// own, often onto the other or across their own feet or out of hold, so
// the whole-figure checks are off by default; the tests of those checks
// turn them on with `skipChecks: ["own feet", "hold"]`.
function figure(
  steps: StepRow[],
  extra: Partial<FigureDefinition> = {},
): ReturnType<typeof defineFigure> {
  return defineFigure({
    name: "Test",
    style: "test",
    time: "4/4",
    steps,
    skipChecks: ["crossed feet", "own feet", "partner spacing", "hold"],
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
  // Offset to his right, so his right foot is in line with the gap
  // between hers.
  pointClose(startPose.follow.left.position, [
    HOLD_OFFSET + STANCE_WIDTH / 2,
    PARTNER_DISTANCE,
  ]);
  pointClose(startPose.follow.right.position, [
    HOLD_OFFSET - STANCE_WIDTH / 2,
    PARTNER_DISTANCE,
  ]);
  assert.equal(HOLD_OFFSET, STANCE_WIDTH / 2);
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
  pointClose(endPose.follow.right.position, [0, 0.8]);
  assert.equal(follow.label, "back");
});

test("an offset step lands that far forward and right, the same as a direction and by", () => {
  // Lead's left foot from (-0.1, 0): 0.3 forward and 0.4 right lands at
  // (0.3, 0.3), a 0.5 step about 53.13 degrees right of forward.
  const offset = figure([{ both: { forward: 0.3, right: 0.4 }, length: "Q" }]);
  const angled = figure([
    {
      both: (Math.atan2(0.4, 0.3) * 180) / Math.PI,
      by: 0.5,
      length: "Q",
    },
  ]);
  pointClose(offset.endPose.lead.left.position, [0.3, 0.3]);
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      const { x, y } = angled.endPose[partner][foot].position;
      pointClose(offset.endPose[partner][foot].position, [x, y]);
    }
  }
  // Labels come from the offset as written; the follow's is reversed.
  assert.equal(offset.steps[0].label, "0.3 forward, 0.4 right");
  assert.equal(offset.steps[1].label, "0.3 back, 0.4 left");
});

test("an offset can be written for one partner, plainly or as `go`, and either part left out", () => {
  const { endPose, steps } = figure([
    {
      lead: { right: -0.2 },
      follow: { go: { forward: -0.3 }, turn: { right: "1/8" } },
      length: "Q",
    },
  ]);
  // Lead's left foot 0.2 to his left; follow's right foot 0.3 back
  // from her facing (south), so north.
  pointClose(endPose.lead.left.position, [-0.3, 0]);
  pointClose(endPose.follow.right.position, [0, 0.7]);
  assert.equal(steps[0].label, "0.2 left");
  assert.equal(steps[1].label, "0.3 back, turning 1/8 right");
});

test("an offset with `by`, or one that doesn't move the foot, is an error", () => {
  assert.throws(
    () => figure([{ both: { forward: 0.3 }, by: 0.3, length: "Q" }]),
    /step 1: a step written as \{ forward, right \} finds its own distance/,
  );
  assert.throws(
    () => figure([{ both: { forward: 0, right: 0 }, length: "Q" }]),
    /step 1: \{ forward, right \} doesn't move the foot; use "in place"/,
  );
});

test("both: side and diagonal steps mirror to the same floor direction", () => {
  const side = figure([{ both: "side left", by: 0.3, length: "Q" }]);
  pointClose(side.endPose.lead.left.position, [-0.4, 0]);
  pointClose(side.endPose.follow.right.position, [-0.3, 0.4]);
  assert.equal(side.steps[1].label, "side right");

  const diagonal = figure([
    { both: "diagonal forward right", by: Math.SQRT2 * 0.1, length: "Q" },
  ]);
  pointClose(diagonal.endPose.lead.left.position, [0, 0.1]);
  pointClose(diagonal.endPose.follow.right.position, [0.1, 0.5]);
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
  // (Turning round the lead, so that his step is the one written.)
  const { steps } = figure([
    {
      both: "forward",
      by: 0.3,
      turn: { right: 1 / 4 },
      turnCentre: "lead",
      length: "Q",
    },
  ]);
  assert.equal(steps[0].movement.type, "straight");
  if (steps[0].movement.type === "straight") {
    assert.equal(steps[0].movement.direction, 0);
  }
  assert.equal(steps[0].orientation, 90);
  assert.equal(steps[1].orientation, 270);
});

test("both: turning round the lead, he takes the step as written and she keeps her place in the hold", () => {
  // Lead: left foot forward 0.4 from (-0.1, 0) to (-0.1, 0.4), turning a
  // quarter right to face east; his right closes to its right (south),
  // (-0.1, 0.2). Follow: her right foot started at (0, 0.4), (0.1, 0.4)
  // from his left; that offset turns with the couple to (0.4, -0.1), so
  // it lands at (0.3, 0.3) -- not (0, 0.8), her own spot turned in
  // place. Facing west, her left closes to the south, (0.3, 0.1). She
  // ends 0.4 in front of him and 0.1 to his right (south): closed hold
  // turned a quarter right.
  const { endPose } = figure(
    [
      {
        both: "forward",
        by: 0.4,
        turn: { right: 1 / 4 },
        turnCentre: "lead",
        length: "Q",
      },
      { both: "close", length: "Q" },
    ],
    {
      expectEnd: {
        stance: "closed",
        moved: { forward: 0.3, right: -0.1 },
        turned: { right: 1 / 4 },
        leadStandingOn: "R",
      },
    },
  );
  pointClose(endPose.lead.left.position, [-0.1, 0.4]);
  pointClose(endPose.lead.right.position, [-0.1, 0.2]);
  pointClose(endPose.follow.right.position, [0.3, 0.3]);
  pointClose(endPose.follow.left.position, [0.3, 0.1]);
  assert.equal(endPose.follow.orientation, 270);
});

test("both: a step forward for the lead turns round the follow by default; he travels round her", () => {
  // The same row without a centre. He goes forward, so she is on the
  // inside: her right foot takes the written step (0.4 north, back for
  // her) from (0, 0.4) to (0, 0.8). His left foot started (-0.1, -0.4)
  // from hers; turned a quarter right that's (-0.4, 0.1), so he lands at
  // (-0.4, 0.9), a 0.95 stride to her 0.4. Then both close.
  const rows: StepRow[] = [
    { both: "forward", by: 0.4, turn: { right: "1/4" }, length: "Q" },
    { both: "close", length: "Q" },
  ];
  const { endPose, steps } = figure(rows, {
    expectEnd: {
      stance: "closed",
      moved: { forward: 0.8, right: -0.4 },
      turned: { right: 1 / 4 },
      leadStandingOn: "R",
    },
  });
  pointClose(endPose.follow.right.position, [0, 0.8]);
  pointClose(endPose.lead.left.position, [-0.4, 0.9]);
  // Same as writing it out.
  const explicit = figure([{ ...rows[0], turnCentre: "follow" }, rows[1]]);
  assert.deepEqual(explicit.endPose, endPose);
  // Labels are still the written step, not the worked-out direction.
  assert.equal(steps[0].label, "forward, turning 2/8 right");
  assert.equal(steps[1].label, "back, turning 2/8 right");
});

test("both: turning round the point between them, each travels round it", () => {
  // The centre starts halfway between his left foot (-0.1, 0) and her
  // right (0, 0.4), at (-0.05, 0.2), and moves 0.4 north to (-0.05, 0.6).
  // Each foot's offset from it, (-0.05, -0.2) and (0.05, 0.2), turns a
  // quarter right to (-0.2, 0.05) and (0.2, -0.05).
  const { endPose } = figure([
    {
      both: "forward",
      by: 0.4,
      turn: { right: 1 / 4 },
      turnCentre: "between",
      length: "Q",
    },
  ]);
  pointClose(endPose.lead.left.position, [-0.25, 0.65]);
  pointClose(endPose.follow.right.position, [0.15, 0.55]);
});

test("both: the default centre is whoever steps back, or between them on a step straight to the side", () => {
  const ends = (row: StepRow) => figure([row]).endPose;
  const back: StepRow = {
    both: "back",
    by: 0.4,
    turn: { right: 1 / 8 },
    length: "Q",
  };
  assert.deepEqual(ends(back), ends({ ...back, turnCentre: "lead" }));
  const diagonal: StepRow = {
    both: { forward: 0.2, right: -0.3 },
    turn: { left: 1 / 8 },
    length: "Q",
  };
  assert.deepEqual(ends(diagonal), ends({ ...diagonal, turnCentre: "follow" }));
  const side: StepRow = {
    both: "side left",
    by: 0.4,
    turn: { left: 1 / 8 },
    length: "Q",
  };
  assert.deepEqual(ends(side), ends({ ...side, turnCentre: "between" }));
  // Without a turn the centre makes no difference: the plain mirror.
  const straight = figure([{ both: "forward", by: 0.4, length: "Q" }]);
  pointClose(straight.endPose.lead.left.position, [-0.1, 0.4]);
  pointClose(straight.endPose.follow.right.position, [0, 0.8]);
});

test("both: turnCentre needs `both`, a turn and a step on the floor", () => {
  assert.throws(
    () =>
      figure([
        {
          lead: "forward",
          by: 0.4,
          turn: { right: 1 / 8 },
          turnCentre: "lead",
          length: "Q",
        },
      ]),
    /step 1: `turnCentre` only goes with `both`/,
  );
  assert.throws(
    () =>
      figure([{ both: "forward", by: 0.4, turnCentre: "follow", length: "Q" }]),
    /step 1: `turnCentre` needs a `turn` on the row/,
  );
  assert.throws(
    () =>
      figure([
        {
          both: "side left",
          by: 0.3,
          air: true,
          turn: { right: 1 / 8 },
          turnCentre: "between",
          length: "Q",
        },
      ]),
    /step 1: `turnCentre` can't go on an airborne step/,
  );
});

test("both: a turn on in place or pivot is rejected, since the hold would come apart", () => {
  for (const action of ["in place", "pivot"] as const) {
    assert.throws(
      () =>
        figure([
          { both: "forward", by: 0.4, length: "Q" },
          { both: action, turn: { right: 1 / 8 }, length: "Q" },
        ]),
      (error: unknown) =>
        error instanceof FigureError &&
        /step 2: with `both`, a turn can't go on/.test(error.message),
    );
  }
});

test("both: a turning close carries its turn back into the feet of the step before, while each body turns on its own count", () => {
  // A quarter turn split 1/8 on the side step and 1/8 on the close (a
  // book box turn) puts every foot where the whole quarter on the side
  // step does; only the bodies' facing differs, and only until the close.
  const split = figure(
    [
      { both: "forward", by: 0.5, length: "Q" },
      {
        both: { forward: 0.4, right: 0.5 },
        turn: { right: "1/8" },
        length: "Q",
      },
      { both: "close", turn: { right: "1/8" }, length: "Q" },
    ],
    { skipChecks: ["crossed feet", "own feet", "partner spacing"] },
  );
  const whole = figure([
    { both: "forward", by: 0.5, length: "Q" },
    {
      both: { forward: 0.4, right: 0.5 },
      turn: { right: "1/4" },
      length: "Q",
    },
    { both: "close", length: "Q" },
  ]);
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      const { x, y } = whole.endPose[partner][foot].position;
      pointClose(split.endPose[partner][foot].position, [x, y]);
    }
  }
  assert.equal(split.endPose.lead.orientation, 90);
  assert.equal(split.endPose.follow.orientation, 270);
  // The side step's bodies have turned only their own eighth.
  assert.deepEqual(
    split.steps.slice(2, 4).map((step) => step.orientation),
    [45, 225],
  );
  assert.deepEqual(
    whole.steps.slice(2, 4).map((step) => step.orientation),
    [90, 270],
  );
  // The hold check passes (it judges the side step against the hold
  // the turn finishes in), and the figure ends in closed hold. Here the
  // side step goes straight to the side, so the couple turns round the
  // point between the moving feet, (0.15, 0.2); his right foot lands at
  // (0.35, 0.25) and he closes to (0.35, 0.45): his feet are centred
  // 0.35 forward and 0.35 right of where they started.
  assert.doesNotThrow(() =>
    figure(
      [
        { both: "forward", by: 0.5, length: "Q" },
        { both: "side right", by: 0.4, turn: { right: "1/8" }, length: "Q" },
        { both: "close", turn: { right: "1/8" }, length: "Q" },
      ],
      {
        skipChecks: ["crossed feet", "partner spacing"],
        expectEnd: {
          stance: "closed",
          turned: { right: "1/4" },
          moved: { forward: 0.35, right: 0.35 },
        },
      },
    ),
  );
});

test("both: a turn spread over consecutive mirrored steps still ends exactly in hold", () => {
  // The turn starts on count 1 (1/24), continues on count 2 (1/8) and
  // finishes on the close (1/12). Count 1 moves his left foot and her
  // right; count 2 moves the other pair, which last stood in the
  // un-turned hold, so it turns by everything since: the whole quarter.
  // Without that the follow ends about 10 cm out of place.
  const { endPose } = figure(
    [
      {
        both: { forward: -0.4, right: -0.2 },
        foot: "L",
        turn: { right: "1/24" },
        length: "Q",
      },
      {
        both: { forward: -0.6, right: -0.3 },
        turn: { right: "1/8" },
        length: "Q",
      },
      { both: "close", turn: { right: "1/12" }, length: "Q" },
    ],
    { skipChecks: ["own feet"] },
  );
  const lead = {
    x: (endPose.lead.left.position.x + endPose.lead.right.position.x) / 2,
    y: (endPose.lead.left.position.y + endPose.lead.right.position.y) / 2,
  };
  const follow = {
    x: (endPose.follow.left.position.x + endPose.follow.right.position.x) / 2,
    y: (endPose.follow.left.position.y + endPose.follow.right.position.y) / 2,
  };
  // Facing east (90): the follow 0.4 in front (+x) and 0.1 to his right
  // (-y).
  assert.equal(endPose.lead.orientation, 90);
  pointClose(follow, [lead.x + PARTNER_DISTANCE, lead.y - HOLD_OFFSET]);
});

test("both: a turning close needs a mirrored travelling step before it", () => {
  for (const before of [
    { lead: "forward", follow: "back", by: 0.4, length: "Q" },
    { both: "in place", length: "Q" },
  ] as StepRow[]) {
    assert.throws(
      () =>
        figure([
          { both: "forward", by: 0.4, length: "Q" },
          before,
          { both: "close", turn: { right: "1/8" }, length: "Q" },
        ]),
      /step 3: with `both`, a turn on a close needs the step before it to be a mirrored \(`both`\) travelling step/,
    );
  }
});

test("a close changes weight late; other steps, and a close without weight, don't say", () => {
  const { steps } = figure([
    { both: "forward", by: 0.4, length: "Q" },
    { both: "close", length: "Q" },
    { both: "back", by: 0.4, length: "Q" },
    { both: "close", weight: false, length: "Q" },
  ]);
  const lead = steps.filter((step) => step.partner === "lead");
  assert.deepEqual(
    lead.map((step) => step.weightTiming),
    [undefined, "late", undefined, undefined],
  );
  // The follow's mirrored close is late too.
  assert.equal(
    steps.filter((step) => step.partner === "follow")[1].weightTiming,
    "late",
  );
});

// The whisk from the owner's class: forward, side, then the lead's left
// foot crosses behind his right while both partners open an eighth into
// promenade. Count 3's offsets (to the millimetre) land the crossing
// feet where "crossed promenade" puts them.
const WHISK_STEPS: StepRow[] = [
  { both: "forward", by: 0.5, foot: "L", beat: 1 },
  { both: { forward: 0.5, right: 0.2 }, beat: 2 },
  {
    lead: {
      go: { forward: -0.141, right: 0.612 },
      turn: { left: "1/8" },
      cross: true,
    },
    follow: {
      go: { forward: -0.141, right: -0.612 },
      turn: { right: "1/8" },
      cross: true,
    },
    beat: 3,
  },
];

test("crossed promenade: a whisk ends in it, measured from where the lead's right foot went", () => {
  assert.doesNotThrow(() =>
    figure(WHISK_STEPS, {
      time: "3/4",
      skipChecks: ["own feet", "hold"],
      expectEnd: {
        stance: "crossed promenade",
        moved: { forward: 0.5, right: 0.3 },
        leadStandingOn: "L",
      },
    }),
  );
});

test("crossed promenade: a figure can start in it, opened an eighth each with the crossing feet behind", () => {
  // Lead's right foot at the origin, facing 315; his left 0.25 behind and
  // 0.05 to the right in that facing: 0.3 * (sin 45, -cos 45) =
  // (0.2121, -0.1414). Follow's left at (0.1, 0.4) facing 225 (offset
  // to his right in the closed hold they opened from); her right the
  // mirror image, at (0.3121, 0.5414). Both stand on the crossed
  // foot, so the lead's first step is with his right.
  const { startPose, steps } = figure(
    [{ both: "diagonal forward left", by: 0.5, length: "Q" }],
    { start: "crossed promenade" },
  );
  const s = Math.SQRT1_2;
  pointClose(startPose.lead.right.position, [0, 0]);
  pointClose(startPose.lead.left.position, [0.3 * s, -0.2 * s]);
  pointClose(startPose.follow.left.position, [0.1, 0.4]);
  pointClose(startPose.follow.right.position, [0.1 + 0.3 * s, 0.4 + 0.2 * s]);
  assert.equal(startPose.lead.orientation, 315);
  assert.equal(startPose.follow.orientation, 225);
  assert.equal(startPose.lead.left.weight, 1);
  assert.equal(startPose.follow.right.weight, 1);
  assert.equal(steps[0].foot, "right");
});

test("promenade apart: the leading feet at the front of the V, the trailing ones closed behind", () => {
  // Lead's left at the origin facing 315; his right 0.4 back along the
  // line of travel (+x) and 0.1 to his right, (s, s) * 0.1:
  // (0.4 + 0.1s, 0.1s). The partners have separated by 0.05 * sqrt 2
  // each, so the follow's right is at (0.1, 0.4 + 0.1 * sqrt 2) (0.1 for
  // the offset hold), facing 225; her left 0.4 back and 0.1 to her left,
  // (s, -s) * 0.1.
  const { startPose, steps } = figure(
    [{ both: "diagonal forward left", by: 0.5, length: "Q" }],
    { start: "promenade apart" },
  );
  const s = Math.SQRT1_2;
  pointClose(startPose.lead.left.position, [0, 0]);
  pointClose(startPose.lead.right.position, [0.4 + 0.1 * s, 0.1 * s]);
  const gap = 0.4 + 0.1 * Math.SQRT2;
  pointClose(startPose.follow.right.position, [0.1, gap]);
  pointClose(startPose.follow.left.position, [0.5 + 0.1 * s, gap - 0.1 * s]);
  assert.equal(startPose.lead.orientation, 315);
  assert.equal(startPose.follow.orientation, 225);
  assert.equal(startPose.lead.left.weight, 1);
  assert.equal(startPose.follow.right.weight, 1);
  assert.equal(steps[0].foot, "right");
});

test("tango promenade: inside feet standing, his left as in closed, her right still in front of it", () => {
  // Lead's right at the origin facing 315, his left STANCE_WIDTH to his
  // left (no draw-back in the standard hold); the follow's left 0.4
  // across the line from his right and 0.1 back along it, facing 225,
  // her right 0.4 in front of his left and 0.1 to its right in his
  // facing, where the link's first quick left it. Each stands on the
  // inside foot, so the lead's first step is with his left.
  const { startPose, steps } = figure(
    [{ both: "diagonal forward left", by: 0.2, length: "S" }],
    { start: "tango promenade" },
  );
  const r = Math.SQRT1_2;
  pointClose(startPose.lead.right.position, [0, 0]);
  pointClose(startPose.lead.left.position, [-0.2 * r, -0.2 * r]);
  pointClose(startPose.follow.left.position, [0.1, 0.4]);
  pointClose(startPose.follow.right.position, [
    -0.2 * r + 0.1 * r - 0.4 * r,
    -0.2 * r + 0.1 * r + 0.4 * r,
  ]);
  assert.equal(startPose.lead.orientation, 315);
  assert.equal(startPose.follow.orientation, 225);
  assert.equal(startPose.lead.right.weight, 1);
  assert.equal(startPose.follow.left.weight, 1);
  assert.equal(steps[0].foot, "left");
});

test("crossed promenade: a figure starting in it follows a whisk with no gap", () => {
  const whisk = figure(WHISK_STEPS, { time: "3/4" });
  const after = figure(
    [{ both: "diagonal forward left", by: 0.5, length: "Q" }],
    { start: "crossed promenade" },
  );
  const join = assessJoin(whisk.endPose, {
    ...after,
    id: "after",
    steps: after.steps.map((step, index) => ({ ...step, id: String(index) })),
  });
  assert.equal(join.fits, true, JSON.stringify(join.issues));
  assert.ok(join.maxFootGap < 1e-3);
});

test("path around the front: the foot sets off forward and curves round to land where the step says", () => {
  // Lead's left foot at (-0.1, 0), facing north, goes 0.3 forward and 0.3
  // right. Setting off north, the only circle through the landing spot
  // is a quarter circle of radius 0.3 curving right, centred on (0.2, 0):
  // it ends at (0.2, 0.3), and halfway round it is at
  // (0.2 - 0.3 cos 45°, 0.3 sin 45°).
  const authored = defineFigure({
    name: "Curve",
    style: "test",
    time: "4/4",
    skipChecks: ["crossed feet", "partner spacing", "own feet", "hold"],
    steps: [
      {
        lead: { go: { forward: 0.3, right: 0.3 }, path: "around the front" },
        length: "Q",
      },
    ],
  });
  const step = authored.steps[0];
  assert.equal(step.movement.type, "arc");
  if (step.movement.type === "arc") {
    assert.ok(Math.abs(step.movement.curvature - 1 / 0.3) < 1e-9);
    assert.ok(Math.abs(step.movement.arcLength - (0.3 * Math.PI) / 2) < 1e-9);
  }
  pointClose(authored.endPose.lead.left.position, [0.2, 0.3]);
  const curve = { ...authored, id: "c", steps: [{ ...step, id: "0" }] };
  const halfway = poseAtBeat(curve, 0.5).lead.left.position;
  pointClose(halfway, [0.2 - 0.3 * Math.SQRT1_2, 0.3 * Math.SQRT1_2]);
});

test("path around the front: straight ahead stays straight; it needs a travelling step and a spot in front", () => {
  const straight = figure([
    { lead: { go: "forward", by: 0.4, path: "around the front" }, length: "Q" },
  ]);
  assert.equal(straight.steps[0].movement.type, "straight");
  assert.throws(
    () =>
      figure([
        { lead: { go: "in place", path: "around the front" }, length: "Q" },
      ]),
    /step 1 \(lead\): "path" needs a step that travels along the floor/,
  );
  assert.throws(
    () =>
      figure([
        {
          lead: { go: "back", by: 0.4, path: "around the front" },
          length: "Q",
        },
      ]),
    /"around the front" can't reach a spot 180° round/,
  );
});

test("path around the back: the foot sets off diagonally back towards its side and curves round to land where the step says", () => {
  // Lead's left foot at (-0.1, 0), facing north, lands 0.4 to the left
  // at (-0.5, 0). The spot is to the left, so the foot sets off
  // diagonally back left (setOff -135, heading 225). The spot is 90°
  // left of the facing, 45° round from the set-off heading, so the arc
  // turns through 90° and bends right: a quarter circle with chord 0.4.
  const authored = figure([
    {
      lead: { go: "side left", by: 0.4, path: "around the back" },
      length: "Q",
    },
  ]);
  const step = authored.steps[0];
  assert.equal(step.movement.type, "arc");
  if (step.movement.type === "arc") {
    assert.equal(step.movement.setOff, -135);
    assert.ok(step.movement.curvature > 0);
    assert.ok(
      Math.abs(
        step.movement.arcLength - (0.4 * Math.PI) / 4 / Math.sin(Math.PI / 4),
      ) < 1e-9,
    );
  }
  pointClose(authored.endPose.lead.left.position, [-0.5, 0]);
  // Partway, the foot is behind where it started.
  const curve = { ...authored, id: "c", steps: [{ ...step, id: "0" }] };
  assert.ok(poseAtBeat(curve, 0.25).lead.left.position.y < -0.05);

  // A spot to the right sets off diagonally back right.
  const right = figure([
    {
      lead: { go: "side right", by: 0.4, path: "around the back" },
      length: "Q",
    },
  ]).steps[0].movement;
  assert.equal(right.type === "arc" && right.setOff, 135);
});

test("path around the back: it needs a spot to one side", () => {
  for (const go of ["forward", "back"] as const) {
    assert.throws(
      () =>
        figure([
          { lead: { go, by: 0.4, path: "around the back" }, length: "Q" },
        ]),
      /"around the back" needs a spot to one side/,
    );
  }
});

test("crossed legs: feet uncross the way they crossed, not through each other", () => {
  // The lead's right foot crosses 0.2 in front of his left: from
  // (0.1, 0) to (-0.3, 0.3). Then his left foot, which is behind, goes
  // to (-0.5, 1.0). In a straight line it comes out in front of the
  // right foot while the feet are still crossed: its leg would pass
  // through the right leg. Round the back, it stays behind until the
  // feet have uncrossed.
  const steps = (path?: "around the back"): StepRow[] => [
    {
      lead: { go: { forward: 0.3, right: -0.4 }, foot: "R", cross: true },
      length: "Q",
    },
    { lead: { go: { forward: 1.0, right: -0.4 }, path }, length: "Q" },
  ];
  assert.throws(
    () =>
      figure(steps(), { skipChecks: ["partner spacing", "own feet", "hold"] }),
    /step 2\) the lead's left foot has come out in front of the right while the feet are still crossed, so the legs would pass through each other/,
  );
  assert.doesNotThrow(() =>
    figure(steps("around the back"), {
      skipChecks: ["partner spacing", "own feet", "hold"],
    }),
  );
  // It belongs to the crossed-feet check, so skipping that skips it.
  assert.doesNotThrow(() =>
    figure(steps(), {
      skipChecks: ["crossed feet", "partner spacing", "own feet", "hold"],
    }),
  );
});

test("close with by: the feet end that far apart instead of stance width", () => {
  // Lead: left forward 0.4 to (-0.1, 0.4), then the right closes to 0.1
  // beside it: (0, 0.4).
  const { endPose } = figure([
    { lead: "forward", by: 0.4, length: "Q" },
    { lead: { go: "close", by: 0.1 }, length: "Q" },
  ]);
  pointClose(endPose.lead.right.position, [0, 0.4]);
});

test("crossed feet: a step may not put the left foot right of the right foot unless it says cross", () => {
  // Lead's left foot from (-0.1, 0) to 0.2 right of his right foot.
  const crossing: StepRow[] = [
    { lead: { go: { forward: 0.1, right: 0.4 } }, length: "Q" },
  ];
  assert.throws(
    () => figure(crossing, { skipChecks: ["own feet", "hold"] }),
    /the lead's left foot is 0\.\d\d to the right of the right foot, so the feet are crossed\. If that's meant, add "cross": true/,
  );
  assert.doesNotThrow(() =>
    figure(
      [
        {
          lead: { go: { forward: 0.1, right: 0.4 }, cross: true },
          length: "Q",
        },
      ],
      { skipChecks: ["partner spacing", "own feet", "hold"] },
    ),
  );
  assert.doesNotThrow(() =>
    figure(crossing, { skipChecks: ["crossed feet", "own feet", "hold"] }),
  );
});

test("crossed feet: a figure starting crossed may stay crossed until the feet uncross, but not cross again unannounced", () => {
  // From crossed promenade the lead's right foot steps 0.3 to his right,
  // which uncrosses the feet; then his left crosses back over without
  // saying so.
  assert.doesNotThrow(() =>
    figure([{ lead: { go: "side right", by: 0.3 }, length: "Q" }], {
      start: "crossed promenade",
      skipChecks: ["partner spacing", "own feet", "hold"],
    }),
  );
  assert.throws(
    () =>
      figure(
        [
          { lead: { go: "side right", by: 0.3 }, length: "Q" },
          { lead: { go: { forward: 0, right: 0.8 } }, length: "Q" },
        ],
        {
          start: "crossed promenade",
          skipChecks: ["partner spacing", "own feet", "hold"],
        },
      ),
    /step 2\) the lead's left foot is .* so the feet are crossed/,
  );
});

test("partner spacing: a lead foot may not come within 10 cm of a follow foot", () => {
  // The lead's left foot goes 0.35 forward and 0.1 right, from (-0.1, 0)
  // straight at the follow's right foot at (0, 0.4) (she doesn't move).
  // The check reports the first moment it gets too close: seven eighths
  // of the way, at (-0.0125, 0.30625), 0.095 short of her foot.
  const treading: StepRow[] = [
    { lead: { forward: 0.35, right: 0.1 }, length: "Q" },
  ];
  assert.throws(
    () => figure(treading, { skipChecks: ["own feet", "hold"] }),
    /at beat 1\.875 the lead's left foot and the follow's right foot are 0\.09 apart, centre to centre \(at least 0\.1 needed\)/,
  );
  assert.doesNotThrow(() =>
    figure(treading, { skipChecks: ["partner spacing", "own feet", "hold"] }),
  );
  // Walking forward in the offset hold, his right foot passes between
  // her feet, 10 cm from each: allowed.
  assert.doesNotThrow(() =>
    figure(
      [
        { both: "forward", by: 0.4, foot: "L", length: "Q" },
        { both: "forward", by: 0.5, length: "Q" },
      ],
      { skipChecks: ["own feet", "hold"] },
    ),
  );
});

test("hold: after every row the partners are in closed hold or promenade, within tolerance", () => {
  // The follow side-steps alone, her right foot 0.3 to her right (west),
  // taking weight: her weight goes from her left foot at (0.2, 0.4) to
  // her right at (-0.3, 0.4), 0.5 from where closed hold puts it (over
  // her left, since the lead stands on his right).
  const apart: StepRow[] = [
    { follow: { go: "side right", by: 0.3 }, length: "Q" },
  ];
  assert.throws(
    () => figure(apart, { skipChecks: ["own feet"] }),
    /after step 1 \(beat 2\) the partners aren't in hold: the nearest is closed hold, but the follow is 0\.50 from where it puts her \(at most 0\.2\) and her facing is 0° off \(at most 30°\)/,
  );
  assert.doesNotThrow(() =>
    figure(apart, { skipChecks: ["own feet", "hold"] }),
  );

  // Turning away: her weight stays put but she faces 45° off him.
  assert.throws(
    () =>
      figure(
        [{ follow: { go: "pivot", turn: { left: "1/8" } }, length: "Q" }],
        { skipChecks: ["own feet"] },
      ),
    /her facing is 45° off/,
  );

  // Within tolerance: her right foot 0.1 to her left, taking weight,
  // leaves her weight 0.1 out, still in hold.
  assert.doesNotThrow(() =>
    figure([{ follow: { go: "side left", by: 0.1 }, length: "Q" }], {
      skipChecks: ["own feet"],
    }),
  );

  // Mirrored steps keep the hold, turning or not, and the waltz
  // promenade stances count as in hold standing on either foot. (In
  // tango promenade only the inside feet are: her free right foot is
  // still in front of his left, where the link left it.)
  assert.doesNotThrow(() =>
    figure(
      [
        { both: "forward", by: 0.5, length: "Q" },
        { both: "side right", by: 0.4, turn: { right: "1/4" }, length: "Q" },
        { both: "close", length: "Q" },
      ],
      { skipChecks: ["own feet"] },
    ),
  );
  for (const start of ["crossed promenade", "promenade apart"] as const) {
    assert.doesNotThrow(() =>
      figure([{ both: "in place", length: "Q" }], {
        start,
        skipChecks: ["own feet"],
      }),
    );
  }
});

test("pointing: the moving foot points that much further round than the body, for one partner or both", () => {
  // A natural turn's first half, inside partner pointing further: both
  // turn a quarter right, and the follow's foot points another eighth.
  const { steps } = figure([
    {
      both: "forward",
      by: 0.4,
      turn: { right: "1/4" },
      pointing: { follow: { right: "1/8" } },
      length: "Q",
    },
  ]);
  const [lead, follow] = steps;
  assert.equal(lead.orientation, 90);
  assert.equal("footDirection" in lead, false);
  assert.equal(follow.orientation, 270);
  assert.equal(follow.footDirection, 315);

  // One amount on the row applies to each partner it covers; a partner
  // object uses its own.
  const both = figure([
    { both: "side left", by: 0.3, pointing: { left: "1/16" }, length: "Q" },
  ]);
  assert.deepEqual(
    both.steps.map((step) => step.footDirection),
    [337.5, 157.5],
  );
  const own = figure([
    {
      lead: { go: "forward", by: 0.3, pointing: { right: 0.25 } },
      follow: "back",
      by: 0.3,
      pointing: { left: "1/8" },
      length: "Q",
    },
  ]);
  assert.deepEqual(
    own.steps.map((step) => step.footDirection),
    [90, 135],
  );
});

test("own feet: a dancer's feet, as footprints, may not overlap unless crossed on purpose", () => {
  // Closing to 5 cm would put the lead's feet 4 cm into each other; the
  // check reports the first moment past its few millimetres' slack, as
  // the foot comes in.
  const tooClose: StepRow[] = [
    { lead: { go: "close", by: 0.05 }, length: "Q" },
  ];
  assert.throws(
    () =>
      figure(tooClose, {
        skipChecks: ["crossed feet", "partner spacing", "hold"],
      }),
    /at beat 1\.563 \(step 1\) the lead's feet overlap by 0\.017 \(feet drawn 0\.26 long and 0\.09 wide\)/,
  );
  assert.doesNotThrow(() =>
    figure(tooClose, {
      skipChecks: ["crossed feet", "own feet", "partner spacing", "hold"],
    }),
  );
  // Closing to the usual 20 cm is clear.
  assert.doesNotThrow(() =>
    figure([{ lead: "close", length: "Q" }], {
      skipChecks: ["crossed feet", "partner spacing", "hold"],
    }),
  );
  // A step marked `cross` may cross one foot over the other.
  assert.doesNotThrow(() =>
    figure(
      [
        {
          lead: { go: "side left", by: 0.05, cross: true, foot: "R" },
          length: "Q",
        },
      ],
      { skipChecks: ["partner spacing", "hold"] },
    ),
  );
});

test("close lands beside the standing foot at stance width, across the facing after any turn", () => {
  const { endPose } = figure([
    { both: "forward", by: 0.4, length: "Q" },
    { both: "close", length: "Q" },
  ]);
  pointClose(endPose.lead.left.position, [-0.1, 0.4]);
  pointClose(endPose.lead.right.position, [0.1, 0.4]);
  pointClose(endPose.follow.right.position, [0, 0.8]);
  pointClose(endPose.follow.left.position, [0.2, 0.8]);

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
  pointClose(pivot.endPose.follow.left.position, [0.2, 0.4]);
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
  pointClose(boleo.endPose.follow.right.position, [0, 0.4]);
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
          follow: { L: [0.2, 0.4], R: [0, 1.0] },
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
      /lead steps overlap on beat 1/,
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

test("expectBeats passes when the steps last that long, and fails with both lengths otherwise", () => {
  // S, Q, Q with the default slow of 2 beats: 2 + 1 + 1 = 4 beats.
  const steps: StepRow[] = [
    { both: "forward", by: 0.3, length: "S" },
    { both: "forward", by: 0.3, length: "Q" },
    { both: "close", length: "Q" },
  ];
  assert.doesNotThrow(() => figure(steps, { expectBeats: 4 }));
  assert.throws(
    () => figure(steps, { expectBeats: 3 }),
    (error: unknown) =>
      error instanceof FigureError &&
      /the steps last 4 beats, but expectBeats says 3/.test(error.message),
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

// ---------------------------------------------------------------------
// parseFigureDefinition: checking the shape of figure files (JSON)
// ---------------------------------------------------------------------

const VALID_FILE = {
  name: "Rock Step",
  style: "cha-cha",
  time: "4/4",
  notes: "A test figure.",
  steps: [
    {
      both: "forward",
      by: 0.3,
      beat: 1,
      label: { lead: "rock", follow: "rock back" },
    },
    { both: "in place", beat: 2 },
    { both: "close", beat: 3 },
  ],
  expectEnd: { stance: "closed", leadStandingOn: "L" },
};

function problemsOf(value: unknown): string {
  try {
    parseFigureDefinition(value, "rock-step.json");
  } catch (error) {
    assert.ok(error instanceof FigureError);
    return error.message;
  }
  assert.fail("expected parseFigureDefinition to reject the file");
}

test("parseFigureDefinition: cross is true or false, and skipChecks names known checks", () => {
  assert.match(
    problemsOf({
      ...VALID_FILE,
      steps: [{ both: "forward", by: 0.3, cross: "yes", beat: 1 }],
    }),
    /steps\[0\]\.cross: should be true or false/,
  );
  assert.match(
    problemsOf({ ...VALID_FILE, skipChecks: ["crossed feet", "everything"] }),
    /skipChecks\[1\]: should be one of: "crossed feet", "own feet", "partner spacing", "hold"/,
  );
});

test('parseFigureDefinition: path is "around the front" or "around the back"', () => {
  assert.match(
    problemsOf({
      ...VALID_FILE,
      steps: [{ both: "forward", by: 0.3, path: "around the side", beat: 1 }],
    }),
    /steps\[0\]\.path: should be one of: "around the front", "around the back"/,
  );
  assert.doesNotThrow(() =>
    parseFigureDefinition(
      {
        ...VALID_FILE,
        steps: [
          { both: "side left", by: 0.3, path: "around the back", beat: 1 },
        ],
      },
      "rock-step.json",
    ),
  );
});

test("parseFigureDefinition: stances are closed or crossed promenade", () => {
  assert.doesNotThrow(() =>
    parseFigureDefinition(
      { ...VALID_FILE, start: "crossed promenade" },
      "rock-step.json",
    ),
  );
  assert.match(
    problemsOf({ ...VALID_FILE, start: "promenade" }),
    /start: should be one of: "closed", "crossed promenade", "promenade apart", "tango promenade"/,
  );
});

test("parseFigureDefinition: a well-formed file is accepted unchanged and works with defineFigure", () => {
  const parsed = parseFigureDefinition(
    JSON.parse(JSON.stringify(VALID_FILE)),
    "rock-step.json",
  );
  assert.deepEqual(parsed, VALID_FILE);
  assert.doesNotThrow(() => defineFigure(parsed));
});

test("parseFigureDefinition: an offset needs forward or right in metres, and nothing else", () => {
  const withStep = (step: unknown) =>
    problemsOf({ ...VALID_FILE, steps: [step] });
  assert.match(
    withStep({ both: {}, beat: 1 }),
    /steps\[0\]\.both: needs "forward", "right" or both, in metres/,
  );
  assert.match(
    withStep({ both: { forward: "far" }, beat: 1 }),
    /steps\[0\]\.both\.forward: should be a number/,
  );
  assert.match(
    withStep({ lead: { right: 0.2, up: 1 }, beat: 1 }),
    /steps\[0\]\.lead\.up: unknown field \(expected one of: forward, right\)/,
  );
  assert.match(
    withStep({ follow: { go: { left: 0.2 } }, beat: 1 }),
    /steps\[0\]\.follow\.go\.left: unknown field/,
  );
});

test("parseFigureDefinition: pointing is a turn, or one per partner on a row", () => {
  const file = (row: Record<string, unknown>) => ({
    ...VALID_FILE,
    steps: [{ both: "forward", by: 0.3, beat: 1, ...row }],
  });
  assert.doesNotThrow(() =>
    parseFigureDefinition(file({ pointing: { right: "1/8" } }), "a.json"),
  );
  assert.doesNotThrow(() =>
    parseFigureDefinition(
      file({ pointing: { lead: { left: 0.1 } } }),
      "a.json",
    ),
  );
  assert.match(
    problemsOf(file({ pointing: { lead: { up: 1 } } })),
    /steps\[0\]\.pointing\.lead: should be \{ "right": … \} or \{ "left": … \}/,
  );
  assert.match(
    problemsOf(file({ pointing: { lead: { left: 0.1 }, everyone: 1 } })),
    /steps\[0\]\.pointing\.everyone: unknown field/,
  );
});

test("footwork and riseTiming: kept on the steps, one footwork each on a mirrored row", () => {
  const { steps } = figure([
    {
      both: "forward",
      by: 0.5,
      rise: 0.02,
      riseTiming: "late",
      footwork: { lead: "HT", follow: "TH" },
      length: "Q",
    },
    { both: "side right", by: 0.4, footwork: "T", length: "Q" },
  ]);
  assert.deepEqual(
    steps.map((step) => [step.footwork, step.riseTiming]),
    [
      ["HT", "late"],
      ["TH", "late"],
      ["T", undefined],
      ["T", undefined],
    ],
  );
});

test("parseFigureDefinition: footwork is chart letters, or one per partner on a row; riseTiming is even or late", () => {
  const file = (row: Record<string, unknown>) => ({
    ...VALID_FILE,
    steps: [{ both: "forward", by: 0.3, beat: 1, ...row }],
  });
  assert.doesNotThrow(() =>
    parseFigureDefinition(
      file({ footwork: { lead: "HT", follow: "TH" }, riseTiming: "late" }),
      "a.json",
    ),
  );
  assert.match(
    problemsOf(file({ footwork: "heel" })),
    /steps\[0\]\.footwork: should be footwork letters/,
  );
  assert.match(
    problemsOf(file({ footwork: { lead: "HT", everyone: "T" } })),
    /steps\[0\]\.footwork\.everyone: unknown field/,
  );
  assert.match(
    problemsOf(file({ riseTiming: "early" })),
    /steps\[0\]\.riseTiming: should be one of/,
  );
});

test("parseFigureDefinition: turns can be written as fractions of a turn in text", () => {
  const authored = defineFigure(
    parseFigureDefinition(
      {
        name: "Pivot",
        style: "tango",
        time: "4/4",
        steps: [
          { follow: { go: "pivot", turn: { left: "1/8" } }, length: "Q" },
        ],
        // A follow turning on her own isn't in hold.
        skipChecks: ["own feet", "hold"],
      },
      "pivot.json",
    ),
  );
  // "1/8" left from facing 180.
  assert.equal(authored.steps[0].orientation, 135);
  assert.equal(authored.steps[0].label, "pivot 1/8 left");
});

test("parseFigureDefinition: reports every problem at once, each with the file and where it is", () => {
  const message = problemsOf({
    name: "Rock Step",
    style: "cha-cha",
    time: "four four",
    stpes: [],
    steps: [
      { both: "forwards", by: "0.3", beats: 1 },
      { lead: { go: "pivot", turn: { clockwise: 0.25 } }, length: "M" },
      { follow: { by: 0.2 }, beat: 2, foot: "left" },
    ],
    expectEnd: { stance: "open" },
  });
  assert.match(message, /^rock-step\.json:/);
  for (const expected of [
    /time: should look like "3\/4"/,
    /stpes: unknown field/,
    /steps\[0\]\.both: should be a number of degrees, \{ "forward": …, "right": … \}, or one of: .*"forward"/,
    /steps\[0\]\.by: should be a positive number/,
    /steps\[0\]\.beats: unknown field/,
    /steps\[1\]\.lead\.turn: should be \{ "right": … \} or \{ "left": … \}/,
    /steps\[1\]\.length: should be one of: "S", "Q"/,
    /steps\[2\]\.follow\.go: is required/,
    /steps\[2\]\.foot: should be one of: "L", "R"/,
    /expectEnd\.stance: should be one of: "closed"/,
  ]) {
    assert.match(message, expected);
  }
});

test("parseFigureDefinition: required fields, bad fractions and incomplete expectEnd are caught", () => {
  const message = problemsOf({
    steps: [{ both: "pivot", turn: { left: "one eighth" }, length: "Q" }],
    expectEnd: { moved: { forward: 1 } },
  });
  assert.match(message, /name: is required/);
  assert.match(message, /style: is required/);
  assert.match(message, /time: is required/);
  assert.match(
    message,
    /steps\[0\]\.turn\.left: should be a positive fraction of a turn/,
  );
  assert.match(message, /expectEnd: needs either "stance" or "feet"/);

  assert.match(
    problemsOf({ name: "X", style: "y", time: "4/4", steps: [] }),
    /steps: should be a list with at least one step/,
  );
  assert.match(
    problemsOf({
      name: "X",
      style: "y",
      time: "4/4",
      steps: [{ both: "forward", by: 0.3, beat: 1 }],
      expectEnd: { feet: { lead: { L: [0, 0], R: [0] }, follow: {} } },
    }),
    /expectEnd\.feet\.lead\.R: should be \[x, y\] in metres/,
  );
  assert.match(
    problemsOf([1, 2]),
    /rock-step\.json: should contain a single JSON object/,
  );
});

test("pathSetOff: a custom departure changes the arc while preserving its landing point", () => {
  // Lead starts at (-.1,0), sets off east, and follows a quarter circle
  // turning left to (.2,.3). The radius is .3 and centre is (-.1,.3).
  const authored = figure([
    {
      lead: {
        go: { forward: 0.3, right: 0.3 },
        path: "around the front",
        pathSetOff: 90,
      },
      length: "Q",
    },
  ]);
  const step = authored.steps[0];
  assert.equal(step.movement.type, "arc");
  if (step.movement.type === "arc") {
    assert.equal(step.movement.setOff, 90);
    assert.ok(Math.abs(step.movement.curvature + 1 / 0.3) < 1e-9);
  }
  pointClose(authored.endPose.lead.left.position, [0.2, 0.3]);
  const f = { ...authored, id: "departure", steps: [{ ...step, id: "0" }] };
  pointClose(poseAtBeat(f, 0.5).lead.left.position, [
    -0.1 + 0.3 * Math.SQRT1_2,
    0.3 - 0.3 * Math.SQRT1_2,
  ]);
  assert.throws(
    () => figure([{ both: "forward", by: 0.3, pathSetOff: 45, length: "Q" }]),
    /pathSetOff.*needs a curved/,
  );
});

test("per-partner paths: curve only the named dancer on a mirrored step", () => {
  const plain = figure([{ both: { forward: 0.3, right: 0.3 }, length: "Q" }]);
  const curved = figure([
    {
      both: { forward: 0.3, right: 0.3 },
      path: { lead: "around the front" },
      pathSetOff: { lead: 90 },
      length: "Q",
    },
  ]);
  assert.equal(curved.steps[0].movement.type, "arc");
  if (curved.steps[0].movement.type === "arc")
    assert.equal(curved.steps[0].movement.setOff, 90);
  assert.deepEqual(curved.steps[1], plain.steps[1]);
  pointClose(curved.endPose.lead.left.position, [0.2, 0.3]);
  pointClose(curved.endPose.follow.right.position, [0.3, 0.7]);
});

test("per-partner paths: row options apply to plain actions, with independent departure angles", () => {
  const authored = figure([
    {
      lead: "forward",
      follow: "back",
      by: 0.3,
      path: { lead: "around the front", follow: "around the front" },
      pathSetOff: { lead: 10, follow: 170 },
      length: "Q",
    },
  ]);
  for (const [index, angle] of [
    [0, 10],
    [1, 170],
  ]) {
    const move = authored.steps[index].movement;
    assert.equal(move.type, "arc");
    if (move.type === "arc") assert.equal(move.setOff, angle);
  }
  pointClose(authored.endPose.lead.left.position, [-0.1, 0.3]);
  pointClose(authored.endPose.follow.right.position, [0, 0.7]);
});

test("hold: closed with the follow turned 1/8 right is explicit and uses the ordinary limits", () => {
  // Isolate hold recognition, as above: she pivots on the spot in closed
  // hold, so only her facing changes.
  const checks: Partial<FigureDefinition> = {
    skipChecks: ["crossed feet", "own feet", "partner spacing"],
  };
  const turned = (eighths: number): StepRow => ({
    lead: "in place",
    follow: { go: "pivot", turn: { right: `${eighths}/8` } },
    hold: "closed, follow turned 1/8 right",
    length: "Q",
  });
  // 45° right of square is the hold's own facing; 1/16 either side of it
  // is within the ordinary 30° tolerance.
  assert.doesNotThrow(() => figure([turned(1)], checks));
  const unmarked = turned(1);
  delete unmarked.hold;
  assert.throws(
    () => figure([unmarked], checks),
    /nearest is closed hold.*facing is 45° off/,
  );
  // Square closed hold no longer satisfies a row that names this hold.
  assert.throws(
    () => figure([{ ...turned(1), follow: "in place" }], checks),
    /nearest is closed, follow turned 1\/8 right.*facing is 45° off/,
  );
  assert.throws(
    () => figure([turned(2)], checks),
    /nearest is closed, follow turned 1\/8 right.*facing is 45° off/,
  );
  // Only the marked row: a later unmarked row is checked as usual, so
  // her staying turned is refused there.
  assert.throws(
    () =>
      figure(
        [turned(1), { lead: "in place", follow: "in place", length: "Q" }],
        checks,
      ),
    /after step 2.*partners aren't in hold/,
  );
});

test("hold: opposed promenade is explicit and uses the ordinary distance/facing limits", () => {
  // Isolate hold recognition; these artificial foot placements are not a
  // catalogue figure. Other dedicated suites cover full movement geometry.
  const checks: Partial<FigureDefinition> = {
    skipChecks: ["crossed feet", "own feet", "partner spacing"],
  };
  const row: StepRow = {
    lead: "in place",
    follow: { go: { forward: 0.3, right: -0.25 } },
    hold: "opposed promenade",
    length: "Q",
  };
  assert.doesNotThrow(() => figure([row], checks));
  const unmarked = { ...row };
  delete unmarked.hold;
  assert.throws(() => figure([unmarked], checks), /partners aren't in hold/);
  assert.throws(
    () =>
      figure(
        [{ ...row, follow: { go: { forward: 0.3, right: -0.55 } } }],
        checks,
      ),
    /nearest is opposed promenade.*follow is 0.30.*at most 0.2/,
  );
  assert.throws(
    () =>
      figure(
        [
          {
            ...row,
            follow: {
              go: { forward: 0.3, right: -0.25 },
              turn: { right: "1/4" },
            },
          },
        ],
        checks,
      ),
    /nearest is opposed promenade.*facing is 90° off/,
  );
  // The annotation applies to one row; it must not implicitly grant a
  // different hold to later unmarked rows.
  assert.throws(
    () =>
      figure(
        [
          row,
          {
            both: "in place",
            weight: false,
            length: "Q",
          },
        ],
        checks,
      ),
    /after step 2.*partners aren't in hold/,
  );
  assert.throws(
    () =>
      figure(
        [{ both: "in place", hold: "opposed promenade", length: "Q" }],
        checks,
      ),
    /nearest is opposed promenade/,
  );
});
