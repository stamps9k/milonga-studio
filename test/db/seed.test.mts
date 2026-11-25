import {
  stepOverlapError,
  isFreeFootFollow,
} from "../../src/libs/dance/overlap.mts";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type BetterSqlite3 from "better-sqlite3";

import { openTestDatabase } from "../support/database.mts";
import { loadFigures } from "../../db/figures/index.mts";
import {
  STANCE_NAMES,
  holdForStyle,
  stancePose,
} from "../../src/libs/dance/authoring.mts";
import { applyTransform, fitTransform } from "../../src/libs/dance/floor.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";
import { figureDurationBeats, poseAtBeat } from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { Sequence } from "../../src/libs/dance/sequence.mts";

// Integrity checks for the sample data in db/seed.mts, run against a
// freshly seeded temporary database and read back through the same
// assembly code the API uses.
//
// Seeded figures are written with defineFigure (db/figures/), which
// calculates each stored endPose by folding the steps and checks the
// figure's expectEnd. The fold check below still guards the round trip
// through the database: if the stored endPose and the stored steps ever
// disagree, the 2D view (which draws the folded steps) and sequence
// chaining (which fits the next figure onto the stored endPose) would
// disagree about where the couple is.

/** The figure files the seed should have loaded: whatever is in
 *  db/figures/, so adding a figure file never needs a test change. */
const FIGURE_FILES = loadFigures();

/** Exact-match tolerance for values the code derives itself. */
const POSITION_EPSILON = 1e-6;

let db: BetterSqlite3.Database;
let cleanup: () => void;
let figures: Figure[];
let sequences: Sequence[];
let assembleDance: (
  id: number,
) => import("../../src/libs/dance/dance.mts").Dance;

before(async () => {
  ({ db, cleanup } = await openTestDatabase({ seed: true }));
  const assemble = await import("../../api/assemble.mts");
  assembleDance = assemble.assembleDance;

  const figureIds = db.prepare("SELECT id FROM figures ORDER BY id").all() as {
    id: number;
  }[];
  figures = figureIds.map(({ id }) => assemble.assembleFigure(id));

  const sequenceIds = db
    .prepare("SELECT id FROM sequences ORDER BY id")
    .all() as { id: number }[];
  sequences = sequenceIds.map(({ id }) => assemble.assembleSequence(id));
});

after(() => cleanup());

function maxFootDistance(a: Pose, b: Pose): number {
  let max = 0;
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      const p = a[partner][foot].position;
      const q = b[partner][foot].position;
      max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y));
    }
  }
  return max;
}

function headingDifference(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

test("seed: stores every figure file, plus the 11 sample sequences and dances", () => {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count("figures"), FIGURE_FILES.length);
  assert.equal(count("sequences"), 11);
  assert.equal(count("dances"), 11);
  assert.deepEqual(
    figures.map((figure) => figure.name).sort(),
    FIGURE_FILES.map((figure) => figure.name).sort(),
  );
});

test("seed: every dance assembles fully, with a positive tempo and valid timestamps", () => {
  const danceIds = db.prepare("SELECT id FROM dances ORDER BY id").all() as {
    id: number;
  }[];
  for (const { id } of danceIds) {
    const dance = assembleDance(id);
    assert.ok(dance.tempo > 0, `${dance.name}: tempo ${dance.tempo}`);
    assert.ok(Number.isInteger(dance.schemaVersion) && dance.schemaVersion > 0);
    assert.ok(!Number.isNaN(Date.parse(dance.createdAt)));
    assert.ok(!Number.isNaN(Date.parse(dance.updatedAt)));
    assert.ok(dance.sequence.entries.length > 0, `${dance.name} is empty`);
  }
});

