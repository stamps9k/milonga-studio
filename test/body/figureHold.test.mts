import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import { segmentDistance } from "../../src/libs/body/legContact.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import {
  solveSkeleton,
  type CoupleSkeleton,
} from "../../src/libs/body/skeleton.mts";
import type { JointName } from "../../src/libs/body/skeleton.mts";
import { distance, sub } from "../../src/libs/body/vector3.mts";
import { holdForStyle } from "../../src/libs/dance/authoring.mts";
import {
  figureDurationBeats,
  footEase,
  poseAtBeat,
} from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

// Every figure file, danced by the mannequins in the hold of its style
// and sampled every 1/128 beat (under 10 ms at tango's default tempo),
// with linear and eased foot travel. A failure here is something a
// viewer sees in the 3D view: an arm or the hips jumping between frames,
// or the partners' arms passing through each other. No figure is exempt.

const SAMPLE = 1 / 128;

/** The 3D mannequin's capsule radii (scene3d.mts), in metres. */
const RADIUS = {
  upperArm: 0.04,
  forearm: 0.033,
  shoulder: 0.05,
};

const figures: Figure[] = loadFigures().map((figure) => ({
  ...figure,
  id: figure.name,
  steps: figure.steps.map((step, index) => ({ ...step, id: String(index) })),
}));

/** The couple at every sample of `figure`, linear then eased. */
const danced = new Map<Figure, CoupleSkeleton[][]>();
function dance(figure: Figure): CoupleSkeleton[][] {
  const cached = danced.get(figure);
  if (cached) return cached;
  const runs = [{}, { footEasing: footEase }].map((options) => {
    const couples: CoupleSkeleton[] = [];
    const duration = figureDurationBeats(figure);
    for (let i = 0; i * SAMPLE <= duration + 1e-9; i++)
      couples.push(
        solveSkeleton(
          poseAtBeat(figure, i * SAMPLE, options),
          DEFAULT_PROPORTIONS,
          holdForStyle(figure.style),
        ),
      );
    return couples;
  });
  danced.set(figure, runs);
  return runs;
}

/** Each sample with the one before it, in both runs, and its beat. */
function* steps(figure: Figure) {
  for (const run of dance(figure))
    for (let i = 1; i < run.length; i++)
      yield { before: run[i - 1], now: run[i], beat: i * SAMPLE + 1 };
}

/** Each sample of the linear run, and its beat. */
function* samples(figure: Figure) {
  const [run] = dance(figure);
  for (let i = 0; i < run.length; i++)
    yield { couple: run[i], beat: i * SAMPLE + 1 };
}

const partners = ["lead", "follow"] as const;
const sides = ["left", "right"] as const;

/** A dancer's arm bones as capsules: [from joint, to joint, radius]. */
function armBones(
  side: "left" | "right",
): [JointName, JointName, number, string][] {
  return [
    [
      `${side}UpperArm`,
      `${side}LowerArm`,
      RADIUS.upperArm,
      `${side} upper arm`,
    ],
    [`${side}LowerArm`, `${side}Hand`, RADIUS.forearm, `${side} forearm`],
  ];
}

test("figures: elbows and hands move smoothly relative to the body", async (t) => {
  // Measured relative to the chest, so the body's own travel doesn't
  // count: a joint moving more than this in one sample is a visible
  // jump. Provisional: just above the largest step now (about 4.8 cm,
  // his left elbow at the start of the Back Corté's second step).
  const STEP = 0.05;
  for (const figure of figures)
    await t.test(figure.name, () => {
      for (const { before, now, beat } of steps(figure))
        for (const partner of partners)
          for (const joint of [
            "leftLowerArm",
            "rightLowerArm",
            "leftHand",
            "rightHand",
          ] as const) {
            const moved = distance(
              sub(now[partner].joints[joint], now[partner].joints.chest),
              sub(before[partner].joints[joint], before[partner].joints.chest),
            );
            assert.ok(
              moved <= STEP,
              `${partner} ${joint} jumps ${moved.toFixed(3)} m at beat ${beat.toFixed(3)}`,
            );
          }
    });
});

test("figures: the hips rise and sink smoothly", async (t) => {
  // The hips follow the body position the figure authors across the
  // floor; the solver sets only their height (rise, knee flex, and
  // lowering so a leg reaches its foot). A height change of more than
  // this in one sample is a visible jump, such as a free foot switching
  // from its ball to its heel. Provisional: a long stride sinks the
  // hips up to about 2.9 cm a sample as the weight arrives.
  const STEP = 0.03;
  for (const figure of figures)
    await t.test(figure.name, () => {
      for (const { before, now, beat } of steps(figure))
        for (const partner of partners) {
          const moved = Math.abs(
            now[partner].joints.hips.z - before[partner].joints.hips.z,
          );
          assert.ok(
            moved <= STEP,
            `${partner}'s hips jump ${moved.toFixed(3)} m at beat ${beat.toFixed(3)}`,
          );
        }
    });
});

test("figures: the partners' arms lie on each other, not through each other", async (t) => {
  // Her left arm lies along his right and the joined hands clasp, so
  // those arms touch; where her elbow rests on his and at the clasp they
  // press in a few centimetres. Provisional limit.
  const PRESS = 0.05;
  for (const figure of figures)
    await t.test(figure.name, () => {
      for (const { couple, beat } of samples(figure)) {
        const his = couple.lead.joints;
        const hers = couple.follow.joints;
        for (const side of sides)
          for (const [from, to, radius, name] of armBones(side))
            for (const herSide of sides)
              for (const [herFrom, herTo, herRadius, herName] of armBones(
                herSide,
              )) {
                const gap =
                  segmentDistance(
                    his[from],
                    his[to],
                    hers[herFrom],
                    hers[herTo],
                  ) -
                  radius -
                  herRadius;
                assert.ok(
                  gap >= -PRESS,
                  `his ${name} and her ${herName} press in ${(-gap).toFixed(3)} m at beat ${beat.toFixed(3)}`,
                );
              }
      }
    });
});

test("figures: his right arm passes clear of her left shoulder", async (t) => {
  // His upper arm against her shoulder joint (the mannequin's shoulder
  // bar): his arm wraps round her side under her arm rather than
  // through her shoulder, in closed hold and promenade alike (the upper
  // bodies open apart in promenade, openUpperBodies).
  for (const figure of figures)
    await t.test(figure.name, () => {
      for (const { couple, beat } of samples(figure)) {
        const gap =
          segmentDistance(
            couple.lead.joints.rightUpperArm,
            couple.lead.joints.rightLowerArm,
            couple.follow.joints.leftUpperArm,
            couple.follow.joints.leftUpperArm,
          ) -
          RADIUS.upperArm -
          RADIUS.shoulder;
        assert.ok(
          gap >= 0,
          `his arm presses ${(-gap).toFixed(3)} m into her shoulder at beat ${beat.toFixed(3)}`,
        );
      }
    });
});
