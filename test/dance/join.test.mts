import { test } from "node:test";
import assert from "node:assert/strict";

import {
  JOIN_FACING_TOLERANCE,
  JOIN_FOOT_GAP_TOLERANCE,
  assessJoin,
} from "../../src/libs/dance/join.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { DanceStep, Figure } from "../../src/libs/dance/step.mts";

// assessJoin places the next figure the way the sequence builder does
// (fitTransform) and reports what still doesn't line up. These fixtures
// use the seed's closed stance: feet 0.2 apart, partners 0.4 apart,
// lead facing 0 and follow facing 180.

function stance({
  leadWeightOnLeft,
  shift = { x: 0, y: 0 },
}: {
  leadWeightOnLeft: boolean;
  shift?: { x: number; y: number };
}): Pose {
  const lead = leadWeightOnLeft ? [1, 0] : [0, 1];
  return {
    lead: {
      left: { position: { x: -0.1 + shift.x, y: shift.y }, weight: lead[0] },
      right: { position: { x: 0.1 + shift.x, y: shift.y }, weight: lead[1] },
      orientation: 0,
      rise: 0,
    },
    follow: {
      // The follow faces the lead, so her left foot is on the east side.
      left: {
        position: { x: 0.1 + shift.x, y: 0.4 + shift.y },
        weight: lead[1],
      },
      right: {
        position: { x: -0.1 + shift.x, y: 0.4 + shift.y },
        weight: lead[0],
      },
      orientation: 180,
      rise: 0,
    },
  };
}

/** Lead weighted on the right, so his free foot is the left. */
const NEUTRAL = stance({ leadWeightOnLeft: false });

function step(
  partner: DanceStep["partner"],
  foot: DanceStep["foot"],
  beat: number,
  distance: number,
  contact: DanceStep["contact"] = "floor",
): DanceStep {
  return {
    id: `${partner}-${foot}-${beat}`,
    partner,
    foot,
    movement: { type: "straight", direction: 0, distance },
    contact,
    weight: 1,
    orientation: partner === "lead" ? 0 : 180,
    rise: 0,
    beat,
    duration: 1,
  };
}

/** A figure starting in `startPose` whose first steps move lead's left
 *  and follow's right -- the free feet in NEUTRAL. */
function figureFrom(startPose: Pose, steps?: DanceStep[]): Figure {
  return {
    id: "next",
    name: "Next",
    style: "tango",
    timeSignature: { beatsPerMeasure: 4, beatUnit: 4 },
    steps: steps ?? [
      step("lead", "left", 1, 0.3),
      step("follow", "right", 1, 0.3),
    ],
    startPose,
    endPose: startPose,
  };
}

test("assessJoin: a figure starting in exactly the stance the couple is in fits, with nothing to report", () => {
  const result = assessJoin(NEUTRAL, figureFrom(NEUTRAL));
  assert.equal(result.fits, true);
  assert.deepEqual(result.issues, []);
  assert.ok(result.maxFootGap < 1e-9);
  assert.equal(result.facingChange.lead, 0);
  assert.equal(result.facingChange.follow, 0);
});

test("assessJoin: the same stance moved and turned on the floor still fits exactly", () => {
  const placedEnd = applyTransform(
    { position: { x: 2, y: -1 }, rotation: 135 },
    NEUTRAL,
  );
  const result = assessJoin(placedEnd, figureFrom(NEUTRAL));
  assert.equal(result.fits, true);
  assert.ok(result.maxFootGap < 1e-9);
  assert.ok(Math.abs(result.transform.rotation - 135) < 1e-9);
});

test("assessJoin: an open, mid-stride ending is reported as a foot gap, not hidden by a turn", () => {
  // Where the seeded Walking Step ends: lead's left 0.6 forward, follow's
  // right 0.6 back, both still facing along line of dance.
  const midStride: Pose = structuredClone(NEUTRAL);
  midStride.lead.left = { position: { x: -0.1, y: 0.6 }, weight: 1 };
  midStride.lead.right.weight = 0;
  midStride.follow.right = { position: { x: -0.1, y: 1.0 }, weight: 1 };
  midStride.follow.left.weight = 0;

  const result = assessJoin(midStride, figureFrom(NEUTRAL));
  assert.equal(result.fits, false);
  assert.ok(Math.abs(result.transform.rotation) < 1e-9, "no false turn");
  // The closed stance is centred on the open one (moved 0.3 forward),
  // so every foot is 0.3 from where the previous figure left it.
  assert.ok(Math.abs(result.maxFootGap - 0.3) < 1e-9);
  const gaps = result.issues.filter((issue) => issue.kind === "foot-gap");
  assert.equal(gaps.length, 4);
});

