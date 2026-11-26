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
 *
 * The code is in ./authoring/: definition.mts (the figure-file format's
 * types), stances.mts (named stances and their measurements), moves.mts
 * (rows into steps), autoPath.mts (routes for `path: "auto"`),
 * checks.mts (hold, feet and expectEnd checks), define.mts
 * (defineFigure) and parse.mts (parseFigureDefinition). This
 * file is the public entry point; import from here.
 */

export type {
  CurvedPath,
  FootCheck,
  RelativeDirection,
  Action,
  Offset,
  Turn,
  TurnAmount,
  TurnCentre,
  MoveOptions,
  PartnerMove,
  StepRow,
  ExpectedEnd,
  RowHold,
  FigureDefinition,
  AuthoredFigure,
} from "./authoring/definition.mts";
export {
  CURVED_PATHS,
  FOOT_CHECKS,
  ROW_HOLDS,
  TURN_CENTRES,
  FigureError,
} from "./authoring/definition.mts";
export type { HoldKind, HoldShape, StanceName } from "./authoring/stances.mts";
export {
  STANCE_WIDTH,
  PARTNER_DISTANCE,
  HOLD_OFFSET,
  HOLD_SHAPES,
  TANGO_HOLD,
  holdForStyle,
  CROSS_BEHIND,
  CROSS_ACROSS,
  PROMENADE_SIDE_STEP,
  PROMENADE_CLOSE_WIDTH,
  PROMENADE_SEPARATION,
  CONTRA_CHECK_ADVANCE,
  CONTRA_CHECK_INWARD,
  CONTRA_CHECK_TURN,
  CONTRA_CHECK_LOWERING,
  STANCE_NAMES,
  stancePose,
} from "./authoring/stances.mts";
export {
  HOLD_TOLERANCE,
  HOLD_FACING_TOLERANCE,
  PARTNER_FOOT_CLEARANCE,
} from "./authoring/checks.mts";
export {
  AUTO_PATH_CLEARANCE,
  AUTO_PATH_MAX_BULGE,
  AUTO_PATH_MAX_LENGTH_RATIO,
} from "./authoring/autoPath.mts";
export { defineFigure } from "./authoring/define.mts";
export { parseFigureDefinition } from "./authoring/parse.mts";
