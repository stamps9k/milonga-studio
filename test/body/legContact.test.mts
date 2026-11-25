import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  LEG_CONTACT,
  LEG_RADII,
  MAX_KNEE_SWING,
  segmentDistance,
  slideKnees,
} from "../../src/libs/body/legContact.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import {
  solvePartnerSkeleton,
  solveSkeleton,
} from "../../src/libs/body/skeleton.mts";
import type { CoupleSkeleton } from "../../src/libs/body/skeleton.mts";
import { distance } from "../../src/libs/body/vector3.mts";
import {
  defineFigure,
  parseFigureDefinition,
  stancePose,
} from "../../src/libs/dance/authoring.mts";
import { footEase, poseAtBeat } from "../../src/libs/dance/fold.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

const SIDES = ["left", "right"] as const;

/** The smallest surface gap between any of the lead's leg bones and any
 *  of the follow's (negative where they press in). */
function partnerLegGap(couple: CoupleSkeleton): number {
  const bones = (partner: "lead" | "follow") =>
    SIDES.flatMap((side) => {
      const j = couple[partner].joints;
      const hip = side === "left" ? j.leftUpperLeg : j.rightUpperLeg;
      const knee = side === "left" ? j.leftLowerLeg : j.rightLowerLeg;
      const ankle = side === "left" ? j.leftFoot : j.rightFoot;
      return [
        { a: hip, b: knee, r: LEG_RADII.thigh },
        { a: knee, b: ankle, r: LEG_RADII.shin },
      ];
    });
  let gap = Infinity;
  for (const x of bones("lead"))
    for (const y of bones("follow"))
      gap = Math.min(gap, segmentDistance(x.a, x.b, y.a, y.b) - x.r - y.r);
  return gap;
}

function solved(pose: Pose): CoupleSkeleton {
  return {
    lead: solvePartnerSkeleton(pose.lead, DEFAULT_PROPORTIONS.lead, "lead"),
    follow: solvePartnerSkeleton(
      pose.follow,
      DEFAULT_PROPORTIONS.follow,
      "follow",
    ),
  };
}

function loadFigures(): Figure[] {
  return readdirSync("db/figures")
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const definition = defineFigure(
        parseFigureDefinition(
          JSON.parse(readFileSync(`db/figures/${name}`, "utf8")),
          name,
        ),
      );
      return {
        ...definition,
        id: name,
        steps: definition.steps.map((step, i) => ({ ...step, id: `${i}` })),
      };
    });
}

test("slideKnees leaves legs that don't meet as they are", () => {
  const couple = solved(
    stancePose("closed", { lead: "right", follow: "left" }),
  );
  assert.ok(partnerLegGap(couple) > 0);
  assert.deepEqual(slideKnees(couple), couple);
});

test("slideKnees swings a pressing knee round its hip-ankle line until the legs only touch", () => {
  // The frame of the RF Closed Change where the legs, bent straight
  // forward, press in furthest (by more than LEG_CONTACT): after
  // sliding they at most touch.
  const closedChange = loadFigures().find((f) => f.name === "RF Closed Change");
  assert.ok(closedChange);
  let before = solved(poseAtBeat(closedChange, 0));
  for (let beat = 0; beat <= 3; beat += 1 / 128) {
    const couple = solved(poseAtBeat(closedChange, beat));
    if (partnerLegGap(couple) < partnerLegGap(before)) before = couple;
  }
  assert.ok(partnerLegGap(before) < -LEG_CONTACT);
  const after = slideKnees(before);
  assert.ok(partnerLegGap(after) >= -LEG_CONTACT - 1e-9);
  for (const partner of ["lead", "follow"] as const)
    for (const side of SIDES) {
      const was = before[partner].joints;
      const now = after[partner].joints;
      const k = side === "left" ? "leftLowerLeg" : "rightLowerLeg";
      const hip = side === "left" ? "leftUpperLeg" : "rightUpperLeg";
      const ankle = side === "left" ? "leftFoot" : "rightFoot";
      // Hips and feet stay; the knee keeps both bone lengths.
      assert.deepEqual(now[hip], was[hip]);
      assert.deepEqual(now[ankle], was[ankle]);
      assert.ok(
        Math.abs(distance(now[hip], now[k]) - distance(was[hip], was[k])) <
          1e-9,
      );
      assert.ok(
        Math.abs(distance(now[k], now[ankle]) - distance(was[k], was[ankle])) <
          1e-9,
      );
      const swing = after[partner].kneeSwing[side];
      assert.ok(Math.abs(swing) <= MAX_KNEE_SWING);
      assert.equal(swing === 0, now[k] === was[k]);
    }
  assert.ok(
    SIDES.some((side) => after.lead.kneeSwing[side] !== 0) ||
      SIDES.some((side) => after.follow.kneeSwing[side] !== 0),
  );
});

test("every figure: partners' legs at most touch, with knees swinging smoothly", () => {
  // 1/128 beat is under 10 ms at the fastest default tempo; a swing
  // changing more than a few degrees in that time would show as a jump.
  const step = 1 / 128;
  for (const figure of loadFigures()) {
    const beats = Math.max(...figure.steps.map((s) => s.beat - 1 + s.duration));
    for (const options of [{}, { footEasing: footEase }]) {
      let previous: number[] | null = null;
      for (let beat = 0; beat <= beats + 1e-9; beat += step) {
        const couple = solveSkeleton(poseAtBeat(figure, beat, options));
        const gap = partnerLegGap(couple);
        assert.ok(
          gap >= -LEG_CONTACT - 1e-6,
          `${figure.name}: legs press in ${gap} m at beat ${beat}`,
        );
        const swings = [
          couple.lead.kneeSwing.left,
          couple.lead.kneeSwing.right,
          couple.follow.kneeSwing.left,
          couple.follow.kneeSwing.right,
        ];
        if (previous !== null)
          swings.forEach((swing, i) =>
            assert.ok(
              Math.abs(swing - previous![i]) <= 5,
              `${figure.name}: a knee swings ${swing - previous![i]} degrees in one frame at beat ${beat}`,
            ),
          );
        previous = swings;
      }
    }
  }
});
