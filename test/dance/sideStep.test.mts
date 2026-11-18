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
import { assessJoin } from "../../src/libs/dance/join.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";

function load(file: string) {
  const definition = parseFigureDefinition(
    JSON.parse(
      readFileSync(
        new URL(`../../db/figures/${file}.json`, import.meta.url),
        "utf8",
      ),
    ),
    file,
  );
  const authored = defineFigure(definition);
  return {
    definition,
    figure: {
      ...authored,
      id: file,
      steps: authored.steps.map((s, i) => ({ ...s, id: String(i) })),
    },
  };
}
const { definition, figure: sideStep } = load("side-step");
function close(a: number, b: number) {
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
}

test("Side Step: right/left feet move 35 cm without crossing, in the original single Q", () => {
  assert.deepEqual(definition.skipChecks ?? [], []);
  assert.deepEqual(
    sideStep.startPose,
    stancePose("closed", { lead: "left", follow: "right" }),
  );
  assert.equal(figureDurationBeats(sideStep), 1);
  assert.deepEqual(
    sideStep.steps.map((s) => [s.partner, s.foot, s.beat, s.duration]),
    [
      ["lead", "right", 1, 1],
      ["follow", "left", 1, 1],
    ],
  );
  const end = poseAtBeat(sideStep, 1);
  for (const partner of ["lead", "follow"] as const) {
    const moving = partner === "lead" ? "right" : "left",
      support = partner === "lead" ? "left" : "right";
    close(
      end[partner][moving].position.x -
        sideStep.startPose[partner][moving].position.x,
      0.35,
    );
    close(
      end[partner][moving].position.y,
      sideStep.startPose[partner][moving].position.y,
    );
    assert.deepEqual(
      end[partner][support].position,
      sideStep.startPose[partner][support].position,
    );
    assert.equal(end[partner][moving].weight, 1);
    assert.equal(end[partner][support].weight, 0);
  }
  close(end.lead.right.position.x, 0.45);
  close(end.follow.left.position.x, 0.55);
  assert.deepEqual(end, sideStep.endPose);
});

test("Side Step: adjacent tango steps have compatible support order, with existing positional gaps explicit", () => {
  const incoming = assessJoin(load("walking-step").figure.endPose, sideStep);
  const outgoing = assessJoin(sideStep.endPose, load("cruzada").figure);
  for (const join of [incoming, outgoing]) {
    assert.ok(!join.issues.some((issue) => issue.kind === "weighted-foot"));
    assert.equal(
      join.fits,
      false,
      "Position gaps remain; do not claim a clean chain",
    );
  }
  close(incoming.maxFootGap, 0.3);
  close(outgoing.maxFootGap, 0.175);
});

test("Side Step: full footprints, legs, hold and balance clear throughout", () => {
  // Include every footprint and leg pair throughout both support transfers.
  for (const options of [{}, { footEasing: footEase }])
    for (let beat = 0; beat <= 1; beat += 1 / 256) {
      const p = poseAtBeat(sideStep, beat, options),
        skeleton = solveSkeleton(p),
        feet = [],
        bones = [];
      const l = bodyPosition(p.lead),
        f = bodyPosition(p.follow);
      close(f.x - l.x, 0.1);
      close(f.y - l.y, 0.4);
      for (const partner of ["lead", "follow"] as const) {
        close(p[partner].orientation, partner === "lead" ? 0 : 180);
        close(p[partner].rise, 0);
        assert.equal(p[partner].bodyOffset, undefined);
        const s = skeleton[partner];
        assert.deepEqual(s.legShortfall, { left: 0, right: 0 });
        assert.ok(s.hipDrop <= 0.16, `Hip lowering at ${beat}`);
        assert.equal(
          assessLateralBalance(p[partner], s).plausible,
          true,
          `Balance at ${beat}`,
        );
        for (const side of ["left", "right"] as const) {
          feet.push({
            p: p[partner][side].position,
            heading: footHeading(p[partner], side),
          });
          const j = s.joints;
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
      }
      for (let i = 0; i < feet.length; i++)
        for (let k = i + 1; k < feet.length; k++) {
          const a = feet[i],
            b = feet[k];
          assert.ok(
            footprintGap(a.p, a.heading, b.p, b.heading) >= 0.005,
            `Footprints ${i}/${k} at ${beat}`,
          );
        }
      for (let i = 0; i < bones.length; i++)
        for (let k = i + 1; k < bones.length; k++) {
          const a = bones[i],
            b = bones[k];
          if (a.partner === b.partner && a.side === b.side) continue;
          assert.ok(
            segmentDistance(a.a, a.b, b.a, b.b) - a.r - b.r >= 0.005,
            `Legs ${a.partner} ${a.side}/${b.partner} ${b.side} at ${beat}`,
          );
        }
    }
});
