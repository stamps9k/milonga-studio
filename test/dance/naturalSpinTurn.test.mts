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
  type PoseOptions,
} from "../../src/libs/dance/fold.mts";
import { footHeading, type Pose } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import {
  normalizeDegrees,
  rotatePoint,
} from "../../src/libs/dance/heading.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { sequenceFootprints } from "../../src/libs/dance/footprints.mts";
import { isFreeFootFollow } from "../../src/libs/dance/overlap.mts";
import { parseDance } from "../../src/libs/dance/persistence.mts";
import { sampleDance } from "../support/dance.mts";
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
const { definition: firstDefinition, figure: firstHalf } = load(
  "natural-spin-turn-first-half",
);
const { definition: spinDefinition, figure: spin } = load(
  "natural-spin-turn-second-half",
);
const { figure: promenadeClose } = load("promenade-walk-and-close");
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

test("Natural Spin Turn: separate three-count halves connect exactly, with six standard foot placements", () => {
  assert.deepEqual(firstDefinition.skipChecks ?? [], []);
  assert.deepEqual(spinDefinition.skipChecks ?? [], []);
  assert.equal(figureDurationBeats(firstHalf), 3);
  assert.equal(figureDurationBeats(spin), 3);
  poseClose(
    firstHalf.startPose,
    stancePose("closed", { lead: "left", follow: "right" }),
  );
  poseClose(
    spin.startPose,
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  close(firstHalf.endPose.lead.orientation, 135);
  close(spin.endPose.lead.orientation, 225);
  const first = placeEntry(firstHalf, undefined),
    second = placeEntry(spin, first);
  assert.equal(assessJoin(first.resolvedEndPose, spin).fits, true);
  poseClose(first.resolvedEndPose, second.resolvedStartPose);
  const incoming = placeEntry(promenadeClose, undefined),
    after = placeEntry(spin, incoming);
  assert.equal(assessJoin(incoming.resolvedEndPose, spin).fits, true);
  poseClose(incoming.resolvedEndPose, after.resolvedStartPose);
  let previous = 0,
    total = 0;
  for (let i = 0; i <= 6 * 256; i++) {
    const p = sequencePoseAtBeat([first, second], i / 256)!;
    total += normalizeDegrees(p.lead.orientation - previous);
    previous = p.lead.orientation;
  }
  close(total, 360);
  const prints = sequenceFootprints([first, second]);
  for (const partner of ["lead", "follow"] as const) {
    const placements = prints.filter(
      (p) => p.partner === partner && p.count !== "",
    );
    assert.deepEqual(
      placements.map((p) => p.count),
      ["1", "2", "3", "1", "2", "3"],
    );
    assert.deepEqual(
      placements.map((p) => p.foot),
      partner === "lead"
        ? ["right", "left", "right", "left", "right", "left"]
        : ["left", "right", "left", "right", "left", "right"],
    );
  }
  const original = sampleDance();
  original.sequence.entries = [first, second];
  const restored = parseDance(JSON.parse(JSON.stringify(original)));
  for (const [i, originalFigure] of [firstHalf, spin].entries()) {
    const roundTrip = restored.sequence.entries[i].figure;
    assert.deepEqual(
      roundTrip.steps.map((s) => [s.beat, s.duration, s.weight]),
      originalFigure.steps.map((s) => [s.beat, s.duration, s.weight]),
    );
    for (const beat of [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3])
      poseClose(poseAtBeat(roundTrip, beat), poseAtBeat(originalFigure, beat));
  }
});
test("Underturned Natural Spin Turn: 135-degree pivot keeps RF forward in CBMP, then toe-pivots with an unweighted brush", () => {
  for (const options of [{}, { footEasing: footEase }]) {
    let previous = 0,
      total = 0;
    for (let i = 0; i <= 3 * 256; i++) {
      const p = poseAtBeat(spin, i / 256, options),
        angle = p.lead.orientation;
      const delta = normalizeDegrees(angle - previous);
      assert.ok(delta < 3, "Every part of the spin turns right continuously");
      total += delta;
      previous = angle;
      const opposition = Math.abs(
        normalizeDegrees(p.follow.orientation - p.lead.orientation + 180) - 180,
      );
      assert.ok(
        Math.abs(opposition - 180) <= 10 + 1e-8,
        "Partners remain facing each other",
      );
      if (i / 256 >= 0.3 && i / 256 <= 1) {
        const relative = rotatePoint(
          {
            x: p.lead.right.position.x - p.lead.left.position.x,
            y: p.lead.right.position.y - p.lead.left.position.y,
          },
          -p.lead.orientation,
        );
        close(relative.x, 0);
        close(relative.y, 0.3);
        assert.equal(p.lead.left.weight, 1);
      }
    }
    close(total, 225);
  }
  close(poseAtBeat(spin, 1).lead.orientation, 135);
  close(poseAtBeat(spin, 2).lead.orientation, 180);
  close(spin.endPose.lead.orientation, 225);
  const partial = poseAtBeat(spin, 0.5);
  close(partial.follow.right.weight, 0.8);
  close(partial.follow.left.weight, 0.2);
  for (let i = 0; i <= 64; i++) {
    const p = poseAtBeat(spin, 1.65 + (0.35 * i) / 64);
    assert.equal(p.follow.left.weight, 1);
    assert.equal(p.follow.right.weight, 0);
  }
  const before = poseAtBeat(spin, 1),
    after = poseAtBeat(spin, 2);
  const forward = rotatePoint(
    {
      x: after.lead.right.position.x - before.lead.right.position.x,
      y: after.lead.right.position.y - before.lead.right.position.y,
    },
    -135,
  );
  assert.ok(forward.y > 0.3);
  close(forward.x, 0);
  const brush = rotatePoint(
    {
      x: after.follow.right.position.x - after.follow.left.position.x,
      y: after.follow.right.position.y - after.follow.left.position.y,
    },
    -after.follow.orientation,
  );
  close(brush.x, 0.11);
  close(brush.y, 0);
  assert.equal(after.follow.left.weight, 1);
  assert.equal(after.follow.right.weight, 0);
  assert.ok(
    spin.steps.some(
      (s) =>
        s.partner === "follow" &&
        s.foot === "right" &&
        isFreeFootFollow(s, spin.steps) &&
        s.beat > 2,
    ),
  );
  for (const partner of ["lead", "follow"] as const) {
    close(poseAtBeat(spin, 1)[partner].rise, 0);
    close(poseAtBeat(spin, 2)[partner].rise, 0.02);
    close(poseAtBeat(spin, 2.5)[partner].rise, 0.02);
    close(spin.endPose[partner].rise, 0);
  }
  assert.equal(
    spin.steps.find((s) => s.partner === "lead" && s.beat === 1)!.footwork,
    "THT",
  );
  assert.equal(
    spin.steps.find((s) => s.partner === "follow" && s.beat === 1)!.footwork,
    "HT",
  );
});
test("Natural Spin Turn: side/back exit for lead, diagonal forward for follow, feet apart in closed hold", () => {
  const before = poseAtBeat(spin, 2),
    end = spin.endPose;
  const l = rotatePoint(
    {
      x: end.lead.left.position.x - before.lead.right.position.x,
      y: end.lead.left.position.y - before.lead.right.position.y,
    },
    -180,
  );
  assert.ok(l.x < -0.3 && l.y < 0 && l.y > -0.1);
  const f = rotatePoint(
    {
      x: end.follow.right.position.x - before.follow.left.position.x,
      y: end.follow.right.position.y - before.follow.left.position.y,
    },
    0,
  );
  assert.ok(f.x > 0 && f.y > 0);
  assert.equal(end.lead.left.weight, 1);
  assert.equal(end.follow.right.weight, 1);
  for (const partner of ["lead", "follow"] as const) {
    const p = end[partner];
    assert.ok(
      Math.hypot(
        p.left.position.x - p.right.position.x,
        p.left.position.y - p.right.position.y,
      ) > 0.3,
    );
  }
  const lead = bodyPosition(end.lead),
    follow = bodyPosition(end.follow),
    hold = rotatePoint({ x: follow.x - lead.x, y: follow.y - lead.y }, -225);
  close(hold.x, 0.1);
  close(hold.y, 0.4);
});
test("Natural Spin Turn halves: all six counts clear every footprint and thigh/shin pair, with normal reach and balance", () => {
  const first = placeEntry(firstHalf, undefined),
    entries = [first, placeEntry(spin, first)];
  const sources = [
    {
      name: "placed full figure",
      beats: 6,
      at: (beat: number, options: PoseOptions) =>
        sequencePoseAtBeat(entries, beat, options),
    },
    {
      name: "authored opening",
      beats: 3,
      at: (beat: number, options: PoseOptions) =>
        poseAtBeat(firstHalf, beat, options),
    },
    {
      name: "authored spin",
      beats: 3,
      at: (beat: number, options: PoseOptions) =>
        poseAtBeat(spin, beat, options),
    },
  ];
  for (const source of sources)
    for (const options of [{}, { footEasing: footEase }])
      for (let sample = 0; sample <= source.beats * 256; sample++) {
        const beat = sample / 256,
          p = source.at(beat, options);
        assert.ok(p, `${source.name} has a pose at beat ${beat}`);
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
