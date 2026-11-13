import { applyTransform } from "./floor.mts";
import { figureDurationBeats, poseAtBeat } from "./fold.mts";
import {
  RAD_TO_DEG,
  addPoints,
  headingToUnitVector,
  normalizeDegrees,
  scalePoint,
  subPoints,
} from "./heading.mts";
import type { Pose, Point2D } from "./pose.mts";
import type {
  DanceStep,
  Figure,
  Foot,
  Partner,
  TimeSignature,
} from "./step.mts";

/**
 * defineFigure: write a figure the way a dancer describes it, and get
 * back the model's data (absolute floor headings, beats, poses).
 *
 * You describe each step relative to the dancer -- "lead's left foot
 * forward 40 cm on count 1", "both close", "follow pivots a quarter
 * left" -- and the helper works out everything the model needs:
 *
 * - which foot moves (the free one), and the starting weight;
 * - the follow's step when you write `both` (the mirror of the lead's);
 * - each step's absolute floor direction, from the dancer's facing;
 * - where a "close" lands (beside the standing foot at stance width);
 * - weight, facing and timing after each step;
 * - the figure's end pose, by folding its steps (see fold.mts).
 *
 * It then checks the result and throws a descriptive error if a step
 * moves the foot carrying the weight, the timing is inconsistent, or
 * the figure doesn't end where `expectEnd` says it should. The seed
 * script calls it, so `npm test` catches mistakes.
 *
 * See db/FIGURES.md for a guide with examples.
 */

// ---------------------------------------------------------------------
// Stance
// ---------------------------------------------------------------------

/** Distance between a dancer's feet in a normal standing position, in
 *  metres (the working floor unit; see src/libs/dance/AGENTS.md). */
export const STANCE_WIDTH = 0.2;

/** Distance between the lead's and follow's feet front to back in
 *  closed hold. Provisional: the follow stands directly in front of the
 *  lead, without the slight offset to the lead's right of real closed
 *  hold. Both values can change independently. */
export const PARTNER_DISTANCE = 0.4;

/** Named starting positions. Only closed hold so far: lead at the
 *  origin facing line of dance (0), follow facing him (180). */
export type StanceName = "closed";

type ShortFoot = "L" | "R";

const FOOT: Record<ShortFoot, Foot> = { L: "left", R: "right" };
const OTHER: Record<Foot, Foot> = { left: "right", right: "left" };

/** Feet positions of a named stance, with each partner standing on the
 *  given foot. */
function stancePose(stance: StanceName, standing: Record<Partner, Foot>): Pose {
  const half = STANCE_WIDTH / 2;
  const weight = (partner: Partner, foot: Foot) =>
    standing[partner] === foot ? 1 : 0;
  switch (stance) {
    case "closed":
      return {
        lead: {
          left: {
            position: { x: -half, y: 0 },
            weight: weight("lead", "left"),
          },
          right: {
            position: { x: half, y: 0 },
            weight: weight("lead", "right"),
          },
          orientation: 0,
          rise: 0,
        },
        // Facing the lead, so her left foot is on the east (+x) side.
        follow: {
          left: {
            position: { x: half, y: PARTNER_DISTANCE },
            weight: weight("follow", "left"),
          },
          right: {
            position: { x: -half, y: PARTNER_DISTANCE },
            weight: weight("follow", "right"),
          },
          orientation: 180,
          rise: 0,
        },
      };
  }
}

// ---------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------

/** Direction of travel relative to the dancer's facing *before* the
 *  step's turn. A number is degrees clockwise from forward (so 90 is
 *  side right), for directions between the named ones. */
export type RelativeDirection =
  | "forward"
  | "back"
  | "side left"
  | "side right"
  | "diagonal forward left"
  | "diagonal forward right"
  | "diagonal back left"
  | "diagonal back right"
  | number;

/**
 * What a foot does:
 * - a RelativeDirection: travel that way by `by` metres, taking weight;
 * - "close": bring the free foot beside the standing foot (at stance
 *   width, across the dancer's facing after any turn), taking weight;
 * - "in place": change weight onto the free foot without moving it
 *   (a recover, or a cha-cha "in place" step);
 * - "pivot": turn on the standing foot without moving it (needs `turn`).
 */
export type Action = RelativeDirection | "close" | "in place" | "pivot";

/** A turn, as a fraction of a full turn: `{ right: 1 / 8 }` is 45
 *  degrees clockwise (a natural turn), `{ left: 3 / 8 }` is 135 degrees
 *  anticlockwise (a reverse turn). */
