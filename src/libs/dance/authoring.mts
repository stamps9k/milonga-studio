import { applyTransform } from "./floor.mts";
import { figureDurationBeats, poseAtBeat } from "./fold.mts";
import {
  RAD_TO_DEG,
  addPoints,
  headingToUnitVector,
  normalizeDegrees,
  rotatePoint,
  scalePoint,
  subPoints,
} from "./heading.mts";
import type { Pose, Point2D } from "./pose.mts";
import type {
  DanceStep,
  Figure,
  Foot,
  Movement,
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
 * the figure doesn't end where `expectEnd` says it should (or last as
 * many beats as `expectBeats` says). The seed
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

/**
 * Named positions a figure can start or end in (`start`, and
 * `expectEnd.stance`):
 * - "closed": closed hold. The midpoint of the lead's feet is at the
 *   origin, the lead faces line of dance (0) and the follow faces him
 *   (180), PARTNER_DISTANCE in front.
 * - "crossed promenade": the position a whisk ends in. Each partner has
 *   opened an eighth from closed hold (the lead to his left, the follow
 *   to her right) into a V that opens to the lead's left, and has the
 *   crossing foot (the lead's left, the follow's right) behind the
 *   other one. See crossedPromenadePose for the exact geometry. Named
 *   "crossed" so plain "promenade" stays free for a feet-apart version
 *   (tango's promenade starts differently; owner's decision,
 *   2026-11-16).
 * - "promenade apart": the same V, but with the feet apart, where the
 *   Promenade Chassé ends: each partner's leading foot (the lead's left,
 *   the follow's right) has gone PROMENADE_SIDE_STEP along the line of
 *   travel past where the trailing foot closed. See
 *   promenadeApartPose. Named by the owner (2026-11-16).
 * - "tango promenade": the ballroom tango promenade, where the owner's
 *   Progressive Link ends and the Closed Promenade starts. The same V
 *   and frame as the waltz promenades, with the feet apart and
 *   uncrossed: each partner stands on the inside foot (the lead's right,
 *   the follow's left) with the outside foot TANGO_PROMENADE_WIDTH out
 *   along the line of travel. See tangoPromenadePose.
 */
export type StanceName =
  "closed" | "crossed promenade" | "promenade apart" | "tango promenade";

/** In "crossed promenade", how far the crossing foot is behind the
 *  other foot, and how far across it, in metres, measured in the
 *  opened facing. Provisional: from the owner's description of the
 *  whisk ("toe just behind the right heel"), not technique. */
export const CROSS_BEHIND = 0.25;
export const CROSS_ACROSS = 0.05;

/** In "promenade apart", how far the leading foot is past the trailing
 *  foot along the line of travel, in metres: the chassé's side step.
 *  Provisional: the owner's agreed side-step size for the waltz
 *  figures, not technique. */
export const PROMENADE_SIDE_STEP = 0.4;

/** In "promenade apart", how far apart the feet are across the dancer's
 *  facing: the chassé closes to 0.1 rather than STANCE_WIDTH so the
 *  partners' inner feet stay PARTNER_FOOT_CLEARANCE apart. */
export const PROMENADE_CLOSE_WIDTH = 0.1;

/** In "promenade apart", how far each partner has moved out from the
 *  lines they started the chassé on (away from the other), in metres:
 *  the chassé's count 2 lands each leading foot this much wider, which
 *  makes room for the Open Natural Turn's first stride (owner's request,
 *  2026-11-16). The chassé writes it as 0.05 forward and 0.05 outward
 *  in each dancer's opened facing, 0.05 * sqrt 2 across the line. */
export const PROMENADE_SEPARATION = 0.05 * Math.SQRT2;

/** In "tango promenade", how far each partner's outside foot is along
 *  the line of travel from the inside foot, in metres. Provisional: the
 *  owner's link steps wide, landing level with the other foot 0.4 out
 *  from where it was, from a closed stance 0.2 wide (2026-11-17). */
export const TANGO_PROMENADE_WIDTH = 0.6;

export const STANCE_NAMES: readonly StanceName[] = [
  "closed",
  "crossed promenade",
  "promenade apart",
  "tango promenade",
];