test("assessJoin: a gap within tolerance is not an issue", () => {
  const nearlyThere = stance({
    leadWeightOnLeft: false,
    shift: { x: 0, y: 0 },
  });
  nearlyThere.lead.left.position.x += JOIN_FOOT_GAP_TOLERANCE * 0.8;
  const result = assessJoin(nearlyThere, figureFrom(NEUTRAL));
  assert.ok(result.maxFootGap > 0);
  assert.equal(
    result.issues.some((issue) => issue.kind === "foot-gap"),
    false,
  );
});

test("assessJoin: a follow turned away from the lead is reported as a facing change", () => {
  // Like the end of the Ocho: follow at 45 degrees, but the next figure
  // starts with her facing the lead (180). Placement follows the lead's
  // frame, so the lead doesn't turn and the follow snaps 135 degrees.
  const turnedAway: Pose = structuredClone(NEUTRAL);
  turnedAway.follow.orientation = 45;
  const result = assessJoin(turnedAway, figureFrom(NEUTRAL));
  assert.equal(result.facingChange.lead, 0);
  assert.equal(result.facingChange.follow, 135);
  assert.deepEqual(
    result.issues.filter((issue) => issue.kind === "facing-change"),
    [{ kind: "facing-change", partner: "follow", degrees: 135 }],
  );
  assert.equal(result.fits, false);
});

test("assessJoin: facing changes report the shorter, signed way round", () => {
  const turnedAway: Pose = structuredClone(NEUTRAL);
  // From 200 to 180 is a 20-degree counterclockwise snap: -20.
  turnedAway.follow.orientation = 200;
  const result = assessJoin(turnedAway, figureFrom(NEUTRAL));
  assert.equal(result.facingChange.follow, -20);
  assert.ok(20 > JOIN_FACING_TOLERANCE);
  assert.equal(result.fits, false);
});

test("assessJoin: stepping first with the foot a partner is standing on is reported", () => {
  // Lead stands on his left at the join, but the next figure's first
  // travelling step moves his left.
  const weightedLeft = stance({ leadWeightOnLeft: true });
  const result = assessJoin(weightedLeft, figureFrom(NEUTRAL));
  assert.deepEqual(
    result.issues.filter((issue) => issue.kind === "weighted-foot"),
    [
      { kind: "weighted-foot", partner: "lead", foot: "left" },
      { kind: "weighted-foot", partner: "follow", foot: "right" },
    ],
  );
  assert.equal(result.fits, false);
  // Positions and facing still line up exactly; only the weight is wrong.
  assert.ok(result.maxFootGap < 1e-9);
});

test("assessJoin: the weight check uses the first travelling step, skipping weight changes and airborne steps", () => {
  const weightedLeft = stance({ leadWeightOnLeft: true });
  // Lead's first step is an in-place weight change onto the right, then
  // an airborne flick of the left; his first travelling step is the
  // right foot, which is free. Steps are stored out of beat order.
  const next = figureFrom(NEUTRAL, [
    step("lead", "right", 3, 0.3),
    step("lead", "left", 1, 0),
    step("lead", "left", 2, 0.3, "air"),
    step("follow", "left", 1, 0.3),
  ]);
  const result = assessJoin(weightedLeft, next);
  assert.equal(
    result.issues.some((issue) => issue.kind === "weighted-foot"),
    false,
  );
});

test("assessJoin: a partner with no travelling steps can't fail the weight check", () => {
  const weightedLeft = stance({ leadWeightOnLeft: true });
  const next = figureFrom(NEUTRAL, [step("lead", "left", 1, 0)]);
  const result = assessJoin(weightedLeft, next);
  assert.deepEqual(result.issues, []);
});
