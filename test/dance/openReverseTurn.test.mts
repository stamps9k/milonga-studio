import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defineFigure,
  parseFigureDefinition,
  stancePose,
} from "../../src/libs/dance/authoring.mts";
import {
  figureDurationBeats,
  footEase,
  footprintGap,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import { footHeading, type Pose } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
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
const turn = load("open-reverse-turn-lady-outside");
const closed = () =>
  stancePose("closed", { lead: "right", follow: "left" }, "tango");

/** The follow's body in the lead's frame: x to his right, y ahead. */
function followFromLead(pose: Pose) {
  const lead = bodyPosition(pose.lead),
    follow = bodyPosition(pose.follow);
  return rotatePoint(
    { x: follow.x - lead.x, y: follow.y - lead.y },
    -pose.lead.orientation,
  );
}

test("Open Reverse Turn, Lady Outside: Q Q S Q Q S, the lead stepping L R L R L R", () => {
  assert.equal(figureDurationBeats(turn), 4);
  for (const partner of ["lead", "follow"] as const) {
    const steps = turn.steps.filter((step) => step.partner === partner);
    assert.deepEqual(
      steps.map((step) => step.duration),
      [0.5, 0.5, 1, 0.5, 0.5, 1],
    );
    assert.deepEqual(
      steps.map((step) => step.foot),
      partner === "lead"
        ? ["left", "right", "left", "right", "left", "right"]
        : ["right", "left", "right", "left", "right", "left"],
    );
  }
});

test("Open Reverse Turn, Lady Outside: a 3/4 turn to the left from closed hold back into closed hold", () => {
  // The lead backs the line of dance on 3 and 4 and ends facing
  // diagonal wall, 3/4 to the left of where he started (diagonal centre).
  const facing = [0, 0.5, 1, 2, 2.5, 3, 4].map(
    (beat) => poseAtBeat(turn, beat).lead.orientation,
  );
  assert.deepEqual(facing, [0, 0, 270, 225, 135, 90, 90]);
  for (const beat of [0, 0.5, 1, 2, 2.5, 3, 4]) {
    const p = poseAtBeat(turn, beat);
    assert.equal(p.follow.orientation, (p.lead.orientation + 180) % 360);
  }
  const end = turn.endPose;
  const rotated = applyTransform(
    { position: { x: 0, y: 0 }, rotation: 90 },
    closed(),
  );
  const shift = {
    x: end.lead.left.position.x - rotated.lead.left.position.x,
    y: end.lead.left.position.y - rotated.lead.left.position.y,
  };
  const expected = applyTransform({ position: shift, rotation: 0 }, rotated);
  for (const partner of ["lead", "follow"] as const)
    for (const foot of ["left", "right"] as const) {
      const a = end[partner][foot].position,
        b = expected[partner][foot].position;
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9);
    }
});

test("Open Reverse Turn, Lady Outside: she is outside him, to his right, on 3 and 4", () => {
  // In closed hold she is 10 cm to his right; outside partner she is
  // further across, and back in front of him by the close.
  const offset = (beat: number) => followFromLead(poseAtBeat(turn, beat)).x;
  assert.ok(Math.abs(offset(1) - 0.1) < 1e-9);
  assert.ok(offset(2) >= 0.14, `step 3: ${offset(2)}`);
  assert.ok(offset(2.5) >= 0.2, `step 4: ${offset(2.5)}`);
  assert.ok(Math.abs(offset(4) - 0.1) < 1e-9);
});

test("Open Reverse Turn, Lady Outside: follows the Back Corté with no gap", () => {
  const corte = placeEntry(load("back-corte"), undefined);
  const join = assessJoin(corte.resolvedEndPose, turn);
  assert.equal(join.fits, true, JSON.stringify(join.issues));
  assert.ok(join.maxFootGap < 1e-8);
});

test("Open Reverse Turn, Lady Outside: no two footprints overlap", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 4; beat += 1 / 128) {
      const pose = poseAtBeat(turn, beat, options);
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