type ShortFoot = "L" | "R";

const FOOT: Record<ShortFoot, Foot> = { L: "left", R: "right" };
const OTHER: Record<Foot, Foot> = { left: "right", right: "left" };

/** Feet positions of a named stance, with each partner standing on the
 *  given foot. */
export function stancePose(
  stance: StanceName,
  standing: Record<Partner, Foot>,
): Pose {
  const half = STANCE_WIDTH / 2;
  const weight = (partner: Partner, foot: Foot) =>
    standing[partner] === foot ? 1 : 0;
  switch (stance) {
    case "crossed promenade":
      return crossedPromenadePose(weight);
    case "promenade apart":
      return promenadeApartPose(weight);
    case "tango promenade":
      return tangoPromenadePose(weight);
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

/**
 * "crossed promenade", in the frame of the closed hold the couple opened
 * from: the lead's right foot (the one he doesn't cross) is at the
 * origin, and before opening he faced 0 with the follow facing him.
 * Measuring from his right foot keeps a figure's `moved` readable: for a
 * whisk it's simply where that foot went.
 *
 * - Lead: right foot at (0, 0); faces 315 (opened an eighth to his
 *   left); left foot CROSS_BEHIND behind the right and CROSS_ACROSS to
 *   its right, in that opened facing.
 * - Follow: left foot PARTNER_DISTANCE in front of the lead's right
 *   foot, at (0, 0.4), where it was in hold; faces 225 (opened an eighth
 *   to her right); right foot CROSS_BEHIND behind her left and
 *   CROSS_ACROSS to its left (the mirror image).
 *
 * The weights come from `weight`, normally on the crossed feet, which
 * is how a whisk ends.
 */
function crossedPromenadePose(
  weight: (partner: Partner, foot: Foot) => number,
): Pose {
  const crossed = (standingFoot: Point2D, facing: number, across: number) =>
    addPoints(
      addPoints(
        standingFoot,
        scalePoint(headingToUnitVector(facing), -CROSS_BEHIND),
      ),
      scalePoint(headingToUnitVector(facing + 90), across),
    );
  const leadRight = { x: 0, y: 0 };
  const followLeft = { x: 0, y: PARTNER_DISTANCE };
  return {
    lead: {
      left: {
        position: crossed(leadRight, 315, CROSS_ACROSS),
        weight: weight("lead", "left"),
      },
      right: { position: leadRight, weight: weight("lead", "right") },
      orientation: 315,
      rise: 0,
    },
    follow: {
      left: { position: followLeft, weight: weight("follow", "left") },
      right: {
        // Across to her left: the mirror of the lead's cross.
        position: crossed(followLeft, 225, -CROSS_ACROSS),
        weight: weight("follow", "right"),
      },
      orientation: 225,
      rise: 0,
    },
  };
}

/**
 * "promenade apart", in the same frame as "crossed promenade" (the
 * closed hold the couple opened from, so the lead faces 315 and the
 * follow 225, and the line of travel is towards -x), but measured from
 * the lead's left foot, the one he stands on:
 *
 * - Lead: left foot at (0, 0). His right foot is where it closed in the
 *   chassé: PROMENADE_SIDE_STEP back along the line of travel, then
 *   PROMENADE_CLOSE_WIDTH to his right across his opened facing.
 * - Follow: right foot at (0, 0.4), PARTNER_DISTANCE from the lead's left
 *   across the line of travel. Her left foot is the mirror image:
 *   PROMENADE_SIDE_STEP back along the line, then PROMENADE_CLOSE_WIDTH
 *   to her left.
 *
 * The weights come from `weight`, normally on the leading feet (the
 * lead's left, the follow's right).
 */
function promenadeApartPose(
  weight: (partner: Partner, foot: Foot) => number,
): Pose {
  // Back along the line of travel (-x) is +x.
  const back = { x: PROMENADE_SIDE_STEP, y: 0 };
  const trailing = (leading: Point2D, facing: number, side: 90 | -90) =>
    addPoints(
      addPoints(leading, back),
      scalePoint(headingToUnitVector(facing + side), PROMENADE_CLOSE_WIDTH),
    );
  const leadLeft = { x: 0, y: 0 };
  const followRight = { x: 0, y: PARTNER_DISTANCE + 2 * PROMENADE_SEPARATION };
  return {
    lead: {
      left: { position: leadLeft, weight: weight("lead", "left") },
      right: {
        position: trailing(leadLeft, 315, 90),
        weight: weight("lead", "right"),
      },
      orientation: 315,
      rise: 0,
    },
    follow: {
      left: {
        position: trailing(followRight, 225, -90),
        weight: weight("follow", "left"),
      },
      right: { position: followRight, weight: weight("follow", "right") },
      orientation: 225,
      rise: 0,
    },
  };
}

/**
 * "tango promenade", in the same frame as the waltz promenades (the
 * lead faces 315 and the follow 225, and the line of travel runs
 * towards -x), measured from the lead's right foot, the one he stands
 * on:
 *
 * - Lead: right foot at (0, 0); left foot TANGO_PROMENADE_WIDTH along
 *   the line of travel, at (-0.6, 0).
 * - Follow: left foot PARTNER_DISTANCE across the line, at (0, 0.4),
 *   where it was in closed hold; right foot TANGO_PROMENADE_WIDTH along
 *   the line, at (-0.6, 0.4).
 *
 * Unlike "promenade apart", the outside feet are level with each other
 * along the line (as the owner's link leaves them) and the partners
 * keep closed hold's distance. The weights come from `weight`, normally
 * on the inside feet.
 */
function tangoPromenadePose(
  weight: (partner: Partner, foot: Foot) => number,
): Pose {
  const out = { x: -TANGO_PROMENADE_WIDTH, y: 0 };
  const leadRight = { x: 0, y: 0 };
  const followLeft = { x: 0, y: PARTNER_DISTANCE };
  return {
    lead: {
      left: {
        position: addPoints(leadRight, out),
        weight: weight("lead", "left"),
      },
      right: { position: leadRight, weight: weight("lead", "right") },
      orientation: 315,
      rise: 0,
    },
    follow: {
      left: { position: followLeft, weight: weight("follow", "left") },
      right: {
        position: addPoints(followLeft, out),
        weight: weight("follow", "right"),
      },
      orientation: 225,
      rise: 0,
    },
  };
}

/** The checks a figure can skip (FigureDefinition.skipChecks). */
export type FootCheck = "crossed feet" | "partner spacing";
export const FOOT_CHECKS: readonly FootCheck[] = [
  "crossed feet",
  "partner spacing",
];

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
 * - "pivot": turn on the standing foot without moving it (needs `turn`);
 * - an Offset: travel this far forward and this far right, taking
 *   weight (no `by`: the distance comes from the offset).
 */
export type Action =
  RelativeDirection | "close" | "in place" | "pivot" | Offset;

/**
 * Where the moving foot goes, as metres forward and metres to the right
 * of where it is now (negative for back and left), measured from the
 * dancer's facing before the step's turn, like the other directions.
 * `{ "forward": 0.9, "right": 0.2 }` is the same step as a direction of
 * about 12.53 degrees and `by` of about 0.922, but reads as the move a
 * dancer has in mind and avoids long decimals. Either part may be left
 * out (it is then 0), but not both.
 */
export interface Offset {
  forward?: number;
  right?: number;
}

/** An action other than an offset: what a move holds once any offset
 *  has been turned into a direction and distance (resolveOffset). */
type PlainAction = Exclude<Action, Offset>;

/** A partner's move once any offset has been resolved. */
type PlainMove = Omit<PartnerMove, "go"> & { go: PlainAction };

function isOffset(action: unknown): action is Offset {
  return typeof action === "object" && action !== null;
}

/** An offset as a direction and distance, the form the rest of
 *  defineFigure works with. Compass convention: 0 is forward, 90 is
 *  right. */
function offsetMove(
  offset: Offset,
  move: MoveOptions,
  where: string,
): { go: number; by: number } {
  if (move.by !== undefined) {
    throw new FigureError(
      `${where}: a step written as { forward, right } finds its own distance, so it doesn't take \`by\``,
    );
  }
  const forward = offset.forward ?? 0;
  const right = offset.right ?? 0;
  const by = Math.hypot(forward, right);
  if (by < 1e-12) {
    throw new FigureError(
      `${where}: { forward, right } doesn't move the foot; use "in place" for a weight change`,
    );
  }
  return {
    go: normalizeDegrees(Math.atan2(right, forward) * RAD_TO_DEG),
    by,
  };
}

/** The move with any offset turned into a direction and `by`. */
function resolveOffset(move: PartnerMove, where: string): PlainMove {
  return isOffset(move.go)
    ? { ...move, ...offsetMove(move.go, move, where) }
    : { ...move, go: move.go };
}

/** "0.9 forward, 0.2 right", for default labels. */
function describeOffset(offset: Offset): string {
  const metres = (value: number) => Number(Math.abs(value).toFixed(3));
  const parts: string[] = [];
  const forward = offset.forward ?? 0;
  const right = offset.right ?? 0;
  if (forward !== 0) {
    parts.push(`${metres(forward)} ${forward > 0 ? "forward" : "back"}`);
  }
  if (right !== 0) {
    parts.push(`${metres(right)} ${right > 0 ? "right" : "left"}`);
  }
  return parts.join(", ");
}

/** A turn, as a fraction of a full turn: `{ right: 1 / 8 }` is 45
 *  degrees clockwise (a natural turn), `{ left: 3 / 8 }` is 135 degrees
 *  anticlockwise (a reverse turn). */
export type Turn = { right: TurnAmount } | { left: TurnAmount };

/** A fraction of a full turn: a number (0.125) or a fraction written as
 *  text ("1/8"), which reads better in JSON figure files. */
export type TurnAmount = number | `${number}/${number}`;

/** The size of a turn amount as a fraction of a full turn. Assumes the
 *  amount has been validated (see parseFigureDefinition). */
function turnFraction(amount: TurnAmount): number {
  if (typeof amount === "number") return amount;
  const [numerator, denominator] = amount.split("/").map(Number);
  return numerator / denominator;
}

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
  /** "around the front": the foot travels on a curve instead of a
   *  straight line. It sets off the way the dancer faces before the
   *  step's turn and curves round to land exactly where the step says,
   *  so on a turning step it swings round in front of the body instead
   *  of cutting across behind the standing foot. Owner's request
   *  (2026-11-16), for the Open Natural Turn. */
  path?: "around the front";
  /** true when this step crosses the feet on purpose (a whisk's cross
   *  behind). Without it, defineFigure refuses a step that puts the left
   *  foot to the right of the right foot (see checkFeet). */
  cross?: boolean;
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
  /** Path to db/figure.schema.json, for editor support. Ignored. */
  $schema?: string;
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
  /** How many beats the figure should last. Checked against the length
   *  worked out from the steps (figureDurationBeats), as an independent
   *  check on the timing, the way expectEnd checks the end position. */
  expectBeats?: number;
  /** Checks to leave out for this figure, for figures known to be wrong
   *  that are kept until they're rewritten (say why in `notes`):
   *  "crossed feet" and "partner spacing" (see checkFeet). */
  skipChecks?: FootCheck[];
  /** Free text for whoever reads or edits the figure file: sources,
   *  caveats, open questions. Not stored in the database. */
  notes?: string;
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
  return "right" in turn
    ? turnFraction(turn.right) * 360
    : -turnFraction(turn.left) * 360;
}

function describeTurn(turn: Turn): string {
  const [direction, amount] =
    "right" in turn
      ? ["right", turnFraction(turn.right)]
      : ["left", turnFraction(turn.left)];
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
  const base = isOffset(action)
    ? describeOffset(action)
    : typeof action === "number"
      ? `${action}° from forward`
      : action;
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
  move: PlainMove;
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
    path: row.path,
    cross: row.cross,
  };
  const labelFor = (partner: Partner) =>
    typeof row.label === "string" ? row.label : row.label?.[partner];

  if (row.both !== undefined) {
    if (row.lead !== undefined || row.follow !== undefined) {
      throw new FigureError(
        `${where}: use either \`both\` or \`lead\`/\`follow\`, not both`,
      );
    }
    const lead = resolveOffset({ ...shared, go: row.both }, where);
    let leadLabel = labelFor("lead") ?? "";
    let followLabel = labelFor("follow") ?? "";
    if (isOffset(row.both)) {
      // Label from the offset as written, before it becomes degrees.
      // The follow's mirror of it is the same offset reversed: his
      // forward is her back, his right her left.
      const air = row.air === true;
      leadLabel ||= defaultLabel(row.both, row.turn, air);
      followLabel ||= defaultLabel(
        {
          forward: -(row.both.forward ?? 0),
          right: -(row.both.right ?? 0),
        },
        row.turn,
        air,
      );
    }
    // The follow mirrors the lead: the other foot and the same turn.
    // Her foot and her travel are filled in once the lead's step is
    // known: see defineFigure, which keeps her placed relative to him
    // so that the couple turns together.
    const follow: PlainMove = { ...lead, foot: undefined };
    return [
      { partner: "lead", move: lead, label: leadLabel },
      { partner: "follow", move: follow, label: followLabel },
    ];
  }

  const moves: ResolvedMove[] = [];
  for (const partner of ["lead", "follow"] as const) {
    const value = row[partner];
    if (value === undefined) continue;
    // An object with `go` is this partner's own move and options; any
    // other object is an offset, used like a plain action.
    const written: PartnerMove =
      typeof value === "object" && "go" in value
        ? value
        : { ...shared, go: value };
    let label = written.label ?? labelFor(partner) ?? "";
    if (isOffset(written.go)) {
      // Label from the offset as written, before it becomes degrees.
      label ||= defaultLabel(written.go, written.turn, written.air === true);
    }
    moves.push({ partner, move: resolveOffset(written, where), label });
  }
  if (moves.length === 0) {
    throw new FigureError(`${where}: needs \`both\`, \`lead\` or \`follow\``);
  }
  return moves;
}

