import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defineFigure,
  parseFigureDefinition,
  stancePose,
} from "../../src/libs/dance/authoring.mts";
import {
  footEase,
  footprintGap,
  poseAtBeat,
  sequencePoseAtBeat,
  type PoseOptions,
} from "../../src/libs/dance/fold.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";

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
const spin = load("natural-spin-turn-second-half");
const reverse = load("reverse-turn-4-6");

test("spin turn finish: the spin turn ends exactly where Reverse Turn (4–6) starts, pelvis included", () => {
  const first = placeEntry(spin, undefined);
  const join = assessJoin(first.resolvedEndPose, reverse);
  assert.equal(join.fits, true);
  assert.ok(join.maxFootGap < 1e-6, `foot gap ${join.maxFootGap}`);
  const next = placeEntry(reverse, first);
  for (const partner of ["lead", "follow"] as const) {
    const a = first.resolvedEndPose[partner].bodyOffset!,
      b = next.resolvedStartPose[partner].bodyOffset!;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, `${partner} pelvis`);
    for (const foot of ["left", "right"] as const)
      assert.equal(
        first.resolvedEndPose[partner][foot].weight,
        next.resolvedStartPose[partner][foot].weight,
      );
  }
  // The stance itself keeps the spin's pelvis offsets.
  assert.ok(
    stancePose("spin turn finish", { lead: "left", follow: "right" }).lead
      .bodyOffset,
  );
});

test("Reverse Turn (4–6): a quarter turn left, mostly on a long count-2 stride, then a big close", () => {
  const facing = (beat: number) => poseAtBeat(reverse, beat).lead.orientation;
  const close = (a: number, b: number) =>
    assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  // 15°, then 60°, then 15°: finishing facing left of where he started.
  close(facing(1), 345);
  close(facing(2), 285);
  close(facing(3), 270);
  close(poseAtBeat(reverse, 3).follow.orientation, 90);
  // Count 1: the body turns while the right foot keeps pointing along
  // the line it stepped back on.
  const one = poseAtBeat(reverse, 1).lead;
  assert.ok(one.right.direction !== undefined);
  close(one.right.direction!, 0);
  // Count 2: the lead's left a long stride, leaving the feet well apart;
  // count 3 brings them together.
  const lead2 = reverse.steps.find(
    (s) => s.partner === "lead" && s.foot === "left",
  )!;
  const stride =
    lead2.movement.type === "straight"
      ? lead2.movement.distance
      : lead2.movement.arcLength;
  assert.ok(stride > 0.6, `count 2 stride ${stride}`);
  const at2 = poseAtBeat(reverse, 2).lead,
    at3 = reverse.endPose.lead;
  const apart = Math.hypot(
    at2.left.position.x - at2.right.position.x,
    at2.left.position.y - at2.right.position.y,
  );
  assert.ok(apart > 0.3, `feet ${apart} apart after count 2`);
  const closing = Math.hypot(
    at3.right.position.x - at2.right.position.x,
    at3.right.position.y - at2.right.position.y,
  );
  assert.ok(closing > 0.2, `close travels ${closing}`);
  // The follow, on the outside, goes round her standing foot.
  const follow2 = reverse.steps.find(
    (s) => s.partner === "follow" && s.foot === "right",
  )!;
  assert.equal(follow2.movement.type, "arc");
  assert.equal(reverse.endPose.lead.right.weight, 1);
  assert.equal(reverse.endPose.follow.left.weight, 1);
});

test("Natural Spin Turn into Reverse Turn (4–6): feet and legs stay clear, with normal reach and balance", () => {
  const first = placeEntry(spin, undefined),
    entries = [first, placeEntry(reverse, first)];
  for (const options of [{}, { footEasing: footEase }] as PoseOptions[])
    for (let sample = 0; sample <= 6 * 128; sample++) {
      const beat = sample / 128,
        p = sequencePoseAtBeat(entries, beat, options);
      assert.ok(p);
      const skeleton = solveSkeleton(p),
        feet = [],
        bones = [];
      for (const partner of ["lead", "follow"] as const) {
        const s = skeleton[partner];
        assert.deepEqual(s.legShortfall, { left: 0, right: 0 });
        assert.ok(s.hipDrop <= 0.16, `Hip lowering ${partner} at ${beat}`);
        assert.equal(
          assessLateralBalance(p[partner], s).plausible,
          true,
          `Balance ${partner} at ${beat}`,
        );
        for (const side of ["left", "right"] as const) {
          feet.push({
            p: p[partner][side].position,
            h: footHeading(p[partner], side),
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
        for (let k = i + 1; k < feet.length; k++)
          assert.ok(
            footprintGap(feet[i].p, feet[i].h, feet[k].p, feet[k].h) >= 0.005,
            `Footprints ${i}/${k} at ${beat}`,
          );
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
