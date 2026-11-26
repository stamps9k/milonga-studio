import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defineFigure,
  parseFigureDefinition,
} from "../../src/libs/dance/authoring.mts";
import {
  figureDurationBeats,
  footEase,
  footprintGap,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import { footHeading, type Pose } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { rotatePoint } from "../../src/libs/dance/heading.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";

function load(file: string): Figure {
  const authored = defineFigure(
    parseFigureDefinition(
      JSON.parse(
        readFileSync(
          new URL(`../../db/figures/${file}.json`, import.meta.url),
          "utf8",
        ),
      ),
      file,
    ),
  );
  return {
    ...authored,
    id: file,
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}
const five = load("five-step");

/** The follow's body in the lead's frame: x to his right, y ahead. */
function followFromLead(pose: Pose) {
  const lead = bodyPosition(pose.lead),
    follow = bodyPosition(pose.follow);
  return rotatePoint(
    { x: follow.x - lead.x, y: follow.y - lead.y },
    -pose.lead.orientation,
  );
}

test("Five Step: Q Q Q Q S, the lead stepping L R L R and placing his L", () => {
  assert.equal(figureDurationBeats(five), 3);
  for (const partner of ["lead", "follow"] as const) {
    const steps = five.steps.filter((step) => step.partner === partner);
    assert.deepEqual(
      steps.map((step) => step.duration),
      [0.5, 0.5, 0.5, 0.5, 1],
    );
    assert.deepEqual(
      steps.map((step) => step.foot),
      partner === "lead"
        ? ["left", "right", "left", "right", "left"]
        : ["right", "left", "right", "left", "right"],
    );
  }
});

test("Five Step: he turns 1/4 left onto steps 2-4 and she turns 1/4 right into promenade on 5", () => {
  const at = (beat: number) => poseAtBeat(five, beat);
  assert.deepEqual(
    [0, 0.5, 1, 1.5, 2, 3].map((beat) => at(beat).lead.orientation),
    [0, 0, 270, 270, 270, 270],
  );
  assert.deepEqual(
    [0, 0.5, 1, 1.5, 2, 3].map((beat) => at(beat).follow.orientation),
    [180, 180, 90, 90, 90, 180],
  );
});

test("Five Step: no weight changes on the slow, so each ends on the foot of step 4", () => {
  const before = poseAtBeat(five, 2),
    end = poseAtBeat(five, 3);
  assert.equal(before.lead.right.weight, 1);
  assert.equal(before.follow.left.weight, 1);
  assert.equal(end.lead.right.weight, 1);
  assert.equal(end.follow.left.weight, 1);
  // The standing feet don't move on the slow.
  for (const [partner, foot] of [
    ["lead", "right"],
    ["follow", "left"],
  ] as const) {
    const a = before[partner][foot].position,
      b = end[partner][foot].position;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9);
  }
});

test("Five Step: she is outside him, to his right, on 3", () => {
  // In closed hold she is 10 cm to his right; outside partner, further.
  assert.ok(Math.abs(followFromLead(poseAtBeat(five, 0)).x - 0.1) < 1e-9);
  const outside = followFromLead(poseAtBeat(five, 1.5)).x;
  assert.ok(outside >= 0.15, `step 3: ${outside}`);
});

test("Five Step: follows the Open Reverse Turn and leads into the Closed Promenade with no gap", () => {
  const turn = placeEntry(load("open-reverse-turn-lady-outside"), undefined);
  const into = assessJoin(turn.resolvedEndPose, five);
  assert.equal(into.fits, true, JSON.stringify(into.issues));
  assert.ok(into.maxFootGap < 1e-8);

  const placed = placeEntry(five, turn);
  const out = assessJoin(placed.resolvedEndPose, load("closed-promenade"));
  assert.equal(out.fits, true, JSON.stringify(out.issues));
  assert.ok(out.maxFootGap < 1e-8);
});

test("Five Step: no two footprints overlap", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 128) {
      const pose = poseAtBeat(five, beat, options);
      const feet = (["lead", "follow"] as const).flatMap((partner) =>
        (["left", "right"] as const).map((foot) => ({
          partner,
          p: pose[partner][foot].position,
          h: footHeading(pose[partner], foot),
        })),
      );
      for (let i = 0; i < feet.length; i++)
        for (let k = i + 1; k < feet.length; k++) {
          const a = feet[i],
            b = feet[k];
          assert.ok(
            footprintGap(a.p, a.h, b.p, b.h) >= 0,
            `${a.partner}/${b.partner} footprints overlap at beat ${beat}`,
          );
        }
    }
});
