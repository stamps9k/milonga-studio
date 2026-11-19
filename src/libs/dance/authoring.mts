import { applyTransform } from "./floor.mts";
import {
  FOOTPRINT_LENGTH,
  FOOTPRINT_WIDTH,
  figureDurationBeats,
  footprintGap,
  poseAtBeat,
} from "./fold.mts";
import { bodyPosition } from "./weight.mts";
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  addPoints,
  angleBetweenDegrees,
  headingToUnitVector,
  normalizeDegrees,
  rotatePoint,
  scalePoint,
  subPoints,
} from "./heading.mts";
import { footHeading } from "./pose.mts";
import type { Pose, Point2D } from "./pose.mts";
import type {
  DanceStep,
  Figure,
  Foot,
  Movement,
  Partner,
  RiseTiming,
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
 * - the follow's step when you write `both` (the mirror of the lead's),
 *   and on a turning step both partners' steps round the turning centre;
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
 *  closed hold. Provisional. */
export const PARTNER_DISTANCE = 0.4;

/**
 * How far the follow stands to the lead's right in closed hold, in
 * metres, measured across his facing between the centres of the two
 * partners' feet. Standard closed hold is offset, each partner a little
 * to the other's right, and "never toes to toes": when the lead walks
 * forward his right foot goes between her feet (owner's request,
 * 2026-11-17; Smooth and Standard references put it at up to half a
 * body width).
 *
 * Half the stance width is exactly the shift that puts the lead's right
 * foot in line with the gap between her feet, so that's the value used.
 * Provisional: tango's offset is larger in real technique, but the
 * model has no style-specific stances, so every dance uses this one.
 *
 * The promenade stances keep the same offset in the closed frame they
 * opened from. Because their line of travel runs towards -x, the
 * follow's +x shift puts her slightly behind the lead along the line,
 * as in real promenade (the V's point at his right hip and her left).
 */
export const HOLD_OFFSET = STANCE_WIDTH / 2;

/**
 * Named positions a figure can start or end in (`start`, and
 * `expectEnd.stance`):
 * - "closed": closed hold. The midpoint of the lead's feet is at the
 *   origin, the lead faces line of dance (0) and the follow faces him
 *   (180), PARTNER_DISTANCE in front and HOLD_OFFSET to his right.
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
 * - "contra check": the compact checked position in the original closed
 *   frame, lead LF / follow RF weighted, with 15° left contra rotation and
 *   3 cm lowering. See CONTRA_CHECK_* for provisional dimensions.
 */
export type StanceName =
  | "closed"
  | "crossed promenade"
  | "promenade apart"
  | "tango promenade"
  | "contra check";

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

/** Provisional compact contra-check connection, in metres/degrees. These
 * define the checked pose shared by the check and its separate recovery;
 * they do not alter ordinary closed hold or any existing figure. */
export const CONTRA_CHECK_ADVANCE = 0.4;
export const CONTRA_CHECK_INWARD = 0.14;
export const CONTRA_CHECK_TURN = 15;
export const CONTRA_CHECK_LOWERING = 0.03;

