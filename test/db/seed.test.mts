import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type BetterSqlite3 from "better-sqlite3";

import { openTestDatabase } from "../support/database.mts";
import { applyTransform, fitTransform } from "../../src/libs/dance/floor.mts";
import { figureDurationBeats, poseAtBeat } from "../../src/libs/dance/fold.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { Sequence } from "../../src/libs/dance/sequence.mts";

// Integrity checks for the sample data in db/seed.mts, run against a
// freshly seeded temporary database and read back through the same
// assembly code the API uses.
//
// The seed is hand-typed: each figure stores both its steps and its
// start/end poses, and nothing but these tests forces the two to agree.
// When they don't, the 2D view (which draws the folded steps) and
// sequence chaining (which fits the next figure onto the stored
// endPose) disagree about where the couple is.

/** Figure lengths in beats, as documented in db/seed.mts's header. */
const DOCUMENTED_DURATIONS: Record<string, number> = {
  "Walking Step": 1,
  "Side Step": 1,
  Cruzada: 2,
  Ocho: 4,
  "Forward Waltz": 3,
  "Balance Step": 3,
  "Cha-Cha Basic": 4,
  "Side Basic": 4,
};

/** Exact-match tolerance for values the code derives itself. */
const POSITION_EPSILON = 1e-6;
/** Tolerance when comparing a fold against hand-typed seed poses. The
 *  seed types derived positions (such as the Ocho's diagonal steps) to
 *  3 decimal places, i.e. to the nearest millimetre at the metre scale
 *  the seed uses, so a 1 mm tolerance accepts rounding but still catches
 *  real mismatches, which are tens of centimetres. */
const HAND_TYPED_EPSILON = 1e-3;

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

test("seed: creates the documented 8 figures, 5 sequences and 5 dances", () => {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count("figures"), 8);
  assert.equal(count("sequences"), 5);
  assert.equal(count("dances"), 5);
  assert.deepEqual(
    figures.map((figure) => figure.name).sort(),
    Object.keys(DOCUMENTED_DURATIONS).sort(),
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

test("seed: every figure starts in its local frame with the lead facing line of dance", () => {
  // Figures are authored at the origin facing 0 degrees (see
  // sequence.mts); placement belongs to the sequence's transform.
  for (const figure of figures) {
    assert.equal(
      figure.startPose.lead.orientation,
      0,
      `${figure.name}: lead starts facing ${figure.startPose.lead.orientation}`,
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
        distance < HAND_TYPED_EPSILON,
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

test("seed: each figure's length matches the beat count documented in db/seed.mts", async (t) => {
  for (const figure of figures) {
    await t.test(figure.name, () => {
      assert.equal(
        figureDurationBeats(figure),
        DOCUMENTED_DURATIONS[figure.name],
      );
    });
  }
});

test("seed: no partner has two steps in progress at the same time", async (t) => {
  // Provisional check, not a confirmed dance rule: a partner moving two
  // feet at once only makes sense for actions like jumps, which the
  // model doesn't represent yet. If the owner confirms such figures
  // should be allowed, narrow this check rather than deleting it.
  for (const figure of figures) {
    await t.test(figure.name, () => {
      for (const partner of ["lead", "follow"] as const) {
        const intervals = figure.steps
          .filter((step) => step.partner === partner)
          .map((step) => [step.beat - 1, step.beat - 1 + step.duration])
          .sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < intervals.length; i++) {
          assert.ok(
            intervals[i][0] >= intervals[i - 1][1] - 1e-9,
            `${partner} step at beat ${intervals[i][0] + 1} starts before the previous one ends at ${intervals[i - 1][1] + 1}`,
          );
        }
      }
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
