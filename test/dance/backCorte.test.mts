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
import { DEFAULT_PROPORTIONS } from "../../src/libs/body/proportions.mts";

import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";
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
  const a = defineFigure(definition(file));
  return {
    ...a,
    id: file,
    steps: a.steps.map((s, i) => ({ ...s, id: String(i) })),
  };
}
const corte = load("back-corte");
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
function endPose(): Pose {
  return {
    lead: {
      left: { position: { x: 0.2, y: -1.24 }, weight: 0 },
      // Closed in tango hold: his right foot 0.08 behind his left.
      right: { position: { x: 0.28, y: -1.04 }, weight: 1 },
      orientation: 270,
      rise: 0,
    },
    follow: {
      left: { position: { x: -0.07, y: -0.94 }, weight: 1 },
      right: { position: { x: 0.01, y: -1.14 }, weight: 0 },
      orientation: 90,
      rise: 0,
    },
  };
}

test("Back Corté: original entry/exit poses, phrasing and foot order are preserved", () => {
  connection(
    corte.startPose,
    stancePose("closed", { lead: "right", follow: "left" }, "tango"),
  );
  connection(corte.endPose, endPose());
  connection(poseAtBeat(corte, 3), endPose());
  assert.equal(figureDurationBeats(corte), 3);
  for (const partner of ["lead", "follow"] as const) {
    const steps = corte.steps.filter((s) => s.partner === partner);
    assert.deepEqual(
      steps.map((s) => s.duration),
      [1, 0.5, 0.5, 1],
    );
    assert.deepEqual(
      steps.map((s) => s.foot),
      partner === "lead"
        ? ["left", "right", "left", "right"]
        : ["right", "left", "right", "left"],
    );
    assert.deepEqual(
      steps.map((s) => s.orientation),
      partner === "lead" ? [0, 0, 315, 270] : [180, 180, 135, 90],
    );
    // Straight back; the second step is shorter than the first because
    // it starts from the drawn-back right foot.
    steps.slice(0, 2).forEach((s, i) => {
      assert.equal(s.movement.type, "straight");
      if (s.movement.type === "straight") {
        close(s.movement.direction, 180);
        close(s.movement.distance, [0.5, 0.92][i]);
      }
    });
  }
  // Every landing is pinned, including the third step before the close.
  // The lead's foot points earlier; body facing and travel do not.
  const third = poseAtBeat(corte, 2);
  close(third.lead.left.position.x, 0.2);
  close(third.lead.left.position.y, -1.24);
  close(third.follow.right.position.x, 0.01);
  close(third.follow.right.position.y, -1.14);
  // Her third step curves round the front, away from his standing right
  // foot, so her right leg passes beside his rather than through it, and
  // lands pointing where she will face after the close, like his left.
  const follow = corte.steps.filter((s) => s.partner === "follow")[2];
  assert.equal(follow.movement.type, "arc");
  if (follow.movement.type === "arc") assert.equal(follow.movement.setOff, 45);
  const lead = corte.steps.filter((s) => s.partner === "lead")[2];
  assert.equal(lead.footDirection, 270);
  assert.equal(lead.movement.type, "arc");
  if (lead.movement.type === "arc")
    assert.ok(
      lead.movement.arcLength < 1,
      "Route should stay compact rather than looping round the standing foot",
    );
});

test("Back Corté: joins from Closed Promenade and back into closed-start figures", () => {
  const previous = placeEntry(load("closed-promenade"), undefined);
  const middle = placeEntry(corte, previous);
  for (const [end, next] of [
    [previous.resolvedEndPose, corte],
    [middle.resolvedEndPose, load("walks-and-progressive-link")],
  ] as const) {
    const join = assessJoin(end, next);
    assert.equal(join.fits, true, JSON.stringify(join.issues));
    assert.ok(join.maxFootGap < 1e-8);
  }
});

test("Back Corté: no authoring exemptions and footprints clear throughout linear/eased playback", () => {
  assert.deepEqual(definition("back-corte").skipChecks ?? [], []);
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const p = poseAtBeat(corte, beat, options);
      for (const partner of ["lead", "follow"] as const) {
        const a = p[partner];
        assert.ok(
          footprintGap(
            a.left.position,
            footHeading(a, "left"),
            a.right.position,
            footHeading(a, "right"),
          ) >= 0.005,
          `${partner} footprint clearance at ${beat}`,
        );
      }
    }
});

test("Back Corté: reach, hip lowering and lateral balance hold throughout", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const p = poseAtBeat(corte, beat, options),
        s = solveTango(p);
      for (const partner of ["lead", "follow"] as const) {
        assert.deepEqual(s[partner].legShortfall, { left: 0, right: 0 });
        assert.ok(s[partner].hipDrop <= 0.13);
        assert.equal(
          assessLateralBalance(p[partner], s[partner]).plausible,
          true,
        );
      }
    }
});

test("Back Corté: the repaired turn and close clear full thigh/shin capsules", () => {
  // Scope this extra proxy check to the turn and close. A dancer's own legs
  // keep 5 mm clear; the partners' may touch, pressing in up to
  // TANGO_LEG_CONTACT as the body solver allows in tango (the whole figure
  // is covered by test/body/legContact.test.mts).
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 1.5; beat <= 3; beat += 1 / 256) {
      const s = solveTango(poseAtBeat(corte, beat, options));
      const bones = [];
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
          const needed =
            a.partner === b.partner ? 0.005 : -TANGO_LEG_CONTACT - 1e-6;
          assert.ok(
            segmentDistance(a.a, a.b, b.a, b.b) - a.r - b.r >= needed,
            `Leg clearance at ${beat}: ${a.partner} ${a.side} / ${b.partner} ${b.side}`,
          );
        }
    }
});
