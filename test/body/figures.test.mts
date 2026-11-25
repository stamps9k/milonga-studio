import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import {
  figureDurationBeats,
  poseAtBeat,
  footEase,
} from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { holdForStyle } from "../../src/libs/dance/authoring.mts";

// Every figure file, danced by the mannequins' bodies (lead 1.75 m,
// follow 1.70 m), sampled every sixteenth of a beat. A failure here
// means a figure puts a foot where the dancer's leg can't follow:
// usually a step written too long, or two feet too far apart while the
// weight is on one of them.

const SAMPLE = 1 / 16;

/**
 * How far the hips may sink below standing height (plus any rise) to
 * reach the feet: 16 cm. Ordinary steps take 4-11 cm with the back heel
 * released (a 0.5 m waltz step about 7). Provisional (2026-11-17).
 */
const MAX_HIP_DROP = 0.16;

const figures: Figure[] = loadFigures().map((figure) => ({
  ...figure,
  id: figure.name,
  steps: figure.steps.map((step, index) => ({ ...step, id: String(index) })),
}));

function worstAlong(figure: Figure) {
  let worstDrop = { drop: 0, beat: 0, partner: "lead" };
  let shortfall = 0;
  const duration = figureDurationBeats(figure);
  for (let beat = 0; beat <= duration + 1e-9; beat += SAMPLE) {
    const skeleton = solveSkeleton(
      poseAtBeat(figure, beat),
      DEFAULT_PROPORTIONS,
      holdForStyle(figure.style),
    );
    for (const partner of ["lead", "follow"] as const) {
      const { hipDrop, legShortfall } = skeleton[partner];
      shortfall = Math.max(shortfall, legShortfall.left, legShortfall.right);
      if (hipDrop > worstDrop.drop) {
        worstDrop = { drop: hipDrop, beat: beat + 1, partner };
      }
    }
  }
  return { worstDrop, shortfall };
}

test("figures: every leg reaches its foot", async (t) => {
  for (const figure of figures) {
    await t.test(figure.name, () => {
      assert.equal(worstAlong(figure).shortfall, 0);
    });
  }
});

test("figures: the hips never sink further than an ordinary step needs", async (t) => {
  for (const figure of figures) {
    await t.test(figure.name, () => {
      const { drop, beat, partner } = worstAlong(figure).worstDrop;
      assert.ok(
        drop <= MAX_HIP_DROP,
        `the ${partner}'s hips sink ${drop.toFixed(2)} m at beat ${beat.toFixed(2)} to reach the feet (at most ${MAX_HIP_DROP})`,
      );
    });
  }
});

// Every catalogue figure participates in reach, lowering and lateral balance.
test("figures: pelvis and loaded legs remain within lateral balance limits", async (t) => {
  for (const figure of figures) {
    await t.test(figure.name, () => {
      for (const options of [{}, { footEasing: footEase }]) {
        const duration = figureDurationBeats(figure);
        for (let sample = 0; sample <= Math.ceil(duration * 128); sample++) {
          const beat = Math.min(sample / 128, duration);
          const pose = poseAtBeat(figure, beat, options);
          const skeleton = solveSkeleton(
            pose,
            DEFAULT_PROPORTIONS,
            holdForStyle(figure.style),
          );
          for (const partner of ["lead", "follow"] as const) {
            const balance = assessLateralBalance(
              pose[partner],
              skeleton[partner],
            );
            assert.ok(
              balance.plausible,
              `${partner} at beat ${beat}: support lean ${balance.supportLeanDegrees.toFixed(3)}°, loaded leg lean ${balance.loadedLegLeanDegrees.toFixed(3)}°`,
            );
          }
        }
      }
    });
  }
});