/** The foot a move uses, and whether it's travelling (needs the free
 *  foot) or a pivot (needs the standing foot). */
function chooseFoot(
  move: PlainMove,
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
  move: PlainMove,
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
    // Beside the standing foot, across the dancer's facing after the
    // turn: a left foot closes to the standing foot's left (facing - 90),
    // a right foot to its right (facing + 90). The feet end STANCE_WIDTH
    // apart, centre to centre, unless `by` gives the gap: in promenade a
    // close is narrower (0.1), or the closing foot would reach towards
    // the partner's feet.
    const standingFoot = OTHER[foot];
    const side = headingToUnitVector(after + (foot === "left" ? -90 : 90));
    const target = addPoints(
      state.position[standingFoot],
      scalePoint(side, move.by ?? STANCE_WIDTH),
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

  let movement: Movement = { type: "straight", direction, distance };
  if (move.path === "around the front") {
    if (air || distance === 0) {
      throw new FigureError(
        `${where}: "path" needs a step that travels along the floor`,
      );
    }
    movement = curveAroundTheFront(before, direction, distance, where);
  }

  if (!air && distance > 0) {
    // The curve, if there is one, ends at the same spot as the straight
    // step would (see curveAroundTheFront).
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
    movement,
    contact: air ? "air" : "floor",
    // A pivot keeps the weight on the pivoting foot.
    weight: takesWeight || move.go === "pivot" ? 1 : 0,
    // A close brings the foot in first and changes weight once it's
    // there (agreed with the owner for every dance, 2026-11-16; other
    // steps keep the even transfer until a figure needs otherwise).
    ...(takesWeight && move.go === "close"
      ? { weightTiming: "late" as const }
      : {}),
    orientation: after,
    rise: move.rise ?? 0,
    label: label || defaultLabel(move.go, move.turn, air),
  };
}

/** How far (metres) the left foot may stray to the right of the right
 *  foot, across the dancer's facing, before the feet count as crossed. */
const CROSSED_FEET_TOLERANCE = 0.02;

/** The closest a lead's foot and a follow's foot may come, centre to
 *  centre, in metres: a foot is about 9 cm wide (figureShapes.mts), so
 *  this leaves a few centimetres between them. Provisional (owner's
 *  agreement, 2026-11-16). */
export const PARTNER_FOOT_CLEARANCE = 0.15;

/** How finely checkFeet samples a figure, in beats. */
const FOOT_CHECK_STEP = 1 / 16;

/**
 * Two checks on the whole of a figure's movement, not just its end,
 * sampled every FOOT_CHECK_STEP beats and at every step's end:
 *
 * - Crossed feet: in each dancer's own frame, the left foot stays to the
 *   left of the right foot (owner's rule, 2026-11-16). Crossing is only
 *   allowed during a step marked `cross: true` and afterwards until the
 *   feet uncross, or from the start of a figure that starts crossed
 *   ("crossed promenade") until they first uncross.
 * - Partner spacing: no lead foot comes within PARTNER_FOOT_CLEARANCE of
 *   a follow foot, centre to centre, so neither steps on the other.
 *
 * Steps index `marks` in the figure's step order (the order defineFigure
 * produced them in).
 */
function checkFeet(
  name: string,
  figure: Figure,
  marks: { cross: boolean; where: string }[],
  startsCrossed: boolean,
  skip: Set<FootCheck>,
): void {
  const duration = figureDurationBeats(figure);
  const beats = new Set<number>();
  for (let beat = 0; beat <= duration + 1e-9; beat += FOOT_CHECK_STEP) {
    beats.add(Math.min(beat, duration));
  }
  for (const step of figure.steps) beats.add(step.beat - 1 + step.duration);
  const ordered = [...beats].sort((a, b) => a - b);

  const allowed: Record<Partner, boolean> = {
    lead: startsCrossed,
    follow: startsCrossed,
  };
  for (const beat of ordered) {
    const pose = poseAtBeat(figure, beat);
    for (const partner of ["lead", "follow"] as const) {
      // This partner's step under way at `beat` (or just finished).
      const current = figure.steps.findIndex(
        (step) =>
          step.partner === partner &&
          step.beat - 1 <= beat + 1e-9 &&
          beat <= step.beat - 1 + step.duration + 1e-9,
      );
      const crossing = current >= 0 && marks[current].cross;
      if (crossing) allowed[partner] = true;

      const { left, right, orientation } = pose[partner];
      const across = subPoints(left.position, right.position);
      const toTheRight =
        across.x * headingToUnitVector(orientation + 90).x +
        across.y * headingToUnitVector(orientation + 90).y;
      if (toTheRight <= CROSSED_FEET_TOLERANCE) {
        if (!crossing) allowed[partner] = false;
      } else if (!allowed[partner] && !skip.has("crossed feet")) {
        const where = current >= 0 ? ` (${marks[current].where})` : "";
        throw new FigureError(
          `${name}: at beat ${Number((beat + 1).toFixed(3))}${where} the ${partner}'s left foot is ${toTheRight.toFixed(2)} to the right of the right foot, so the feet are crossed. If that's meant, add "cross": true to the step that crosses them`,
        );
      }
    }

    if (skip.has("partner spacing")) continue;
    for (const leadFoot of ["left", "right"] as const) {
      for (const followFoot of ["left", "right"] as const) {
        const gap = subPoints(
          pose.lead[leadFoot].position,
          pose.follow[followFoot].position,
        );
        const distance = Math.hypot(gap.x, gap.y);
        if (distance < PARTNER_FOOT_CLEARANCE - 1e-9) {
          throw new FigureError(
            `${name}: at beat ${Number((beat + 1).toFixed(3))} the lead's ${leadFoot} foot and the follow's ${followFoot} foot are ${distance.toFixed(2)} apart, centre to centre (at least ${PARTNER_FOOT_CLEARANCE} needed), so one would tread on the other`,
          );
        }
      }
    }
  }
}

/** How far a curve "around the front" may turn away from the dancer's
 *  facing to reach its landing spot. Beyond this the foot would swing
 *  round behind the body, which isn't "around the front". */
const MAX_CURVE_DEGREES = 120;

/**
 * The circular arc for a step with `path: "around the front"`.
 *
 * The model draws an arc from where the foot is, setting off along the
 * dancer's facing before the step (arcEndpoint in fold.mts), bending
 * with a constant curvature. There is exactly one such arc through the
 * landing spot: if the landing spot is `theta` degrees round from the
 * facing (clockwise positive) and `chord` metres away, the arc turns
 * through 2 * theta, so
 *   curvature = 2 sin(theta) / chord   (positive curves right)
 *   arcLength = chord * theta / sin(theta)   (theta in radians).
 * Setting off forward means the foot passes in front of the body before
 * it curves to land, which is what the owner described for the left
 * foot on count 2 of the Open Natural Turn.
 */
function curveAroundTheFront(
  facing: number,
  direction: number,
  chord: number,
  where: string,
): Movement {
  const theta = normalizeDegrees(direction - facing + 180) - 180;
  if (Math.abs(theta) < 1e-9) {
    // The landing spot is straight ahead: the curve is a straight line.
    return { type: "straight", direction, distance: chord };
  }
  if (Math.abs(theta) > MAX_CURVE_DEGREES) {
    throw new FigureError(
      `${where}: "around the front" can't reach a spot ${Math.round(Math.abs(theta))}° round from the way the dancer faces (at most ${MAX_CURVE_DEGREES}°)`,
    );
  }
  const radians = theta / RAD_TO_DEG;
  return {
    type: "arc",
    curvature: (2 * Math.sin(radians)) / chord,
    arcLength: (chord * radians) / Math.sin(radians),
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
/** Who stands on which foot before a stance's first step, when the step
 *  doesn't say: in closed hold the lead is on his right (stepping off
 *  the left) and the follow on her left; in crossed promenade each is
 *  on the crossed foot, which is how a whisk ends. */
const DEFAULT_STANDING: Record<StanceName, Record<Partner, Foot>> = {
  closed: { lead: "right", follow: "left" },
  "crossed promenade": { lead: "left", follow: "right" },
  "promenade apart": { lead: "left", follow: "right" },
  "tango promenade": { lead: "right", follow: "left" },
};

function inferStanding(
  rows: StepRow[],
  name: string,
  stance: StanceName,
): Record<Partner, Foot> {
  const defaults = DEFAULT_STANDING[stance];
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
        // Nothing to infer from: the stance's usual starting weight.
        standing[partner] = defaults[partner];
      } else {
        standing[partner] = move.go === "pivot" ? foot : OTHER[foot];
      }
    }
    if (standing.lead && standing.follow) break;
  }
  return {
    lead: standing.lead ?? defaults.lead,
    follow: standing.follow ?? defaults.follow,
  };
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

  const start = definition.start ?? "closed";
  const startPose = stancePose(start, inferStanding(rows, name, start));
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
    /** For checkFeet: whether the step crosses the feet on purpose, and
     *  which row it came from ("step 2"). */
    cross: boolean;
    where: string;
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

    if (
      row.both !== undefined &&
      row.turn !== undefined &&
      turnDegrees(row.turn) !== 0 &&
      (row.both === "close" || row.both === "in place" || row.both === "pivot")
    ) {
      // On these steps each partner turns over their own standing foot,
      // which doesn't move, so the two can't swing round each other and
      // closed hold would silently come apart (the follow would end up
      // beside the lead instead of in front of him). Turning on a
      // standing foot while the couple rotates round a shared centre
      // isn't modelled yet.
      throw new FigureError(
        `${where}: with \`both\`, a turn can't go on "${row.both}": each partner would turn on their own standing foot and the hold would come apart. Put the turn on a travelling step, or write \`lead\` and \`follow\` separately`,
      );
    }

    let leadFoot: Foot | undefined;
    // Where the lead's moving foot was and where it lands on this row,
    // for mirroring a turning step (see below).
    let leadFrom: Point2D | undefined;
    let leadTo: Point2D | undefined;
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

      // With `both`, the follow's travelling step is worked out from the
      // lead's, so that she keeps the same position relative to him.
      //
      // Her moving foot starts at some offset from his moving foot (in
      // closed hold, 40 cm along his facing). The step turns the couple
      // by the step's turn, so that offset turns with it: her foot lands
      // at his foot's landing point plus the offset rotated by the turn.
      //
      // Without a turn this is the plain mirror: the same floor
      // direction and distance as the lead. With a turn the partners
      // swing round each other and their steps differ: whoever is on the
      // outside of the turn travels further. (Previously she took the
      // lead's floor direction and distance and turned on the spot,
      // which left her beside him rather than in front after a turn.)
      //
      // Airborne steps don't place a foot, so they keep the plain
      // mirror: the same floor direction as the lead.
      let partnerMove = move;
      const travels =
        typeof move.go === "number" || move.go in DIRECTION_DEGREES;
      if (row.both !== undefined && partner === "follow" && travels) {
        if (move.air !== true && leadFrom && leadTo) {
          const offset = subPoints(state.follow.position[foot], leadFrom);
          const target = addPoints(
            leadTo,
            rotatePoint(offset, turnDegrees(move.turn)),
          );
          const delta = subPoints(target, state.follow.position[foot]);
          const distance = Math.hypot(delta.x, delta.y);
          // Compass heading of the delta (0 = +y, clockwise), relative
          // to her facing before the turn, as `go` expects.
          partnerMove =
            distance < 1e-12
              ? { ...move, go: "in place", by: undefined }
              : {
                  ...move,
                  go: normalizeDegrees(
                    Math.atan2(delta.x, delta.y) * RAD_TO_DEG -
                      state.follow.orientation,
                  ),
                  by: distance,
                };
        } else {
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
      }
      if (partner === "lead") leadFrom = state.lead.position[foot];
      const step = applyMove(
        partner,
        partnerMove,
        foot,
        state[partner],
        label,
        `${where} (${partner})`,
      );
      if (partner === "lead") leadTo = state.lead.position[foot];
      if (partnerMove !== move && !label) {
        // Describe the follow's mirrored step in her own terms.
        step.label = defaultLabel(
          mirrorName(move.go),
          move.turn,
          move.air === true,
        );
      }
      resolved.push({
        step,
        start,
        length,
        cross: partnerMove.cross === true,
        where: `step ${index + 1}`,
      });
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

  checkFeet(
    name,
    figure,
    resolved.map(({ cross, where }) => ({ cross, where })),
    start === "crossed promenade",
    new Set(definition.skipChecks ?? []),
  );

  if (definition.expectEnd) {
    checkExpectedEnd(name, definition.expectEnd, endPose);
  }
  if (definition.expectBeats !== undefined) {
    const beats = figureDurationBeats(figure);
    if (Math.abs(beats - definition.expectBeats) > 1e-9) {
      throw new FigureError(
        `${name}: the steps last ${beats} beats, but expectBeats says ${definition.expectBeats}`,
      );
    }
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
function mirrorName(action: PlainAction): PlainAction {
  if (typeof action === "number") return normalizeDegrees(action + 180);
  if (action in DIRECTION_DEGREES) {
    const degrees = normalizeDegrees(
      DIRECTION_DEGREES[action as keyof typeof DIRECTION_DEGREES] + 180,
    );
    const name = Object.entries(DIRECTION_DEGREES).find(
      ([, value]) => value === degrees,
    )?.[0];
    return (name as PlainAction | undefined) ?? degrees;
  }
  return action;
}

export { FigureError };

// ---------------------------------------------------------------------
// Validating figure files
// ---------------------------------------------------------------------

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
    "rise",
    "weight",
    "air",
    "path",
    "cross",
  ] as const;
  function checkMoveOptions(path: string, object: Record<string, unknown>) {
    checkOneOf(`${path}foot`, object.foot, ["L", "R"]);
    checkNumber(`${path}by`, object.by, { positive: true });
    checkTurn(`${path}turn`, object.turn);
    checkNumber(`${path}rise`, object.rise);
    checkBoolean(`${path}weight`, object.weight);
    checkBoolean(`${path}air`, object.air);
    checkOneOf(`${path}path`, object.path, ["around the front"]);
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
        "lead",
        "follow",
        "beat",
        "length",
        "label",
        ...MOVE_OPTIONS,
      ]);
      if (row.both !== undefined) checkAction(`${path}.both`, row.both);
      checkPartner(`${path}.lead`, row.lead);
      checkPartner(`${path}.follow`, row.follow);
      checkMoveOptions(`${path}.`, row);
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
