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
