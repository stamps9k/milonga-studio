import { test } from "node:test";
import assert from "node:assert/strict";

import {
  currentStepsAtBeat,
  figureDurationBeats,
  figureFootTrails,
  footEase,
  poseAtBeat,
  sequenceCurrentStepsAtBeat,
  sequenceDurationBeats,
  sequenceFootTrails,
  sequencePoseAtBeat,
  sequenceTrailSegments,
  sequenceEntrySpans,
  sequenceEntryIndexAtBeat,
  stepPhases,
  swivelStandingFoot,
  passingPoint,
  PASSING_GAP,
  footprintGap,
  FOOTPRINT_LENGTH,
  FOOTPRINT_WIDTH,
  footPitchAt,
  risePhase,
  LATE_RISE_SHARE,
  LEAD_PITCH,
  LATE_WEIGHT_FOOT_SHARE,
} from "../../src/libs/dance/fold.mts";
import { defineFigure } from "../../src/libs/dance/authoring.mts";
import type { StepRow } from "../../src/libs/dance/authoring.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import { applyTransform, fitTransform } from "../../src/libs/dance/floor.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { FloorTransform } from "../../src/libs/dance/sequence.mts";

const IDENTITY: FloorTransform = { position: { x: 0, y: 0 }, rotation: 0 };

function pointClose(
  a: { x: number; y: number },
  b: { x: number; y: number },
  epsilon = 1e-6,
) {
  assert.ok(
    Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon,
    `expected (${a.x}, ${a.y}) to be close to (${b.x}, ${b.y})`,
  );
}

// Mirrors the real seeded "Side Step" figure -- chosen because, unlike
// most of the seed data, its hand-typed endPose actually does equal the
// fold of its own steps, so this doubles as a check against real
// numbers rather than only self-referential ones.
const sideStep: Figure = {
  id: "side-step",
  name: "Side Step",
  style: "tango",
  timeSignature: { beatsPerMeasure: 4, beatUnit: 4 },
  startPose: {
    lead: {
      left: { position: { x: -0.1, y: 0 }, weight: 0 },
      right: { position: { x: 0.1, y: 0 }, weight: 1 },
      orientation: 0,
      rise: 0,
    },
    follow: {
      left: { position: { x: 0.1, y: 0.4 }, weight: 1 },
      right: { position: { x: -0.1, y: 0.4 }, weight: 0 },
      orientation: 180,
      rise: 0,
    },
  },
  endPose: {
    lead: {
      left: { position: { x: 0.25, y: 0 }, weight: 1 },
      right: { position: { x: 0.1, y: 0 }, weight: 0 },
      orientation: 0,
      rise: 0,
    },
    follow: {
      left: { position: { x: 0.1, y: 0.4 }, weight: 0 },
      right: { position: { x: 0.25, y: 0.4 }, weight: 1 },
      orientation: 180,
      rise: 0,
    },
  },
  steps: [
    {
      id: "1",
      partner: "lead",
      foot: "left",
      movement: { type: "straight", direction: 90, distance: 0.35 },
      contact: "floor",
      weight: 1,
      orientation: 0,
      rise: 0,
      beat: 1,
      duration: 1,
    },
    {
      id: "2",
      partner: "follow",
      foot: "right",
      movement: { type: "straight", direction: 90, distance: 0.35 },
      contact: "floor",
      weight: 1,
      orientation: 180,
      rise: 0,
      beat: 1,
      duration: 1,
    },
  ],
};

test("figureFootTrails: folding Side Step's steps reproduces its own (real, hand-typed) endPose", () => {
  const trails = figureFootTrails(sideStep, IDENTITY);

  pointClose(trails.lead.left[0], sideStep.startPose.lead.left.position);
  pointClose(
    trails.lead.left[trails.lead.left.length - 1],
    sideStep.endPose.lead.left.position,
  );
  pointClose(
    trails.follow.right[trails.follow.right.length - 1],
    sideStep.endPose.follow.right.position,
  );

  // Feet that never take a step in this figure keep a single-point
  // trail sitting at their startPose position.
  assert.equal(trails.lead.right.length, 1);
  assert.equal(trails.follow.left.length, 1);
});

test("figureFootTrails: an arc movement traces a quarter circle correctly", () => {
  const arcFigure: Figure = {
    ...sideStep,
    id: "arc-test",
    startPose: {
      ...sideStep.startPose,
      lead: {
        ...sideStep.startPose.lead,
        left: { position: { x: 0, y: 0 }, weight: 0 },
        orientation: 0,
      },
    },
    steps: [
      {
        id: "1",
        partner: "lead",
        foot: "left",
        // Curving right (positive curvature) from heading 0 (north),
        // radius 1, quarter-circle arc length.
        movement: { type: "arc", curvature: 1, arcLength: Math.PI / 2 },
        contact: "floor",
        weight: 1,
        orientation: 90,
        rise: 0,
        beat: 1,
        duration: 1,
      },
    ],
  };

  const trails = figureFootTrails(arcFigure, IDENTITY);
  const end = trails.lead.left[trails.lead.left.length - 1];

  // Hand-derived: curving right from (0,0) facing north through a
  // quarter circle of radius 1 ends at (1, 1), now facing east.
  pointClose(end, { x: 1, y: 1 }, 1e-6);
});

test("sequenceFootTrails: concatenates entries without duplicating the shared joint vertex", () => {
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: sideStep, transform: { position: { x: 1, y: 1 }, rotation: 0 } },
  ];

  const combined = sequenceFootTrails(entries);

  // 2 points per entry (start + end) for lead.left, minus 1 shared
  // joint vertex between the two entries = 3 total.
  assert.equal(combined.lead.left.length, 3);
  pointClose(combined.lead.left[0], { x: -0.1, y: 0 });
  pointClose(combined.lead.left[1], { x: 0.25, y: 0 });
  pointClose(combined.lead.left[2], { x: 1.25, y: 1 });
});