export const STANCE_NAMES: readonly StanceName[] = [
  "closed",
  "crossed promenade",
  "promenade apart",
  "tango promenade",
  "contra check",
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
    case "contra check":
      // Provisional compact CBMP check, not a syllabus depth prescription.
      // Feet retain their forward/back line while the bodies turn 15° left.
      // This is also the recovery's exact entry: no boundary repositioning.
      return {
        lead: {
          left: {
            position: {
              x: -half + CONTRA_CHECK_INWARD,
              y: CONTRA_CHECK_ADVANCE,
            },
            weight: weight("lead", "left"),
            direction: 0,
          },
          right: {
            position: { x: half, y: 0 },
            weight: weight("lead", "right"),
          },
          orientation: 360 - CONTRA_CHECK_TURN,
          rise: -CONTRA_CHECK_LOWERING,
        },
        follow: {
          left: {
            position: { x: HOLD_OFFSET + half, y: PARTNER_DISTANCE },
            weight: weight("follow", "left"),
          },
          right: {
            position: {
              x: HOLD_OFFSET - half + CONTRA_CHECK_INWARD,
              y: PARTNER_DISTANCE + CONTRA_CHECK_ADVANCE,
            },
            weight: weight("follow", "right"),
            direction: 180,
          },
          orientation: 180 - CONTRA_CHECK_TURN,
          rise: -CONTRA_CHECK_LOWERING,
        },
      };
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
        // Facing the lead, so her left foot is on the east (+x) side,
        // and HOLD_OFFSET to his right: her right foot is straight in
        // front of the middle of his feet, so his right foot is in
        // line with the gap between hers.
        follow: {
          left: {
            position: { x: HOLD_OFFSET + half, y: PARTNER_DISTANCE },
            weight: weight("follow", "left"),
          },
          right: {
            position: { x: HOLD_OFFSET - half, y: PARTNER_DISTANCE },
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
 *   foot and HOLD_OFFSET to its right, at (0.1, 0.4), where it was in
 *   hold; faces 225 (opened an eighth to her right); right foot
 *   CROSS_BEHIND behind her left and CROSS_ACROSS to its left (the
 *   mirror image). The offset leaves her 0.1 behind him along the line
 *   of travel (-x).
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
  const followLeft = { x: HOLD_OFFSET, y: PARTNER_DISTANCE };
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
 * - Follow: right foot PARTNER_DISTANCE plus twice PROMENADE_SEPARATION
 *   from the lead's left across the line of travel, and HOLD_OFFSET
 *   behind it along the line (+x), at (0.1, 0.6). Her left foot is the
 *   mirror image:
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
  const followRight = {
    x: HOLD_OFFSET,
    y: PARTNER_DISTANCE + 2 * PROMENADE_SEPARATION,
  };
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
 * - Follow: left foot PARTNER_DISTANCE across the line and HOLD_OFFSET
 *   behind along it, at (0.1, 0.4), where it was in closed hold; right
 *   foot TANGO_PROMENADE_WIDTH along the line, at (-0.5, 0.4).
 *
 * Unlike "promenade apart", the partners
 * keep closed hold's distance. The weights come from `weight`, normally
 * on the inside feet.
 */
function tangoPromenadePose(
  weight: (partner: Partner, foot: Foot) => number,
): Pose {
  const out = { x: -TANGO_PROMENADE_WIDTH, y: 0 };
  const leadRight = { x: 0, y: 0 };
  const followLeft = { x: HOLD_OFFSET, y: PARTNER_DISTANCE };
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
   *  is an error, not a silent correction. With `both`, this is the
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
  /** false for a step without weight (a tap or a close without
   *  weight): the foot moves but the weight stays on the standing foot. */
  weight?: boolean;
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

/** How far along from the lead's moving foot to the follow's each
 *  turning centre is (see the mirroring in defineFigure). */
const TURN_CENTRE_FRACTION: Record<TurnCentre, number> = {
  lead: 0,
  follow: 1,
  between: 0.5,
};

/** The turning centre of a `both` row that doesn't give one: the
 *  partner the written step sends backward, who is on the inside of the
 *  turn (the lead when his step goes back, the follow when it goes
 *  forward and hers goes back). A step straight to the side sends
 *  neither backward, so the couple turns round the point between them.
 *  `move` is the lead's step with any offset already resolved to
 *  degrees, measured from his facing before the turn. */
function defaultTurnCentre(move: PlainMove): TurnCentre {
  const degrees =
    typeof move.go === "number"
      ? move.go
      : DIRECTION_DEGREES[move.go as keyof typeof DIRECTION_DEGREES];
  const forward = Math.cos(degrees * DEG_TO_RAD);
  if (forward > 1e-9) return "follow";
  if (forward < -1e-9) return "lead";
  return "between";
}

/** A copy of `move` that takes the foot from `from` to `target`, as a
 *  direction (relative to `orientation`, the facing before the step's
 *  turn, as `go` expects) and distance. */
function moveTo(
  move: PlainMove,
  from: Point2D,
  target: Point2D,
  orientation: number,
): PlainMove {
  const delta = subPoints(target, from);
  const distance = Math.hypot(delta.x, delta.y);
  if (distance < 1e-12) return { ...move, go: "in place", by: undefined };
  return {
    ...move,
    // Compass heading of the delta: 0 = +y, clockwise.
    go: normalizeDegrees(
      Math.atan2(delta.x, delta.y) * RAD_TO_DEG - orientation,
    ),
    by: distance,
  };
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
    riseTiming: row.riseTiming,
    bodyOffset: row.bodyOffset,
    weight: row.weight,
    air: row.air,
    cross: row.cross,
  };
  const pathFor = (partner: Partner): CurvedPath | undefined =>
    typeof row.path === "object" ? row.path[partner] : row.path;
  const departureFor = (partner: Partner): number | undefined =>
    typeof row.pathSetOff === "object"
      ? row.pathSetOff[partner]
      : row.pathSetOff;
  const labelFor = (partner: Partner) =>
    typeof row.label === "string" ? row.label : row.label?.[partner];
  const footworkFor = (partner: Partner): string | undefined =>
    typeof row.footwork === "object" ? row.footwork[partner] : row.footwork;
  const pointingFor = (partner: Partner): Turn | undefined =>
    row.pointing === undefined
      ? undefined
      : "lead" in row.pointing || "follow" in row.pointing
        ? (row.pointing as { lead?: Turn; follow?: Turn })[partner]
        : (row.pointing as Turn);

  if (row.both !== undefined) {
    if (row.lead !== undefined || row.follow !== undefined) {
      throw new FigureError(
        `${where}: use either \`both\` or \`lead\`/\`follow\`, not both`,
      );
    }
    const lead = resolveOffset(
      {
        ...shared,
        footwork: footworkFor("lead"),
        pointing: pointingFor("lead"),
        pathSetOff: departureFor("lead"),
        path: pathFor("lead"),
        go: row.both,
      },
      where,
    );
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
    const follow: PlainMove = {
      ...lead,
      foot: undefined,
      footwork: footworkFor("follow"),
      pointing: pointingFor("follow"),
      pathSetOff: departureFor("follow"),
      path: pathFor("follow"),
    };
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
        : {
            ...shared,
            footwork: footworkFor(partner),
            pointing: pointingFor(partner),
            pathSetOff: departureFor(partner),
            path: pathFor(partner),
            go: value,
          };
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

  if (move.pathSetOff !== undefined && move.path === undefined) {
    throw new FigureError(`${where}: "pathSetOff" needs a curved "path"`);
  }
  let movement: Movement = { type: "straight", direction, distance };
  if (move.path !== undefined) {
    if (air || distance === 0) {
      throw new FigureError(
        `${where}: "path" needs a step that travels along the floor`,
      );
    }
    movement = curveAround(
      move.path,
      before,
      direction,
      distance,
      where,
      move.pathSetOff,
    );
  }

  if (!air && distance > 0) {
    // The curve, if there is one, ends at the same spot as the straight
    // step would (see curveAround).
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
    // Left out when the foot points the way the body faces.
    ...(turnDegrees(move.pointing) !== 0
      ? { footDirection: normalizeDegrees(after + turnDegrees(move.pointing)) }
      : {}),
    rise: move.rise ?? 0,
    ...(move.bodyOffset
      ? {
          bodyOffset: rotatePoint(
            { x: move.bodyOffset.right ?? 0, y: move.bodyOffset.forward ?? 0 },
            after,
          ),
        }
      : {}),
    // "even" and no footwork are the defaults, left out.
    ...(move.riseTiming === "late" ? { riseTiming: "late" as const } : {}),
    ...(move.footwork !== undefined ? { footwork: move.footwork } : {}),
    label: label || defaultLabel(move.go, move.turn, air),
  };
}

/**
 * The hold positions checkHold recognises, as where the follow's centre
 * of weight is from the lead's (centerOfWeight) and how she faces
 * relative to him, at the end of a row:
 * - closed hold: facing him (follow's facing minus lead's = 180),
 *   HOLD_OFFSET to his right and PARTNER_DISTANCE in front, in his
 *   facing;
 * - promenade: the V (270, as the promenade stances have it: him 315,
 *   her 225), measured in the closed hold the couple opened from (his
 *   facing + 45): HOLD_OFFSET to the right and 0.55 in front. Where the
 *   promenade stances put the weighted feet she is 0.40 to 0.68 in front
 *   in that frame (tango promenade, promenade apart, crossed promenade),
 *   so the middle of that range is used.
 */
const HOLD_POSITIONS: readonly {
  name: string;
  /** The follow's facing minus the lead's, degrees. */
  facing: number;
  /** Turn from the lead's facing to the frame `at` is measured in. */
  frame: number;
  at: Point2D;
}[] = [
  {
    name: "closed hold",
    facing: 180,
    frame: 0,
    at: { x: HOLD_OFFSET, y: PARTNER_DISTANCE },
  },
  {
    name: "promenade",
    facing: 270,
    frame: 45,
    at: { x: HOLD_OFFSET, y: 0.55 },
  },
];

/** How far the follow's horizontal body position may be from a hold position at
 *  the end of a row, in metres, and how far her facing may be from it,
 *  in degrees. Provisional judgement calls (2026-11-17): loose enough
 *  for the promenade stances' range and the Open Natural Turn's opening
 *  out of promenade on count 1, tight enough to catch a partner left
 *  20-30 cm out of place. */
export const HOLD_TOLERANCE = 0.2;
export const HOLD_FACING_TOLERANCE = 30;

/**
 * The "hold" check: at the end of every row, once all of its steps have
 * finished, the partners must be in a recognised hold position. Unmarked
 * rows use HOLD_POSITIONS; an explicit row hold selects its own reference
 * with the same tolerances, without granting it to other rows. The model has no arms, so this stands in for them:
 * it catches a figure whose separately written steps leave one partner
 * out of reach of the other mid-figure. Mirrored (`both`) steps keep the
 * hold by construction, so in practice it checks `lead`/`follow` rows.
 * Before a turning mirrored close it checks against the hold the turn
 * finishes in (`carriedTurn`, one entry per row, in degrees).
 * Compare bodyPosition, including any authored pelvis offset, rather than
 * the feet: supporting feet can open a channel while the hips stay close.
 * Added 2026-11-17 (owner's request); body shaping added 2026-11-18.
 */
function checkHold(
  name: string,
  figure: Figure,
  rowEnds: Map<number, number>,
  carriedTurn: readonly number[],
  rowHolds: readonly StepRow["hold"][],
): void {
  for (const [row, beat] of [...rowEnds].sort((a, b) => a[0] - b[0])) {
    const pose = poseAtBeat(figure, beat);
    const lead = bodyPosition(pose.lead);
    const follow = bodyPosition(pose.follow);
    const facing = normalizeDegrees(
      pose.follow.orientation - pose.lead.orientation,
    );
    // The opposed side-by-side formation is opt-in for this row. It is a
    // geometric constraint, not a hold exemption: ordinary distance/facing
    // limits still apply, and closed hold alone no longer satisfies the row.
    // An explicitly shaped body may keep close promenade contact while the
    // supporting feet open a passing channel. This provisional 27 cm centre
    // separation accounts for hip widths; the usual hold/facing tolerances
    // still apply. Unshaped figures retain their existing hold checks.
    const holds =
      rowHolds[row] === "opposed promenade"
        ? [
            {
              name: "opposed promenade",
              facing: 180,
              frame: 0,
              at: { x: 0.35, y: 0.1 },
            },
          ]
        : pose.lead.bodyOffset || pose.follow.bodyOffset
          ? [
              ...HOLD_POSITIONS,
              {
                name: "contact promenade",
                facing: 270,
                frame: 45,
                at: { x: HOLD_OFFSET, y: 0.27 },
              },
            ]
          : HOLD_POSITIONS;
    const misses = holds.map((hold) => {
      // Smallest angle between her facing and the hold's, 0-180.
      const turnedBy = Math.abs(
        normalizeDegrees(facing - hold.facing + 180) - 180,
      );
      // Before a turning close the feet are already placed for the
      // whole turn while the bodies are still on their way round
      // (carriedTurn in defineFigure), so the hold to check is the one
      // the turn finishes in.
      const expected = addPoints(
        lead,
        rotatePoint(
          hold.at,
          pose.lead.orientation + carriedTurn[row] + hold.frame,
        ),
      );
      const off = subPoints(follow, expected);
      return { hold, turnedBy, distance: Math.hypot(off.x, off.y) };
    });
    if (
      misses.some(
        ({ turnedBy, distance }) =>
          turnedBy <= HOLD_FACING_TOLERANCE && distance <= HOLD_TOLERANCE,
      )
    ) {
      continue;
    }
    const nearest = misses.reduce((best, miss) =>
      miss.turnedBy < best.turnedBy ? miss : best,
    );
    throw new FigureError(
      `${name}: after step ${row + 1} (beat ${Number((beat + 1).toFixed(3))}) the partners aren't in hold: the nearest is ${nearest.hold.name}, but the follow is ${nearest.distance.toFixed(2)} from where it puts her (at most ${HOLD_TOLERANCE}) and her facing is ${nearest.turnedBy.toFixed(0)}° off (at most ${HOLD_FACING_TOLERANCE}°)`,
    );
  }
}

/** How far (metres) the left foot may stray to the right of the right
 *  foot, across the dancer's facing, before the feet count as crossed. */
const CROSSED_FEET_TOLERANCE = 0.02;

/** How far a dancer's footprints may overlap before the "own feet"
 *  check fails, in metres: a few millimetres, for the footprint being
 *  only close to a real foot's outline. Provisional (2026-11-17). */
const OWN_FEET_TOLERANCE = 0.005;

/** The closest a lead's foot and a follow's foot may come, centre to
 *  centre, in metres: a foot is about 9 cm wide
 *  (src/libs/render/figureShapes.mts), so this keeps them from
 *  overlapping, with about a centimetre to spare. Provisional. It was
 *  15 cm (owner's agreement, 2026-11-16) while the follow stood
 *  directly in front of the lead; with the offset hold (HOLD_OFFSET)
 *  his right foot walks between her feet, passing 10 cm from each,
 *  which is how real walks in hold go but no 20 cm stance can keep
 *  15 cm clear of both sides (2026-11-17). */
export const PARTNER_FOOT_CLEARANCE = 0.1;

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
 * - Legs passing through each other (part of the "crossed feet" check):
 *   while the feet are crossed, whichever foot is in front stays in
 *   front, so they uncross the way they crossed. Crossed feet mean
 *   crossed legs; if the foot that was behind came out in front, its
 *   leg would have gone through the other one. Added 2026-11-17 after
 *   the Open Natural Turn's left foot uncrossed in front of a right foot
 *   that had crossed in front of it. "In front" is along the dancer's
 *   facing, and only counts once the feet are more than
 *   CROSSED_FEET_TOLERANCE apart that way, so feet crossing level with
 *   each other don't flip it on rounding.
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
  // While a partner's feet are crossed: the foot found in front since
  // they crossed (null until one is clearly in front, or while
  // uncrossed).
  const inFront: Record<Partner, Foot | null> = { lead: null, follow: null };
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
      const where = current >= 0 ? ` (${marks[current].where})` : "";
      // "own feet": a dancer's two feet, drawn as footprints, may not
      // overlap, except while they're crossed on purpose (a step with
      // `cross`, until they uncross), when one passes over or behind
      // the other off the floor. The crossed-feet check below compares
      // only the feet's middles, so without this a foot could land on
      // top of the other, or its toes swing into it, unnoticed.
      if (
        !skip.has("own feet") &&
        !(allowed[partner] && toTheRight > CROSSED_FEET_TOLERANCE) &&
        !crossing
      ) {
        const gap = footprintGap(
          left.position,
          footHeading(pose[partner], "left"),
          right.position,
          footHeading(pose[partner], "right"),
        );
        if (gap < -OWN_FEET_TOLERANCE) {
          throw new FigureError(
            `${name}: at beat ${Number((beat + 1).toFixed(3))}${where} the ${partner}'s feet overlap by ${(-gap).toFixed(3)} (feet drawn ${FOOTPRINT_LENGTH} long and ${FOOTPRINT_WIDTH} wide), so one would stand on the other or the legs would pass through each other`,
          );
        }
      }
      if (toTheRight <= CROSSED_FEET_TOLERANCE) {
        if (!crossing) allowed[partner] = false;
        inFront[partner] = null;
        continue;
      }
      if (skip.has("crossed feet")) continue;
      if (!allowed[partner]) {
        throw new FigureError(
          `${name}: at beat ${Number((beat + 1).toFixed(3))}${where} the ${partner}'s left foot is ${toTheRight.toFixed(2)} to the right of the right foot, so the feet are crossed. If that's meant, add "cross": true to the step that crosses them`,
        );
      }
      const ahead =
        across.x * headingToUnitVector(orientation).x +
        across.y * headingToUnitVector(orientation).y;
      if (Math.abs(ahead) <= CROSSED_FEET_TOLERANCE) continue;
      const front: Foot = ahead > 0 ? "left" : "right";
      if (inFront[partner] === null) {
        inFront[partner] = front;
      } else if (inFront[partner] !== front) {
        throw new FigureError(
          `${name}: at beat ${Number((beat + 1).toFixed(3))}${where} the ${partner}'s ${front} foot has come out in front of the ${OTHER[front]} while the feet are still crossed, so the legs would pass through each other. Feet uncross the way they crossed: if the ${front} foot crossed behind, take it round the back (\`path: "around the back"\`)`,
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

/** How far a curve may turn away from the way it sets off to reach its
 *  landing spot. Beyond this the foot would loop round to the other
 *  side of the body: for "around the front" it would swing round
 *  behind, which isn't "around the front". */
const MAX_CURVE_DEGREES = 120;

/** Which way, in degrees from the facing, a curve "around the back"
 *  sets off: diagonally back on the side the foot lands on (+135 for a
 *  spot to the right, -135 to the left). Provisional (2026-11-17):
 *  chosen for the Open Natural Turn's count 2, where it takes the left
 *  foot 13 cm behind the right, centre to centre, as the feet uncross.
 *  Setting off straight back made a loop of nearly three quarters of a
 *  circle, and anything nearer the side passed in front of the right
 *  foot again. */
const AROUND_THE_BACK_SET_OFF = 135;

/**
 * The circular arc for a step with a curved `path`.
 *
 * The model draws an arc from where the foot is, setting off at a given
 * angle from the dancer's facing before the step (Movement.arc's
 * `setOff`; see arcHeading in fold.mts) and bending with a constant
 * curvature. There is exactly one such arc through the landing spot:
 * if the landing spot is `theta` degrees round from the set-off heading
 * (clockwise positive) and `chord` metres away, the arc turns through
 * 2 * theta, so
 *   curvature = 2 sin(theta) / chord   (positive curves right)
 *   arcLength = chord * theta / sin(theta)   (theta in radians).
 *
 * - "around the front" sets off forward (setOff 0), so the foot passes
 *   in front of the body before it curves to land, which is what the
 *   owner described for a foot swinging round on a turning step.
 * - "around the back" sets off diagonally back towards the landing side
 *   (AROUND_THE_BACK_SET_OFF), so the foot passes behind the standing
 *   foot. The landing spot has to be to one side: straight ahead or
 *   straight behind, there is no side to go round.
 */
function curveAround(
  path: CurvedPath,
  facing: number,
  direction: number,
  chord: number,
  where: string,
  departure?: number,
): Movement {
  // Where the landing spot is, in degrees clockwise from the facing,
  // in (-180, 180].
  const fromFacing = normalizeDegrees(direction - facing + 180) - 180;
  let setOff = 0;
  if (path === "around the back") {
    if (Math.abs(fromFacing) < 1e-9 || Math.abs(fromFacing) > 180 - 1e-9) {
      throw new FigureError(
        `${where}: "around the back" needs a spot to one side, not straight ${Math.abs(fromFacing) < 90 ? "ahead" : "behind"}`,
      );
    }
    setOff = Math.sign(fromFacing) * AROUND_THE_BACK_SET_OFF;
  }
  // A specific departure angle keeps the same endpoint and circular-arc
  // model while allowing a shallower route than the preset back swing.
  if (departure !== undefined) setOff = normalizeDegrees(departure + 180) - 180;
  const theta = normalizeDegrees(fromFacing - setOff + 180) - 180;
  if (Math.abs(theta) < 1e-9) {
    // The landing spot is straight along the set-off heading: the curve
    // is a straight line.
    return { type: "straight", direction, distance: chord };
  }
  if (Math.abs(theta) > MAX_CURVE_DEGREES) {
    throw new FigureError(
      `${where}: "${path}" can't reach a spot ${Math.round(Math.abs(theta))}° round from the way the foot sets off (at most ${MAX_CURVE_DEGREES}°)`,
    );
  }
  const radians = theta / RAD_TO_DEG;
  return {
    type: "arc",
    curvature: (2 * Math.sin(radians)) / chord,
    arcLength: (chord * radians) / Math.sin(radians),
    ...(setOff !== 0 ? { setOff } : {}),
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
  "contra check": { lead: "left", follow: "right" },
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

  // A turn on a mirrored close: the couple's bodies turn on the close,
  // but the feet were already placed for it on the step before.
  //
  // In hold each partner's weight is a fixed offset from the other's,
  // turned with the couple. A close only moves each body 10 cm sideways
  // (from the standing foot to the middle of the feet), so if the couple
  // were exactly in hold before the close, turning the bodies an eighth
  // on it would leave the follow about 30 cm out of place. Ballroom
  // charts have the bodies keep turning through the close (a natural
  // turn's "1/8 between 2 and 3") while the feet close normally, which
  // works because the step before already placed the feet for the whole
  // turn. So the close's turn is carried back into the previous
  // mirrored travelling step's foot placement (the couple's rotation
  // round its turning centre), while each body still turns only by its
  // own step's `turn`: after the close the couple is exactly in hold,
  // facing the way the whole turn leads. Owner's choice (option A,
  // 2026-11-17).
  const carriedTurn: number[] = rows.map(() => 0);
  rows.forEach((row, index) => {
    if (
      row.both !== "close" ||
      row.turn === undefined ||
      turnDegrees(row.turn) === 0
    ) {
      return;
    }
    const previous = rows[index - 1];
    const travelling =
      previous?.both !== undefined &&
      previous.air !== true &&
      previous.both !== "close" &&
      previous.both !== "in place" &&
      previous.both !== "pivot";
    if (!travelling) {
      throw new FigureError(
        `${name}, step ${index + 1}: with \`both\`, a turn on a close needs the step before it to be a mirrored (\`both\`) travelling step, which places the feet for the turn the close finishes`,
      );
    }
    carriedTurn[index - 1] = turnDegrees(row.turn);
  });

  // In hold the lead's left foot pairs with the follow's right, and his
  // right with her left (each is in front of the other). A mirrored
  // turning step only moves one pair, so the other pair is left in the
  // relation the couple had when it last moved. pairFacing records, per
  // pair (keyed by the lead's foot), the lead's facing that pair was
  // last placed for, and a mirrored travelling step turns its pair by
  // everything since: the turn so far, not just its own. Without this a
  // turn spread over consecutive steps (begun on count 1, say) leaves
  // the couple short of the hold by the earlier steps' turn. (2026-11-17)
  const pairFacing: Record<Foot, number> = {
    left: startPose.lead.orientation,
    right: startPose.lead.orientation,
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
    /** For checkHold: the row (0-based) the step came from. */
    row: number;
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
      (row.both === "in place" || row.both === "pivot")
    ) {
      // On these steps each partner turns over their own standing foot,
      // which doesn't move, so the two can't swing round each other and
      // closed hold would silently come apart (the follow would end up
      // beside the lead instead of in front of him). A turning close is
      // different: see carriedTurn above.
      throw new FigureError(
        `${where}: with \`both\`, a turn can't go on "${row.both}": each partner would turn on their own standing foot and the hold would come apart. Put the turn on a travelling step, or write \`lead\` and \`follow\` separately`,
      );
    }
    if (row.turnCentre !== undefined) {
      if (row.both === undefined) {
        throw new FigureError(
          `${where}: \`turnCentre\` only goes with \`both\`; with \`lead\` and \`follow\` written separately, each step already says where that partner goes`,
        );
      }
      if (
        (row.turn === undefined || turnDegrees(row.turn) === 0) &&
        carriedTurn[index] === 0
      ) {
        throw new FigureError(
          `${where}: \`turnCentre\` needs a \`turn\` on the row (or a turning close after it)`,
        );
      }
      if (row.air === true) {
        throw new FigureError(
          `${where}: \`turnCentre\` can't go on an airborne step, which doesn't move the couple`,
        );
      }
    }

    let leadFoot: Foot | undefined;
    // Where each partner's moving foot lands on a travelling `both` row,
    // worked out together when the lead's step is reached (see below).
    let targets: Record<Partner, Point2D> | undefined;
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

      // With `both`, the partners keep their places in the hold: the
      // couple moves and turns as one, round a turning centre.
      //
      // Take the point C a fraction t of the way from the lead's moving
      // foot to the follow's (t = 0, 1 or 1/2 for a centre of "lead",
      // "follow" or "between"). C makes the step as written: it moves by
      // the lead's written displacement d. The couple turns round C by
      // the step's turn R, so each moving foot P lands at
      //
      //   C + d + R(P - C).
      //
      // With t = 0 the lead's foot lands exactly where his step says
      // and the follow swings round him; with t = 1 her foot lands where
      // the mirror of his step says (the same floor displacement) and
      // he swings round her. Whoever is further from C travels further:
      // the outside of the turn. Without a turn R does nothing and both
      // simply take the written step, the plain mirror, whatever the
      // centre.
      //
      // Airborne steps don't place a foot, so they keep the plain
      // mirror: the same floor direction as the lead.
      let partnerMove = move;
      const travels =
        typeof move.go === "number" || move.go in DIRECTION_DEGREES;
      if (
        row.both !== undefined &&
        partner === "lead" &&
        travels &&
        move.air !== true
      ) {
        const leadFrom = state.lead.position[foot];
        const followFrom = state.follow.position[OTHER[foot]];
        // Where the written step would put his foot, without changing
        // his state yet.
        const scratch = structuredClone(state.lead);
        applyMove("lead", move, foot, scratch, label, where);
        const displacement = subPoints(scratch.position[foot], leadFrom);
        const centre = row.turnCentre ?? defaultTurnCentre(move);
        const t = TURN_CENTRE_FRACTION[centre];
        const pivot = addPoints(
          leadFrom,
          scalePoint(subPoints(followFrom, leadFrom), t),
        );
        // The couple's facing the feet land for: after this step's own
        // turn, plus any the next close carries back (carriedTurn). The
        // pair turns from the facing it was last placed for
        // (pairFacing), which is this step's starting facing unless an
        // earlier mirrored step turned the couple while this pair stood.
        const placedFor =
          state.lead.orientation + turnDegrees(move.turn) + carriedTurn[index];
        const degrees =
          turnDegrees(move.turn) +
          carriedTurn[index] +
          angleBetweenDegrees(pairFacing[foot], state.lead.orientation);
        pairFacing[foot] = placedFor;
        const land = (from: Point2D) =>
          addPoints(
            addPoints(pivot, displacement),
            rotatePoint(subPoints(from, pivot), degrees),
          );
        targets = { lead: land(leadFrom), follow: land(followFrom) };
        if (t !== 0 && degrees !== 0) {
          partnerMove = moveTo(
            move,
            leadFrom,
            targets.lead,
            state.lead.orientation,
          );
        }
      }
      if (row.both !== undefined && partner === "follow" && travels) {
        if (targets) {
          partnerMove = moveTo(
            move,
            state.follow.position[foot],
            targets.follow,
            state.follow.orientation,
          );
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
      const step = applyMove(
        partner,
        partnerMove,
        foot,
        state[partner],
        label,
        `${where} (${partner})`,
      );
      if (partnerMove !== move && !label) {
        // Describe the step in the dancer's own terms, as written (the
        // follow's as the mirror of the lead's), not as the worked-out
        // direction in degrees.
        step.label = defaultLabel(
          partner === "follow" ? mirrorName(move.go) : move.go,
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
        row: index,
      });
      // Any other step that places a foot (a close, separately written
      // steps) leaves its pair in whatever relation the steps give; it
      // counts as placed for the lead's facing now.
      const travelledBoth =
        row.both !== undefined && travels && move.air !== true;
      if (
        !travelledBoth &&
        move.go !== "pivot" &&
        move.go !== "in place" &&
        move.air !== true
      ) {
        const pairKey = partner === "lead" ? foot : OTHER[foot];
        pairFacing[pairKey] = state.lead.orientation;
      }
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
    start === "crossed promenade" || start === "contra check",
    new Set(definition.skipChecks ?? []),
  );

  if (!(definition.skipChecks ?? []).includes("hold")) {
    // When each row has finished: the latest end of its steps.
    const rowEnds = new Map<number, number>();
    steps.forEach((step, index) => {
      const { row } = resolved[index];
      const end = step.beat - 1 + step.duration;
      rowEnds.set(row, Math.max(rowEnds.get(row) ?? 0, end));
    });
    checkHold(
      name,
      figure,
      rowEnds,
      carriedTurn,
      rows.map((row) => row.hold),
    );
  }

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
    "pointing",
    "rise",
    "riseTiming",
    "bodyOffset",
    "footwork",
    "weight",
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
    checkBoolean(`${path}weight`, object.weight);
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
