import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  defineFigure,
  parseFigureDefinition,
  stancePose,
} from "../../src/libs/dance/authoring.mts";
import {
  figureDurationBeats,
  poseAtBeat,
  footEase,
  footprintGap,
} from "../../src/libs/dance/fold.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";

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
  const authored = defineFigure(definition(file));
  return {
    ...authored,
    id: file,
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}
const promenade = load("closed-promenade");

function assertPoseClose(actual: Pose, expected: Pose) {
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      const a = actual[partner][foot];
      const e = expected[partner][foot];
      assert.ok(
        Math.hypot(a.position.x - e.position.x, a.position.y - e.position.y) <
          1e-8,
        `${partner}.${foot} moved from the original connection pose`,
      );
      assert.equal(a.weight, e.weight);
      assert.equal(
        footHeading(actual[partner], foot),
        footHeading(expected[partner], foot),
      );
    }
    assert.equal(actual[partner].orientation, expected[partner].orientation);
    assert.equal(actual[partner].rise, expected[partner].rise);
  }
}

test("Closed Promenade: retains the original connection poses and S Q Q S phrasing", () => {
  assertPoseClose(
    promenade.startPose,
    stancePose("tango promenade", { lead: "right", follow: "left" }),
  );
  // Actual resolved endpoint before the adjustment, including the historical
  // rounded third-step offsets. Pin the world positions, not just a fitted
  // closed stance, so shortening a stride cannot silently shorten the chain.
  const originalEnd: Pose = {
    lead: {
      left: {
        position: { x: -1.6994398256692884, y: 0.14990663761154827 },
        weight: 0,
      },
      right: {
        position: { x: -1.4994398256692885, y: 0.14990663761154802 },
        weight: 1,
      },
      orientation: 0,
      rise: 0,
    },
    follow: {
      left: {
        position: { x: -1.3994398256692884, y: 0.549906637611548 },
        weight: 1,
      },
      right: {
        position: { x: -1.5994398256692883, y: 0.549906637611548 },
        weight: 0,
      },
      orientation: 180,
      rise: 0,
    },
  };
  assertPoseClose(promenade.endPose, originalEnd);
  assertPoseClose(poseAtBeat(promenade, 3), originalEnd);
  assert.equal(figureDurationBeats(promenade), 3);
  for (const partner of ["lead", "follow"] as const) {
    const steps = promenade.steps.filter((step) => step.partner === partner);
    assert.deepEqual(
      steps.map((step) => step.duration),
      [1, 0.5, 0.5, 1],
    );
    assert.deepEqual(
      steps.map((step) => step.foot),
      partner === "lead"
        ? ["left", "right", "left", "right"]
        : ["right", "left", "right", "left"],
    );
    for (const beat of [1, 1.5, 2])
      assert.equal(
        poseAtBeat(promenade, beat)[partner].orientation,
        promenade.startPose[partner].orientation,
      );
  }
});

test("Closed Promenade: joins Progressive Link and Back Corté without foot, facing or weight discontinuities", () => {
  const link = placeEntry(load("walks-and-progressive-link"), undefined);
  const middle = placeEntry(promenade, link);
  const corte = load("back-corte");
  for (const [end, next] of [
    [link.resolvedEndPose, promenade],
    [middle.resolvedEndPose, corte],
  ] as const) {
    const join = assessJoin(end, next);
    assert.equal(join.fits, true, JSON.stringify(join.issues));
    assert.ok(join.maxFootGap < 1e-8);
  }
});

test("Closed Promenade: all authoring checks run and both partners uncross without footprint collisions", () => {
  assert.deepEqual(definition("closed-promenade").skipChecks ?? [], []);
  // Loading above runs all authoring checks. Also sample the repaired path
  // more densely, with both the test fold and the renderer's eased feet.
  for (const options of [{}, { footEasing: footEase }]) {
    for (let beat = 1.5; beat <= 3; beat += 1 / 128) {
      const pose = poseAtBeat(promenade, beat, options);
      for (const partner of ["lead", "follow"] as const) {
        const p = pose[partner];
        assert.ok(
          footprintGap(
            p.left.position,
            footHeading(p, "left"),
            p.right.position,
            footHeading(p, "right"),
          ) >= 0,
          `${partner}'s feet overlap while uncrossing/closing at beat ${beat}`,
        );
      }
    }
  }
});

test("Closed Promenade: default bodies reach every foot with at most 14 cm of hip lowering", () => {
  // Provisional comfort target for this adjustment: below the shared 16 cm
  // limit, without changing body sizes, solver behaviour or check tolerances.
  for (const options of [{}, { footEasing: footEase }]) {
    for (let beat = 0; beat <= 3; beat += 1 / 128) {
      const skeleton = solveSkeleton(poseAtBeat(promenade, beat, options));
      for (const partner of ["lead", "follow"] as const) {
        assert.deepEqual(skeleton[partner].legShortfall, { left: 0, right: 0 });
        assert.ok(
          skeleton[partner].hipDrop <= 0.14,
          `${partner}'s hips drop ${skeleton[partner].hipDrop} m at beat ${beat}`,
        );
      }
    }
  }
});