test("figureDurationBeats: reads the latest point any step finishes at", () => {
  const oneBeatFigure: Figure = { ...sideStep };
  assert.equal(figureDurationBeats(oneBeatFigure), 1);

  const twoBeatFigure: Figure = {
    ...sideStep,
    steps: [
      ...sideStep.steps,
      {
        id: "3",
        partner: "follow",
        foot: "left",
        movement: { type: "straight", direction: 180, distance: 0.15 },
        contact: "floor",
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 2,
        duration: 1,
      },
    ],
  };
  assert.equal(figureDurationBeats(twoBeatFigure), 2);
});

test("poseAtBeat: at localBeat 0, returns startPose exactly", () => {
  const pose = poseAtBeat(sideStep, 0);
  pointClose(pose.lead.left.position, sideStep.startPose.lead.left.position);
  assert.equal(pose.lead.left.weight, sideStep.startPose.lead.left.weight);
  assert.equal(pose.lead.orientation, sideStep.startPose.lead.orientation);
});

test("poseAtBeat: at the figure's full duration, matches folding all the way (same as figureFootTrails' final point)", () => {
  const duration = figureDurationBeats(sideStep);
  const pose = poseAtBeat(sideStep, duration);
  pointClose(pose.lead.left.position, sideStep.endPose.lead.left.position);
  pointClose(
    pose.follow.right.position,
    sideStep.endPose.follow.right.position,
  );
  assert.equal(pose.lead.left.weight, 1);
  assert.equal(pose.lead.right.weight, 0);
});

test("poseAtBeat: mid-step, interpolates position smoothly and complements the sibling foot's weight", () => {
  const halfway = poseAtBeat(sideStep, 0.5);

  // Side Step: lead.left moves +X from -0.1 to 0.25 (distance 0.35) over
  // beat interval [0, 1) -- at progress 0.5, expect halfway there.
  pointClose(halfway.lead.left.position, { x: -0.1 + 0.35 * 0.5, y: 0 });

  // Weight transferring from lead.right (started at 1) to lead.left
  // (target 1) -- at halfway, both should read ~0.5, summing to 1.
  assert.ok(Math.abs(halfway.lead.left.weight - 0.5) < 1e-9);
  assert.ok(Math.abs(halfway.lead.right.weight - 0.5) < 1e-9);
  assert.ok(
    Math.abs(halfway.lead.left.weight + halfway.lead.right.weight - 1) < 1e-9,
  );
});

test("poseAtBeat: two partners stepping on the same beat both interpolate (regression -- a shared beat window used to stop after the first foot)", () => {
  // Side Step has both partners moving on beat 1 (lead.left and
  // follow.right share the exact same [0, 1) window) -- this is the
  // normal case for partner dancing, not an edge case. Only checking
  // lead's feet (as the test above does) wouldn't have caught a bug
  // where processing stopped after the first foot in beat order.
  const halfway = poseAtBeat(sideStep, 0.5);

  pointClose(halfway.follow.right.position, {
    x: sideStep.startPose.follow.right.position.x + 0.35 * 0.5,
    y: sideStep.startPose.follow.right.position.y,
  });
  assert.ok(Math.abs(halfway.follow.right.weight - 0.5) < 1e-9);
  assert.ok(Math.abs(halfway.follow.left.weight - 0.5) < 1e-9);
});

test("poseAtBeat: a step not yet reached leaves that foot at rest", () => {
  const twoBeatFigure: Figure = {
    ...sideStep,
    steps: [
      sideStep.steps[0],
      {
        id: "3",
        partner: "lead",
        foot: "right",
        movement: { type: "straight", direction: 90, distance: 0.2 },
        contact: "floor",
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 2,
        duration: 1,
      },
    ],
  };
  // Before beat 1's step even starts.
  const beforeAnything = poseAtBeat(twoBeatFigure, 0);
  pointClose(
    beforeAnything.lead.right.position,
    twoBeatFigure.startPose.lead.right.position,
  );

  // After the first step completes, but before the second (beat 2) one
  // has started -- lead.right should still be resting at its own
  // startPose position, untouched by the unrelated first step.
  const betweenSteps = poseAtBeat(twoBeatFigure, 1);
  pointClose(
    betweenSteps.lead.right.position,
    twoBeatFigure.startPose.lead.right.position,
  );
});

test("sequenceDurationBeats and sequencePoseAtBeat: concatenates figures' durations and delegates to the right entry across a join", () => {
  const secondTransform = { position: { x: 5, y: 2 }, rotation: 30 };
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: sideStep, transform: secondTransform },
  ];

  assert.equal(sequenceDurationBeats(entries), 2);

  const atStart = sequencePoseAtBeat(entries, 0);
  pointClose(
    atStart!.lead.left.position,
    sideStep.startPose.lead.left.position,
  );

  // At the exact boundary between two entries, sequencePoseAtBeat picks
  // up the *next* entry at its own localBeat 0 (its startPose, placed
  // by its own transform) -- there's no claim the two entries' poses
  // physically line up here, only that this delegation is correct.
  const expectedAtJoin = applyTransform(secondTransform, sideStep.startPose);
  const atJoin = sequencePoseAtBeat(entries, 1);
  pointClose(atJoin!.lead.left.position, expectedAtJoin.lead.left.position);

  const atEnd = sequencePoseAtBeat(entries, 2);
  const expectedAtEnd = applyTransform(secondTransform, sideStep.endPose);
  pointClose(atEnd!.lead.left.position, expectedAtEnd.lead.left.position);

  assert.equal(sequencePoseAtBeat([], 0), null);
});

