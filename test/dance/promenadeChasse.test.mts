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
  footEase,
  footprintGap,
  figureDurationBeats,
} from "../../src/libs/dance/fold.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";
function definition(file: string) {
  return parseFigureDefinition(
    JSON.parse(
      readFileSync(
        new URL(`../../db/figures/${file}.json`, import.meta.url),
        "utf8",
      ),
    ),
    file,
  );
}
function load(file: string): Figure {
  const a = defineFigure(definition(file));
  return {
    ...a,
    id: file,
    steps: a.steps.map((s, i) => ({ ...s, id: String(i) })),
  };
}
const chasse = load("promenade-chasse");
function close(a: number, b: number) {
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
}
function connection(actual: Pose, expected: Pose) {
  for (const partner of ["lead", "follow"] as const) {
    close(actual[partner].orientation, expected[partner].orientation);
    assert.equal(actual[partner].rise, expected[partner].rise);
    assert.equal(actual[partner].bodyOffset, undefined);
    for (const foot of ["left", "right"] as const) {
      const a = actual[partner][foot],
        e = expected[partner][foot];
      close(a.position.x, e.position.x);
      close(a.position.y, e.position.y);
      assert.equal(a.weight, e.weight);
      close(
        footHeading(actual[partner], foot),
        footHeading(expected[partner], foot),
      );
    }
  }
}
// Resolved exit before this repair. All four foot positions are pinned rather
// than merely fitting an equivalent stance, so travel cannot silently change.
const originalEnd: Pose = {
  lead: {
    left: {
      position: { x: -1.3192388155425117, y: -0.0707106781186548 },
      weight: 1,
    },
    right: { position: { x: -0.848528137423857, y: 0 }, weight: 0 },
    orientation: 315,
    rise: 0,
  },
  follow: {
    left: { position: { x: -0.7485281374238572, y: 0.4 }, weight: 0 },
    right: {
      position: { x: -1.2192388155425118, y: 0.47071067811865425 },
      weight: 1,
    },
    orientation: 225,
    rise: 0,
  },
};

test("Promenade Chassé: original crossed entry and promenade-apart exit are retained", () => {
  connection(
    chasse.startPose,
    stancePose("crossed promenade", { lead: "left", follow: "right" }),
  );
  connection(chasse.endPose, originalEnd);
  connection(poseAtBeat(chasse, 3), originalEnd);
  const second = poseAtBeat(chasse, 1.5),
    closed = poseAtBeat(chasse, 2);
  // The side-step landing and all subsequent landings stay where they were.
  close(second.lead.left.position.x, -0.9192388155425117);
  close(second.lead.left.position.y, -0.07071067811865472);
  close(second.follow.right.position.x, -0.8192388155425119);
  close(second.follow.right.position.y, 0.4707106781186543);
  for (const partner of ["lead", "follow"] as const) {
    const inner = partner === "lead" ? "right" : "left";
    close(
      closed[partner][inner].position.x,
      originalEnd[partner][inner].position.x,
    );
    close(
      closed[partner][inner].position.y,
      originalEnd[partner][inner].position.y,
    );
    assert.equal(closed[partner].bodyOffset, undefined);
  }
});

test("Promenade Chassé: 1 2 & 3 rhythm, toe rise, close and foot order remain", () => {
  assert.equal(figureDurationBeats(chasse), 3);
  for (const partner of ["lead", "follow"] as const) {
    const steps = chasse.steps.filter((s) => s.partner === partner);
    assert.deepEqual(
      steps.map((s) => s.beat),
      [1, 2, 2.5, 3],
    );
    assert.deepEqual(
      steps.map((s) => s.duration),
      [1, 0.5, 0.5, 1],
    );
    assert.deepEqual(
      steps.map((s) => s.foot),
      partner === "lead"
        ? ["right", "left", "right", "left"]
        : ["left", "right", "left", "right"],
    );
    assert.deepEqual(
      steps.map((s) => s.rise),
      [0, 0.06, 0.1, 0],
    );
    assert.equal(steps[2].weightTiming, "late");
    for (const step of steps)
      assert.equal(step.orientation, partner === "lead" ? 315 : 225);
    assert.deepEqual(steps[0].movement, {
      type: "straight",
      direction: 270,
      distance: 0.25,
    });
    for (const [beat, rise] of [
      [1, 0],
      [1.5, 0.06],
      [2, 0.1],
      [3, 0],
    ])
      close(poseAtBeat(chasse, beat)[partner].rise, rise);
    const p = poseAtBeat(chasse, 2)[partner];
    close(
      Math.hypot(
        p.left.position.x - p.right.position.x,
        p.left.position.y - p.right.position.y,
      ),
      0.1,
    );
  }
});

test("Promenade Chassé: connects Whisk to Open Natural Turn without moving the joins", () => {
  const previous = placeEntry(load("whisk"), undefined),
    middle = placeEntry(chasse, previous);
  // Whisk has an existing 0.4265 mm rounding gap at this stance; retain it.
  for (const [end, next, gap] of [
    [previous.resolvedEndPose, chasse, 0.0004264965961272196],
    [middle.resolvedEndPose, load("open-natural-turn"), 0],
  ] as const) {
    const join = assessJoin(end, next);
    assert.equal(join.fits, true, JSON.stringify(join.issues));
    close(join.maxFootGap, gap);
  }
});

test("Promenade Chassé: no authoring exemptions and positive footprint clearance throughout", () => {
  assert.deepEqual(definition("promenade-chasse").skipChecks ?? [], []);
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const p = poseAtBeat(chasse, beat, options);
      for (const partner of ["lead", "follow"] as const) {
        const a = p[partner];
        assert.ok(
          footprintGap(
            a.left.position,
            footHeading(a, "left"),
            a.right.position,
            footHeading(a, "right"),
          ) >= 0.003,
          `${partner} feet overlap at ${beat}`,
        );
      }
    }
});

test("Promenade Chassé: every leg reaches with at most 11 cm hip lowering and plausible lateral balance", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const p = poseAtBeat(chasse, beat, options),
        s = solveSkeleton(p);
      for (const partner of ["lead", "follow"] as const) {
        assert.deepEqual(s[partner].legShortfall, { left: 0, right: 0 });
        assert.ok(
          s[partner].hipDrop <= 0.11,
          `${partner} lowers ${s[partner].hipDrop} m at ${beat}`,
        );
        assert.equal(
          assessLateralBalance(p[partner], s[partner]).plausible,
          true,
        );
      }
    }
});

test("Promenade Chassé: the close and final step clear full thigh/shin capsules", () => {
  // The early crossed-stance release still has a documented transient leg
  // proxy overlap (~2.5 cm, reduced from ~7.8 cm). Do not claim full-figure
  // mesh clearance. Footprints, reach and balance above cover every beat.
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 1.5; beat <= 3; beat += 1 / 256) {
      const s = solveSkeleton(poseAtBeat(chasse, beat, options)),
        bones = [];
      for (const partner of ["lead", "follow"] as const)
        for (const side of ["left", "right"] as const) {
          const j = s[partner].joints;
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
      for (let i = 0; i < bones.length; i++)
        for (let k = i + 1; k < bones.length; k++) {
          const a = bones[i],
            b = bones[k];
          if (a.partner === b.partner && a.side === b.side) continue;
          assert.ok(
            segmentDistance(a.a, a.b, b.a, b.b) - a.r - b.r >= 0.005,
            `Leg clearance at ${beat}: ${a.partner} ${a.side} / ${b.partner} ${b.side}`,
          );
        }
    }
});