export type Turn = { right: number } | { left: number };

/** Options that can be given for both partners on a row, or per
 *  partner. */
export interface MoveOptions {
  /** Which foot. Usually left out: the free foot (or, for "pivot", the
   *  standing foot) is used. Giving a foot that contradicts the weight
   *  is an error, not a silent correction. With `both`, this is the
   *  lead's foot; the follow uses the other one. */
  foot?: ShortFoot;
  /** Distance travelled in metres. Required for a direction; not used
   *  for "close", "in place" or "pivot". */
  by?: number;
  turn?: Turn;
  /** Rise at the end of the step, in metres above normal standing
   *  height (waltz/foxtrot rise and fall). Default 0. */
  rise?: number;
  /** false for a step without weight (a tap or a close without
   *  weight): the foot moves but the weight stays on the standing foot. */
  weight?: boolean;
  /** An airborne action (boleo, gancho, ...): the free leg goes out
   *  along the direction and back, carrying no weight. */
  air?: boolean;
  label?: string;
}

/** One partner's part of a row, when written separately. */
export interface PartnerMove extends MoveOptions {
  go: Action;
}

/**
 * One moment in the figure. Either `both` (the lead does it and the
 * follow mirrors it), or `lead` and/or `follow` separately. Timing is
 * either `beat` (when the step starts: 1, 2, 3.5 for "3&", ...) or
 * `length` ("S" or "Q"), and a figure uses one style throughout.
 *
 * Options written on the row (by, turn, rise, ...) apply to `both`, and
 * to `lead`/`follow` written as a plain action; a partner written as an
 * object uses only its own options.
 */
export interface StepRow extends Omit<MoveOptions, "label"> {
  both?: Action;
  lead?: Action | PartnerMove;
  follow?: Action | PartnerMove;
  beat?: number;
  length?: "S" | "Q";
  /** One label for both partners, or one each. Default: generated
   *  from the action ("forward", "close", "pivot 1/8 left", ...). */
  label?: string | { lead?: string; follow?: string };
}

/** Where the figure should end, checked against the folded steps. All
 *  in the figure's own frame: the lead starts at the origin facing
 *  forward (+y), with +x to his right. */
export type ExpectedEnd =
  | {
      /** The named stance, moved and turned as a whole. */
      stance: StanceName;
      /** How far the stance has moved, in metres. */
      moved?: { forward?: number; right?: number };
      turned?: Turn;
      /** Which foot the lead stands on; the follow stands on the
       *  opposite one. Leave out to check positions and facing only. */
      leadStandingOn?: ShortFoot;
    }
  | {
      /** Exact foot positions [x, y], for endings that aren't a named
       *  stance (an open, mid-stride finish, say). */
      feet: Record<Partner, Record<ShortFoot, [number, number]>>;
      /** Facing in degrees (0 = forward, clockwise). Default: unchecked. */
      facing?: Partial<Record<Partner, number>>;
    };

export interface FigureDefinition {
  name: string;
  /** Free-form style tag, as used in the library (tango, waltz, ...). */
  style: string;
  /** Time signature, such as "3/4" or "4/4". */
  time: `${number}/${number}`;
  /** Starting stance. Default "closed". */
  start?: StanceName;
  /** Beats in a slow, for the S/Q style. A quick is half. Default 2. */
  slow?: number;
  steps: StepRow[];
  expectEnd?: ExpectedEnd;
}

/** The model's data for a figure, ready to store (no ids yet). */
export interface AuthoredFigure {
  name: string;
  style: string;
  timeSignature: TimeSignature;
  startPose: Pose;
  endPose: Pose;
  steps: Omit<DanceStep, "id">[];
}

// ---------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------

const DIRECTION_DEGREES: Record<Exclude<RelativeDirection, number>, number> = {
  forward: 0,
  "diagonal forward right": 45,
  "side right": 90,
  "diagonal back right": 135,
  back: 180,
  "diagonal back left": 225,
  "side left": 270,
  "diagonal forward left": 315,
};

/** Matching tolerance for expectEnd: 1 mm, enough for rounded values. */
const POSITION_TOLERANCE = 1e-3;
const ANGLE_TOLERANCE = 1e-6;

class FigureError extends Error {}

function turnDegrees(turn: Turn | undefined): number {
  if (turn === undefined) return 0;
  return "right" in turn ? turn.right * 360 : -turn.left * 360;
}

