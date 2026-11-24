import { test } from "node:test";
import assert from "node:assert/strict";

import { capitalize, groupByStyle } from "../../src/components/styleGroups.mts";

test("groupByStyle: groups by style, groups and names in alphabetical order", () => {
  const items = [
    { name: "Whisk", style: "waltz" },
    { name: "Ocho", style: "argentine tango" },
    { name: "RF Closed Change", style: "waltz" },
    { name: "Reverse Box Turn (forward half)", style: "waltz" },
    { name: "box turn (forward half)", style: "waltz" },
    { name: "Back Corté", style: "tango" },
  ];
  assert.deepEqual(
    groupByStyle(items).map(([style, group]) => [
      style,
      group.map((item) => item.name),
    ]),
    [
      ["argentine tango", ["Ocho"]],
      ["tango", ["Back Corté"]],
      [
        "waltz",
        [
          "box turn (forward half)",
          "Reverse Box Turn (forward half)",
          "RF Closed Change",
          "Whisk",
        ],
      ],
    ],
  );
});

test("groupByStyle: ignores accents when sorting names", () => {
  const [[, group]] = groupByStyle([
    { name: "Promenade Walk", style: "waltz" },
    { name: "Promenade Chassé", style: "waltz" },
  ]);
  assert.deepEqual(
    group.map((item) => item.name),
    ["Promenade Chassé", "Promenade Walk"],
  );
});

test("capitalize: upper-cases the first letter only", () => {
  assert.equal(capitalize("argentine tango"), "Argentine tango");
  assert.equal(capitalize(""), "");
});
