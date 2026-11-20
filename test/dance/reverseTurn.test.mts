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
const box = load("reverse-box-turn-backward");

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

test("Reverse Turn (4–6): from count 1 on, the feet land where the Reverse Box Turn (backward half) puts them", () => {
  for (const beat of [1, 2, 3]) {
    const a = poseAtBeat(reverse, beat),
      b = poseAtBeat(box, beat);
    for (const partner of ["lead", "follow"] as const) {
      assert.ok(
        Math.abs(a[partner].orientation - b[partner].orientation) < 1e-6,
      );
      for (const foot of ["left", "right"] as const) {
        // The standing feet of count 1 are still at the spin turn finish.
        const standing =
          beat === 1 &&
          ((partner === "lead" && foot === "left") ||
            (partner === "follow" && foot === "right"));
        if (standing) continue;
        const p = a[partner][foot].position,
          q = b[partner][foot].position;
        assert.ok(
          Math.hypot(p.x - q.x, p.y - q.y) < 2e-3,
          `${partner} ${foot} at ${beat}`,
        );
      }
    }
  }
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

test("separate lead and follow turning closes get the hold allowance a mirrored turning close gets", () => {
  // Reverse Turn (4–6) closes with a separate lead and follow step, each
  // turning 1/12; after count 2 the bodies are judged against the hold
  // that turn finishes in, as for a mirrored turning close. It loads
  // above, so the allowance holds. If only the lead's close turns there
  // is no allowance, and the hold check after count 2 fails.
  const json = JSON.parse(
    readFileSync(
      new URL("../../db/figures/reverse-turn-4-6.json", import.meta.url),
      "utf8",
    ),
  );
  const followClose = json.steps.find(
    (row: { beat: number; follow?: { go: string } }) =>
      row.beat === 3 && row.follow?.go === "close",
  );
  delete followClose.follow.turn;
  delete json.expectEnd;
  assert.throws(
    () => defineFigure(parseFigureDefinition(json, "test")),
    /after step 3 \(beat 3\) the partners aren't in hold/,
  );
});
