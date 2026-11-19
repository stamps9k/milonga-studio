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
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
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
const { definition: checkDefinition, figure: check } = load("contra-check");
const { definition: recoveryDefinition, figure: recovery } = load(
  "contra-check-recovery",
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

test("Contra Check pair: all authoring checks run, with separate three-count figures", () => {
  for (const definition of [checkDefinition, recoveryDefinition]) {
    assert.deepEqual(definition.skipChecks ?? [], []);
    assert.equal(definition.style, "waltz");
    assert.equal(definition.time, "3/4");
  }
  close(figureDurationBeats(check), 3);
  close(figureDurationBeats(recovery), 3);
  poseClose(
    check.startPose,
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  assert.deepEqual(
    check.steps.map((s) => [s.partner, s.foot, s.beat, s.duration, s.weight]),
    [
      ["lead", "left", 1, 1, 1],
      ["follow", "right", 1, 1, 1],
      ["lead", "right", 2, 2, 0],
      ["follow", "left", 2, 2, 0],
    ],
  );
});

test("Contra Check: compact forward/back CBMP, modest contra rotation and a held finish", () => {
  const p = poseAtBeat(check, 1);
  close(p.lead.left.position.x, 0.04);
  close(p.lead.left.position.y, 0.4);
  close(p.lead.right.position.x, 0.1);
  close(p.lead.right.position.y, 0);
  close(p.follow.right.position.x, 0.14);
  close(p.follow.right.position.y, 0.8);
  close(p.follow.left.position.x, 0.2);
  close(p.follow.left.position.y, 0.4);
  close(p.lead.orientation, 345);
  close(p.follow.orientation, 165);
  close(footHeading(p.lead, "left"), 0);
  close(footHeading(p.follow, "right"), 180);
  for (const beat of [1, 1.5, 2, 2.5, 3]) poseClose(poseAtBeat(check, beat), p);
  poseClose(p, stancePose("contra check", { lead: "left", follow: "right" }));
  poseClose(check.endPose, recovery.startPose);
});

test("Closed Recovery: replace weight, side, close; finish ready for an LF figure", () => {
  assert.deepEqual(
    recovery.steps.map((s) => [
      s.partner,
      s.foot,
      s.beat,
      s.duration,
      s.weight,
    ]),
    [
      ["lead", "right", 1, 1, 1],
      ["follow", "left", 1, 1, 1],
      ["lead", "left", 2, 1, 1],
      ["follow", "right", 2, 1, 1],
      ["lead", "right", 3, 1, 1],
      ["follow", "left", 3, 1, 1],
    ],
  );
  const recovered = poseAtBeat(recovery, 1);
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      close(
        recovered[partner][foot].position.x,
        recovery.startPose[partner][foot].position.x,
      );
      close(
        recovered[partner][foot].position.y,
        recovery.startPose[partner][foot].position.y,
      );
    }
    close(recovered[partner].orientation, partner === "lead" ? 0 : 180);
  }
  const side = poseAtBeat(recovery, 2);
  close(side.lead.left.position.x, -0.3);
  close(side.lead.left.position.y, 0);
  close(side.follow.right.position.x, -0.2);
  close(side.follow.right.position.y, 0.4);
  const closed = applyTransform(
    { position: { x: -0.2, y: 0 }, rotation: 0 },
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  poseClose(recovery.endPose, closed);
  const closing = recovery.steps.filter((s) => s.beat === 3);
  assert.ok(
    closing.every((s) => s.weightTiming === "late" && s.riseTiming === "late"),
  );
});

test("Contra Check pair: exact connections, including ordinary incoming/outgoing waltz figures", () => {
  const incoming = placeEntry(load("rf-closed-change").figure, undefined);
  assert.equal(assessJoin(incoming.resolvedEndPose, check).fits, true);
  const checked = placeEntry(check, incoming),
    recovered = placeEntry(recovery, checked);
  assert.equal(assessJoin(checked.resolvedEndPose, recovery).fits, true);
  poseClose(checked.resolvedEndPose, recovered.resolvedStartPose);
  assert.equal(
    assessJoin(recovered.resolvedEndPose, load("lf-closed-change").figure).fits,
    true,
  );
  assert.equal(assessJoin(recovered.resolvedEndPose, check).fits, true);
});

test("Contra Check pair: every footprint and thigh/shin pair clears, with ordinary reach and balance", () => {
  const first = placeEntry(check, undefined),
    entries = [first, placeEntry(recovery, first)];
  // No interval is omitted for cross:true. Include all six beats, both easing
  // modes and the join itself. These are mannequin capsule proxies, not meshes.
  for (const options of [{}, { footEasing: footEase }])
    for (let sample = 0; sample <= 6 * 256; sample++) {
      const beat = sample / 256,
        p = sequencePoseAtBeat(entries, beat, options);
      assert.ok(p, `Pair has a pose at beat ${beat}`);
      const skeleton = solveSkeleton(p),
        feet = [],
        bones = [];
      const l = bodyPosition(p.lead),
        f = bodyPosition(p.follow);
      close(f.x - l.x, 0.1);
      close(f.y - l.y, 0.4);
      for (const partner of ["lead", "follow"] as const) {
        const s = skeleton[partner];
        assert.deepEqual(s.legShortfall, { left: 0, right: 0 });
        assert.ok(s.hipDrop <= 0.06, `Hip lowering ${partner} at ${beat}`);
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