test("sequencePoseAtBeat: is exactly continuous across a join when fitTransform's chain is exact (congruent poses)", () => {
  // A figure built so its own startPose and endPose ARE rigidly
  // congruent (every foot shifts by the same vector) -- both partners
  // step straight forward by the same distance, foot by foot, so the
  // relative shape at the end matches the start, just translated.
  const shift = 0.4;
  const congruentFigure: Figure = {
    ...sideStep,
    id: "congruent",
    endPose: {
      lead: {
        left: {
          position: { x: sideStep.startPose.lead.left.position.x, y: shift },
          weight: 0,
        },
        right: {
          position: { x: sideStep.startPose.lead.right.position.x, y: shift },
          weight: 1,
        },
        orientation: 0,
        rise: 0,
      },
      follow: {
        left: {
          position: {
            x: sideStep.startPose.follow.left.position.x,
            y: 0.4 + shift,
          },
          weight: 1,
        },
        right: {
          position: {
            x: sideStep.startPose.follow.right.position.x,
            y: 0.4 + shift,
          },
          weight: 0,
        },
        orientation: 180,
        rise: 0,
      },
    },
    steps: [
      {
        id: "1",
        partner: "lead",
        foot: "left",
        movement: { type: "straight", direction: 0, distance: shift },
        contact: "floor",
        weight: 0,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
      },
      {
        id: "2",
        partner: "lead",
        foot: "right",
        movement: { type: "straight", direction: 0, distance: shift },
        contact: "floor",
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
      },
      {
        id: "3",
        partner: "follow",
        foot: "left",
        movement: { type: "straight", direction: 0, distance: shift },
        contact: "floor",
        weight: 1,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
      },
      {
        id: "4",
        partner: "follow",
        foot: "right",
        movement: { type: "straight", direction: 0, distance: shift },
        contact: "floor",
        weight: 0,
        orientation: 180,
        rise: 0,
        beat: 1,
        duration: 1,
      },
    ],
  };

  const secondTransform = fitTransform(
    congruentFigure.startPose,
    congruentFigure.endPose,
  );
  const entries = [
    { figure: congruentFigure, transform: IDENTITY },
    { figure: congruentFigure, transform: secondTransform },
  ];

  const previousEnd = applyTransform(IDENTITY, congruentFigure.endPose);
  const atJoin = sequencePoseAtBeat(
    entries,
    figureDurationBeats(congruentFigure),
  );
  pointClose(atJoin!.lead.left.position, previousEnd.lead.left.position, 1e-6);
});

test("currentStepsAtBeat: both partners' first step is current right from localBeat 0", () => {
  const current = currentStepsAtBeat(sideStep, 0);
  assert.equal(current.lead?.id, "1");
  assert.equal(current.follow?.id, "2");
});

test("currentStepsAtBeat: a foot with no step yet reads null, not the unrelated step that happens to be running", () => {
  const twoBeatFigure: Figure = {
    ...sideStep,
    steps: [
      sideStep.steps[0], // lead.left, beat 1
      {
        id: "3",
        partner: "lead",
        foot: "right",
        movement: { type: "straight", direction: 90, distance: 0.2 },
        contact: "floor",
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 2,
        duration: 1,
      },
    ],
  };

  const midFirstStep = currentStepsAtBeat(twoBeatFigure, 0.5);
  assert.equal(midFirstStep.lead?.id, "1");
  // follow never steps in this figure at all.
  assert.equal(midFirstStep.follow, null);

  const midSecondStep = currentStepsAtBeat(twoBeatFigure, 1.5);
  // lead.right's step (id "3") has started and supersedes id "1" as
  // lead's current step, even though they're different feet.
  assert.equal(midSecondStep.lead?.id, "3");
});

test("currentStepsAtBeat: after a step completes it stays 'current' until a later one for that partner starts", () => {
  const afterCompletion = currentStepsAtBeat(sideStep, 1); // full duration
  assert.equal(afterCompletion.lead?.id, "1");
  assert.equal(afterCompletion.follow?.id, "2");
});

test("sequenceCurrentStepsAtBeat: reports the right figure and delegates like sequencePoseAtBeat across a join", () => {
  const secondFigure: Figure = {
    ...sideStep,
    id: "side-step-2",
    name: "Side Step (again)",
  };
  const secondTransform = { position: { x: 5, y: 2 }, rotation: 30 };
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: secondFigure, transform: secondTransform },
  ];

  const midFirst = sequenceCurrentStepsAtBeat(entries, 0.5);
  assert.equal(midFirst?.figureId, "side-step");
  assert.equal(midFirst?.steps.lead?.id, "1");

  // At the exact boundary, delegates to the *next* entry (matching
  // sequencePoseAtBeat's own documented behaviour), so the second
  // figure's steps are already "current" at globalBeat 1.
  const atJoin = sequenceCurrentStepsAtBeat(entries, 1);
  assert.equal(atJoin?.figureId, "side-step-2");
  assert.equal(atJoin?.figureName, "Side Step (again)");
  assert.equal(atJoin?.steps.lead?.id, "1");

  assert.equal(sequenceCurrentStepsAtBeat([], 0), null);
});

// ---------------------------------------------------------------------
// Edge cases and invariants added alongside the code review. These use
// small hand-built figures so every expected value can be checked by
// hand from the heading convention in heading.mts.
// ---------------------------------------------------------------------

/** A one-step figure for lead's left foot only, starting at the origin
 *  facing north, so the step's movement is the only thing that moves. */
function singleLeadStepFigure(
  step: Partial<Figure["steps"][number]> &
    Pick<Figure["steps"][number], "movement">,
): Figure {
  return {
    ...sideStep,
    id: "single-step",
    startPose: {
      ...sideStep.startPose,
      lead: {
        ...sideStep.startPose.lead,
        left: { position: { x: 0, y: 0 }, weight: 0 },
        right: { position: { x: 0.2, y: 0 }, weight: 1 },
        orientation: 0,
        rise: 0,
      },
    },
    steps: [
      {
        id: "1",
        partner: "lead",
        foot: "left",
        contact: "floor",
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        ...step,
      },
    ],
  };
}

test("poseAtBeat: clamps -- before the start reads startPose, past the end reads the completed fold", () => {
  const before = poseAtBeat(sideStep, -5);
  pointClose(before.lead.left.position, sideStep.startPose.lead.left.position);

  const end = poseAtBeat(sideStep, figureDurationBeats(sideStep));
  const wayPast = poseAtBeat(sideStep, 100);
  pointClose(wayPast.lead.left.position, end.lead.left.position);
  pointClose(wayPast.follow.right.position, end.follow.right.position);
  assert.equal(wayPast.lead.left.weight, end.lead.left.weight);
});

