import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

import {
  FigureError,
  parseFigureDefinition,
} from "../../src/libs/dance/authoring.mts";

// The figure file format is described twice: db/figure.schema.json, which
// editors use for autocomplete and as-you-type checks, and
// parseFigureDefinition, which the seed uses (with friendlier messages).
// These tests check that the two accept and reject exactly the same
// files, so neither can drift: adding a field or changing a rule in one
// without the other fails here.
//
// Rather than a hand-picked list of cases, the main test starts from
// "kitchen sink" files that use every field, then systematically breaks
// them -- every field removed, an unknown field added to every object,
// and every value swapped for a range of wrong ones -- and asks both
// checkers about each variant.

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const schema = JSON.parse(
  readFileSync(join(root, "db/figure.schema.json"), "utf8"),
);

// ajv is a dev dependency used only here; the app and seed never load it.
const ajv = new Ajv({ allErrors: true, strict: true });
const schemaAccepts = ajv.compile(schema);

function validatorAccepts(value: unknown): boolean {
  try {
    parseFigureDefinition(value, "test.json");
    return true;
  } catch (error) {
    if (error instanceof FigureError) return false;
    throw error;
  }
}

/** Every field the format has, in one file (shape only: it doesn't need
 *  to make sense as dancing). */
const WITH_STANCE_END = {
  $schema: "../figure.schema.json",
  name: "Everything",
  style: "test",
  time: "4/4",
  start: "closed",
  slow: 1,
  notes: "Uses every field.",
  steps: [
    {
      both: "forward",
      turnCentre: "between",
      foot: "L",
      by: 0.3,
      turn: { right: "1/8" },
      pointing: { lead: { right: "1/8" }, follow: { left: 0.125 } },
      rise: 0.05,
      weight: false,
      air: true,
      beat: 1,
      label: "both",
    },
    {
      lead: {
        go: 10,
        foot: "R",
        by: 0.2,
        turn: { left: 0.25 },
        pointing: { right: "1/16" },
        rise: 0,
        weight: true,
        air: false,
        path: "around the front",
        cross: false,
        label: "lead",
      },
      follow: "pivot",
      length: "S",
      label: { lead: "a", follow: "b" },
    },
    { both: { forward: 0.9, right: 0.2 }, length: "Q" },
    {
      lead: { right: -0.2 },
      follow: { go: { forward: -0.1 }, foot: "L" },
      length: "Q",
    },
  ],
  expectBeats: 4,
  expectEnd: {
    stance: "closed",
    moved: { forward: 0.4, right: -0.3 },
    turned: { left: "3/8" },
    leadStandingOn: "R",
  },
};

const WITH_FEET_END = {
  name: "Feet",
  style: "test",
  time: "3/4",
  start: "crossed promenade",
  skipChecks: ["crossed feet", "partner spacing", "hold"],
  steps: [{ follow: { go: "close" }, length: "Q" }],
  expectEnd: {
    feet: {
      lead: { L: [-0.1, 0.6], R: [0.1, 0] },
      follow: { L: [0.1, 0.4], R: [-0.1, 1] },
    },
    facing: { lead: 0, follow: 180 },
  },
};

/** Values swapped in for each field in turn. Between them they hit
 *  every type, empty and non-empty text, zero and negative numbers,
 *  valid and invalid fraction text, and each enum's spellings. */
const REPLACEMENTS: unknown[] = [
  null,
  true,
  0,
  -1,
  0.5,
  42,
  "",
  "x",
  "1/8",
  "0/8",
  "1/0",
  "1 / 4",
  "3/4",
  "L",
  "S",
  "closed",
  "forward",
  "pivot",
  [],
  [0, 0],
  [0],
  {},
  { right: "1/8" },
  { go: "forward" },
  { L: [0, 0], R: [0, 0] },
];

type Json = unknown;

/** Every variant of `value` with one change at one place. */
function* mutations(value: Json, path = "$"): Generator<[string, Json]> {
  for (const replacement of REPLACEMENTS) {
    yield [`${path} = ${JSON.stringify(replacement)}`, replacement];
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      for (const [where, changed] of mutations(value[i], `${path}[${i}]`)) {
        const copy = [...value];
        copy[i] = changed;
        yield [where, copy];
      }
      yield [`delete ${path}[${i}]`, value.filter((_, j) => j !== i)];
    }
  } else if (typeof value === "object" && value !== null) {
    const object = value as Record<string, Json>;
    yield [`${path}.zzz added`, { ...object, zzz: 1 }];
    for (const key of Object.keys(object)) {
      const rest = { ...object };
      delete rest[key];
      yield [`delete ${path}.${key}`, rest];
      for (const [where, changed] of mutations(object[key], `${path}.${key}`)) {
        yield [where, { ...object, [key]: changed }];
      }
    }
  }
}

test("the schema compiles in strict mode", () => {
  assert.equal(typeof schemaAccepts, "function");
});

test("every real figure file is accepted by both the schema and the validator", () => {
  const folder = join(root, "db/figures");
  const files = readdirSync(folder).filter((file) => file.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const json = JSON.parse(readFileSync(join(folder, file), "utf8"));
    assert.equal(
      schemaAccepts(json),
      true,
      `${file} fails the schema: ${ajv.errorsText(schemaAccepts.errors)}`,
    );
    assert.equal(validatorAccepts(json), true, `${file} fails the validator`);
  }
});

test("the kitchen-sink files use every field and are valid", () => {
  for (const file of [WITH_STANCE_END, WITH_FEET_END]) {
    assert.equal(
      schemaAccepts(file),
      true,
      ajv.errorsText(schemaAccepts.errors),
    );
    assert.equal(validatorAccepts(file), true);
  }
});

test("the schema and the validator agree on every systematically broken variant", () => {
  const disagreements: string[] = [];
  let checked = 0;
  let rejected = 0;
  for (const base of [WITH_STANCE_END, WITH_FEET_END]) {
    for (const [where, variant] of mutations(base)) {
      checked++;
      const bySchema = schemaAccepts(variant);
      const byValidator = validatorAccepts(variant);
      if (!bySchema) rejected++;
      if (bySchema !== byValidator) {
        disagreements.push(
          `${base.name}: ${where} -> schema ${bySchema ? "accepts" : "rejects"}, validator ${byValidator ? "accepts" : "rejects"}`,
        );
      }
    }
  }
  // Sanity: the variants really exercise both outcomes.
  assert.ok(checked > 1000, `only ${checked} variants`);
  assert.ok(rejected > 0 && rejected < checked);
  assert.deepEqual(
    disagreements.slice(0, 20),
    [],
    `${disagreements.length} disagreements`,
  );
});
