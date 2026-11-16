import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadFigures } from "../../db/figures/index.mts";

// loadFigures reads every *.json file in a folder of figure files. These
// tests point it at temporary folders; the last one checks the real
// db/figures/ folder.

let directory: string;

before(() => {
  directory = mkdtempSync(join(tmpdir(), "milonga-figures-test-"));
});

after(() => rmSync(directory, { recursive: true, force: true }));

function folderWith(files: Record<string, unknown>): string {
  const folder = mkdtempSync(join(directory, "set-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(
      join(folder, name),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return folder;
}

function walk(name: string, by = 0.3) {
  return {
    name,
    style: "tango",
    time: "4/4",
    steps: [{ both: "forward", by, length: "Q" }],
  };
}

test("loadFigures: loads every .json file, in file-name order, ignoring other files", () => {
  const folder = folderWith({
    "b-second.json": walk("Second"),
    "a-first.json": walk("First"),
    "README.md": "not a figure",
    "draft.json.bak": "{",
  });
  const figures = loadFigures(folder);
  assert.deepEqual(
    figures.map((figure) => figure.name),
    ["First", "Second"],
  );
  // They come back as full model data, ready to store.
  assert.equal(figures[0].steps.length, 2);
  assert.ok(figures[0].endPose.lead.left.position.y > 0);
});

test("loadFigures: an empty folder gives no figures", () => {
  assert.deepEqual(loadFigures(folderWith({})), []);
});

test("loadFigures: reports problems from every file together, each with its file name", () => {
  const folder = folderWith({
    "good.json": walk("Good"),
    "broken.json": "{ not json",
    "typo.json": {
      ...walk("Typo"),
      steps: [{ both: "forwards", by: 0.3, length: "Q" }],
    },
    "weighted.json": {
      ...walk("Weighted"),
      steps: [
        { lead: "forward", by: 0.3, length: "Q" },
        { lead: { go: "forward", foot: "L", by: 0.3 }, length: "Q" },
      ],
    },
  });
  assert.throws(
    () => loadFigures(folder),
    (error: unknown) => {
      const message = (error as Error).message;
      return (
        /broken\.json: isn't valid JSON/.test(message) &&
        /typo\.json:\n? *steps\[0\]\.both: should be a number of degrees/.test(
          message,
        ) &&
        /weighted\.json: Weighted, step 2 \(lead\): the left foot is carrying the weight/.test(
          message,
        ) &&
        !/good\.json/.test(message)
      );
    },
  );
});

test("loadFigures: two files with the same figure name are an error", () => {
  const folder = folderWith({
    "walk.json": walk("Walk"),
    "walk-copy.json": walk("Walk", 0.4),
  });
  assert.throws(
    () => loadFigures(folder),
    /walk\.json: the name "Walk" is already used by walk-copy\.json/,
  );
});

test("loadFigures: the real db/figures/ folder loads cleanly", () => {
  const figures = loadFigures();
  assert.ok(figures.length > 0);
  assert.equal(
    new Set(figures.map((figure) => figure.name)).size,
    figures.length,
  );
});
