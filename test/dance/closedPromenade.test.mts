import { segmentDistance } from "../support/legClearance.mts";
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
import { applyTransform } from "../../src/libs/dance/floor.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";
import { TANGO_LEG_CONTACT } from "../../src/libs/body/legContact.mts";

/** Solves the couple in ballroom tango's hold, as the 3D view does. */
function solveTango(pose: Pose) {
  return solveSkeleton(pose, DEFAULT_PROPORTIONS, "tango");
}

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
    assert.equal(actual[partner].bodyOffset, undefined);
  }
}

test("Closed Promenade: S Q Q S from tango promenade into closed hold, the lead keeping his facing", () => {
  assertPoseClose(
    promenade.startPose,
    stancePose("tango promenade", { lead: "right", follow: "left" }, "tango"),
  );
  // The book: the man has no turn, the lady turns a quarter to the left
  // on her side step (step 3), and they close into closed position.
  const closed = stancePose(
    "closed",
    { lead: "right", follow: "left" },
    "tango",
  );
  const turned = applyTransform(
    { position: { x: 0, y: 0 }, rotation: -45 },
    closed,
  );
  const end = promenade.endPose;
  const shift = {
    x: end.lead.left.position.x - turned.lead.left.position.x,
    y: end.lead.left.position.y - turned.lead.left.position.y,
  };
  assertPoseClose(
    end,
    applyTransform({ position: shift, rotation: 0 }, turned),
  );
  assertPoseClose(poseAtBeat(promenade, 3), end);
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
  }
  for (const beat of [1, 1.5, 2, 3])
    assert.equal(poseAtBeat(promenade, beat).lead.orientation, 315);
  for (const beat of [1, 1.5])
    assert.equal(poseAtBeat(promenade, beat).follow.orientation, 225);
  for (const beat of [2, 3])
    assert.equal(poseAtBeat(promenade, beat).follow.orientation, 135);
});

test("Progressive Link: the lead doesn't turn and the follow turns a quarter right on the second quick", () => {
  const link = load("walks-and-progressive-link");
  for (const beat of [0, 1, 2, 2.5, 3])
    assert.equal(poseAtBeat(link, beat).lead.orientation, 0);
  for (const beat of [0, 1, 2, 2.5])
    assert.equal(poseAtBeat(link, beat).follow.orientation, 180);
  assert.equal(poseAtBeat(link, 3).follow.orientation, 270);
  // The first quick travels; on the second his right foot lands close
  // beside his left, slightly behind it, so his body barely moves on.
  const q1 = poseAtBeat(link, 2.5).lead,
    q2 = poseAtBeat(link, 3).lead;
  assert.ok(
    q1.left.position.y - poseAtBeat(link, 2).lead.right.position.y > 0.45,
  );
  const across = q2.right.position.x - q2.left.position.x,
    behind = q2.left.position.y - q2.right.position.y;
  assert.ok(Math.abs(across - 0.2) < 1e-9 && Math.abs(behind - 0.08) < 1e-9);
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

test("Closed Promenade: default bodies reach every foot with at most 16 cm of hip lowering", () => {
  // Keep the shared comfort limit, without changing body sizes or the solver.
  for (const options of [{}, { footEasing: footEase }]) {
    for (let beat = 0; beat <= 3; beat += 1 / 128) {
      const skeleton = solveTango(poseAtBeat(promenade, beat, options));
      for (const partner of ["lead", "follow"] as const) {
        assert.deepEqual(skeleton[partner].legShortfall, { left: 0, right: 0 });
        assert.ok(
          skeleton[partner].hipDrop <= 0.16,
          `${partner}'s hips drop ${skeleton[partner].hipDrop} m at beat ${beat}`,
        );
      }
    }
  }
});

// Match the visible mannequin thigh/shin radii. Test every pair of distinct
// legs, including each dancer's own legs: footprint centres missed this.
// A dancer's own legs must stay clear; the partners' may touch, pressing
// in up to TANGO_LEG_CONTACT as the body solver allows in tango.
test("Closed Promenade: thighs and shins clear while hips nearly touch", () => {
  for (const options of [{}, { footEasing: footEase }]) {
    let nearestHips = Infinity;
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const bodies = solveTango(poseAtBeat(promenade, beat, options));
      const bones = [];
      for (const partner of ["lead", "follow"] as const)
        for (const side of ["left", "right"] as const) {
          const j = bodies[partner].joints;
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
          const gap = segmentDistance(a.a, a.b, b.a, b.b) - a.r - b.r;
          const allowed =
            a.partner === b.partner ? 0 : TANGO_LEG_CONTACT + 1e-6;
          assert.ok(
            gap >= -allowed,
            `Leg overlap ${gap} m at beat ${beat}: ${a.partner} ${a.side} / ${b.partner} ${b.side}`,
          );
        }
      if (beat >= 1 && beat <= 1.5) {
        const a = bodies.lead.joints,
          b = bodies.follow.joints;
        const gap =
          segmentDistance(
            a.leftUpperLeg,
            a.rightUpperLeg,
            b.leftUpperLeg,
            b.rightUpperLeg,
          ) - 0.16;
        assert.ok(gap >= 0, "Pelvis capsules overlap");
        nearestHips = Math.min(nearestHips, gap);
      }
    }
    assert.ok(
      nearestHips < 0.02,
      `Hips never came within 2 cm: ${nearestHips}`,
    );
  }
  const first = poseAtBeat(promenade, 1);
  assert.ok(Math.abs(first.lead.left.position.y + 0.06) < 1e-8);
  assert.ok(Math.abs(first.follow.right.position.y - 0.44) < 1e-8);
});

test("Closed Promenade: the outer feet pass under the hips without a wide side swing", () => {
  for (const options of [{}, { footEasing: footEase }]) {
    const nearest = { lead: Infinity, follow: Infinity };
    const start = { lead: -Infinity, follow: -Infinity };
    for (let beat = 1.5; beat <= 2; beat += 1 / 256) {
      const pose = poseAtBeat(promenade, beat, options);
      const skeleton = solveTango(pose);
      for (const partner of ["lead", "follow"] as const) {
        const foot =
          pose[partner][partner === "lead" ? "left" : "right"].position;
        const hip = skeleton[partner].joints.hips;
        // Floor y is across promenade travel. Each outer foot starts
        // about 13 cm out from its pelvis. His left goes to the side and
        // never more than 1 mm further out. Her right uncrosses behind her
        // standing left as she turns to face him, so it sweeps out round
        // her heel, but compactly: within 21 cm of her pelvis.
        const outward = partner === "lead" ? hip.y - foot.y : foot.y - hip.y;
        if (beat === 1.5) start[partner] = outward;
        assert.ok(
          outward <= (partner === "lead" ? start.lead + 0.001 : 0.21),
          `${partner} swings ${outward} m outward at ${beat}`,
        );
        if (beat > 1.6 && beat < 1.9)
          nearest[partner] = Math.min(
            nearest[partner],
            Math.hypot(hip.x - foot.x, hip.y - foot.y),
          );
      }
    }
    for (const partner of ["lead", "follow"] as const)
      assert.ok(
        nearest[partner] < 0.12,
        `${partner}'s outer foot never passes within 12 cm of the pelvis`,
      );
  }
});
