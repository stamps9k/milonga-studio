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
  poseAtBeat,
  footEase,
  footprintGap,
} from "../../src/libs/dance/fold.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import { rotatePoint } from "../../src/libs/dance/heading.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";

const definition = parseFigureDefinition(
  JSON.parse(
    readFileSync(
      new URL("../../db/figures/ocho.json", import.meta.url),
      "utf8",
    ),
  ),
  "ocho",
);
const authored = defineFigure(definition);
const ocho = {
  ...authored,
  id: "ocho",
  steps: authored.steps.map((s, i) => ({ ...s, id: String(i) })),
};
function close(a: number, b: number) {
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
}

test("Ocho: all authoring checks run with the original entry, rhythm and support order", () => {
  assert.deepEqual(definition.skipChecks ?? [], []);
  assert.ok(
    definition.steps.every((row) => !row.cross),
    "No row-level crossing exemption",
  );
  assert.deepEqual(
    ocho.startPose,
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  assert.equal(figureDurationBeats(ocho), 4);
  assert.deepEqual(
    ocho.steps.map((s) => [s.partner, s.foot, s.beat, s.duration]),
    [
      ["lead", "left", 1, 1],
      ["follow", "left", 1, 1],
      ["follow", "right", 2, 1],
      ["lead", "right", 3, 1],
      ["follow", "right", 3, 1],
      ["follow", "left", 4, 1],
    ],
  );
  const end = poseAtBeat(ocho, 4);
  // Keep the original lead right-foot landing, not merely its rounded expectEnd.
  close(end.lead.right.position.x, 0.1 - 0.2 * Math.sin((10 * Math.PI) / 180));
  close(end.lead.right.position.y, 0.2 * Math.cos((10 * Math.PI) / 180));
  assert.equal(end.lead.right.weight, 1);
  assert.equal(end.follow.left.weight, 1);
  assert.deepEqual(end, ocho.endPose);
});

test("Ocho: pivot on left, walk back on right, pivot the other way, walk back on left", () => {
  const p0 = poseAtBeat(ocho, 0),
    p1 = poseAtBeat(ocho, 1),
    p2 = poseAtBeat(ocho, 2),
    p3 = poseAtBeat(ocho, 3),
    p4 = poseAtBeat(ocho, 4);
  close(p1.follow.orientation, 150);
  close(p3.follow.orientation, 210);
  // Both pivots keep the feet placed and weight over the actual pivot foot.
  assert.equal(p1.follow.left.weight, 1);
  assert.equal(p3.follow.right.weight, 1);
  for (const side of ["left", "right"] as const) {
    assert.deepEqual(p1.follow[side].position, p0.follow[side].position);
    assert.deepEqual(p3.follow[side].position, p2.follow[side].position);
  }
  for (const [start, end, side, lateral] of [
    [p1, p2, "right", -0.1],
    [p3, p4, "left", 0],
  ] as const) {
    const a = start.follow[side].position,
      b = end.follow[side].position;
    const own = rotatePoint(
      { x: b.x - a.x, y: b.y - a.y },
      -start.follow.orientation,
    );
    close(own.y, -0.2);
    close(own.x, lateral);
  }
  // Avoid returning to the old >60 cm wide finish and 45-degree facing.
  assert.ok(
    Math.hypot(
      p4.follow.left.position.x - p4.follow.right.position.x,
      p4.follow.left.position.y - p4.follow.right.position.y,
    ) < 0.35,
  );
});

test("Ocho: compact pivots retain the unchanged hold limits and flat rise without shaping", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 4; beat += 1 / 256) {
      const p = poseAtBeat(ocho, beat, options),
        l = bodyPosition(p.lead),
        f = bodyPosition(p.follow);
      close(p.lead.orientation, 0);
      assert.ok(p.follow.orientation >= 150 && p.follow.orientation <= 210);
      close(p.lead.rise, 0);
      close(p.follow.rise, 0);
      assert.equal(p.lead.bodyOffset, undefined);
      assert.equal(p.follow.bodyOffset, undefined);
      assert.ok(
        Math.hypot(f.x - l.x - 0.1, f.y - l.y - 0.4) <= 0.2,
        `Hold error at ${beat}`,
      );
    }
});

test("Ocho: complete footprints and all thigh/shin pairs clear through both pivots and walks", () => {
  // Include both stationary pivots and moving feet, with no interval exclusions.
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 4; beat += 1 / 256) {
      const p = poseAtBeat(ocho, beat, options),
        skeleton = solveSkeleton(p),
        feet = [],
        bones = [];
      for (const partner of ["lead", "follow"] as const) {
        const s = skeleton[partner];
        assert.deepEqual(s.legShortfall, { left: 0, right: 0 });
        assert.ok(s.hipDrop <= 0.16, `Hip lowering at ${beat}`);
        assert.equal(
          assessLateralBalance(p[partner], s).plausible,
          true,
          `Balance at ${beat}`,
        );
        for (const side of ["left", "right"] as const) {
          feet.push({
            p: p[partner][side].position,
            heading: footHeading(p[partner], side),
          });
          const j = s.joints;
          bones.push(
            {
              partner,
              side,
              a: j[`${side}UpperLeg`],
              b: j[`${side}LowerLeg`],
              r: 0.06,
            },
            {
              partner,
              side,
              a: j[`${side}LowerLeg`],
              b: j[`${side}Foot`],
              r: 0.045,
            },
          );
        }
      }
      for (let i = 0; i < feet.length; i++)
        for (let k = i + 1; k < feet.length; k++) {
          const a = feet[i],
            b = feet[k];
          assert.ok(
            footprintGap(a.p, a.heading, b.p, b.heading) >= 0.005,
            `Footprints ${i}/${k} at ${beat}`,
          );
        }
      for (let i = 0; i < bones.length; i++)
        for (let k = i + 1; k < bones.length; k++) {
          const a = bones[i],
            b = bones[k];
          if (a.partner === b.partner && a.side === b.side) continue;
          assert.ok(
            segmentDistance(a.a, a.b, b.a, b.b) - a.r - b.r >= 0.005,
            `Legs ${a.partner} ${a.side}/${b.partner} ${b.side} at ${beat}`,
          );
        }
    }
});
