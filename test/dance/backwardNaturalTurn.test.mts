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
import { applyTransform } from "../../src/libs/dance/floor.mts";
import { normalizeDegrees } from "../../src/libs/dance/heading.mts";
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
const { definition, figure: turn } = load("natural-turn-backward");
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

test("Backward Natural Turn: three right-turning counts from the free left foot", () => {
  assert.deepEqual(definition.skipChecks ?? [], []);
  assert.equal(figureDurationBeats(turn), 3);
  poseClose(
    turn.startPose,
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  for (const partner of ["lead", "follow"] as const) {
    const all = turn.steps.filter((s) => s.partner === partner);
    const steps = all.filter((s) => s.weight === 1);
    assert.deepEqual(
      all.map((s) => [s.beat, s.duration, s.weight]),
      [
        [1, 0.5, 1],
        [1.5, 0.5, 0],
        [2, 0.5, 1],
        [2.5, 0.5, 0],
        [3, 0.5, 1],
        [3.5, 0.5, 0],
      ],
    );
    assert.deepEqual(
      steps.map((s) => s.foot),
      partner === "lead"
        ? ["left", "right", "left"]
        : ["right", "left", "right"],
    );
    assert.deepEqual(
      steps.map((s) => [s.beat, s.duration, s.weight]),
      [
        [1, 0.5, 1],
        [2, 0.5, 1],
        [3, 0.5, 1],
      ],
    );
    close(turn.endPose[partner].rise, 0);
  }
  assert.ok(
    poseAtBeat(turn, 1).lead.left.position.y <
      turn.startPose.lead.left.position.y,
  );
  assert.ok(
    poseAtBeat(turn, 1).follow.right.position.y <
      turn.startPose.follow.right.position.y,
  );
  close(turn.endPose.lead.orientation, 225);
  close(turn.endPose.follow.orientation, 45);
  for (const [beat, heading] of [
    [1, 90],
    [2, 135],
    [3, 225],
  ]) {
    close(poseAtBeat(turn, beat).lead.orientation, heading);
    close(
      footHeading(poseAtBeat(turn, beat).lead, beat === 2 ? "right" : "left"),
      heading,
    );
  }
  const before = poseAtBeat(turn, 1).lead,
    after = poseAtBeat(turn, 2).lead;
  assert.ok(
    after.right.position.x - before.right.position.x > 0.09,
    "RF moves forward along the new eastward heading",
  );
  // Turn about the shared floor-space centre, not about a fixed lead.
  const centre = (p: Pose) => {
    const feet = [p.lead.left, p.lead.right, p.follow.left, p.follow.right];
    return {
      x: feet.reduce((a, f) => a + f.position.x, 0) / 4,
      y: feet.reduce((a, f) => a + f.position.y, 0) / 4,
    };
  };
  const a = centre(turn.startPose),
    b = centre(turn.endPose);
  close(a.x, b.x);
  close(a.y, b.y);
  const hips = (p: Pose) => {
    const l = bodyPosition(p.lead),
      f = bodyPosition(p.follow);
    return { x: (l.x + f.x) / 2, y: (l.y + f.y) / 2 };
  };
  const startHips = hips(turn.startPose),
    endHips = hips(turn.endPose);
  assert.ok(
    Math.hypot(endHips.x - startHips.x, endHips.y - startHips.y) < 0.08,
    "Pelvis midpoint also finishes within 8 cm",
  );
  for (let sample = 0; sample <= 3 * 256; sample++) {
    const p = poseAtBeat(turn, sample / 256),
      h = hips(p);
    assert.ok(
      Math.hypot(h.x - startHips.x, h.y - startHips.y) < 0.65,
      "Pivot stays within a compact floor area",
    );
  }

  const end = turn.endPose,
    l = end.lead.left.position,
    r = end.lead.right.position;
  poseClose(
    end,
    applyTransform(
      { position: { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 }, rotation: 225 },
      stancePose("closed", { lead: "left", follow: "right" }),
    ),
  );
  for (const options of [{}, { footEasing: footEase }])
    for (let i = 0; i <= 3 * 256; i++) {
      const p = poseAtBeat(turn, i / 256, options);
      close(normalizeDegrees(p.follow.orientation - p.lead.orientation), 180);
    }
});
test("Backward Natural Turn: exact support and position connections after promenade close and before RF closed change", () => {
  const first = placeEntry(promenadeClose, undefined),
    second = placeEntry(turn, first);
  assert.equal(assessJoin(first.resolvedEndPose, turn).fits, true);
  poseClose(first.resolvedEndPose, second.resolvedStartPose);
  const next = load("rf-closed-change").figure;
  assert.equal(assessJoin(second.resolvedEndPose, next).fits, true);
  poseClose(second.resolvedEndPose, placeEntry(next, second).resolvedStartPose);
});
test("Backward Natural Turn and incoming close: all six counts clear every footprint and thigh/shin pair, with normal reach and balance", () => {
  const first = placeEntry(promenadeClose, undefined),
    entries = [first, placeEntry(turn, first)];
  // Include authored foot pitch and placed playback separately; the current
  // floor transform omits pitch. Exercise both solver inputs without altering
  // that independent playback issue. No crossed interval or leg pair is omitted.
  const sources = [
    {
      name: "placed pair",
      beats: 6,
      at: (beat: number, options: PoseOptions) =>
        sequencePoseAtBeat(entries, beat, options),
    },
    {
      name: "authored turn",
      beats: 3,
      at: (beat: number, options: PoseOptions) =>
        poseAtBeat(turn, beat, options),
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