test("poseAtBeat: steps are applied in beat order regardless of the order they're stored in", () => {
  const ordered = singleLeadStepFigure({
    movement: { type: "straight", direction: 0, distance: 0.3 },
  });
  const secondStep = {
    ...ordered.steps[0],
    id: "2",
    beat: 2,
    movement: { type: "straight" as const, direction: 90, distance: 0.2 },
  };
  const inOrder: Figure = { ...ordered, steps: [ordered.steps[0], secondStep] };
  const reversed: Figure = {
    ...ordered,
    steps: [secondStep, ordered.steps[0]],
  };

  // North 0.3 then east 0.2 from the origin ends at (0.2, 0.3).
  pointClose(poseAtBeat(inOrder, 2).lead.left.position, { x: 0.2, y: 0.3 });
  pointClose(poseAtBeat(reversed, 2).lead.left.position, { x: 0.2, y: 0.3 });
  const trails = figureFootTrails(reversed, IDENTITY).lead.left;
  pointClose(trails[1], { x: 0, y: 0.3 });
  pointClose(trails[2], { x: 0.2, y: 0.3 });
});

test("poseAtBeat: a pivot (zero-distance step) turns the frame without moving the foot", () => {
  const pivot = singleLeadStepFigure({
    movement: { type: "straight", direction: 0, distance: 0 },
    orientation: 90,
  });
  const mid = poseAtBeat(pivot, 0.5);
  pointClose(mid.lead.left.position, { x: 0, y: 0 });
  assert.ok(Math.abs(mid.lead.orientation - 45) < 1e-9);

  const end = poseAtBeat(pivot, 1);
  pointClose(end.lead.left.position, { x: 0, y: 0 });
  assert.ok(Math.abs(end.lead.orientation - 90) < 1e-9);
});

test("figureFootTrails: negative curvature curves left (mirror of the positive quarter circle)", () => {
  const leftArc = singleLeadStepFigure({
    movement: { type: "arc", curvature: -1, arcLength: Math.PI / 2 },
    orientation: 270,
  });
  const trail = figureFootTrails(leftArc, IDENTITY).lead.left;
  // From (0, 0) facing north, a radius-1 quarter circle curving left
  // ends at (-1, 1), now facing west.
  pointClose(trail[trail.length - 1], { x: -1, y: 1 });
});

test("poseAtBeat: footEasing changes how the foot travels, not where it goes or the weight", () => {
  // The lead's left foot goes 0.4 north over one beat.
  const step = singleLeadStepFigure({
    movement: { type: "straight", direction: 0, distance: 0.4 },
  });
  const eased = { footEasing: footEase };
  // A quarter of the way through the time, a steady foot has covered a
  // quarter of the way; an eased one has only just got going
  // (smoothstep(0.25) = 0.15625).
  pointClose(poseAtBeat(step, 0.25).lead.left.position, { x: 0, y: 0.1 });
  pointClose(poseAtBeat(step, 0.25, eased).lead.left.position, {
    x: 0,
    y: 0.4 * 0.15625,
  });
  // Halfway and at the end they agree.
  pointClose(poseAtBeat(step, 0.5, eased).lead.left.position, {
    x: 0,
    y: 0.2,
  });
  pointClose(poseAtBeat(step, 1, eased).lead.left.position, { x: 0, y: 0.4 });
  // The weight still moves steadily.
  assert.equal(
    poseAtBeat(step, 0.25, eased).lead.left.weight,
    poseAtBeat(step, 0.25).lead.left.weight,
  );
});

test("footEase: starts and ends at rest, and is symmetric", () => {
  assert.equal(footEase(0), 0);
  assert.equal(footEase(1), 1);
  assert.equal(footEase(0.5), 0.5);
  assert.ok(Math.abs(footEase(0.2) + footEase(0.8) - 1) < 1e-12);
  // Out-of-range progress is clamped.
  assert.equal(footEase(-1), 0);
  assert.equal(footEase(2), 1);
});

test("poseAtBeat: halfway through an arc the foot is on the curve, not on the straight chord", () => {
  const arc = singleLeadStepFigure({
    movement: { type: "arc", curvature: 1, arcLength: Math.PI / 2 },
    orientation: 90,
  });
  // Curving right from (0, 0) facing north, the circle's centre is at
  // (1, 0). Halfway along the quarter circle (45 degrees of sweep) the
  // foot is at (1 - cos 45, sin 45). The chord midpoint would instead
  // be (0.5, 0.5).
  const mid = poseAtBeat(arc, 0.5).lead.left.position;
  pointClose(mid, { x: 1 - Math.SQRT1_2, y: Math.SQRT1_2 });
  assert.ok(Math.abs(Math.hypot(mid.x - 1, mid.y) - 1) < 1e-9);
});

test("poseAtBeat: an arc with setOff sets off at that angle from the facing", () => {
  // Facing north, setOff 180 sets off south; curving right (clockwise)
  // from south heads round towards the west. A radius-1 quarter circle
  // from (0, 0) is centred on (-1, 0) and ends at (-1, -1); halfway it
  // is at (cos 45 - 1, -sin 45).
  const backwards = singleLeadStepFigure({
    movement: {
      type: "arc",
      curvature: 1,
      arcLength: Math.PI / 2,
      setOff: 180,
    },
  });
  pointClose(poseAtBeat(backwards, 0.5).lead.left.position, {
    x: Math.SQRT1_2 - 1,
    y: -Math.SQRT1_2,
  });
  pointClose(poseAtBeat(backwards, 1).lead.left.position, { x: -1, y: -1 });
  const trail = figureFootTrails(backwards, IDENTITY).lead.left;
  pointClose(trail[trail.length - 1], { x: -1, y: -1 });
});

test("poseAtBeat: rise is interpolated linearly across the step", () => {
  const rising = singleLeadStepFigure({
    movement: { type: "straight", direction: 0, distance: 0.4 },
    rise: 0.08,
  });
  assert.ok(Math.abs(poseAtBeat(rising, 0.25).lead.rise - 0.02) < 1e-9);
  assert.ok(Math.abs(poseAtBeat(rising, 1).lead.rise - 0.08) < 1e-9);
  // The other partner's rise is untouched by the lead's step.
  assert.equal(poseAtBeat(rising, 1).follow.rise, 0);
});

test("poseAtBeat: each partner's foot weights always sum to 1 throughout a step", () => {
  for (let beat = 0; beat <= 1; beat += 0.125) {
    const pose = poseAtBeat(sideStep, beat);
    for (const partner of ["lead", "follow"] as const) {
      const total = pose[partner].left.weight + pose[partner].right.weight;
      assert.ok(
        Math.abs(total - 1) < 1e-9,
        `${partner} weights sum to ${total} at beat ${beat}`,
      );
    }
  }
});

