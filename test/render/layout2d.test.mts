import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { sequenceFootprints } from "../../src/libs/dance/footprints.mts";
import type {
  Footprint,
  FootprintState,
} from "../../src/libs/dance/footprints.mts";
import type { SequenceEntry } from "../../src/libs/dance/sequence.mts";
import {
  countOpacity,
  layoutSequence,
  pathFrom,
  toScreen,
  withCounts,
} from "../../src/libs/render/layout2d.mts";

const figures = loadFigures();

function chain(names: string[]): SequenceEntry[] {
  const entries: SequenceEntry[] = [];
  for (const name of names) {
    const figure = figures.find((candidate) => candidate.name === name);
    assert.ok(figure, `no figure called ${name}`);
    // Seed figures have no ids until they're stored; give them some.
    const stored = {
      ...figure,
      id: name,
      steps: figure.steps.map((step, index) => ({ ...step, id: `${index}` })),
    };
    entries.push(placeEntry(stored, entries[entries.length - 1]));
  }
  return entries;
}

test("toScreen and pathFrom: floor-north is drawn up the screen", () => {
  assert.deepEqual(toScreen({ x: 0.3, y: 0.5 }), { x: 0.3, y: -0.5 });
  assert.equal(
    pathFrom([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]),
    "M 0 0 L 0 -1",
  );
  assert.equal(pathFrom([]), "");
});

test("layoutSequence: an empty sequence has nothing to frame", () => {
  assert.equal(layoutSequence([]), null);
});

test("layoutSequence: every foot's path is inside the view, with room round the edge", () => {
  const entries = chain(["Whisk", "Promenade Chassé", "Open Natural Turn"]);
  const layout = layoutSequence(entries);
  assert.ok(layout);
  const [x, y, width, height] = layout.viewBox.split(" ").map(Number);
  // At least half a metre of padding on every side (see layoutSequence).
  const points = layout.segments.flatMap((trails) =>
    [trails.lead, trails.follow].flatMap((feet) =>
      [...feet.left, ...feet.right].map(toScreen),
    ),
  );
  assert.ok(points.length > 0);
  for (const point of points) {
    assert.ok(point.x >= x + 0.5 && point.x <= x + width - 0.5);
    assert.ok(point.y >= y + 0.5 && point.y <= y + height - 0.5);
  }
  // The scale bar is a round length no wider than a fifth of the view,
  // and sits inside it.
  assert.ok(layout.scaleBar.length > 0);
  assert.ok(layout.scaleBar.length <= width / 5);
  assert.ok(layout.scaleBar.x + layout.scaleBar.length < x + width);
  assert.ok(layout.scaleBar.y < y + height);
  assert.deepEqual(layout.footprints, sequenceFootprints(entries));
});

function print(
  overrides: Partial<Footprint>,
  phase: FootprintState["phase"] = "taken",
  age = 0,
): FootprintState {
  return {
    footprint: {
      partner: "lead",
      foot: "left",
      position: { x: 0, y: 0 },
      orientation: 0,
      entryIndex: 0,
      startBeat: 0,
      endBeat: 1,
      count: "1",
      ...overrides,
    },
    phase,
    age,
  };
}

test("withCounts: one count per spot, the newest print's; none for the stance or later steps", () => {
  const older = print({ count: "1" }, "taken", 1);
  // Same foot, under a centimetre away: the same spot.
  const newer = print({ count: "2", position: { x: 0.004, y: 0 } }, "landing");
  const stance = print({ count: "", position: { x: 1, y: 0 } });
  const later = print({ count: "4", position: { x: 2, y: 0 } }, "later");
  const otherFoot = print({ foot: "right", count: "1" });
  const states = [older, newer, stance, later, otherFoot];

  const { footprints, counts } = withCounts(states);
  assert.equal(footprints, states);
  assert.deepEqual(counts.map((state) => state.footprint.count).sort(), [
    "1",
    "2",
  ]);
  assert.ok(counts.includes(newer));
  assert.ok(counts.includes(otherFoot));
  assert.ok(!counts.includes(older));
});

test("countOpacity: counts on old prints fade, but not below 0.45", () => {
  assert.ok(countOpacity("taken", 0) > countOpacity("taken", 3));
  assert.equal(countOpacity("taken", 50), 0.45);
  assert.ok(countOpacity("landing", 0) > countOpacity("next", 0));
});
