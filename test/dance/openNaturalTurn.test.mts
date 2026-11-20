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
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { rotatePoint } from "../../src/libs/dance/heading.mts";
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
const natural = load("open-natural-turn");
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
// The resolved endpoint: exactly closed hold, so closed-start figures join
// with no gap. Pin all four feet, not just an equivalent closed stance or
// rounded expectEnd.
const originalEnd: Pose = {
  lead: {
    left: {
      position: { x: -0.6290000000000002, y: 0.4169999999999995 },
      weight: 0,
    },
    right: {
      position: { x: -0.6290000000000003, y: 0.21699999999999936 },
      weight: 1,
    },
    orientation: 90,
    rise: 0,
  },
  follow: {
    left: {
      position: { x: -0.229, y: 0.117 },
      weight: 1,
    },
    right: {
      position: { x: -0.229, y: 0.317 },
      weight: 0,
    },
    orientation: 270,
    rise: 0,
  },
};

test("Open Natural Turn: original entry/exit poses and count-2 landings are preserved", () => {
  connection(
    natural.startPose,
    stancePose("promenade apart", { lead: "left", follow: "right" }),
  );
  connection(natural.endPose, originalEnd);
  connection(poseAtBeat(natural, 3), originalEnd);
  const second = poseAtBeat(natural, 2);
  for (const partner of ["lead", "follow"] as const) {
    const outer = partner === "lead" ? "left" : "right";
    close(
      second[partner][outer].position.x,
      originalEnd[partner][outer].position.x,
    );
    close(
      second[partner][outer].position.y,
      originalEnd[partner][outer].position.y,
    );
  }
});

test("Open Natural Turn: total turn, foot order, counts and flat rise remain", () => {
  assert.equal(figureDurationBeats(natural), 3);
  for (const partner of ["lead", "follow"] as const) {
    const steps = natural.steps.filter((s) => s.partner === partner);
    assert.deepEqual(
      steps.map((s) => s.beat),
      [1, 2, 3],
    );
    assert.deepEqual(
      steps.map((s) => s.duration),
      [1, 1, 1],
    );
    assert.deepEqual(
      steps.map((s) => s.foot),
      partner === "lead"
        ? ["right", "left", "right"]
        : ["left", "right", "left"],
    );
    assert.deepEqual(
      steps.map((s) => s.orientation),
      partner === "lead" ? [320, 60, 90] : [255, 240, 270],
    );
    assert.deepEqual(
      steps.map((s) => s.rise),
      [0, 0, 0],
    );
    assert.equal(steps[2].weightTiming, "late");
  }
  const first = definition("open-natural-turn").steps[0].lead;
  assert.equal(
    typeof first === "object" && "go" in first ? first.cross : false,
    true,
    "The deeper stride crosses in the body frame; dense clearance tests still cover its entire route",
  );
  const lead = natural.steps[2].movement;
  assert.equal(lead.type, "arc");
  if (lead.type === "arc")
    assert.ok(
      lead.arcLength < 1.25,
      "Uncross should not become a larger backward loop",
    );
});

test("Open Natural Turn: retains joins from Promenade Chassé to closed-start figures", () => {
  const previous = placeEntry(load("promenade-chasse"), undefined),
    middle = placeEntry(natural, previous);
  const incoming = assessJoin(previous.resolvedEndPose, natural);
  assert.equal(incoming.fits, true, JSON.stringify(incoming.issues));
  assert.ok(incoming.maxFootGap < 1e-8);
  for (const file of ["box-turn-backward", "lf-closed-change"]) {
    const join = assessJoin(middle.resolvedEndPose, load(file));
    assert.equal(join.fits, true, JSON.stringify(join.issues));
    assert.ok(join.maxFootGap < 1e-6, `foot gap ${join.maxFootGap}`);
  }
});

