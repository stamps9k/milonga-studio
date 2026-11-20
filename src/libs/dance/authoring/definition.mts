/**
 * The figure-file format as TypeScript types: what a figure definition
 * can say (rows, partner moves, options, stances to start in, expected
 * ends), the relative direction names, and FigureError. Shared by the
 * rest of the authoring modules; see ../authoring.mts for the overview.
 */

import type { Pose } from "../pose.mts";
import type {
  DanceStep,
  Partner,
  RiseTiming,
  TimeSignature,
} from "../step.mts";
import type { ShortFoot, StanceName } from "./stances.mts";

/** The curved foot paths a step can ask for (MoveOptions.path). */
export type CurvedPath = "around the front" | "around the back";
export const CURVED_PATHS: readonly CurvedPath[] = [
  "around the front",
  "around the back",
];

/** The checks a figure can skip (FigureDefinition.skipChecks). */
export type FootCheck =
  "crossed feet" | "own feet" | "partner spacing" | "hold";
export const FOOT_CHECKS: readonly FootCheck[] = [
  "crossed feet",
  "own feet",
  "partner spacing",
  "hold",
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

/** A turn, as a fraction of a full turn: `{ right: 1 / 8 }` is 45
 *  degrees clockwise (a natural turn), `{ left: 3 / 8 }` is 135 degrees
 *  anticlockwise (a reverse turn). */
export type Turn = { right: TurnAmount } | { left: TurnAmount };

/** A fraction of a full turn: a number (0.125) or a fraction written as
 *  text ("1/8"), which reads better in JSON figure files. */
export type TurnAmount = number | `${number}/${number}`;

/**
 * What a couple turns around on a turning `both` step (StepRow.turnCentre):
 * - "lead": the lead takes the step as written and the follow travels
 *   round him, keeping her place in the hold.
 * - "follow": she takes the mirror of the written step and he travels
 *   round her.
 * - "between": the point halfway between their moving feet takes the
 *   written step, and both travel round it, as in a pivot.
 *
 * Ballroom references agree that in an ordinary turn the partner going
 * backward is on the inside of the turn and travels less, while the one
 * going forward goes round them; only pivoting actions turn round a
 * point between the partners. So when a row leaves it out, the centre
 * is whoever the written step sends backward (defaultTurnCentre).
 * Owner's decision, 2026-11-17.
 */
export type TurnCentre = "lead" | "follow" | "between";
export const TURN_CENTRES: readonly TurnCentre[] = [
  "lead",
  "follow",
  "between",
];

/** Options that can be given for both partners on a row, or per
 *  partner. */
export interface MoveOptions {
  /** Which foot. Usually left out: the free foot (or, for "pivot", the
   *  standing foot) is used. Giving a foot that contradicts the weight
   *  is an error, not a silent correction. A partly loaded explicit foot
   *  may continue a phased transfer. With `both`, this is the
   *  lead's foot; the follow uses the other one. */
  foot?: ShortFoot;
  /** Distance travelled in metres. Required for a direction; not used
   *  for "close", "in place" or "pivot". */
  by?: number;
  turn?: Turn;
  /** How much further round than the body the moving foot points when
   *  it lands, measured from the body's facing after the step's turn:
   *  `{ "right": "1/8" }` points the toes an eighth clockwise of the
   *  body. A ballroom chart's "3/8 between 1 and 2, body turns less" is
   *  a step with `turn` 1/4 (the body) and `pointing` 1/8 right (the foot
   *  the rest of the way). Default: the foot points the way the body
   *  faces. The other foot holds its direction while the body turns
   *  towards it, and otherwise swivels with the body
   *  (swivelStandingFoot in fold.mts). Owner's request, 2026-11-17. */
  pointing?: Turn;
  /** Rise at the end of the step, in metres above normal standing
   *  height (waltz/foxtrot rise and fall). Default 0. */
  rise?: number;
  /** "late" when the rise holds and changes at the end of the step (a
   *  chart's "commence to rise at end of 1", "lower at end of 3");
   *  default "even", steadily across the step (see RiseTiming). */
  riseTiming?: RiseTiming;
  /** Pelvis offset from the weighted feet at this step's end, in metres
   * forward/right of this dancer's facing AFTER the turn. Default zero.
   * Independent of the foot mirror; each dancer uses their own frame. */
  bodyOffset?: { forward?: number; right?: number };
  /** The chart's footwork for the step: letters for the parts of the
   *  foot that meet the floor, in order (H heel, T toe, B ball, F flat):
   *  "HT", "T", "TH", "BF". The first letter decides how the foot lands
   *  (DanceStep.footwork). Default: none. */
  footwork?: string;
  /** false for no weight transfer, true (default) for full transfer,
   *  or an explicit end share from 0 to 1 for a phased action. A free-foot
   *  follow overlapping support leaves all weight changes to that support. */
  weight?: boolean | number;
  /** Explicit beats for this action; beat-timed rows only. A weightless
   * free-foot path may overlap the other foot's supporting action. */
  duration?: number;
  /** An airborne action (boleo, gancho, ...): the free leg goes out
   *  along the direction and back, carrying no weight. */
  air?: boolean;
  /** The foot travels on a curve instead of a straight line, landing
   *  exactly where the step says (see curveAround):
   *  - "around the front": it sets off the way the dancer faces before
   *    the step's turn, so on a turning step it swings round in front of
   *    the body instead of cutting across behind the standing foot.
   *    Owner's request (2026-11-16).
   *  - "around the back": it sets off diagonally back, towards the side
   *    it lands on, so it swings round behind the standing foot. For
   *    uncrossing feet that crossed with this foot behind: the foot
   *    stays behind the other leg instead of passing through it (the
   *    Open Natural Turn's count 2, owner's choice 2026-11-17). */
  path?: CurvedPath;
  /** Optional arc departure heading in degrees clockwise from this dancer
   * before the step. Overrides the preset; use for a compact passing route.
   * Authoring only: stored as the existing Movement.arc.setOff. */
  pathSetOff?: number;
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
export interface StepRow extends Omit<
  MoveOptions,
  "label" | "pointing" | "footwork" | "pathSetOff" | "path"
> {
  /** See MoveOptions.footwork. On a row, either one for each partner it
   *  applies to, or one each: a mirrored forward step is usually a heel
   *  lead for one partner and a toe lead for the other,
   *  `{ "lead": "HT", "follow": "TH" }`. */
  footwork?: string | { lead?: string; follow?: string };
  /** See MoveOptions.pointing. On a row, either one amount for each
   *  partner it applies to, or one each: `{ "follow": { "right": "1/8" } }`
   *  (on a turning `both` step the partners usually point differently:
   *  the one on the inside of the turn points further round). */
  pointing?: Turn | { lead?: Turn; follow?: Turn };
  /** Arc departure for each dancer, or one shared value (see MoveOptions).
   * Separate values keep mirrored turning steps compact on both sides. */
  pathSetOff?: number | { lead?: number; follow?: number };
  /** A curved route for both dancers, or only the named partners. An
   * omitted partner retains the ordinary straight/passing route. */
  path?: CurvedPath | { lead?: CurvedPath; follow?: CurvedPath };
  both?: Action;
  /** On a turning `both` step, what the couple turns around (see
   *  TurnCentre). Default: whoever the step sends backward. Only
   *  allowed with `both` and a `turn`. */
  turnCentre?: TurnCentre;
  /** Explicit opposite-facing, side-by-side formation at this row's end.
   * The follow is nominally 35 cm to the lead's right and 10 cm in front,
   * so the backward-travelling lead is slightly ahead along shared travel.
   * Descriptive authoring label, not a new persisted stance or a check bypass.
   * Omission retains the ordinary closed/promenade checks on every other row. */
  hold?: "opposed promenade";
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
   *  "crossed feet" and "partner spacing" (see checkFeet), and "hold"
   *  (see checkHold). */
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

export const DIRECTION_DEGREES: Record<
  Exclude<RelativeDirection, number>,
  number
> = {
  forward: 0,
  "diagonal forward right": 45,
  "side right": 90,
  "diagonal back right": 135,
  back: 180,
  "diagonal back left": 225,
  "side left": 270,
  "diagonal forward left": 315,
};

export class FigureError extends Error {}
