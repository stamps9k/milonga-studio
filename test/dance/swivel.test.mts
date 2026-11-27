import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FigureError,
  STANCE_WIDTH,
  defineFigure,
} from "../../src/libs/dance/authoring.mts";
import type { StepRow } from "../../src/libs/dance/authoring.mts";
import {
  SWIVEL_POINT_AHEAD,
  figureDurationBeats,
  figureFootTrails,
  footEase,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import { headingToUnitVector } from "../../src/libs/dance/heading.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import type { PartnerPose, Point2D } from "../../src/libs/dance/pose.mts";
import type { Figure, Foot, SwivelPoint } from "../../src/libs/dance/step.mts";

// A foot turning on the floor about its ball or heel (`swivel`) keeps
// that point still, so the middle of the foot (its position) moves.
// Closed hold: the lead's feet at (-0.1, 0) and (0.1, 0) facing north,
// the follow's left at (0.2, 0.4) and right at (0, 0.4) facing south.

function figure(steps: StepRow[]): Figure {
  const authored = defineFigure({
    name: "Swivel",
    style: "test",
    time: "4/4",
    steps,
    skipChecks: ["crossed feet", "own feet", "partner spacing", "hold"],
  });
  return {
    ...authored,
    id: "swivel",
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}

/** The point of a foot `about` sits on: its ball or heel. */
function pivotPoint(
  partner: PartnerPose,
  foot: Foot,
  about: SwivelPoint,
): Point2D {
  const along = headingToUnitVector(footHeading(partner, foot));
  const ahead = SWIVEL_POINT_AHEAD[about];
  return {
    x: partner[foot].position.x + ahead * along.x,
    y: partner[foot].position.y + ahead * along.y,
  };
}

function near(actual: Point2D, expected: Point2D, tolerance = 1e-9) {
  assert.ok(
    Math.hypot(actual.x - expected.x, actual.y - expected.y) <= tolerance,
    `expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`,
  );
}

/** poseAtBeat at many moments from `from` to `to`, linear and eased. */
function* samples(f: Figure, from: number, to: number) {
  for (const options of [{}, { footEasing: footEase }])
    for (let i = 0; i <= 32; i++)
      yield poseAtBeat(f, from + ((to - from) * i) / 32, options);
}

/** The trails end where poseAtBeat ends every foot. */
function trailsAgree(f: Figure) {
  const trails = figureFootTrails(f, { position: { x: 0, y: 0 }, rotation: 0 });
  const end = poseAtBeat(f, figureDurationBeats(f));
  for (const partner of ["lead", "follow"] as const)
    for (const foot of ["left", "right"] as const)
      near(trails[partner][foot].at(-1)!, end[partner][foot].position);
}

test("swivel: a pivot on the ball keeps the ball still, a pivot on the heel the heel", () => {
  for (const about of ["ball", "heel"] as const) {
    const f = figure([
      {
        follow: { go: "pivot", turn: { left: "1/4" }, swivel: about },
        length: "Q",
      },
    ]);
    const before = pivotPoint(f.startPose.follow, "left", about);
    for (const pose of samples(f, 0, figureDurationBeats(f)))
      near(pivotPoint(pose.follow, "left", about), before);
    // She ends facing east, so her foot's middle is that far west of
    // the point it turned on.
    const ahead = SWIVEL_POINT_AHEAD[about];
    near(f.endPose.follow.left.position, {
      x: before.x - ahead,
      y: before.y,
    });
    trailsAgree(f);
  }
  // Without one, the foot turns about its middle, as before.
  const plain = figure([
    { follow: { go: "pivot", turn: { left: "1/4" } }, length: "Q" },
  ]);
  near(plain.endPose.follow.left.position, { x: 0.2, y: 0.4 });
});

test("swivel: the standing foot turns about its ball as the body turns over it", () => {
  const f = figure([
    {
      lead: {
        go: "forward",
        foot: "R",
        by: 0.3,
        turn: { right: "1/4" },
        swivel: "ball",
      },
      length: "S",
    },
  ]);
  const ball = { x: -0.1, y: SWIVEL_POINT_AHEAD.ball };
  for (const pose of samples(f, 0, figureDurationBeats(f)))
    near(pivotPoint(pose.lead, "left", "ball"), ball);
  near(f.endPose.lead.left.position, {
    x: -0.1 - SWIVEL_POINT_AHEAD.ball,
    y: SWIVEL_POINT_AHEAD.ball,
  });
  trailsAgree(f);
});

test("swivel: a standing foot stops turning about its ball once it moves off on its own", () => {
  // He turns a quarter right on his right foot over a beat; half way
  // through, his left foot moves off forward without weight. It turned
  // about its ball for the first eighth of a turn only, then follows its
  // own step.
  const f = figure([
    {
      beat: 1,
      lead: {
        go: "in place",
        foot: "R",
        turn: { right: "1/4" },
        swivel: "ball",
        duration: 1,
      },
    },
    {
      beat: 1.5,
      lead: {
        go: { forward: 0.2 },
        foot: "L",
        weight: false,
        duration: 0.5,
      },
    },
  ]);
  const ball = { x: -0.1, y: SWIVEL_POINT_AHEAD.ball };
  for (const pose of samples(f, 0, 0.5))
    near(pivotPoint(pose.lead, "left", "ball"), ball);
  // An eighth of a turn about the ball: pointing north-east.
  const along = headingToUnitVector(45);
  near(poseAtBeat(f, 0.5).lead.left.position, {
    x: ball.x - SWIVEL_POINT_AHEAD.ball * along.x,
    y: ball.y - SWIVEL_POINT_AHEAD.ball * along.y,
  });
  trailsAgree(f);
});

test("swivel: steps after one are measured from where the foot ended up", () => {
  // His right foot turns a quarter right about its ball, then his left
  // closes to it: it lands beside the right foot where it now is.
  const f = figure([
    {
      lead: {
        go: "in place",
        foot: "R",
        turn: { right: "1/4" },
        swivel: "ball",
      },
      length: "Q",
    },
    { lead: "close", length: "Q" },
  ]);
  const right = f.endPose.lead.right.position;
  near(right, {
    x: 0.1 - SWIVEL_POINT_AHEAD.ball,
    y: SWIVEL_POINT_AHEAD.ball,
  });
  // Facing east, his left is north.
  near(f.endPose.lead.left.position, { x: right.x, y: right.y + STANCE_WIDTH });
  trailsAgree(f);
});

test("swivel: a close after the standing foot turned about its ball lands beside it", () => {
  const f = figure([
    {
      lead: {
        go: "forward",
        foot: "R",
        by: 0.3,
        turn: { right: "1/4" },
        swivel: "ball",
      },
      length: "Q",
    },
    { lead: { go: "in place", foot: "L" }, length: "Q" },
    { lead: "close", length: "Q" },
  ]);
  const left = f.endPose.lead.left.position;
  near(left, { x: -0.1 - SWIVEL_POINT_AHEAD.ball, y: SWIVEL_POINT_AHEAD.ball });
  // Facing east, his right is south.
  near(f.endPose.lead.right.position, { x: left.x, y: left.y - STANCE_WIDTH });
  trailsAgree(f);
});

test("swivel: on a step that turns neither foot, it is refused", () => {
  assert.throws(
    () =>
      figure([
        { lead: { go: "forward", by: 0.3, swivel: "ball" }, length: "Q" },
      ]),
    (error) =>
      error instanceof FigureError && /turns neither foot/.test(error.message),
  );
});
