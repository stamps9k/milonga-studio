import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defineFigure,
  parseFigureDefinition,
  stancePose,
} from "../../src/libs/dance/authoring.mts";
import {
  poseAtBeat,
  sequencePoseAtBeat,
  figureDurationBeats,
  footprintGap,
  footEase,
} from "../../src/libs/dance/fold.mts";
import { footHeading, type Pose } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";

function load(file: string) {
  const definition = parseFigureDefinition(
    JSON.parse(
      readFileSync(
        new URL(`../../db/figures/${file}.json`, import.meta.url),
        "utf8",
      ),
    ),
    file,
  );
  const authored = defineFigure(definition);
  const figure: Figure = {
    ...authored,
    id: file,
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
  return { definition, figure };
}
const { definition, figure: weave } = load("weave-from-promenade");
const { definition: closeDefinition, figure: promenadeClose } = load(
  "promenade-walk-and-close",
);
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function poseClose(a: Pose, b: Pose) {
  for (const partner of ["lead", "follow"] as const) {
    close(a[partner].orientation, b[partner].orientation);
    close(a[partner].rise, b[partner].rise);
    assert.deepEqual(a[partner].bodyOffset, b[partner].bodyOffset);
    for (const foot of ["left", "right"] as const) {
      close(a[partner][foot].position.x, b[partner][foot].position.x);
      close(a[partner][foot].position.y, b[partner][foot].position.y);
      close(a[partner][foot].weight, b[partner][foot].weight);
      close(footHeading(a[partner], foot), footHeading(b[partner], foot));
    }
  }
}

test("Weave: six uninterrupted alternating counts from feet-apart promenade", () => {
  assert.deepEqual(definition.skipChecks ?? [], []);
  assert.equal(figureDurationBeats(weave), 6);
  assert.equal(definition.time, "3/4");
  poseClose(
    weave.startPose,
    stancePose("promenade apart", { lead: "left", follow: "right" }),
  );
  for (const partner of ["lead", "follow"] as const) {
    const steps = weave.steps.filter((s) => s.partner === partner);
    assert.deepEqual(
      steps.map((s) => s.foot),
      partner === "lead"
        ? ["right", "left", "right", "left", "right", "left"]
        : ["left", "right", "left", "right", "left", "right"],
    );
    assert.deepEqual(
      steps.map((s) => s.beat),
      [1, 2, 3, 4, 5, 6],
    );
    assert.ok(steps.every((s) => s.duration === 1 && s.weight === 1));
    // Both feet travel at the bar line: count 3 is no close or resting pose.
    for (const beat of [3, 4]) {
      const step = steps[beat - 1],
        before = poseAtBeat(weave, beat - 1),
        after = poseAtBeat(weave, beat);
      const a = before[partner][step.foot].position,
        b = after[partner][step.foot].position;
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 0.1);
    }
  }
});

test("Weave: existing promenade entries connect without a Whisk or contra check requirement", () => {
  for (const name of ["promenade-chasse", "contra-check-recovery-promenade"]) {
    const incoming = placeEntry(load(name).figure, undefined),
      next = placeEntry(weave, incoming);
    assert.equal(assessJoin(incoming.resolvedEndPose, weave).fits, true);
    poseClose(incoming.resolvedEndPose, next.resolvedStartPose);
  }
  poseClose(
    weave.endPose,
    applyTransform(
      { position: weave.endPose.lead.left.position, rotation: 270 },
      stancePose("promenade apart", { lead: "left", follow: "right" }),
    ),
  );
  for (const next of [
    promenadeClose,
    load("open-natural-turn").figure,
    weave,
  ]) {
    assert.equal(assessJoin(weave.endPose, next).fits, true);
  }
});

test("Weave: the lead stays left and travels backward while the follow advances", () => {
  // These behavioural bounds reject the old 90-degree lead swing and circular
  // shuffling even if a future path happens to pass collision checks.
  for (const options of [{}, { footEasing: footEase }]) {
    for (let sample = 2 * 256; sample <= 5 * 256; sample++) {
      const p = poseAtBeat(weave, sample / 256, options),
        lead = bodyPosition(p.lead),
        follow = bodyPosition(p.follow);
      close(p.lead.orientation, 270);
      close(p.follow.orientation, 90);
      // With the lead facing west, north is their right: the follow stays
      // on that side, rather than the lead circling in front of the follow.
      assert.ok(follow.y - lead.y >= 0.09, `Pair sides at ${sample / 256}`);
    }
  }
  for (const beat of [3, 4, 5]) {
    const a = poseAtBeat(weave, beat - 1),
      b = poseAtBeat(weave, beat);
    assert.ok(bodyPosition(b.lead).x - bodyPosition(a.lead).x >= 0.2);
    assert.ok(bodyPosition(b.follow).x - bodyPosition(a.follow).x >= 0.17);
  }
  close(poseAtBeat(weave, 1).lead.orientation, 300);
  close(poseAtBeat(weave, 1).follow.orientation, 240);
  close(weave.endPose.lead.orientation, 225);
  close(weave.endPose.follow.orientation, 135);
});

test("Promenade Walk and Close: separate three counts and an exact collected closed exit", () => {
  assert.deepEqual(closeDefinition.skipChecks ?? [], []);
  assert.equal(figureDurationBeats(promenadeClose), 3);
  poseClose(promenadeClose.startPose, weave.startPose);
  for (const partner of ["lead", "follow"] as const) {
    const steps = promenadeClose.steps.filter((s) => s.partner === partner);
    assert.deepEqual(
      steps.map((s) => s.foot),
      partner === "lead"
        ? ["right", "left", "right"]
        : ["left", "right", "left"],
    );
    assert.deepEqual(
      steps.map((s) => [s.beat, s.duration, s.weight]),
      [
        [1, 1, 1],
        [2, 1, 1],
        [3, 1, 1],
      ],
    );
    assert.equal(steps[2].weightTiming, "late");
  }
  const end = promenadeClose.endPose,
    l = end.lead.left.position,
    r = end.lead.right.position;
  poseClose(
    end,
    applyTransform(
      { position: { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 }, rotation: 0 },
      stancePose("closed", { lead: "right", follow: "left" }),
    ),
  );
  for (const next of [
    load("lf-closed-change").figure,
    load("contra-check").figure,
  ])
    assert.equal(assessJoin(end, next).fits, true);
  const first = placeEntry(weave, undefined),
    second = placeEntry(promenadeClose, first);
  poseClose(first.resolvedEndPose, second.resolvedStartPose);
});

test("Weave and separate close: all nine counts clear every footprint and thigh/shin pair, with normal reach and balance", () => {
  const first = placeEntry(weave, undefined),
    entries = [first, placeEntry(promenadeClose, first)];
  // No interval is omitted for cross:true. Include all nine beats, both easing
  // modes and the join itself. These are mannequin capsule proxies, not meshes.
  for (const options of [{}, { footEasing: footEase }])
    for (let sample = 0; sample <= 9 * 256; sample++) {
      const beat = sample / 256,
        p = sequencePoseAtBeat(entries, beat, options);
      assert.ok(p, `Pair has a pose at beat ${beat}`);
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
        for (let k = i + 1; k < feet.length; k++) {
          const a = feet[i],
            b = feet[k];
          assert.ok(
            footprintGap(a.p, a.h, b.p, b.h) >= 0.005,
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
