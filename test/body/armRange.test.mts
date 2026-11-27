import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import {
  assessArmRange,
  MAX_ARM_BEHIND_DEGREES,
  MIN_ELBOW_DEGREES,
} from "../../src/libs/body/armRange.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import type { PartnerSkeleton } from "../../src/libs/body/skeleton.mts";
import { stancePose, holdForStyle } from "../../src/libs/dance/authoring.mts";
import {
  figureDurationBeats,
  footEase,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

/** A lead in closed hold, his chest facing north, with his right arm
 *  re-placed: the shoulder where the solver put it, then the elbow and
 *  hand at the given offsets (east, north, up) from the shoulder and the
 *  elbow. */
function withRightArm(
  elbow: [number, number, number],
  hand: [number, number, number],
): PartnerSkeleton {
  const { lead } = solveSkeleton(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  const shoulder = lead.joints.rightUpperArm;
  const e = {
    x: shoulder.x + elbow[0],
    y: shoulder.y + elbow[1],
    z: shoulder.z + elbow[2],
  };
  return {
    ...lead,
    joints: {
      ...lead.joints,
      rightLowerArm: e,
      rightHand: { x: e.x + hand[0], y: e.y + hand[1], z: e.z + hand[2] },
    },
  };
}

test("arm range: the closed hold's arms are within range", () => {
  const couple = solveSkeleton(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  for (const partner of ["lead", "follow"] as const)
    for (const side of ["left", "right"] as const)
      assert.ok(
        assessArmRange(couple[partner])[side].plausible,
        `${partner} ${side}`,
      );
});

test("arm range: an elbow folded tighter than the limit fails", () => {
  // Upper arm straight down, forearm folded back up at the given angle.
  for (const bend of [29, 31]) {
    const r = (bend * Math.PI) / 180;
    const arm = assessArmRange(
      withRightArm([0, 0, -0.3], [0, 0.25 * Math.sin(r), 0.25 * Math.cos(r)]),
    ).right;
    assert.ok(Math.abs(arm.elbowDegrees - bend) < 1e-6);
    assert.equal(arm.plausible, bend >= MIN_ELBOW_DEGREES);
  }
});

test("arm range: an upper arm swung further behind the chest than the limit fails", () => {
  for (const behind of [44, 46]) {
    const r = (behind * Math.PI) / 180;
    // Down and back, with the forearm forward so the elbow stays open.
    const arm = assessArmRange(
      withRightArm([0, -0.3 * Math.sin(r), -0.3 * Math.cos(r)], [0, 0.25, 0]),
    ).right;
    assert.ok(Math.abs(arm.behindDegrees - behind) < 1e-6);
    assert.equal(arm.plausible, behind <= MAX_ARM_BEHIND_DEGREES);
  }
});

test("arm range: a hand behind the back or across past the other shoulder fails", () => {
  // Elbow out to the side and back, forearm across behind the back.
  const behindBack = assessArmRange(
    withRightArm([0.05, -0.15, -0.25], [-0.25, -0.05, 0]),
  ).right;
  assert.ok(behindBack.handBehindBack);
  assert.equal(behindBack.plausible, false);
  // Elbow in front, forearm across the chest past the left shoulder.
  const across = assessArmRange(
    withRightArm([-0.2, 0.2, -0.1], [-0.24, 0.05, 0.05]),
  ).right;
  assert.ok(across.handAcrossBody);
  assert.equal(across.plausible, false);
});

test("arm range: every figure keeps both partners' arms within range", async (t) => {
  // Every figure, every 1/128 beat, with linear and eased feet, in its
  // own hold. No figure is exempt.
  const SAMPLE = 1 / 128;
  const figures: Figure[] = loadFigures().map((figure) => ({
    ...figure,
    id: figure.name,
    steps: figure.steps.map((step, index) => ({ ...step, id: String(index) })),
  }));
  for (const figure of figures)
    await t.test(figure.name, () => {
      const duration = figureDurationBeats(figure);
      for (const options of [{}, { footEasing: footEase }])
        for (let i = 0; i * SAMPLE <= duration + 1e-9; i++) {
          const beat = i * SAMPLE;
          const couple = solveSkeleton(
            poseAtBeat(figure, beat, options),
            DEFAULT_PROPORTIONS,
            holdForStyle(figure.style),
          );
          for (const partner of ["lead", "follow"] as const) {
            const arms = assessArmRange(couple[partner]);
            for (const side of ["left", "right"] as const) {
              const arm = arms[side];
              assert.ok(
                arm.plausible,
                `${partner}'s ${side} arm at count ${(beat + 1).toFixed(3)}: ` +
                  `elbow ${arm.elbowDegrees.toFixed(1)}°, ` +
                  `${arm.behindDegrees.toFixed(1)}° behind` +
                  (arm.handBehindBack ? ", hand behind the back" : "") +
                  (arm.handAcrossBody ? ", hand across the body" : ""),
              );
            }
          }
        }
    });
});
