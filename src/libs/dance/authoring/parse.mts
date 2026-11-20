/**
 * parseFigureDefinition: checks the shape of a figure file before
 * defineFigure sees it.
 */

import {
  CURVED_PATHS,
  DIRECTION_DEGREES,
  FOOT_CHECKS,
  FigureError,
  TURN_CENTRES,
} from "./definition.mts";
import type { FigureDefinition } from "./definition.mts";
import { STANCE_NAMES } from "./stances.mts";

/**
 * Checks that `value` (typically parsed from a JSON figure file) has
 * the shape of a FigureDefinition, and returns it typed.
 *
 * TypeScript can't check JSON, so this is what catches typos and wrong
 * types in figure files: unknown keys ("beats" instead of "beat"),
 * misspelt directions, a number where text is expected, a malformed
 * turn. Every problem in the file is reported at once, each with its
 * location (for example `steps[2].follow.turn`), prefixed with
 * `source` (the file name). It checks shape only; whether the steps
 * make sense as dancing is checked by defineFigure.
 *
 * db/figure.schema.json describes the same shape for editors, and
 * test/db/figureSchema.test.mts checks that the two accept and reject
 * exactly the same files. Change both together.
 */
export function parseFigureDefinition(
  value: unknown,
  source: string,
): FigureDefinition {
  const problems: string[] = [];
  const problem = (path: string, message: string) =>
    problems.push(`${path}: ${message}`);

  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const isNumber = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);

  function checkKeys(
    path: string,
    object: Record<string, unknown>,
    allowed: readonly string[],
  ) {
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) {
        problem(
          path ? `${path}.${key}` : key,
          `unknown field (expected one of: ${allowed.join(", ")})`,
        );
      }
    }
  }

  function checkString(path: string, v: unknown, required = false) {
    if (v === undefined) {
      if (required) problem(path, "is required");
      return;
    }
    if (typeof v !== "string" || v.length === 0) {
      problem(path, "should be non-empty text");
    }
  }

  function checkNumber(
    path: string,
    v: unknown,
    { positive = false }: { positive?: boolean } = {},
  ) {
    if (v === undefined) return;
    if (!isNumber(v) || (positive && !(v > 0))) {
      problem(
        path,
        positive ? "should be a positive number" : "should be a number",
      );
    }
  }

  function checkBoolean(path: string, v: unknown) {
    if (v !== undefined && typeof v !== "boolean") {
      problem(path, "should be true or false");
    }
  }

  function checkOneOf(path: string, v: unknown, options: readonly string[]) {
    if (v !== undefined && !options.includes(v as string)) {
      problem(
        path,
        `should be one of: ${options.map((o) => JSON.stringify(o)).join(", ")}`,
      );
    }
  }

  const ACTION_NAMES = [
    ...Object.keys(DIRECTION_DEGREES),
    "close",
    "in place",
    "pivot",
  ];
  function checkAction(path: string, v: unknown) {
    if (isNumber(v)) return;
    if (typeof v === "string" && ACTION_NAMES.includes(v)) return;
    if (isObject(v)) {
      checkOffset(path, v);
      return;
    }
    problem(
      path,
      `should be a number of degrees, { "forward": …, "right": … }, or one of: ${ACTION_NAMES.map((a) => JSON.stringify(a)).join(", ")}`,
    );
  }

  function checkOffset(path: string, v: Record<string, unknown>) {
    checkKeys(path, v, ["forward", "right"]);
    if (v.forward === undefined && v.right === undefined) {
      problem(path, 'needs "forward", "right" or both, in metres');
    }
    checkNumber(`${path}.forward`, v.forward);
    checkNumber(`${path}.right`, v.right);
  }

  function checkTurn(path: string, v: unknown) {
    if (v === undefined) return;
    const keys = isObject(v) ? Object.keys(v) : [];
    if (
      !isObject(v) ||
      keys.length !== 1 ||
      !["right", "left"].includes(keys[0])
    ) {
      problem(path, 'should be { "right": … } or { "left": … }');
      return;
    }
    const amount = v[keys[0]];
    // Text fractions need a non-zero numerator and denominator, matching
    // the turnAmount pattern in db/figure.schema.json.
    const validText =
      typeof amount === "string" &&
      /^0*[1-9]\d*\s*\/\s*0*[1-9]\d*$/.test(amount);
    if (!validText && !(isNumber(amount) && amount > 0)) {
      problem(
        `${path}.${keys[0]}`,
        'should be a positive fraction of a turn, such as 0.125 or "1/8"',
      );
    }
  }

  const MOVE_OPTIONS = [
    "foot",
    "by",
    "turn",
    "pointing",
    "rise",
    "riseTiming",
    "bodyOffset",
    "footwork",
    "weight",
    "duration",
    "air",
    "path",
    "pathSetOff",
    "cross",
  ] as const;
  function checkMoveOptions(
    path: string,
    object: Record<string, unknown>,
    rowLevel = false,
  ) {
    checkOneOf(`${path}foot`, object.foot, ["L", "R"]);
    checkNumber(`${path}by`, object.by, { positive: true });
    checkTurn(`${path}turn`, object.turn);
    if (
      rowLevel &&
      isObject(object.pointing) &&
      ("lead" in object.pointing || "follow" in object.pointing)
    ) {
      checkKeys(`${path}pointing`, object.pointing, ["lead", "follow"]);
      checkTurn(`${path}pointing.lead`, object.pointing.lead);
      checkTurn(`${path}pointing.follow`, object.pointing.follow);
    } else {
      checkTurn(`${path}pointing`, object.pointing);
    }
    checkNumber(`${path}rise`, object.rise);
    checkOneOf(`${path}riseTiming`, object.riseTiming, ["even", "late"]);
    if (object.bodyOffset !== undefined) {
      if (!isObject(object.bodyOffset))
        problem(
          `${path}bodyOffset`,
          'should be { "forward": …, "right": … } in metres',
        );
      else checkOffset(`${path}bodyOffset`, object.bodyOffset);
    }
    const checkFootwork = (where: string, v: unknown) => {
      if (v === undefined) return;
      if (typeof v !== "string" || !/^[HTBF]+$/.test(v)) {
        problem(
          where,
          'should be footwork letters, such as "HT", "T", "TH" or "BF" (H heel, T toe, B ball, F flat)',
        );
      }
    };
    if (rowLevel && isObject(object.footwork)) {
      checkKeys(`${path}footwork`, object.footwork, ["lead", "follow"]);
      if (Object.keys(object.footwork).length === 0) {
        problem(`${path}footwork`, 'should name "lead" or "follow"');
      }
      checkFootwork(`${path}footwork.lead`, object.footwork.lead);
      checkFootwork(`${path}footwork.follow`, object.footwork.follow);
    } else {
      checkFootwork(`${path}footwork`, object.footwork);
    }
    if (typeof object.weight === "number") {
      if (
        !Number.isFinite(object.weight) ||
        object.weight < 0 ||
        object.weight > 1
      )
        problem(`${path}weight`, "should be between 0 and 1");
    } else checkBoolean(`${path}weight`, object.weight);
    checkNumber(`${path}duration`, object.duration, { positive: true });
    checkBoolean(`${path}air`, object.air);
    if (rowLevel && isObject(object.path)) {
      checkKeys(`${path}path`, object.path, ["lead", "follow"]);
      if (Object.keys(object.path).length === 0)
        problem(`${path}path`, 'should name "lead" or "follow"');
      checkOneOf(`${path}path.lead`, object.path.lead, CURVED_PATHS);
      checkOneOf(`${path}path.follow`, object.path.follow, CURVED_PATHS);
    } else checkOneOf(`${path}path`, object.path, CURVED_PATHS);
    if (rowLevel && isObject(object.pathSetOff)) {
      checkKeys(`${path}pathSetOff`, object.pathSetOff, ["lead", "follow"]);
      if (Object.keys(object.pathSetOff).length === 0)
        problem(`${path}pathSetOff`, 'should name "lead" or "follow"');
      checkNumber(`${path}pathSetOff.lead`, object.pathSetOff.lead);
      checkNumber(`${path}pathSetOff.follow`, object.pathSetOff.follow);
    } else checkNumber(`${path}pathSetOff`, object.pathSetOff);
    checkBoolean(`${path}cross`, object.cross);
  }

  function checkPartner(path: string, v: unknown) {
    if (v === undefined) return;
    if (isObject(v) && !("go" in v) && ("forward" in v || "right" in v)) {
      checkOffset(path, v);
    } else if (isObject(v)) {
      checkKeys(path, v, ["go", ...MOVE_OPTIONS, "label"]);
      if (v.go === undefined) problem(`${path}.go`, "is required");
      else checkAction(`${path}.go`, v.go);
      checkMoveOptions(`${path}.`, v);
      checkString(`${path}.label`, v.label);
    } else {
      checkAction(path, v);
    }
  }

  function checkPoint(path: string, v: unknown) {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(isNumber)) {
      problem(path, "should be [x, y] in metres");
    }
  }

  function checkExpectEnd(path: string, v: unknown) {
    if (v === undefined) return;
    if (!isObject(v)) {
      problem(path, "should be an object");
      return;
    }
    if ("stance" in v) {
      checkKeys(path, v, ["stance", "moved", "turned", "leadStandingOn"]);
      checkOneOf(`${path}.stance`, v.stance, STANCE_NAMES);
      if (v.moved !== undefined) {
        if (!isObject(v.moved)) problem(`${path}.moved`, "should be an object");
        else {
          checkKeys(`${path}.moved`, v.moved, ["forward", "right"]);
          checkNumber(`${path}.moved.forward`, v.moved.forward);
          checkNumber(`${path}.moved.right`, v.moved.right);
        }
      }
      checkTurn(`${path}.turned`, v.turned);
      checkOneOf(`${path}.leadStandingOn`, v.leadStandingOn, ["L", "R"]);
    } else if ("feet" in v) {
      checkKeys(path, v, ["feet", "facing"]);
      if (!isObject(v.feet)) problem(`${path}.feet`, "should be an object");
      else {
        checkKeys(`${path}.feet`, v.feet, ["lead", "follow"]);
        for (const partner of ["lead", "follow"]) {
          const feet = v.feet[partner];
          if (!isObject(feet)) {
            problem(
              `${path}.feet.${partner}`,
              'should be { "L": [x, y], "R": [x, y] }',
            );
            continue;
          }
          checkKeys(`${path}.feet.${partner}`, feet, ["L", "R"]);
          checkPoint(`${path}.feet.${partner}.L`, feet.L);
          checkPoint(`${path}.feet.${partner}.R`, feet.R);
        }
      }
      if (v.facing !== undefined) {
        if (!isObject(v.facing))
          problem(`${path}.facing`, "should be an object");
        else {
          checkKeys(`${path}.facing`, v.facing, ["lead", "follow"]);
          checkNumber(`${path}.facing.lead`, v.facing.lead);
          checkNumber(`${path}.facing.follow`, v.facing.follow);
        }
      }
    } else {
      problem(path, 'needs either "stance" or "feet"');
    }
  }

  if (!isObject(value)) {
    throw new FigureError(`${source}: should contain a single JSON object`);
  }
  checkKeys("", value, [
    "$schema",
    "name",
    "style",
    "time",
    "start",
    "slow",
    "steps",
    "expectEnd",
    "expectBeats",
    "skipChecks",
    "notes",
  ]);
  checkString("name", value.name, true);
  checkString("style", value.style, true);
  if (value.time === undefined) problem("time", "is required");
  else if (typeof value.time !== "string" || !/^\d+\/\d+$/.test(value.time)) {
    problem("time", 'should look like "3/4" or "4/4"');
  }
  checkOneOf("start", value.start, STANCE_NAMES);
  checkNumber("slow", value.slow, { positive: true });
  checkNumber("expectBeats", value.expectBeats, { positive: true });
  if (value.skipChecks !== undefined) {
    if (!Array.isArray(value.skipChecks)) {
      problem("skipChecks", "should be a list");
    } else {
      value.skipChecks.forEach((check, index) =>
        checkOneOf(`skipChecks[${index}]`, check, FOOT_CHECKS),
      );
    }
  }
  checkString("notes", value.notes);
  if (value.$schema !== undefined && typeof value.$schema !== "string") {
    problem("$schema", "should be text (the path to figure.schema.json)");
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    problem("steps", "should be a list with at least one step");
  } else {
    value.steps.forEach((row: unknown, index: number) => {
      const path = `steps[${index}]`;
      if (!isObject(row)) {
        problem(path, "should be an object");
        return;
      }
      checkKeys(path, row, [
        "both",
        "turnCentre",
        "hold",
        "lead",
        "follow",
        "beat",
        "length",
        "label",
        ...MOVE_OPTIONS,
      ]);
      if (row.both !== undefined) checkAction(`${path}.both`, row.both);
      checkOneOf(`${path}.turnCentre`, row.turnCentre, TURN_CENTRES);
      checkOneOf(`${path}.hold`, row.hold, ["opposed promenade"]);
      checkPartner(`${path}.lead`, row.lead);
      checkPartner(`${path}.follow`, row.follow);
      checkMoveOptions(`${path}.`, row, true);
      checkNumber(`${path}.beat`, row.beat, { positive: true });
      checkOneOf(`${path}.length`, row.length, ["S", "Q"]);
      if (typeof row.label === "string") {
        checkString(`${path}.label`, row.label);
      } else if (row.label !== undefined) {
        if (!isObject(row.label)) {
          problem(
            `${path}.label`,
            'should be text or { "lead": …, "follow": … }',
          );
        } else {
          checkKeys(`${path}.label`, row.label, ["lead", "follow"]);
          checkString(`${path}.label.lead`, row.label.lead);
          checkString(`${path}.label.follow`, row.label.follow);
        }
      }
    });
  }
  checkExpectEnd("expectEnd", value.expectEnd);

  if (problems.length > 0) {
    throw new FigureError(`${source}:\n  ${problems.join("\n  ")}`);
  }
  return value as unknown as FigureDefinition;
}
