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
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";

const definition = parseFigureDefinition(
  JSON.parse(
    readFileSync(
      new URL("../../db/figures/cruzada.json", import.meta.url),
      "utf8",
    ),
  ),
  "cruzada",
);
const authored = defineFigure(definition);
const cruzada = {
  ...authored,
  id: "cruzada",
  steps: authored.steps.map((s, i) => ({ ...s, id: String(i) })),
};
function close(a: number, b: number) {
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
}

test("Cruzada: all authoring checks run with the original closed entry and lead walk", () => {
  assert.deepEqual(definition.skipChecks ?? [], []);
  assert.deepEqual(
    cruzada.startPose,
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  assert.equal(figureDurationBeats(cruzada), 2);
  assert.deepEqual(
    cruzada.steps.map((s) => [s.partner, s.foot, s.beat, s.duration]),
    [
      ["lead", "left", 1, 1],
      ["follow", "right", 1, 1],
      ["follow", "left", 2, 1],
    ],
  );
  const p = poseAtBeat(cruzada, 2);
  close(p.lead.left.position.x, -0.1);
  close(p.lead.left.position.y, 0.3);
  close(p.lead.right.position.x, 0.1);
  close(p.lead.right.position.y, 0);
  assert.equal(p.lead.left.weight, 1);
  assert.equal(p.lead.right.weight, 0);
});

test("Cruzada: follow walks back, then crosses left in front of right", () => {
  const walking = poseAtBeat(cruzada, 1),
    end = poseAtBeat(cruzada, 2);
  close(walking.follow.right.position.x, 0);
  close(walking.follow.right.position.y, 0.8);
  close(walking.follow.left.position.x, 0.2);
  close(walking.follow.left.position.y, 0.4);
  close(end.follow.left.position.x, -0.03);
  close(end.follow.left.position.y, 0.54);
  close(end.follow.right.position.x, 0);
  close(end.follow.right.position.y, 0.8);
  // Facing 180: -y is in front and -x crosses left to the dancer's right.
  assert.ok(end.follow.left.position.x < end.follow.right.position.x);
  close(end.follow.right.position.y - end.follow.left.position.y, 0.26);
  close(footHeading(end.follow, "left"), 150);
  close(footHeading(end.follow, "right"), 210);
  assert.equal(end.follow.left.weight, 1);
  assert.equal(end.follow.right.weight, 0);
  assert.deepEqual(end, cruzada.endPose);
});

test("Cruzada: both partners stay in hold with flat rise, original facings and no lasting shaping", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 2; beat += 1 / 256) {
      const p = poseAtBeat(cruzada, beat, options),
        l = bodyPosition(p.lead),
        f = bodyPosition(p.follow);
      close(p.lead.orientation, 0);
      close(p.follow.orientation, 180);
      close(p.lead.rise, 0);
      close(p.follow.rise, 0);
      assert.equal(p.lead.bodyOffset, undefined);
      assert.equal(p.follow.bodyOffset, undefined);
      assert.ok(
        Math.hypot(f.x - l.x - 0.1, f.y - l.y - 0.4) < 0.18,
        `Hold error at ${beat}`,
      );
    }
});

test("Cruzada: complete footprints and all thigh/shin pairs clear through the cross", () => {
  // No crossing interval is omitted. Crossed foot order is intentional; actual
  // outline/capsule overlap is checked independently of the authoring flag.
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 2; beat += 1 / 256) {
      const p = poseAtBeat(cruzada, beat, options),
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