test("poseAtBeat and figureFootTrails agree on where every foot ends, including after an arc", () => {
  // The fold is implemented twice (once for trails, once for poses).
  // Both must land every foot in the same place, or the drawn trail and
  // the drawn feet would visibly disagree.
  const mixed: Figure = {
    ...singleLeadStepFigure({
      movement: { type: "straight", direction: 0, distance: 0.3 },
      orientation: 30,
    }),
  };
  mixed.steps = [
    ...mixed.steps,
    {
      ...mixed.steps[0],
      id: "2",
      foot: "right",
      beat: 2,
      movement: { type: "arc", curvature: 2, arcLength: 0.5 },
      orientation: 60,
    },
  ];
  const trails = figureFootTrails(mixed, IDENTITY);
  const pose = poseAtBeat(mixed, figureDurationBeats(mixed));
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      const trail = trails[partner][foot];
      pointClose(pose[partner][foot].position, trail[trail.length - 1]);
    }
  }
});

test("poseAtBeat: an airborne step does not change where the foot rests afterwards", () => {
  const boleo = singleLeadStepFigure({
    movement: { type: "straight", direction: 90, distance: 0.3 },
    contact: "air",
    weight: 0,
  });
  const end = poseAtBeat(boleo, 1);
  pointClose(end.lead.left.position, { x: 0, y: 0 });
  // An air step carries no weight, so it all stays on the standing foot.
  assert.equal(end.lead.left.weight, 0);
  assert.equal(end.lead.right.weight, 1);
});

test("poseAtBeat: an airborne foot goes out along its path and back again", () => {
  const boleo = singleLeadStepFigure({
    movement: { type: "straight", direction: 90, distance: 0.3 },
    contact: "air",
    weight: 0,
  });
  // Out for the first half of the step, back for the second.
  pointClose(poseAtBeat(boleo, 0.25).lead.left.position, { x: 0.15, y: 0 });
  pointClose(poseAtBeat(boleo, 0.5).lead.left.position, { x: 0.3, y: 0 });
  pointClose(poseAtBeat(boleo, 0.75).lead.left.position, { x: 0.15, y: 0 });
});

test("figureFootTrails: airborne steps leave no floor trail, but still turn the frame for later arcs, which are drawn as curves", () => {
  const boleo = singleLeadStepFigure({
    movement: { type: "straight", direction: 90, distance: 0.3 },
    contact: "air",
    weight: 0,
    orientation: 90,
  });
  boleo.steps = [
    ...boleo.steps,
    {
      ...boleo.steps[0],
      id: "2",
      contact: "floor",
      weight: 1,
      beat: 2,
      // Starts facing east (set by the airborne step), so a right-curving
      // quarter circle of radius 1 ends at (1, -1).
      movement: { type: "arc", curvature: 1, arcLength: Math.PI / 2 },
      orientation: 180,
    },
  ];
  const trail = figureFootTrails(boleo, IDENTITY).lead.left;
  // The arc is drawn as a curve: the start, 11 points along it, then the
  // end. Halfway round the quarter circle (centre (0, -1)) is at
  // (sin 45°, -1 + cos 45°).
  assert.equal(trail.length, 13);
  pointClose(trail[0], { x: 0, y: 0 });
  pointClose(trail[6], { x: Math.SQRT1_2, y: Math.SQRT1_2 - 1 });
  pointClose(trail[12], { x: 1, y: -1 });
  pointClose(poseAtBeat(boleo, 2).lead.left.position, { x: 1, y: -1 });
});

test("figureDurationBeats: an empty figure takes 0 beats, and fractional durations add up", () => {
  assert.equal(figureDurationBeats({ ...sideStep, steps: [] }), 0);
  const halfBeats = singleLeadStepFigure({
    movement: { type: "straight", direction: 0, distance: 0.1 },
    beat: 3.5,
    duration: 0.5,
  });
  assert.equal(figureDurationBeats(halfBeats), 3);
});

test("sequencePoseAtBeat: clamps to the first entry's start and the last entry's end", () => {
  const secondTransform = { position: { x: 2, y: 0 }, rotation: 0 };
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: sideStep, transform: secondTransform },
  ];
  const before = sequencePoseAtBeat(entries, -3);
  pointClose(before!.lead.left.position, sideStep.startPose.lead.left.position);

  const after = sequencePoseAtBeat(entries, 99);
  const expectedEnd = applyTransform(
    secondTransform,
    poseAtBeat(sideStep, figureDurationBeats(sideStep)),
  );
  pointClose(after!.lead.left.position, expectedEnd.lead.left.position);
});

test("sequencePoseAtBeat: a zero-length figure in the middle is skipped, not stuck on", () => {
  const empty: Figure = { ...sideStep, id: "empty", steps: [] };
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: empty, transform: IDENTITY },
    { figure: sideStep, transform: { position: { x: 2, y: 0 }, rotation: 0 } },
  ];
  assert.equal(sequenceDurationBeats(entries), 2);
  const atJoin = sequenceCurrentStepsAtBeat(entries, 1);
  assert.equal(atJoin?.figureId, "side-step");
  // Half a beat into the third entry, the lead's left foot is moving
  // from x = 2 - 0.1 towards 2 + 0.25.
  const mid = sequencePoseAtBeat(entries, 1.5);
  pointClose(mid!.lead.left.position, { x: 2 + 0.075, y: 0 });
});

test("sequenceFootTrails: an empty sequence yields empty trails", () => {
  const trails = sequenceFootTrails([]);
  for (const partner of ["lead", "follow"] as const) {
    assert.deepEqual(trails[partner].left, []);
    assert.deepEqual(trails[partner].right, []);
  }
});

test("sequenceTrailSegments: keeps one complete trail per entry, without dropping join points", () => {
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: sideStep, transform: { position: { x: 2, y: 0 }, rotation: 0 } },
  ];
  const { segments } = sequenceTrailSegments(entries, 0.05);
  assert.equal(segments.length, 2);
  // Each segment starts at its own figure's placed start, so the second
  // one starts at x = 2 - 0.1, not where the first one ended.
  pointClose(segments[0].lead.left[0], { x: -0.1, y: 0 });
  pointClose(segments[1].lead.left[0], { x: 1.9, y: 0 });
  pointClose(segments[1].lead.left[1], { x: 2.25, y: 0 });
});

