import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defineFigure,
  parseFigureDefinition,
} from "../../src/libs/dance/authoring.mts";
import { poseAtBeat } from "../../src/libs/dance/fold.mts";
import { rotatePoint } from "../../src/libs/dance/heading.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
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
const openNatural = load("open-natural-turn");
const outsideChange = load("outside-change-promenade");
const weave = load("weave-from-promenade");

test("Outside Change ending in PP joins Open Natural Turn to Weave from Promenade Position exactly", () => {
  const first = placeEntry(openNatural, undefined);
  const into = assessJoin(first.resolvedEndPose, outsideChange);
  assert.equal(into.fits, true);
  assert.ok(into.maxFootGap < 1e-6, `foot gap ${into.maxFootGap}`);
  const second = placeEntry(outsideChange, first);
  const out = assessJoin(second.resolvedEndPose, weave);
  assert.equal(out.fits, true);
  assert.ok(out.maxFootGap < 1e-6, `foot gap ${out.maxFootGap}`);
});

test("Outside Change ending in PP: lead straight back and closing, the follow coming round to his right, then promenade back up the line", () => {
  const start = outsideChange.startPose;
  // In the lead's starting frame: x to his right, y forward.
  const inStart = (p: { x: number; y: number }) =>
    rotatePoint(
      {
        x: p.x - start.lead.left.position.x,
        y: p.y - start.lead.left.position.y,
      },
      -start.lead.orientation,
    );
  const one = poseAtBeat(outsideChange, 1);
  const back = inStart(one.lead.left.position);
  assert.ok(Math.abs(back.x) < 1e-9 && back.y < -0.45, "LF straight back");
  assert.equal(one.lead.left.weight, 1);
  // Count 2: his RF closes; she ends on his right side, facing his way
  // (up to the promenade's opening), standing on her LF.
  const two = poseAtBeat(outsideChange, 2);
  assert.equal(two.lead.right.weight, 1);
  const side = rotatePoint(
    {
      x: two.follow.left.position.x - two.lead.right.position.x,
      y: two.follow.left.position.y - two.lead.right.position.y,
    },
    -two.lead.orientation,
  );
  assert.ok(side.x > 0.3, "She is on his right");
  assert.equal(two.follow.left.weight, 1);
  // Count 3: both forward, back up the line he started facing.
  const end = outsideChange.endPose;
  for (const [partner, foot] of [
    ["lead", "left"],
    ["follow", "right"],
  ] as const) {
    const from = two[partner][foot].position,
      to = end[partner][foot].position;
    assert.ok(
      inStart(to).y - inStart(from).y > 0.25,
      `${partner} travels up the line`,
    );
    assert.equal(end[partner][foot].weight, 1);
  }
});
