import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleDance } from "../support/dance.mts";
import {
  emptyDance,
  parseDance,
  parseDanceJSON,
  MAX_DANCE_BYTES,
} from "../../src/libs/dance/persistence.mts";
import { loadFigures } from "../../db/figures/index.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";

test("persistence: a full Dance round trip retains metadata, Unicode and optional step fields", () => {
  const dance = sampleDance();
  assert.deepEqual(parseDanceJSON(JSON.stringify(dance)), dance);
});
test("persistence: legacy Sequence exports import with a default tempo", () => {
  const sequence = sampleDance().sequence;
  const dance = parseDance(sequence);
  assert.equal(dance.schemaVersion, 1);
  assert.equal(dance.tempo, 60);
  assert.deepEqual(dance.sequence, sequence);
});
test("persistence: derived poses are recomputed from saved placement, not trusted from input", () => {
  const dance = sampleDance();
  dance.sequence.entries[0].transform = {
    position: { x: 2, y: 3 },
    rotation: 90,
  };
  const parsed = parseDance(dance);
  const foot = parsed.sequence.entries[0].resolvedStartPose.lead.left.position;
  assert.ok(Math.abs(foot.x - 2) < 1e-9);
  assert.ok(Math.abs(foot.y - 3.1) < 1e-9);
  assert.equal(
    parsed.sequence.entries[0].resolvedStartPose.lead.orientation,
    90,
  );
  assert.equal(dance.sequence.entries[0].resolvedStartPose.lead.orientation, 0);
});
test("persistence: rejects corrupt, future, excessive and non-finite data", () => {
  assert.throws(() => parseDanceJSON("{"), /not valid JSON/);
  assert.throws(() => parseDanceJSON(" ".repeat(MAX_DANCE_BYTES + 1)), /2 MB/);
  assert.throws(
    () => parseDance({ ...sampleDance(), schemaVersion: 2 }),
    /Unsupported dance version/,
  );
  assert.throws(() => parseDance({ ...sampleDance(), tempo: NaN }), /tempo/);
  assert.throws(() => parseDance({ ...sampleDance(), name: " " }), /name/);
  assert.throws(
    () => parseDance({ ...sampleDance(), createdAt: "yesterday" }),
    /createdAt/,
  );
  const dance = sampleDance();
  dance.sequence.entries[0].figure.steps[0].duration = 0;
  assert.throws(() => parseDance(dance), /duration/);
  dance.sequence.entries[0].figure.steps[0].duration = 10001;
  assert.throws(() => parseDance(dance), /duration/);
});
test("persistence: validates movements, weights, poses and timing before renderer use", () => {
  const invalid: [string, (dance: ReturnType<typeof sampleDance>) => void][] = [
    [
      "curvature",
      (dance) => {
        dance.sequence.entries[0].figure.steps[0].movement = {
          type: "arc",
          curvature: 0,
          arcLength: 0.5,
        };
      },
    ],
    [
      "weight",
      (dance) => {
        dance.sequence.entries[0].figure.startPose.lead.left.weight = 2;
      },
    ],
    [
      "position",
      (dance) => {
        dance.sequence.entries[0].transform.position.x = Infinity;
      },
    ],
    [
      "overlap",
      (dance) => {
        const steps = dance.sequence.entries[0].figure.steps;
        steps.push({ ...steps[0], id: "duplicate" });
      },
    ],
    [
      "airborne",
      (dance) => {
        dance.sequence.entries[0].figure.steps[0].contact = "air";
      },
    ],
  ];
  for (const [reason, change] of invalid) {
    const dance = sampleDance();
    change(dance);
    assert.throws(() => parseDance(dance), /Invalid dance/, reason);
  }
});
test("persistence: bounds total render/metronome work, including repeated entries", () => {
  const dance = sampleDance();
  dance.sequence.entries = Array(501).fill(dance.sequence.entries[0]);
  assert.throws(() => parseDance(dance), /entries/);
  dance.sequence.entries = Array(400).fill(sampleDance().sequence.entries[0]);
  dance.sequence.entries[0].figure.steps[0].duration = 100;
  assert.throws(() => parseDance(dance), /too large/);
});
test("persistence: every authored catalogue figure survives the validation boundary", () => {
  const dance = emptyDance();
  for (const authored of loadFigures()) {
    const figure = {
      ...authored,
      id: authored.name,
      steps: authored.steps.map((step, index) => ({
        ...step,
        id: String(index),
      })),
    };
    dance.sequence.entries.push(
      placeEntry(figure, dance.sequence.entries.at(-1)),
    );
  }
  assert.equal(
    parseDanceJSON(JSON.stringify(dance)).sequence.entries.length,
    dance.sequence.entries.length,
  );
});