test("sequenceTrailSegments: reports each foot that jumps at a join, with where it jumps from and to", () => {
  // Side Step after itself, both at the origin: the lead's left and the
  // follow's right end 0.35 east of where the second Side Step starts
  // them, while the other two feet never moved.
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: sideStep, transform: IDENTITY },
  ];
  const { gaps } = sequenceTrailSegments(entries, 0.05);
  assert.deepEqual(
    gaps.map((gap) => [gap.entryIndex, gap.partner, gap.foot]),
    [
      [1, "lead", "left"],
      [1, "follow", "right"],
    ],
  );
  pointClose(gaps[0].from, { x: 0.25, y: 0 });
  pointClose(gaps[0].to, { x: -0.1, y: 0 });
  assert.ok(Math.abs(gaps[0].distance - 0.35) < 1e-9);
});

test("sequenceTrailSegments: jumps within the tolerance aren't gaps, and a single figure has none", () => {
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: sideStep, transform: IDENTITY },
  ];
  assert.deepEqual(sequenceTrailSegments(entries, 0.4).gaps, []);
  assert.deepEqual(sequenceTrailSegments([entries[0]], 0).gaps, []);
  assert.deepEqual(sequenceTrailSegments([], 0), { segments: [], gaps: [] });
});

test("sequenceEntrySpans: each figure's span starts where the previous one ends", () => {
  const empty: Figure = { ...sideStep, id: "empty", steps: [] };
  const entries = [
    { figure: sideStep },
    { figure: empty },
    { figure: sideStep },
  ];
  assert.deepEqual(sequenceEntrySpans(entries), [
    { startBeat: 0, endBeat: 1 },
    { startBeat: 1, endBeat: 1 },
    { startBeat: 1, endBeat: 2 },
  ]);
  assert.deepEqual(sequenceEntrySpans([]), []);
});

test("sequenceEntryIndexAtBeat: matches the entry the pose is drawn from, including boundaries and clamping", () => {
  const empty: Figure = { ...sideStep, id: "empty", steps: [] };
  const entries = [
    { figure: sideStep, transform: IDENTITY },
    { figure: empty, transform: IDENTITY },
    { figure: sideStep, transform: IDENTITY },
  ];
  assert.equal(sequenceEntryIndexAtBeat(entries, 0), 0);
  assert.equal(sequenceEntryIndexAtBeat(entries, 0.999), 0);
  // A boundary belongs to the figure starting there; the zero-length
  // figure in between is never current.
  assert.equal(sequenceEntryIndexAtBeat(entries, 1), 2);
  assert.equal(sequenceEntryIndexAtBeat(entries, 2), 2);
  // Out of range clamps to the first and last entries.
  assert.equal(sequenceEntryIndexAtBeat(entries, -1), 0);
  assert.equal(sequenceEntryIndexAtBeat(entries, 99), 2);
  assert.equal(sequenceEntryIndexAtBeat([], 0), null);
  // Agrees with the entry sequenceCurrentStepsAtBeat reports.
  assert.equal(
    sequenceCurrentStepsAtBeat(entries, 1)?.figureId,
    entries[sequenceEntryIndexAtBeat(entries, 1)!].figure.id,
  );
});

test("poseAtBeat: a late-weight step brings the foot in first, then moves the weight", () => {
  // Lead's left foot moves 0.3 east (towards the right foot at (0.2, 0))
  // over one beat, starting with all the weight on the right. With
  // "late" timing the foot arrives at 2/3 of the beat, then the weight
  // changes over the last third.
  const figure = singleLeadStepFigure({
    movement: { type: "straight", direction: 90, distance: 0.3 },
    weightTiming: "late",
  });

  // Halfway: the foot is 3/4 of the way there, still without weight.
  const half = poseAtBeat(figure, 0.5).lead;
  pointClose(half.left.position, { x: 0.225, y: 0 });
  assert.equal(half.left.weight, 0);
  assert.equal(half.right.weight, 1);

  // Five sixths: the foot has arrived and the weight is half across.
  const late = poseAtBeat(figure, 5 / 6).lead;
  pointClose(late.left.position, { x: 0.3, y: 0 });
  assert.ok(Math.abs(late.left.weight - 0.5) < 1e-9);

  // The same step with even timing has moved half the weight by then.
  const even = poseAtBeat(
    singleLeadStepFigure({
      movement: { type: "straight", direction: 90, distance: 0.3 },
    }),
    0.5,
  ).lead;
  pointClose(even.left.position, { x: 0.15, y: 0 });
  assert.ok(Math.abs(even.left.weight - 0.5) < 1e-9);
});

test("stepPhases: even follows the step; late splits it at LATE_WEIGHT_FOOT_SHARE", () => {
  assert.deepEqual(stepPhases({}, 0.4), { foot: 0.4, weight: 0.4 });
  assert.deepEqual(stepPhases({ weightTiming: "even" }, 0.4), {
    foot: 0.4,
    weight: 0.4,
  });
  const at = (progress: number) =>
    stepPhases({ weightTiming: "late" }, progress);
  assert.deepEqual(at(0), { foot: 0, weight: 0 });
  assert.deepEqual(at(LATE_WEIGHT_FOOT_SHARE), { foot: 1, weight: 0 });
  assert.deepEqual(at(1), { foot: 1, weight: 1 });
});

test("swivelStandingFoot: the foot holds while the body turns towards it, and swivels once the body passes it or turns away", () => {
  // Pointing with the body: it turns with the body, either way.
  assert.equal(swivelStandingFoot(0, 0, 90), 90);
  assert.equal(swivelStandingFoot(0, 0, 315), 315);
  // Pointing 45 right of the body: the body turns 45 right to meet it,
  // and the foot stays (a chart's "body completes the turn").
  assert.equal(swivelStandingFoot(45, 0, 45), 45);
  // Half way, it still holds.
  assert.equal(swivelStandingFoot(45, 0, 20), 45);
  // The body turns 90 right, past it: the foot stays until the body
  // faces it, then swivels with it.
  assert.equal(swivelStandingFoot(45, 0, 90), 90);
  // The body turns away (left): the foot keeps its 45 offset, swivelling
  // with the body rather than being twisted further.
  assert.equal(swivelStandingFoot(45, 0, 330), 15);
  // The same, mirrored, for a foot pointing left of the body.
  assert.equal(swivelStandingFoot(315, 0, 330), 315);
  assert.equal(swivelStandingFoot(315, 0, 30), 345);
});