function describeTurn(turn: Turn): string {
  const [direction, amount] =
    "right" in turn ? ["right", turn.right] : ["left", turn.left];
  // Show common fractions as fractions (1/8, 3/8, 1/4, ...).
  for (const denominator of [8, 4, 2, 16]) {
    const numerator = amount * denominator;
    if (Math.abs(numerator - Math.round(numerator)) < 1e-9) {
      return `${Math.round(numerator)}/${denominator} ${direction}`;
    }
  }
  return `${Math.round(amount * 360)}° ${direction}`;
}

function defaultLabel(action: Action, turn: Turn | undefined, air: boolean) {
  const base = typeof action === "number" ? `${action}° from forward` : action;
  const withTurn = turn ? `${base}, turning ${describeTurn(turn)}` : base;
  if (action === "pivot" && turn) return `pivot ${describeTurn(turn)}`;
  return air ? `${withTurn} (in the air)` : withTurn;
}

interface PartnerState {
  position: Record<Foot, Point2D>;
  weight: Record<Foot, number>;
  orientation: number;
}

/** A partner's resolved part of a row before timing is attached. */
interface ResolvedMove {
  partner: Partner;
  move: PartnerMove;
  label: string;
}

/** Expand a row into the one or two partner moves it describes. */
function movesOfRow(row: StepRow, where: string): ResolvedMove[] {
  const shared: MoveOptions = {
    foot: row.foot,
    by: row.by,
    turn: row.turn,
    rise: row.rise,
    weight: row.weight,
    air: row.air,
  };
  const labelFor = (partner: Partner) =>
    typeof row.label === "string" ? row.label : row.label?.[partner];

  if (row.both !== undefined) {
    if (row.lead !== undefined || row.follow !== undefined) {
      throw new FigureError(
        `${where}: use either \`both\` or \`lead\`/\`follow\`, not both`,
      );
    }
    const lead: PartnerMove = { ...shared, go: row.both };
    // The follow mirrors the lead: the other foot, the same floor
    // direction and distance, and the same turn (the couple rotates
    // together). The foot is filled in once the lead's is known.
    const follow: PartnerMove = { ...shared, go: row.both, foot: undefined };
    return [
      { partner: "lead", move: lead, label: labelFor("lead") ?? "" },
      { partner: "follow", move: follow, label: labelFor("follow") ?? "" },
    ];
  }

  const moves: ResolvedMove[] = [];
  for (const partner of ["lead", "follow"] as const) {
    const value = row[partner];
    if (value === undefined) continue;
    const move: PartnerMove =
      typeof value === "object" ? value : { ...shared, go: value };
    moves.push({
      partner,
      move,
      label: move.label ?? labelFor(partner) ?? "",
    });
  }
  if (moves.length === 0) {
    throw new FigureError(`${where}: needs \`both\`, \`lead\` or \`follow\``);
  }
  return moves;
}

/** The foot a move uses, and whether it's travelling (needs the free
 *  foot) or a pivot (needs the standing foot). */
function chooseFoot(
  move: PartnerMove,
  state: PartnerState,
  explicit: Foot | undefined,
  where: string,
): Foot {
  const standing = (["left", "right"] as const).filter(
    (foot) => state.weight[foot] >= 0.5,
  );
  const free = (["left", "right"] as const).filter(
    (foot) => state.weight[foot] < 0.5,
  );

  if (move.go === "pivot") {
    const foot = explicit ?? (standing.length === 1 ? standing[0] : undefined);
    if (foot === undefined) {
      throw new FigureError(`${where}: say which foot to pivot on`);
    }
    if (state.weight[foot] < 0.5) {
      throw new FigureError(
        `${where}: can't pivot on the ${foot} foot, which isn't carrying the weight`,
      );
    }
    return foot;
  }

  const foot = explicit ?? (free.length === 1 ? free[0] : undefined);
  if (foot === undefined) {
    throw new FigureError(`${where}: say which foot moves`);
  }
  if (state.weight[foot] >= 0.5) {
    throw new FigureError(
      `${where}: the ${foot} foot is carrying the weight, so it can't step${
        explicit ? "" : " (check the foot or the previous step's weight)"
      }`,
    );
  }
  return foot;
}

/** Apply one partner's move to their state, returning the model step
 *  (without timing) and updating `state`. */
