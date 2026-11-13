import { test } from "node:test";
import assert from "node:assert/strict";

import {
  currentStepsAtBeat,
  figureDurationBeats,
  figureFootTrails,
  poseAtBeat,
  sequenceCurrentStepsAtBeat,
  sequenceDurationBeats,
  sequenceFootTrails,
  sequencePoseAtBeat,
} from "../../src/libs/dance/fold.mts";
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

test("figureFootTrails: airborne steps leave no floor trail, but still turn the frame for later arcs", () => {
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
  assert.equal(trail.length, 2);
  pointClose(trail[0], { x: 0, y: 0 });
  pointClose(trail[1], { x: 1, y: -1 });
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
