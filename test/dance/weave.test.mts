import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defineFigure,
  HOLD_SHAPES,
  HOLD_TOLERANCE,
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
import { LEG_CONTACT } from "../../src/libs/body/legContact.mts";
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

test("Weave: six alternating weighted counts, with her free foot drawn in on 1 and 2", () => {
  assert.deepEqual(definition.skipChecks ?? [], []);
  assert.equal(figureDurationBeats(weave), 6);
  assert.equal(definition.time, "3/4");
  poseClose(
    weave.startPose,
    stancePose("promenade apart", { lead: "left", follow: "right" }),
  );
  for (const partner of ["lead", "follow"] as const) {
    const steps = weave.steps.filter((s) => s.partner === partner),
      weighted = steps.filter((s) => s.weight === 1);
    assert.deepEqual(
      weighted.map((s) => s.foot),
      partner === "lead"
        ? ["right", "left", "right", "left", "right", "left"]
        : ["left", "right", "left", "right", "left", "right"],
    );
    assert.deepEqual(
      weighted.map((s) => [s.beat, s.duration]),
      [1, 2, 3, 4, 5, 6].map((beat) => [beat, 1]),
    );
    // The follow's free foot is drawn in during counts 1 and 2 and arrives
    // by the next count, so every weighted step starts from a collected foot.
    const free = steps.filter((s) => s.weight !== 1);
    assert.deepEqual(
      free.map((s) => [s.foot, Math.ceil(s.beat)]),
      partner === "lead"
        ? []
        : [
            ["right", 2],
            ["left", 3],
          ],
    );
    for (const s of free) {
      assert.equal(s.weight, 0);
      assert.ok(s.beat + s.duration <= Math.ceil(s.beat) + 1e-9);
    }
  }
});

test("Weave: promenade on 1, closed through the turn on 2-3, outside partner on 4, closed on 5, promenade on 6", () => {
  const { offset, distance } = HOLD_SHAPES.standard;
  const relative = (beat: number) => {
    const p = poseAtBeat(weave, beat),
      l = bodyPosition(p.lead),
      f = bodyPosition(p.follow);
    return {
      at: rotatePoint({ x: f.x - l.x, y: f.y - l.y }, -p.lead.orientation),
      facing: normalizeDegrees(p.follow.orientation - p.lead.orientation),
    };
  };
  const facingOff = (a: number, b: number) =>
    Math.abs(normalizeDegrees(a - b + 180) - 180);
  for (const beat of [1, 6])
    assert.ok(facingOff(relative(beat).facing, 270) <= 30, `V on ${beat}`);
  for (const beat of [2, 3, 4, 5]) {
    const { at, facing } = relative(beat),
      across = at.x - offset,
      along = at.y - distance;
    assert.ok(facingOff(facing, 180) <= 30, `Facing on ${beat}`);
    if (beat === 4) {
      // Outside partner: she has moved at least 10 cm to his right of
      // the closed position and stays within the hold tolerance.
      assert.ok(across >= 0.1, `Outside partner on 4: ${across}`);
      assert.ok(Math.hypot(across, along) <= HOLD_TOLERANCE);
    } else {
      assert.ok(Math.hypot(across, along) <= 0.07, `Closed on ${beat}`);
    }
  }
  // From count 3 to 5 he faces against the line of dance (the start
  // facing) and backs along it on 4 and 5.
  const lod = weave.startPose.lead.orientation;
  for (const beat of [3, 4, 5])
    close(
      poseAtBeat(weave, beat).lead.orientation,
      normalizeDegrees(lod + 180),
    );
  for (const beat of [4, 5]) {
    const a = bodyPosition(poseAtBeat(weave, beat - 1).lead),
      b = bodyPosition(poseAtBeat(weave, beat).lead);
    const along = rotatePoint({ x: b.x - a.x, y: b.y - a.y }, -lod).y;
    assert.ok(along >= 0.2, `Backing the line of dance on ${beat}: ${along}`);
  }
});

test("Weave: promenade entries connect, and it ends in promenade a 5/8 turn to the left", () => {
  for (const name of ["promenade-chasse", "contra-check-recovery-promenade"]) {
    const incoming = placeEntry(load(name).figure, undefined),
      next = placeEntry(weave, incoming);
    assert.equal(assessJoin(incoming.resolvedEndPose, weave).fits, true);
    poseClose(incoming.resolvedEndPose, next.resolvedStartPose);
  }
  poseClose(
    weave.endPose,
    applyTransform(
      { position: weave.endPose.lead.left.position, rotation: -225 },
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

/** During count 4 both step in CBMP, her outside partner: her right foot
 *  passes between his standing right foot and her own left, and each
 *  dancer's legs pass close. There, footprints may brush by up to 4 cm
 *  and a dancer's own legs meet by up to 3 cm (the owner accepted this
 *  brush for the book geometry; provisional). That is weave beats 3-4,
 *  plus the first quarter of count 5 while her left foot uncrosses. */
const CBMP_BRUSH = { from: 3, to: 4.25, feet: -0.04, ownLegs: -0.03 };

test("Weave and separate close: feet and legs stay clear apart from the CBMP brush, with normal reach and balance", () => {
  const first = placeEntry(weave, undefined),
    entries = [first, placeEntry(promenadeClose, first)];
  // All nine beats, both easing modes and the join itself, for the placed
  // pair and both authored figures. These are mannequin capsule proxies,
  // not meshes. Partner legs use the catalogue's contact allowance.
  const sources = [
    {
      name: "placed pair",
      beats: 9,
      weaveStart: 0,
      at: (beat: number, options: PoseOptions) =>
        sequencePoseAtBeat(entries, beat, options),
    },
    {
      name: "authored weave",
      beats: 6,
      weaveStart: 0,
      at: (beat: number, options: PoseOptions) =>
        poseAtBeat(weave, beat, options),
    },
    {
      name: "authored close",
      beats: 3,
      weaveStart: -Infinity,
      at: (beat: number, options: PoseOptions) =>
        poseAtBeat(promenadeClose, beat, options),
    },
  ];
  for (const source of sources)
    for (const options of [{}, { footEasing: footEase }])
      for (let sample = 0; sample <= source.beats * 256; sample++) {
        const beat = sample / 256,
          p = source.at(beat, options),
          weaveBeat = beat - source.weaveStart,
          brush = weaveBeat > CBMP_BRUSH.from && weaveBeat <= CBMP_BRUSH.to;
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
              partner,
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
            // Her own feet may touch as the free foot is drawn in.
            const limit = brush
              ? CBMP_BRUSH.feet
              : a.partner === b.partner
                ? 0
                : 0.005;
            assert.ok(
              footprintGap(a.p, a.h, b.p, b.h) >= limit,
              `Footprints ${i}/${k} at ${beat} in ${source.name}`,
            );
          }
        for (let i = 0; i < bones.length; i++)
          for (let k = i + 1; k < bones.length; k++) {
            const a = bones[i],
              b = bones[k];
            if (a.partner === b.partner && a.side === b.side) continue;
            const limit =
              a.partner !== b.partner
                ? -LEG_CONTACT
                : brush
                  ? CBMP_BRUSH.ownLegs
                  : 0.005;
            assert.ok(
              segmentDistance(a.a, a.b, b.a, b.b) - a.r - b.r >= limit,
              `Legs ${a.partner} ${a.side}/${b.partner} ${b.side} at ${beat} in ${source.name}`,
            );
          }
      }
});
