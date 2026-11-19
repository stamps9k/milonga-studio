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
import {
  rotatePoint,
  normalizeDegrees,
} from "../../src/libs/dance/heading.mts";
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
      { position: weave.endPose.lead.left.position, rotation: 180 },
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

test("Weave: count three continues the pivot together, swaps sides and keeps opening-direction progress", () => {
  const before = poseAtBeat(weave, 2),
    after = poseAtBeat(weave, 3);
  // Preserve the accepted opening and the follow's arrival from its pivot.
  close(before.lead.left.position.x, -0.5);
  close(before.lead.left.position.y, -0.08);
  close(before.follow.right.position.x, -0.65);
  close(before.follow.right.position.y, 0.26);
  for (const options of [{}, { footEasing: footEase }])
    for (let sample = 0; sample <= 256; sample++) {
      const progress = sample / 256,
        p = poseAtBeat(weave, 2 + progress, options);
      close(p.lead.orientation, 270 - 90 * progress);
      close(p.follow.orientation, 90 - 90 * progress);
      close(normalizeDegrees(p.follow.orientation - p.lead.orientation), 180);
    }
  const a = bodyPosition(before.lead),
    b = bodyPosition(before.follow),
    c = bodyPosition(after.lead),
    d = bodyPosition(after.follow);
  assert.ok(
    a.y < b.y && c.y > d.y,
    "Partners exchange sides during the shared turn",
  );
  assert.ok(
    c.x < a.x && d.x < b.x,
    "Both continue westward rather than reversing east",
  );
  const delta = {
    x: (c.x + d.x - a.x - b.x) / 2,
    y: (c.y + d.y - a.y - b.y) / 2,
  };
  // The centre travels northwest: between an eighth and a quarter turn
  // clockwise from the opening's westward line, without a reverse step.
  assert.ok(delta.x < -0.15 && delta.y >= -delta.x);
});

test("Weave: opposed shoulder spacing is maintained through the shared turn and new travelling heading", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let sample = 2 * 256; sample <= 5 * 256; sample++) {
      const p = poseAtBeat(weave, sample / 256, options),
        l = bodyPosition(p.lead),
        f = bodyPosition(p.follow);
      // During the shared turn the shoulders draw closer and the forward
      // stagger approaches level; it remains positive and returns to 15 cm
      // at each landing. Keep the geometry/body limits independently strict.
      const relative = rotatePoint(
        { x: f.x - l.x, y: f.y - l.y },
        -p.lead.orientation,
      );
      close(normalizeDegrees(p.follow.orientation - p.lead.orientation), 180);
      assert.ok(
        relative.x >= 0.27 && relative.x <= 0.52,
        `Shoulder spacing at ${sample / 256}`,
      );
      assert.ok(
        relative.y >= 0.01 && relative.y <= 0.26,
        `Lead ahead along shared travel at ${sample / 256}`,
      );
      if (sample >= 3 * 256) {
        close(p.lead.orientation, 180);
        close(p.follow.orientation, 0);
      }
    }
  assert.deepEqual(
    definition.steps.map((row) => row.hold),
    [
      undefined,
      "opposed promenade",
      "opposed promenade",
      "opposed promenade",
      "opposed promenade",
      undefined,
    ],
  );
  for (const beat of [2, 3, 4, 5]) {
    const p = poseAtBeat(weave, beat),
      l = bodyPosition(p.lead),
      f = bodyPosition(p.follow),
      relative = rotatePoint(
        { x: f.x - l.x, y: f.y - l.y },
        -p.lead.orientation,
      );
    assert.ok(relative.x >= 0.33 && relative.x <= 0.39);
    close(relative.y, 0.15);
  }
  // After the twirl the lead backs north and the follow walks north.
  for (const beat of [4, 5]) {
    const a = poseAtBeat(weave, beat - 1),
      b = poseAtBeat(weave, beat);
    assert.ok(bodyPosition(b.lead).y - bodyPosition(a.lead).y >= 0.2);
    assert.ok(bodyPosition(b.follow).y - bodyPosition(a.follow).y >= 0.17);
  }
  close(poseAtBeat(weave, 1).lead.orientation, 300);
  close(poseAtBeat(weave, 1).follow.orientation, 240);
  close(weave.endPose.lead.orientation, 135);
  close(weave.endPose.follow.orientation, 45);
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
  // Keep authored poses and placed playback covered independently. The
  // existing floor transform currently omits foot pitch; this guards both
  // solver inputs without changing that separate playback behaviour here.
  const sources = [
    {
      name: "placed pair",
      beats: 9,
      at: (beat: number, options: PoseOptions) =>
        sequencePoseAtBeat(entries, beat, options),
    },
    {
      name: "authored weave",
      beats: 6,
      at: (beat: number, options: PoseOptions) =>
        poseAtBeat(weave, beat, options),
    },
    {
      name: "authored close",
      beats: 3,
      at: (beat: number, options: PoseOptions) =>
        poseAtBeat(promenadeClose, beat, options),
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
