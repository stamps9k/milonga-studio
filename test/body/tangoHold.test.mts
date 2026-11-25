import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import { segmentDistance } from "../../src/libs/body/legContact.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { distance, sub } from "../../src/libs/body/vector3.mts";
import { holdForStyle } from "../../src/libs/dance/authoring.mts";
import {
  figureDurationBeats,
  footEase,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

// The ballroom tango figures, danced by the mannequins in tango hold:
// his right arm wraps round her side under her left arm and her left arm
// lies along the top of his. Sampled every 1/128 beat (under 10 ms at
// tango's default tempo), linear and eased.
const tango: Figure[] = loadFigures()
  .filter((figure) => figure.style === "tango")
  .map((figure) => ({
    ...figure,
    id: figure.name,
    steps: figure.steps.map((step, index) => ({ ...step, id: String(index) })),
  }));

test("tango hold: elbows and hands move smoothly relative to the body", () => {
  // Measured relative to the chest, so the body's own travel doesn't
  // count: a joint moving more than this in one sample is a visible jump.
  // Provisional: just above the largest step now (about 4.8 cm, his left
  // elbow at the start of the Back Corté's second step).
  const STEP = 0.05;
  assert.ok(tango.length > 0);
  for (const figure of tango) {
    for (const options of [{}, { footEasing: footEase }]) {
      let previous: ReturnType<typeof solveSkeleton> | null = null;
      for (let beat = 0; beat <= figureDurationBeats(figure); beat += 1 / 128) {
        const couple = solveSkeleton(
          poseAtBeat(figure, beat, options),
          DEFAULT_PROPORTIONS,
          holdForStyle(figure.style),
        );
        if (previous !== null)
          for (const partner of ["lead", "follow"] as const)
            for (const joint of [
              "leftLowerArm",
              "rightLowerArm",
              "leftHand",
              "rightHand",
            ] as const) {
              const now = sub(
                couple[partner].joints[joint],
                couple[partner].joints.chest,
              );
              const before = sub(
                previous[partner].joints[joint],
                previous[partner].joints.chest,
              );
              assert.ok(
                distance(now, before) <= STEP,
                `${figure.name}: ${partner} ${joint} jumps ${distance(now, before)} m at beat ${beat}`,
              );
            }
        previous = couple;
      }
    }
  }
});

test("tango hold: her left upper arm stays out of his right upper arm", () => {
  // Arm capsules with the mannequin's radii (4 cm each). Provisional
  // limit: the near shoulders still come within about 10 cm of each other
  // in tango promenade, which needs promenade shaping of the upper bodies
  // to open; until then the upper arms may press in up to 5 cm.
  for (const figure of tango) {
    for (let beat = 0; beat <= figureDurationBeats(figure); beat += 1 / 64) {
      const { lead, follow } = solveSkeleton(
        poseAtBeat(figure, beat),
        DEFAULT_PROPORTIONS,
        holdForStyle(figure.style),
      );
      const gap =
        segmentDistance(
          lead.joints.rightUpperArm,
          lead.joints.rightLowerArm,
          follow.joints.leftUpperArm,
          follow.joints.leftLowerArm,
        ) - 0.08;
      assert.ok(
        gap >= -0.05,
        `${figure.name}: upper arms press in ${-gap} m at beat ${beat}`,
      );
    }
  }
});