function authored(rows: StepRow[]): Figure {
  const figure = defineFigure({
    name: "Test",
    style: "test",
    time: "4/4",
    steps: rows,
    skipChecks: ["crossed feet", "partner spacing", "hold"],
  });
  return {
    ...figure,
    id: "test",
    steps: figure.steps.map((step, index) => ({ ...step, id: String(index) })),
  };
}

test("poseAtBeat: a pointed foot turns as it travels, and the body completes the turn over it", () => {
  // The follow (facing 180) steps back on her right turning a quarter
  // right with her foot an eighth further round (to 315), then closes
  // her left, turning the last eighth with her body.
  const figure = authored([
    {
      follow: {
        go: "back",
        by: 0.4,
        turn: { right: "1/4" },
        pointing: { right: "1/8" },
      },
      length: "Q",
    },
    { follow: { go: "close", turn: { right: "1/8" } }, length: "Q" },
  ]);
  // Half way through the first step the body has turned 45 and the
  // foot, travelling linearly here, 67.5 (half of 135).
  const midway = poseAtBeat(figure, 0.5).follow;
  assert.equal(midway.orientation, 225);
  assert.equal(footHeading(midway, "right"), 247.5);
  // Her left (pointing with her body before the step) swivels with it.
  assert.equal(footHeading(midway, "left"), 225);

  const stepped = poseAtBeat(figure, 1).follow;
  assert.equal(stepped.orientation, 270);
  assert.equal(stepped.right.direction, 315);
  // A foot pointing the way the body faces has no direction of its own.
  assert.equal("direction" in stepped.left, false);

  // On the close the body turns the last eighth to 315, towards where
  // her right foot already points, so it stays; the closing foot points
  // the way she now faces.
  const closed = poseAtBeat(figure, 2).follow;
  assert.equal(closed.orientation, 315);
  assert.equal(footHeading(closed, "right"), 315);
  assert.equal(footHeading(closed, "left"), 315);
  assert.equal("direction" in closed.right, false);
});

test("poseAtBeat: without pointing, poses have no foot directions, as before", () => {
  const figure = authored([
    { both: "forward", by: 0.5, turn: { right: "1/4" }, length: "Q" },
    { both: "close", length: "Q" },
  ]);
  for (const beat of [0, 0.5, 1, 1.5, 2]) {
    const pose = poseAtBeat(figure, beat);
    for (const partner of ["lead", "follow"] as const) {
      for (const foot of ["left", "right"] as const) {
        assert.equal("direction" in pose[partner][foot], false);
      }
    }
  }
});

test("passingPoint: a walk passes the standing foot at PASSING_GAP; side steps, closes and close-running lines don't", () => {
  // Right foot walks from (0.1, 0) to (0.1, 1.0) past the left at
  // (-0.1, 0.5): it passes halfway, 0.1 from the left foot, at (0, 0.5).
  const walk = passingPoint(
    { x: 0.1, y: 0 },
    { x: 0.1, y: 1 },
    {
      x: -0.1,
      y: 0.5,
    },
  );
  assert.ok(walk);
  pointClose(walk.point, { x: -0.1 + PASSING_GAP, y: 0.5 });
  assert.equal(walk.at, 0.5);
  // A side step away from the standing foot, and a close beside it.
  assert.equal(
    passingPoint({ x: -0.1, y: 0 }, { x: -0.4, y: 0 }, { x: 0.1, y: 0 }),
    undefined,
  );
  assert.equal(
    passingPoint({ x: -0.1, y: -0.4 }, { x: -0.1, y: 0 }, { x: 0.1, y: 0 }),
    undefined,
  );
  // Already running within PASSING_GAP of it.
  assert.equal(
    passingPoint({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -0.08, y: 0.5 }),
    undefined,
  );
});

/** One lead step from a stance with the lead's feet 0.2 apart, his left
 *  forward of his right, and the follow's feet where given. */
function walkPastFigure(follow: [number, number][]): Figure {
  const foot = (x: number, y: number, weight: number) => ({
    position: { x, y },
    weight,
  });
  return {
    id: "walk",
    name: "Walk past",
    style: "test",
    timeSignature: { beatsPerMeasure: 4, beatUnit: 4 },
    steps: [
      {
        id: "1",
        partner: "lead",
        foot: "right",
        movement: { type: "straight", direction: 0, distance: 1 },
        contact: "floor",
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
      },
    ],
    startPose: {
      lead: {
        left: foot(-0.1, 0.5, 1),
        right: foot(0.1, 0, 0),
        orientation: 0,
        rise: 0,
      },
      follow: {
        left: foot(follow[0][0], follow[0][1], 1),
        right: foot(follow[1][0], follow[1][1], 0),
        orientation: 180,
        rise: 0,
      },
    },
    endPose: {} as Figure["endPose"],
  };
}

test("poseAtBeat and trails: a walking foot curves in past the standing foot and lands where the step says", () => {
  // The follow is well out of the way.
  const figure = walkPastFigure([
    [3, 3],
    [3.2, 3],
  ]);
  // Halfway round its route (both pieces are the same length here) the
  // right foot is at the passing point.
  pointClose(poseAtBeat(figure, 0.5).lead.right.position, { x: 0, y: 0.5 });
  pointClose(poseAtBeat(figure, 1).lead.right.position, { x: 0.1, y: 1 });
  // The trail draws the curve: it comes within PASSING_GAP of the left
  // foot, where a straight line would stay 0.2 away.
  const trail = figureFootTrails(figure, IDENTITY).lead.right;
  assert.ok(trail.length > 2);
  const closest = Math.min(
    ...trail.map((point) => Math.hypot(point.x + 0.1, point.y - 0.5)),
  );
  assert.ok(closest < 0.11, `closest ${closest}`);
});

