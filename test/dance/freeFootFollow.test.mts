import { test } from "node:test";
import assert from "node:assert/strict";
import { stancePose, defineFigure } from "../../src/libs/dance/authoring.mts";
import {
  poseAtBeat,
  figureFootTrails,
  footEase,
} from "../../src/libs/dance/fold.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import {
  stepOverlapError,
  isFreeFootFollow,
} from "../../src/libs/dance/overlap.mts";
import type { DanceStep, Figure } from "../../src/libs/dance/step.mts";
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const step = (changes: Partial<DanceStep>): DanceStep => ({
  id: "step",
  partner: "lead",
  foot: "right",
  movement: { type: "straight", direction: 0, distance: 0.5 },
  contact: "floor",
  weight: 1,
  orientation: 90,
  rise: 0.1,
  beat: 1,
  duration: 1,
  ...changes,
});
function fixture(steps: DanceStep[]): Figure {
  const startPose = stancePose("closed", { lead: "left", follow: "right" });
  return {
    id: "follow",
    name: "Follow",
    style: "test",
    timeSignature: { beatsPerMeasure: 1, beatUnit: 4 },
    startPose,
    endPose: startPose,
    steps,
  };
}
const arc = () =>
  step({
    id: "free",
    foot: "left",
    weight: 0,
    orientation: 270,
    footDirection: 180,
    rise: 1,
    bodyOffset: { x: 5, y: 5 },
    beat: 1.5,
    duration: 0.5,
    movement: { type: "arc", curvature: 1, arcLength: Math.PI / 2, setOff: 45 },
  });

test("free-foot follows move independently while the support owns frame, rise, pelvis and weight", () => {
  const driver = step({ id: "driver" }),
    free = arc(),
    f = fixture([driver, free]);
  assert.equal(stepOverlapError(f.steps), undefined);
  assert.equal(isFreeFootFollow(free, f.steps), true);
  const p = poseAtBeat(f, 0.75).lead;
  close(p.orientation, 67.5);
  close(p.rise, 0.075);
  assert.equal(p.bodyOffset, undefined);
  close(p.right.weight, 0.75);
  close(p.left.weight, 0.25);
  close(p.right.position.x, 0.1);
  close(p.right.position.y, 0.375);
  close(p.left.position.x, -0.1 + Math.SQRT1_2);
  close(p.left.position.y, -1 + Math.SQRT1_2);
  close(footHeading(p, "left"), 112.5);
  const end = poseAtBeat(f, 1).lead;
  close(end.orientation, 90);
  close(end.left.position.x, 0.9);
  close(end.left.position.y, -1);
  close(end.right.weight, 1);
  const trail = figureFootTrails(f, {
    position: { x: 0, y: 0 },
    rotation: 0,
  }).lead.left.at(-1)!;
  close(trail.x, end.left.position.x);
  close(trail.y, end.left.position.y);
});

test("a follow spanning consecutive support phases retains partial weight and its own direction", () => {
  const a = step({ id: "first", duration: 0.5, weight: 0.6 }),
    b = step({
      id: "second",
      beat: 1.5,
      duration: 0.5,
      orientation: 135,
      movement: { type: "straight", direction: 90, distance: 0.2 },
    }),
    free = arc();
  free.beat = 1.25;
  free.duration = 0.75;
  const f = fixture([a, free, b]);
  assert.equal(stepOverlapError(f.steps), undefined);
  const middle = poseAtBeat(f, 0.5).lead;
  close(middle.right.weight, 0.6);
  close(middle.left.weight, 0.4);
  const p = poseAtBeat(f, 0.75).lead;
  close(p.orientation, 112.5);
  close(p.right.weight, 0.8);
  close(p.left.weight, 0.2);
  close(footHeading(p, "left"), 135);
});

test("timing rejects two body actions, same-foot overlap and unsupported free-foot intervals", () => {
  const owner = step({ id: "owner" });
  assert.match(
    stepOverlapError([owner, step({ id: "other", foot: "left" })])!,
    /overlap/,
  );
  assert.match(
    stepOverlapError([owner, step({ id: "free", weight: 0 })])!,
    /overlap/,
  );
  const free = arc();
  free.duration = 1;
  assert.match(stepOverlapError([owner, free])!, /extends/);
  const first = step({ duration: 0.4 }),
    second = step({ beat: 1.5, duration: 0.5 }),
    gap = arc();
  gap.beat = 1;
  gap.duration = 1;
  assert.match(stepOverlapError([first, second, gap])!, /extends/);
});

test("explicit durations and end weight shares author a continuous transfer across phases", () => {
  const f = defineFigure({
    name: "Transfer",
    style: "test",
    time: "1/4",
    steps: [
      {
        both: "forward",
        foot: "L",
        by: 0.2,
        weight: 0.6,
        beat: 1,
        duration: 0.5,
      },
      {
        both: "forward",
        foot: "L",
        by: 0.1,
        weight: 1,
        beat: 1.5,
        duration: 0.5,
      },
    ],
    expectBeats: 1,
  });
  const figure = {
    ...f,
    id: "transfer",
    steps: f.steps.map((s, i) => ({ ...s, id: String(i) })),
  };
  close(poseAtBeat(figure, 0.5).lead.left.weight, 0.6);
  close(poseAtBeat(figure, 1).lead.left.weight, 1);
  for (const weight of [-0.1, 1.1, NaN, Infinity])
    assert.throws(
      () =>
        defineFigure({
          name: "Invalid",
          style: "test",
          time: "1/4",
          steps: [{ both: "forward", by: 0.2, weight, beat: 1 }],
        }),
      /weight/,
    );
  assert.throws(
    () =>
      defineFigure({
        name: "Invalid",
        style: "test",
        time: "1/4",
        steps: [{ both: "forward", by: 0.2, length: "Q", duration: 0.5 }],
      }),
    /duration/,
  );
});

test("a rigid free-foot arc shares its support pivot's angular timing under eased playback", () => {
  const owner = step({
    foot: "left",
    orientation: 90,
    movement: { type: "straight", direction: 0, distance: 0 },
    rise: 0,
  });
  // Right foot begins 20 cm to the right of LF and follows a quarter circle.
  const free = step({
    id: "arc",
    weight: 0,
    orientation: 90,
    beat: 1,
    duration: 1,
    movement: {
      type: "arc",
      curvature: 5,
      arcLength: Math.PI / 10,
      setOff: 180,
    },
  });
  const f = fixture([owner, free]);
  for (const options of [{}, { footEasing: footEase }]) {
    const p = poseAtBeat(f, 0.25, options).lead;
    close(p.right.position.x, -0.1 + 0.2 * Math.cos(Math.PI / 8));
    close(p.right.position.y, -0.2 * Math.sin(Math.PI / 8));
    close(p.orientation, 22.5);
  }
});