test("seed: every figure's start and end poses put a total weight of 1 on each partner", () => {
  for (const figure of figures) {
    for (const [label, pose] of [
      ["startPose", figure.startPose],
      ["endPose", figure.endPose],
    ] as const) {
      for (const partner of ["lead", "follow"] as const) {
        const total = pose[partner].left.weight + pose[partner].right.weight;
        assert.ok(
          Math.abs(total - 1) < 1e-9,
          `${figure.name} ${label}.${partner} weights sum to ${total}`,
        );
      }
    }
  }
});

test("seed: every figure starts exactly in a named stance's own frame", () => {
  // Figures are authored in the frame of the stance they start in (closed
  // hold facing 0, crossed promenade facing 315; see stancePose and the
  // dance AGENTS.md); placement belongs to the sequence's transform. The
  // feet and facings must match one stance, in the figure's hold;
  // weights may differ.
  for (const figure of figures) {
    const stances = STANCE_NAMES.map((name) => ({
      name,
      pose: stancePose(
        name,
        { lead: "left", follow: "right" },
        holdForStyle(figure.style),
      ),
    }));
    const match = stances.find(
      ({ pose }) =>
        maxFootDistance(figure.startPose, pose) < POSITION_EPSILON &&
        pose.lead.orientation === figure.startPose.lead.orientation &&
        pose.follow.orientation === figure.startPose.follow.orientation,
    );
    assert.ok(
      match,
      `${figure.name}: starts in no named stance (lead facing ${figure.startPose.lead.orientation})`,
    );
  }
});

// One test per figure, generated after the database is ready, so each
// figure's result is reported individually.
test("seed: folding each figure's steps reproduces its stored endPose", async (t) => {
  for (const figure of figures) {
    await t.test(figure.name, () => {
      const folded = poseAtBeat(figure, figureDurationBeats(figure));
      const distance = maxFootDistance(folded, figure.endPose);
      assert.ok(
        distance < POSITION_EPSILON,
        `folded feet are up to ${distance.toFixed(3)} away from the stored endPose`,
      );
      for (const partner of ["lead", "follow"] as const) {
        assert.ok(
          headingDifference(
            folded[partner].orientation,
            figure.endPose[partner].orientation,
          ) < 1e-6,
          `${partner} orientation differs`,
        );
        assert.ok(
          Math.abs(
            folded[partner].left.weight - figure.endPose[partner].left.weight,
          ) < 1e-9,
          `${partner} weights differ`,
        );
      }
    });
  }
});

test("seed: the stored figures last as long as their files say", async (t) => {
  // defineFigure already checks each file's expectBeats against its
  // steps; this checks the length survives storing and reassembling.
  const expected = new Map(
    FIGURE_FILES.map((figure) => [
      figure.name,
      figureDurationBeats({
        ...figure,
        id: "file",
        steps: figure.steps.map((step, index) => ({
          ...step,
          id: String(index),
        })),
      }),
    ]),
  );
  for (const figure of figures) {
    await t.test(figure.name, () => {
      assert.equal(figureDurationBeats(figure), expected.get(figure.name));
    });
  }
});

test("seed: only a free-foot follow overlaps the other foot's supporting action", async (t) => {
  // Each dancer has one body/weight action. A simultaneous free-foot path
  // can follow it; same-foot or two weight-taking actions still conflict.
  for (const figure of figures) {
    await t.test(figure.name, () => {
      assert.equal(stepOverlapError(figure.steps), undefined, figure.name);
    });
  }
});

test("seed: every step moves a foot the partner isn't standing on", async (t) => {
  // Provisional check, not a confirmed dance rule: a travelling step
  // has to be taken with the free foot, since the foot carrying all of
  // a partner's weight can't leave the floor. Zero-distance steps
  // (weight changes and pivots) are exempt, because they don't lift the
  // foot. This is the rule db/seed.mts uses to choose which foot each
  // figure starts with.
  for (const figure of figures) {
    await t.test(figure.name, () => {
      for (const step of figure.steps) {
        if (isFreeFootFollow(step, figure.steps)) continue;
        const travels =
          step.movement.type === "arc" || step.movement.distance > 0;
        if (!travels) continue;
        const before = poseAtBeat(figure, step.beat - 1)[step.partner];
        assert.ok(
          before[step.foot].weight < 1 - 1e-9,
          `${step.partner}'s ${step.foot} foot steps at beat ${step.beat} while carrying all the weight`,
        );
      }
    });
  }
});