function applyMove(
  partner: Partner,
  move: PartnerMove,
  foot: Foot,
  state: PartnerState,
  label: string,
  where: string,
): Omit<DanceStep, "id" | "beat" | "duration"> {
  const before = state.orientation;
  const after = normalizeDegrees(before + turnDegrees(move.turn));
  const start = state.position[foot];
  const air = move.air === true;
  const takesWeight = !air && move.weight !== false && move.go !== "pivot";

  if (move.go === "pivot" && move.turn === undefined) {
    throw new FigureError(`${where}: a pivot needs a \`turn\``);
  }

  let direction = 0;
  let distance = 0;
  if (move.go === "close") {
    if (move.by !== undefined) {
      throw new FigureError(`${where}: "close" finds its own distance`);
    }
    // Beside the standing foot at stance width, across the dancer's
    // facing after the turn: a left foot closes to the standing foot's
    // left (facing - 90), a right foot to its right (facing + 90).
    const standingFoot = OTHER[foot];
    const side = headingToUnitVector(after + (foot === "left" ? -90 : 90));
    const target = addPoints(
      state.position[standingFoot],
      scalePoint(side, STANCE_WIDTH),
    );
    const delta = subPoints(target, start);
    distance = Math.hypot(delta.x, delta.y);
    // Compass heading of the delta (0 = +y, clockwise), see heading.mts.
    direction =
      distance < 1e-12
        ? 0
        : normalizeDegrees(Math.atan2(delta.x, delta.y) * RAD_TO_DEG);
  } else if (move.go === "in place" || move.go === "pivot") {
    if (move.by !== undefined) {
      throw new FigureError(`${where}: "${move.go}" doesn't travel`);
    }
  } else {
    if (move.by === undefined || !(move.by > 0)) {
      throw new FigureError(
        `${where}: a step ${typeof move.go === "number" ? `at ${move.go}°` : move.go} needs a positive \`by\` (distance in metres)`,
      );
    }
    const relative =
      typeof move.go === "number" ? move.go : DIRECTION_DEGREES[move.go];
    // Measured from the facing before the step's turn (owner's decision).
    direction = normalizeDegrees(before + relative);
    distance = move.by;
  }

  if (!air && distance > 0) {
    state.position[foot] = addPoints(
      start,
      scalePoint(headingToUnitVector(direction), distance),
    );
  }
  if (takesWeight) {
    state.weight[foot] = 1;
    state.weight[OTHER[foot]] = 0;
  }
  state.orientation = after;

  return {
    partner,
    foot,
    movement: { type: "straight", direction, distance },
    contact: air ? "air" : "floor",
    // A pivot keeps the weight on the pivoting foot.
    weight: takesWeight || move.go === "pivot" ? 1 : 0,
    orientation: after,
    rise: move.rise ?? 0,
    label: label || defaultLabel(move.go, move.turn, air),
  };
}

function parseTime(time: string, name: string): TimeSignature {
  const match = /^(\d+)\/(\d+)$/.exec(time);
  if (!match) throw new FigureError(`${name}: time must look like "3/4"`);
  return { beatsPerMeasure: Number(match[1]), beatUnit: Number(match[2]) };
}

/** Which foot each partner stands on at the start, worked out from
 *  their first step: a travelling step uses the free foot, so the
 *  partner stands on the other one; a pivot is on the standing foot. A
 *  partner with no foot given on their first step starts standing on
 *  the usual foot: the lead on his right, the follow on her left. */
function inferStanding(rows: StepRow[], name: string): Record<Partner, Foot> {
  const standing: Partial<Record<Partner, Foot>> = {};
  for (const [index, row] of rows.entries()) {
    for (const { partner, move } of movesOfRow(
      row,
      `${name}, step ${index + 1}`,
    )) {
      if (standing[partner]) continue;
      let foot: Foot | undefined = move.foot ? FOOT[move.foot] : undefined;
      if (row.both !== undefined && partner === "follow" && row.foot) {
        foot = OTHER[FOOT[row.foot]];
      }
      if (foot === undefined) {
        // Nothing to infer from: the usual starting weight, lead on his
        // right (stepping off the left), follow on her left.
        standing[partner] = partner === "lead" ? "right" : "left";
      } else {
        standing[partner] = move.go === "pivot" ? foot : OTHER[foot];
      }
    }
    if (standing.lead && standing.follow) break;
  }
  return { lead: standing.lead ?? "right", follow: standing.follow ?? "left" };
}

