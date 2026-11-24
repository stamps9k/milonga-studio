import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  fingerprintOf,
  savedFingerprint,
} from "../../src/hooks/useDanceLibrary.mts";
import {
  defineFigure,
  parseFigureDefinition,
} from "../../src/libs/dance/authoring.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import type { Dance } from "../../src/libs/dance/dance.mts";
import { emptyDance, parseDance } from "../../src/libs/dance/persistence.mts";
import { entriesToSequence } from "../../src/libs/dance/serialize.mts";

function load(file: string) {
  const figure = defineFigure(
    parseFigureDefinition(
      JSON.parse(
        readFileSync(
          new URL(`../../db/figures/${file}.json`, import.meta.url),
          "utf8",
        ),
      ),
      file,
    ),
  );
  return {
    ...figure,
    id: file,
    steps: figure.steps.map((step, index) => ({ ...step, id: String(index) })),
  };
}

test("savedFingerprint: a saved waltz reads as unedited, though its parsed snapshot differs", () => {
  // Whisk then Promenade Chassé: weight timings and a curved path with a
  // negative set-off, which parseDance reorders and normalises.
  const first = placeEntry(load("whisk"), undefined);
  const entries = [first, placeEntry(load("promenade-chasse"), first)];
  const blank = emptyDance();
  const working: Dance = {
    ...blank,
    name: "Untitled",
    tempo: 87,
    sequence: { ...blank.sequence, ...entriesToSequence(entries) },
  };
  const snapshot = parseDance({
    ...working,
    name: "Practice",
    notes: "after class",
    id: "saved",
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
  });
  // The editor after onSaved: its own entries, the saved name and notes.
  const editor: Dance = { ...working, name: "Practice", notes: "after class" };
  assert.notEqual(fingerprintOf(snapshot), fingerprintOf(editor));
  assert.equal(savedFingerprint(working, snapshot), fingerprintOf(editor));
});
