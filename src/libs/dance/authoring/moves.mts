/**
 * Turning a figure definition's rows into model steps: resolving
 * offsets and turns, mirroring `both` rows round the turning centre,
 * choosing the moving foot, building curved paths and default labels,
 * and applying each move to a partner's state.
 */

import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  addPoints,
  headingToUnitVector,
  normalizeDegrees,
  rotatePoint,
  scalePoint,
  subPoints,
} from "../heading.mts";
import type { Point2D } from "../pose.mts";
import type { DanceStep, Foot, Movement, Partner } from "../step.mts";
import { DIRECTION_DEGREES, FigureError } from "./definition.mts";
import type {
  Action,
  CurvedPath,
  MoveOptions,
  Offset,
  PartnerMove,
  StepRow,
  Turn,
  TurnAmount,
  TurnCentre,
} from "./definition.mts";
import { OTHER, STANCE_WIDTH } from "./stances.mts";

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

/** The size of a turn amount as a fraction of a full turn. Assumes the
 *  amount has been validated (see parseFigureDefinition). */
function turnFraction(amount: TurnAmount): number {
  if (typeof amount === "number") return amount;
  const [numerator, denominator] = amount.split("/").map(Number);
  return numerator / denominator;
}

export function turnDegrees(turn: Turn | undefined): number {
  if (turn === undefined) return 0;
  return "right" in turn
    ? turnFraction(turn.right) * 360
    : -turnFraction(turn.left) * 360;
}

/** How far along from the lead's moving foot to the follow's each
 *  turning centre is (see the mirroring in defineFigure). */
export const TURN_CENTRE_FRACTION: Record<TurnCentre, number> = {
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
export function defaultTurnCentre(move: PlainMove): TurnCentre {
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
export function moveTo(
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

export function defaultLabel(
  action: Action,
  turn: Turn | undefined,
  air: boolean,
) {
  const base = isOffset(action)
    ? describeOffset(action)
    : typeof action === "number"
      ? `${action}° from forward`
      : action;
  const withTurn = turn ? `${base}, turning ${describeTurn(turn)}` : base;
  if (action === "pivot" && turn) return `pivot ${describeTurn(turn)}`;
  return air ? `${withTurn} (in the air)` : withTurn;
}

export interface PartnerState {
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
export function movesOfRow(row: StepRow, where: string): ResolvedMove[] {
  const shared: MoveOptions = {
    foot: row.foot,
    duration: row.duration,
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
export function chooseFoot(
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
  if (state.weight[foot] >= (explicit ? 1 - 1e-9 : 0.5)) {
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
export function applyMove(
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
  if (
    typeof move.weight === "number" &&
    (!Number.isFinite(move.weight) || move.weight < 0 || move.weight > 1)
  )
    throw new FigureError(`${where}: weight must be between 0 and 1`);
  const targetWeight = air
    ? 0
    : move.go === "pivot"
      ? state.weight[foot]
      : typeof move.weight === "number"
        ? move.weight
        : move.weight === false
          ? 0
          : 1;
  const takesWeight = targetWeight > 0 && !air && move.go !== "pivot";

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
  state.weight[foot] = targetWeight;
  state.weight[OTHER[foot]] = 1 - targetWeight;
  state.orientation = after;

  return {
    partner,
    foot,
    movement,
    contact: air ? "air" : "floor",
    // A pivot keeps the weight on the pivoting foot.
    weight: targetWeight,
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
 * `setOff`; see arcHeading in fold/paths.mts) and bending with a constant
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

/** The follow's name for the direction of a mirrored step: the same
 *  floor direction, seen from facing the other way. */
export function mirrorName(action: PlainAction): PlainAction {
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
