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
// Original resolved endpoint, including the historic rounded follow offsets.
// Pin all four feet, not just an equivalent closed stance or rounded expectEnd.
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
      position: { x: -0.2280580709048679, y: 0.11686200525370732 },
      weight: 1,
    },
    right: {
      position: { x: -0.228058070904868, y: 0.31686200525370734 },
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

test("Open Natural Turn: original body turns, foot order, counts and flat rise remain", () => {
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
      partner === "lead" ? [0, 60, 90] : [255, 240, 270],
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
    "The first cross is intentional technique, not a figure exemption",
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
    // Original rounded follow geometry leaves this sub-millimetre fit error.
    close(join.maxFootGap, 0.0004759918513644262);
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

test("Open Natural Turn: follow footprints clear throughout and both clear after the intentional cross", () => {
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 3; beat += 1 / 256) {
      const p = poseAtBeat(natural, beat, options);
      for (const partner of ["lead", "follow"] as const) {
        // The existing first-step cross intentionally passes one foot over the
        // other. Authoring validates its crossing order; do not call that flat
        // projected overlap a new blanket exemption for the rest of the figure.
        if (partner === "lead" && beat < 1) continue;
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

test("Open Natural Turn: the final close clears full thigh/shin capsules", () => {
  // The deliberate cross/uncross still overlaps the mannequin leg proxies
  // (~12 cm), as before. This extra check covers the final close; full-figure
  // reach/balance and non-crossing footprints are checked independently above.
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 2; beat <= 3; beat += 1 / 256) {
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
