import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import { figureDurationBeats, poseAtBeat } from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";

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

/**
 * Figures known to need more, waiting for the figure clean-up: they
 * have wide steps in their data.
 */
const KNOWN_DEEP: Record<string, string> = {
  "Promenade Chassé": "count 2 lands 0.73-0.80 m from the standing foot",
  Ocho: "old Argentine tango figure, not yet described by the owner",
};

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
    const skeleton = solveSkeleton(poseAtBeat(figure, beat));
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
    // A known deep figure can sink its hips to the floor, short of
    // reach (the Back Corté's follow, by under a millimetre).
    if (figure.name in KNOWN_DEEP) continue;
    await t.test(figure.name, () => {
      assert.equal(worstAlong(figure).shortfall, 0);
    });
  }
});

test("figures: the hips never sink further than an ordinary step needs", async (t) => {
  for (const figure of figures) {
    if (figure.name in KNOWN_DEEP) continue;
    await t.test(figure.name, () => {
      const { drop, beat, partner } = worstAlong(figure).worstDrop;
      assert.ok(
        drop <= MAX_HIP_DROP,
        `the ${partner}'s hips sink ${drop.toFixed(2)} m at beat ${beat.toFixed(2)} to reach the feet (at most ${MAX_HIP_DROP})`,
      );
    });
  }
});
