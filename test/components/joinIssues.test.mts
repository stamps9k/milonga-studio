import { test } from "node:test";
import assert from "node:assert/strict";

import { describeJoin } from "../../src/components/joinIssues.mts";
import type { JoinAssessment } from "../../src/libs/dance/join.mts";

function assessment(
  issues: JoinAssessment["issues"],
  maxFootGap = 0,
): JoinAssessment {
  return {
    transform: { position: { x: 0, y: 0 }, rotation: 0 },
    maxFootGap,
    facingChange: { lead: 0, follow: 0 },
    issues,
    fits: issues.length === 0,
  };
}

test("describeJoin: a clean join has nothing to say", () => {
  assert.deepEqual(describeJoin(assessment([])), []);
});

test("describeJoin: foot gaps become one line with the largest jump, in metres", () => {
  const lines = describeJoin(
    assessment(
      [
        { kind: "foot-gap", partner: "lead", foot: "left", distance: 0.3 },
        { kind: "foot-gap", partner: "follow", foot: "right", distance: 0.296 },
      ],
      0.3,
    ),
  );
  assert.deepEqual(lines, ["Feet would jump up to 0.30 m"]);
});

test("describeJoin: facing snaps name the partner, size and direction", () => {
  assert.deepEqual(
    describeJoin(
      assessment([
        { kind: "facing-change", partner: "follow", degrees: 135 },
        { kind: "facing-change", partner: "lead", degrees: -20.4 },
      ]),
    ),
    ["Follow would snap 135° clockwise", "Lead would snap 20° anticlockwise"],
  );
});

test("describeJoin: orders gaps, then facing, then weighted feet, regardless of issue order", () => {
  const lines = describeJoin(
    assessment(
      [
        { kind: "weighted-foot", partner: "lead", foot: "left" },
        { kind: "facing-change", partner: "follow", degrees: 45 },
        { kind: "foot-gap", partner: "lead", foot: "left", distance: 0.15 },
      ],
      0.15,
    ),
  );
  assert.deepEqual(lines, [
    "Feet would jump up to 0.15 m",
    "Follow would snap 45° clockwise",
    "Lead would start on the left foot, which is carrying the weight",
  ]);
});