test("poseAtBeat: a passing foot comes in only as far as the partner's standing feet allow", () => {
  // The follow's right foot stands at (-0.02, 0.6), on the passing
  // route: drawing the lead's foot all the way in would take it within
  // 10 cm of hers, so it comes in less, and keeps 10 cm from it.
  const figure = walkPastFigure([
    [0.2, 1.6],
    [-0.02, 0.6],
  ]);
  let closestToHer = Infinity;
  for (let beat = 0; beat <= 1; beat += 1 / 64) {
    const { x, y } = poseAtBeat(figure, beat).lead.right.position;
    closestToHer = Math.min(closestToHer, Math.hypot(x + 0.02, y - 0.6));
  }
  assert.ok(closestToHer >= 0.1 - 1e-9, `closest ${closestToHer}`);
  const midway = poseAtBeat(figure, 0.5).lead.right.position;
  assert.ok(midway.x > 0 && midway.x < 0.1, `midway x ${midway.x}`);
});

test("risePhase and poseAtBeat: a late rise holds, then changes over the end of the step", () => {
  assert.equal(risePhase({}, 0.5), 0.5);
  assert.equal(risePhase({ riseTiming: "late" }, 0.5), 0);
  assert.equal(risePhase({ riseTiming: "late" }, LATE_RISE_SHARE), 0);
  assert.equal(risePhase({ riseTiming: "late" }, 1), 1);
  const figure = authored([
    { both: "forward", by: 0.5, rise: 0.06, length: "Q" },
    { both: "forward", by: 0.5, rise: 0, riseTiming: "late", length: "Q" },
  ]);
  // Up evenly on the first step; held through most of the second, then
  // lowered at its end.
  assert.ok(Math.abs(poseAtBeat(figure, 0.5).lead.rise - 0.03) < 1e-9);
  assert.ok(Math.abs(poseAtBeat(figure, 1.5).lead.rise - 0.06) < 1e-9);
  assert.ok(Math.abs(poseAtBeat(figure, 2).lead.rise) < 1e-9);
});

test("footPitchAt: a heel lead lands toes up, a toe or ball lead heel up, flat or none lands flat", () => {
  const heel = { footwork: "HT", contact: "floor" as const };
  const toe = { footwork: "TH", contact: "floor" as const };
  assert.equal(footPitchAt(heel, 0.7), LEAD_PITCH);
  assert.equal(footPitchAt(toe, 0.7), -LEAD_PITCH);
  assert.equal(
    footPitchAt({ footwork: "B", contact: "floor" }, 0.7),
    -LEAD_PITCH,
  );
  assert.equal(footPitchAt({ footwork: "F", contact: "floor" }, 0.7), 0);
  assert.equal(footPitchAt({ contact: "floor" }, 0.7), 0);
  assert.equal(footPitchAt({ footwork: "HT", contact: "air" }, 0.7), 0);
  // Flat as it sets off and as it lands, tipped in between.
  assert.equal(footPitchAt(heel, 0), 0);
  assert.equal(footPitchAt(heel, 1), 0);
  assert.ok(footPitchAt(heel, 0.5) > 0 && footPitchAt(heel, 0.5) < LEAD_PITCH);
});

test("poseAtBeat: a foot with footwork is tipped only while it travels", () => {
  const figure = authored([
    {
      both: "forward",
      by: 0.5,
      footwork: { lead: "HT", follow: "TH" },
      length: "Q",
    },
  ]);
  const mid = poseAtBeat(figure, 0.7);
  assert.ok((mid.lead.left.pitch ?? 0) > 0);
  assert.ok((mid.follow.right.pitch ?? 0) < 0);
  assert.equal("pitch" in mid.lead.right, false);
  const end = poseAtBeat(figure, 1);
  assert.equal("pitch" in end.lead.left, false);
  assert.equal("pitch" in end.follow.right, false);
});

test("footprintGap: the room between two footprints, negative when they overlap", () => {
  const close = (a: number, b: number) =>
    assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  // Side by side, pointing the same way, 0.2 apart: 0.2 less a width.
  close(
    footprintGap({ x: 0, y: 0 }, 0, { x: 0.2, y: 0 }, 0),
    0.2 - FOOTPRINT_WIDTH,
  );
  // On the same spot: a whole width into each other.
  close(footprintGap({ x: 0, y: 0 }, 0, { x: 0, y: 0 }, 90), -FOOTPRINT_WIDTH);
  // Heel to toe in a line, 0.3 apart: the rounded ends are a foot's
  // length apart less the gap.
  close(
    footprintGap({ x: 0, y: 0 }, 0, { x: 0, y: 0.3 }, 0),
    0.3 - FOOTPRINT_LENGTH,
  );
  // 0.15 apart side by side is clear when parallel, but toes turned in
  // 45° each bring them into each other.
  assert.ok(footprintGap({ x: 0, y: 0 }, 0, { x: 0.15, y: 0 }, 0) > 0);
  assert.ok(footprintGap({ x: 0, y: 0 }, 45, { x: 0.15, y: 0 }, 315) < 0);
});

test("poseAtBeat: a passing foot keeps its outline clear of a standing foot that points across its route", () => {
  // As walkPastFigure, but the standing left foot points 45° to the
  // right, its toes towards the route: the passing foot comes in less
  // than PASSING_GAP and keeps a centimetre between the outlines.
  const figure = walkPastFigure([
    [3, 3],
    [3.2, 3],
  ]);
  figure.startPose.lead.left.direction = 45;
  let closest = Infinity;
  let gap = Infinity;
  for (let beat = 0; beat <= 1; beat += 1 / 64) {
    const lead = poseAtBeat(figure, beat).lead;
    const { x, y } = lead.right.position;
    closest = Math.min(closest, Math.hypot(x + 0.1, y - 0.5));
    gap = Math.min(
      gap,
      footprintGap(lead.left.position, 45, lead.right.position, 0),
    );
  }
  assert.ok(closest > PASSING_GAP + 0.02, `closest ${closest}`);
  assert.ok(gap >= PASSING_GAP - FOOTPRINT_WIDTH - 1e-6, `gap ${gap}`);
});