test("seed: sequence entries' cached resolved poses equal their figure's poses placed by the entry's transform", () => {
  // resolvedStartPose/resolvedEndPose are stored in the database but are
  // only caches of applyTransform(transform, figure pose) (see
  // sequence.mts). This catches the two drifting apart.
  for (const sequence of sequences) {
    for (const [index, entry] of sequence.entries.entries()) {
      const label = `${sequence.name} entry ${index} (${entry.figure.name})`;
      assert.ok(
        maxFootDistance(
          entry.resolvedStartPose,
          applyTransform(entry.transform, entry.figure.startPose),
        ) < POSITION_EPSILON,
        `${label}: resolvedStartPose is stale`,
      );
      assert.ok(
        maxFootDistance(
          entry.resolvedEndPose,
          applyTransform(entry.transform, entry.figure.endPose),
        ) < POSITION_EPSILON,
        `${label}: resolvedEndPose is stale`,
      );
    }
  }
});

test("seed: each sequence starts at its own start transform", () => {
  for (const sequence of sequences) {
    assert.deepEqual(
      sequence.entries[0].transform,
      sequence.startTransform,
      sequence.name,
    );
  }
});

test("seed: consecutive sequence entries are placed so the couple continues from where the previous figure ended", () => {
  for (const sequence of sequences) {
    for (let i = 1; i < sequence.entries.length; i++) {
      const previous = sequence.entries[i - 1];
      const entry = sequence.entries[i];
      const expected = fitTransform(
        entry.figure.startPose,
        previous.resolvedEndPose,
      );
      const placedStart = applyTransform(expected, entry.figure.startPose);
      assert.ok(
        maxFootDistance(entry.resolvedStartPose, placedStart) <
          POSITION_EPSILON,
        `${sequence.name}: entry ${i} (${entry.figure.name}) doesn't continue from entry ${i - 1}`,
      );
    }
  }
});

test("seed: every sample sequence joins cleanly at every figure boundary", () => {
  // Include both Argentine tango combinations. Explicit collections and a
  // counted weight change must survive SQLite/API assembly with no pose jump.
  for (const sequence of sequences) {
    for (let i = 1; i < sequence.entries.length; i++) {
      const previous = sequence.entries[i - 1],
        current = sequence.entries[i];
      const join = assessJoin(previous.resolvedEndPose, current.figure);
      assert.deepEqual(
        join.issues,
        [],
        `${sequence.name}: ${previous.figure.name} -> ${current.figure.name}`,
      );
      assert.ok(
        join.maxFootGap < POSITION_EPSILON,
        `${sequence.name}: tolerated foot gap is still a jump`,
      );
      for (const partner of ["lead", "follow"] as const)
        for (const foot of ["left", "right"] as const)
          assert.equal(
            previous.resolvedEndPose[partner][foot].weight,
            current.resolvedStartPose[partner][foot].weight,
            `${sequence.name}: boundary weight switch`,
          );
    }
  }
});

test("seed: intermediate body placement survives the figure/database/API round trip", () => {
  const source = FIGURE_FILES.find((f) => f.name === "Closed Promenade")!;
  const stored = figures.find((f) => f.name === source.name)!;
  assert.ok(source.steps.some((s) => s.bodyOffset));
  assert.deepEqual(
    stored.steps.map((s) => s.bodyOffset),
    source.steps.map((s) => s.bodyOffset),
  );
  for (const beat of [0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    const a = poseAtBeat(source as Figure, beat),
      b = poseAtBeat(stored, beat);
    for (const partner of ["lead", "follow"] as const)
      assert.deepEqual(b[partner].bodyOffset, a[partner].bodyOffset);
  }
});