function checkExpectedEnd(
  name: string,
  expected: ExpectedEnd,
  actual: Pose,
): void {
  const problems: string[] = [];
  const feet: [Partner, Foot][] = [
    ["lead", "left"],
    ["lead", "right"],
    ["follow", "left"],
    ["follow", "right"],
  ];
  const fmt = (p: Point2D) => `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;
  const angleOff = (a: number, b: number) =>
    Math.abs(normalizeDegrees(a - b + 180) - 180);

  if ("stance" in expected) {
    const leadFoot: Foot = expected.leadStandingOn
      ? FOOT[expected.leadStandingOn]
      : actual.lead.left.weight >= 0.5
        ? "left"
        : "right";
    const target = applyTransform(
      {
        position: {
          x: expected.moved?.right ?? 0,
          y: expected.moved?.forward ?? 0,
        },
        rotation: turnDegrees(expected.turned),
      },
      stancePose(expected.stance, { lead: leadFoot, follow: OTHER[leadFoot] }),
    );
    for (const [partner, foot] of feet) {
      const a = actual[partner][foot].position;
      const e = target[partner][foot].position;
      if (Math.hypot(a.x - e.x, a.y - e.y) > POSITION_TOLERANCE) {
        problems.push(
          `${partner} ${foot} foot ends at ${fmt(a)}, expected ${fmt(e)}`,
        );
      }
      if (
        expected.leadStandingOn &&
        Math.abs(actual[partner][foot].weight - target[partner][foot].weight) >
          1e-9
      ) {
        problems.push(
          `${partner} ${foot} foot ends with weight ${actual[partner][foot].weight}, expected ${target[partner][foot].weight}`,
        );
      }
    }
    for (const partner of ["lead", "follow"] as const) {
      if (
        angleOff(actual[partner].orientation, target[partner].orientation) >
        ANGLE_TOLERANCE
      ) {
        problems.push(
          `${partner} ends facing ${actual[partner].orientation}°, expected ${target[partner].orientation}°`,
        );
      }
    }
  } else {
    for (const [partner, foot] of feet) {
      const [x, y] = expected.feet[partner][foot === "left" ? "L" : "R"];
      const a = actual[partner][foot].position;
      if (Math.hypot(a.x - x, a.y - y) > POSITION_TOLERANCE) {
        problems.push(
          `${partner} ${foot} foot ends at ${fmt(a)}, expected ${fmt({ x, y })}`,
        );
      }
    }
    for (const partner of ["lead", "follow"] as const) {
      const facing = expected.facing?.[partner];
      if (
        facing !== undefined &&
        angleOff(actual[partner].orientation, facing) > ANGLE_TOLERANCE
      ) {
        problems.push(
          `${partner} ends facing ${actual[partner].orientation}°, expected ${normalizeDegrees(facing)}°`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new FigureError(
      `${name}: the steps don't end where expectEnd says:\n  ${problems.join("\n  ")}`,
    );
  }
}

/**
 * Turns a dancer-level description into the model's figure data. Throws
 * a FigureError naming the figure and step on any inconsistency.
 */
