import { test } from "node:test";
import assert from "node:assert/strict";

import { entriesToSequence } from "../../src/libs/dance/serialize.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { SequenceEntry } from "../../src/libs/dance/sequence.mts";

const STILL_POSE: Pose = {
  lead: {
    left: { position: { x: -0.1, y: 0 }, weight: 0.5 },
    right: { position: { x: 0.1, y: 0 }, weight: 0.5 },
    orientation: 0,
    rise: 0,
  },
  follow: {
    left: { position: { x: 0.1, y: 0.4 }, weight: 0.5 },
    right: { position: { x: -0.1, y: 0.4 }, weight: 0.5 },
    orientation: 180,
    rise: 0,
  },
};

const emptyFigure: Figure = {
  id: "f1",
  name: "Hold",
  style: "tango",
  timeSignature: { beatsPerMeasure: 4, beatUnit: 4 },
  steps: [],
  startPose: STILL_POSE,
  endPose: STILL_POSE,
};

function entryAt(x: number, y: number, rotation: number): SequenceEntry {
  return {
    figure: emptyFigure,
    transform: { position: { x, y }, rotation },
    resolvedStartPose: STILL_POSE,
    resolvedEndPose: STILL_POSE,
  };
}

test("entriesToSequence: an empty builder anchors the sequence at the floor origin", () => {
  const sequence = entriesToSequence([]);
  assert.deepEqual(sequence.startTransform, {
    position: { x: 0, y: 0 },
    rotation: 0,
  });
  assert.deepEqual(sequence.entries, []);
});

test("entriesToSequence: startTransform is the first entry's own transform", () => {
  // useSequenceBuilder anchors the first entry explicitly (there's no
  // previous entry to fit it to), so the saved sequence must start
  // exactly there -- not at the last entry, and not at the origin.
  const entries = [entryAt(1, 2, 30), entryAt(5, 5, 90)];
  const sequence = entriesToSequence(entries);
  assert.deepEqual(sequence.startTransform, entries[0].transform);
});

test("entriesToSequence: keeps entries in order and uses placeholder id/name until saving exists", () => {
  const entries = [entryAt(0, 0, 0), entryAt(1, 0, 0), entryAt(2, 0, 0)];
  const sequence = entriesToSequence(entries);
  assert.deepEqual(sequence.entries, entries);
  assert.equal(sequence.id, "local-sequence");
  assert.equal(sequence.name, "Untitled Sequence");
});

test("entriesToSequence: output survives a JSON round trip unchanged (what Share/Export rely on)", () => {
  const entries = [entryAt(0.5, -1.25, 45)];
  const sequence = entriesToSequence(entries);
  assert.deepEqual(JSON.parse(JSON.stringify(sequence)), sequence);
});