test("Open Natural Turn: all authoring checks run and the closed hold has margin on count 2", () => {
  assert.deepEqual(definition("open-natural-turn").skipChecks ?? [], []);
  const p = poseAtBeat(natural, 2),
    l = bodyPosition(p.lead),
    f = bodyPosition(p.follow),
    offset = rotatePoint({ x: 0.1, y: 0.4 }, p.lead.orientation);
  const error = Math.hypot(f.x - l.x - offset.x, f.y - l.y - offset.y);
  assert.ok(
    error < 0.18,
    `Count-2 hold error ${error} m (authoring limit remains .2 m)`,
  );
  close(p.follow.bodyOffset!.x, 0);
  close(p.follow.bodyOffset!.y, 0.04);
  assert.equal(poseAtBeat(natural, 3).follow.bodyOffset, undefined);
});

test("Open Natural Turn: both partners’ footprints clear throughout", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const p = poseAtBeat(natural, beat, options);
      for (const partner of ["lead", "follow"] as const) {
        const a = p[partner];
        assert.ok(
          footprintGap(
            a.left.position,
            footHeading(a, "left"),
            a.right.position,
            footHeading(a, "right"),
          ) >= 0.003,
          `${partner} footprint clearance at ${beat}`,
        );
      }
    }
});

test("Open Natural Turn: reach, hip lowering and lateral balance pass throughout", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const p = poseAtBeat(natural, beat, options),
        s = solveSkeleton(p);
      for (const partner of ["lead", "follow"] as const) {
        assert.deepEqual(s[partner].legShortfall, { left: 0, right: 0 });
        assert.ok(s[partner].hipDrop <= 0.16);
        assert.equal(
          assessLateralBalance(p[partner], s[partner]).plausible,
          true,
        );
      }
    }
});

test("Open Natural Turn: the whole figure clears full thigh/shin capsules", () => {
  // Check all pairs, including each dancer’s two thighs, throughout the
  // opening passage and the subsequent turn. Use the renderer’s capsule sizes.
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const s = solveSkeleton(poseAtBeat(natural, beat, options)),
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

// The original straight passage turned the pelvis across the inner leg. Pin
// the new mechanism as well as the resulting clearance: gather the hips, keep
// the passing foot along travel, and complete the body turn on the next count.
test("Open Natural Turn: inner leg passes beneath close hips before the main body turn", () => {
  const p = poseAtBeat(natural, 1);
  close(footHeading(p.lead, "right"), 270);
  close(p.lead.orientation, 320);
  close(p.lead.bodyOffset!.x, 0.04);
  close(p.lead.bodyOffset!.y, 0.04);
  close(p.follow.bodyOffset!.x, -0.04);
  close(p.follow.bodyOffset!.y, 0.04);
  close(footHeading(p.follow, "left"), 270);
  // Contact is closest during the passage, before either foot finishes landing.
  // Check both the near-contact channel and that the pelvis rods never overlap.
  let nearest = Infinity;
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 1; beat += 1 / 256) {
      const s = solveSkeleton(poseAtBeat(natural, beat, options));
      const l = s.lead.joints,
        f = s.follow.joints;
      const gap =
        segmentDistance(
          l.leftUpperLeg,
          l.rightUpperLeg,
          f.leftUpperLeg,
          f.rightUpperLeg,
        ) - 0.16;
      assert.ok(gap >= 0, `Pelvis overlap at ${beat}`);
      nearest = Math.min(nearest, gap);
    }
  assert.ok(nearest < 0.03, `Closest hip gap ${nearest} m`);
});

test("Open Natural Turn: both inner feet step 15 cm deeper than the accepted clearance repair", () => {
  const p = poseAtBeat(natural, 1);
  // Along this promenade's line of travel, deeper means further in floor -x.
  // Accepted first landings were lead -0.179289... and follow +0.173298... .
  close(-0.1792893218813452 - p.lead.right.position.x, 0.15);
  close(0.1732988685696799 - p.follow.left.position.x, 0.15);
  // The lead passes 33 cm beyond his outer foot; the follow now passes hers too.
  assert.ok(p.lead.left.position.x - p.lead.right.position.x > 0.32);
  assert.ok(p.follow.right.position.x - p.follow.left.position.x > 0.07);
});