export function defineFigure(definition: FigureDefinition): AuthoredFigure {
  const { name } = definition;
  const timeSignature = parseTime(definition.time, name);
  const rows = definition.steps;
  if (rows.length === 0) throw new FigureError(`${name}: has no steps`);

  const usesBeat = rows.some((row) => row.beat !== undefined);
  const usesLength = rows.some((row) => row.length !== undefined);
  if (usesBeat && usesLength) {
    throw new FigureError(
      `${name}: use either \`beat\` or \`length\` for every step, not a mix`,
    );
  }
  rows.forEach((row, index) => {
    if (row.beat === undefined && row.length === undefined) {
      throw new FigureError(
        `${name}, step ${index + 1}: needs a \`beat\` or a \`length\``,
      );
    }
  });

  const startPose = stancePose(
    definition.start ?? "closed",
    inferStanding(rows, name),
  );
  const state: Record<Partner, PartnerState> = {
    lead: {
      position: {
        left: startPose.lead.left.position,
        right: startPose.lead.right.position,
      },
      weight: {
        left: startPose.lead.left.weight,
        right: startPose.lead.right.weight,
      },
      orientation: startPose.lead.orientation,
    },
    follow: {
      position: {
        left: startPose.follow.left.position,
        right: startPose.follow.right.position,
      },
      weight: {
        left: startPose.follow.left.weight,
        right: startPose.follow.right.weight,
      },
      orientation: startPose.follow.orientation,
    },
  };

  // Resolve every move in row order, tracking each partner's state so
  // later steps know which foot is free, where "close" lands, etc.
  const slow = definition.slow ?? 2;
  let clock = 0; // S/Q style: beats elapsed (0-based)
  let previousBeat = -Infinity;
  const resolved: {
    step: Omit<DanceStep, "id" | "beat" | "duration">;
    start: number; // 0-based beat
    length?: number;
  }[] = [];

  rows.forEach((row, index) => {
    const where = `${name}, step ${index + 1}`;
    let start: number;
    let length: number | undefined;
    if (row.length !== undefined) {
      start = clock;
      length = row.length === "S" ? slow : slow / 2;
      clock += length;
    } else {
      const beat = row.beat!;
      if (!(beat >= 1)) throw new FigureError(`${where}: beats count from 1`);
      if (beat < previousBeat) {
        throw new FigureError(`${where}: steps must be listed in beat order`);
      }
      previousBeat = beat;
      start = beat - 1;
    }

    let leadFoot: Foot | undefined;
    for (const { partner, move, label } of movesOfRow(row, where)) {
      let explicit: Foot | undefined = move.foot ? FOOT[move.foot] : undefined;
      if (row.both !== undefined && partner === "follow") {
        explicit = leadFoot ? OTHER[leadFoot] : undefined;
      }
      const foot = chooseFoot(
        move,
        state[partner],
        explicit,
        `${where} (${partner})`,
      );
      if (partner === "lead") leadFoot = foot;

      // With `both`, the follow travels in the lead's floor direction:
      // for a plain direction, convert the lead's absolute heading back
      // into her relative terms.
      let partnerMove = move;
      if (
        row.both !== undefined &&
        partner === "follow" &&
        (typeof move.go === "number" || move.go in DIRECTION_DEGREES)
      ) {
        const leadRelative =
          typeof move.go === "number"
            ? move.go
            : DIRECTION_DEGREES[move.go as keyof typeof DIRECTION_DEGREES];
        const absolute =
          state.lead.orientation - turnDegrees(move.turn) + leadRelative;
        partnerMove = {
          ...move,
          go: normalizeDegrees(absolute - state.follow.orientation),
        };
      }
      const step = applyMove(
        partner,
        partnerMove,
        foot,
        state[partner],
        label,
        `${where} (${partner})`,
      );
      if (partnerMove !== move && !label) {
        // Describe the follow's mirrored step in her own terms.
        step.label = defaultLabel(
          mirrorName(move.go),
          move.turn,
          move.air === true,
        );
      }
      resolved.push({ step, start, length });
    }
  });

  // Beat style: each step lasts until the same partner's next step, and
  // the last one until the end of its measure.
  const bpm = timeSignature.beatsPerMeasure;
  const steps: Omit<DanceStep, "id">[] = resolved.map((entry, index) => {
    let duration = entry.length;
    if (duration === undefined) {
      const next = resolved
        .slice(index + 1)
        .find(
          (other) =>
            other.step.partner === entry.step.partner &&
            other.start > entry.start,
        );
      duration = next
        ? next.start - entry.start
        : (Math.floor(entry.start / bpm) + 1) * bpm - entry.start;
    }
    return { ...entry.step, beat: entry.start + 1, duration };
  });

  // Two moves for the same partner starting at once is a contradiction.
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      if (
        resolved[i].step.partner === resolved[j].step.partner &&
        Math.abs(resolved[i].start - resolved[j].start) < 1e-9
      ) {
        throw new FigureError(
          `${name}: the ${resolved[i].step.partner} has two steps starting on beat ${resolved[i].start + 1}`,
        );
      }
    }
  }

  const figure: Figure = {
    id: "authored",
    name,
    style: definition.style,
    timeSignature,
    steps: steps.map((step, index) => ({ ...step, id: String(index + 1) })),
    startPose,
    endPose: startPose,
  };
  const endPose = poseAtBeat(figure, figureDurationBeats(figure));

  if (definition.expectEnd) {
    checkExpectedEnd(name, definition.expectEnd, endPose);
  }

  return {
    name,
    style: definition.style,
    timeSignature,
    startPose,
    endPose,
    steps,
  };
}

/** The follow's name for the direction of a mirrored step: the same
 *  floor direction, seen from facing the other way. */
function mirrorName(action: Action): Action {
  if (typeof action === "number") return normalizeDegrees(action + 180);
  if (action in DIRECTION_DEGREES) {
    const degrees = normalizeDegrees(
      DIRECTION_DEGREES[action as keyof typeof DIRECTION_DEGREES] + 180,
    );
    const name = Object.entries(DIRECTION_DEGREES).find(
      ([, value]) => value === degrees,
    )?.[0];
    return (name as Action | undefined) ?? degrees;
  }
  return action;
}

export { FigureError };
