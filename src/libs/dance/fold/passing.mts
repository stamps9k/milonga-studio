/**
 * Footprint geometry and passing routes: how close two footprints come
 * (footprintGap), and the route a walking foot takes to pass close beside
 * the standing foot (passingPoint, stepPassings).
 */

import { isFreeFootFollow, bodyHeadingBefore } from "../overlap.mts";
import {
  addPoints,
  headingToUnitVector,
  lerpAngleDegrees,
  scalePoint,
  subPoints,
} from "../heading.mts";
import { footHeading } from "../pose.mts";
import type { Point2D } from "../pose.mts";
import type { DanceStep, Figure, Foot, Movement, Partner } from "../step.mts";
import {
  ARC_TRAIL_SAMPLES,
  FEET,
  movementEndpoint,
  movementPointAt,
  positionsOf,
  straightEndpoint,
} from "./paths.mts";
import {
  standingShare,
  standingSwivelShift,
  swivelShift,
  swivelStandingFoot,
  turnsOnTheSpot,
} from "./timing.mts";

/**
 * How close a travelling foot comes to the standing foot as it passes
 * it, centre to centre, in metres. A foot is about 9 cm wide, so the
 * feet pass with about a centimetre between them, as feet brush past
 * each other in a ballroom walk. Provisional (2026-11-17).
 */
export const PASSING_GAP = 0.1;

/**
 * A footprint's size, in metres, for keeping a dancer's feet apart: about
 * 26 cm long and 9 cm wide, as the 2D view draws a foot
 * (src/libs/render/figureShapes.mts) and close to the body solver's feet
 * (src/libs/body/proportions.mts). Shared by the passing route here and
 * the "own feet" check in authoring.mts.
 */
export const FOOTPRINT_LENGTH = 0.26;
export const FOOTPRINT_WIDTH = 0.09;

/** The least room a passing foot leaves between its outline and the
 *  standing foot's, in metres. With parallel feet that's PASSING_GAP
 *  between centres. */
const PASSING_FOOT_CLEARANCE = PASSING_GAP - FOOTPRINT_WIDTH;

/** The closest two points on segments ab and cd come, in 2D. */
function segmentDistance(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
): number {
  const cross = (o: Point2D, p: Point2D, q: Point2D) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const toSegment = (p: Point2D, s: Point2D, e: Point2D) => {
    const se = subPoints(e, s);
    const lengthSquared = se.x * se.x + se.y * se.y;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              ((p.x - s.x) * se.x + (p.y - s.y) * se.y) / lengthSquared,
            ),
          );
    return Math.hypot(p.x - (s.x + se.x * t), p.y - (s.y + se.y * t));
  };
  return Math.min(
    toSegment(a, c, d),
    toSegment(b, c, d),
    toSegment(c, a, b),
    toSegment(d, a, b),
  );
}

/**
 * How much room there is between two footprints, in metres: negative
 * when they overlap. Each foot is drawn as a rounded strip
 * FOOTPRINT_LENGTH long and FOOTPRINT_WIDTH wide (a stadium) along the
 * way it points, centred on its position, which is close to a foot's
 * outline and makes the gap the distance between their centre lines
 * less one foot's width.
 */
export function footprintGap(
  a: Point2D,
  aHeading: number,
  b: Point2D,
  bHeading: number,
): number {
  const half = (FOOTPRINT_LENGTH - FOOTPRINT_WIDTH) / 2;
  const ends = (centre: Point2D, heading: number): [Point2D, Point2D] => {
    const along = scalePoint(headingToUnitVector(heading), half);
    return [subPoints(centre, along), addPoints(centre, along)];
  };
  const [a1, a2] = ends(a, aHeading);
  const [b1, b2] = ends(b, bHeading);
  return segmentDistance(a1, a2, b1, b2) - FOOTPRINT_WIDTH;
}

/** Where along a straight step (0 at its start, 1 at its end) the
 *  standing foot has to be for the moving foot to pass it. Outside this
 *  range the standing foot is level with where the foot sets off or
 *  lands (a side step, a close), and it travels straight. */
const PASSING_RANGE: readonly [number, number] = [0.15, 0.85];

/**
 * The passing point of a straight step: where the moving foot goes past
 * the standing foot, or undefined when it doesn't pass it.
 *
 * Feet don't travel in straight lines between where they set off and
 * where they land. In a walk (forward or back) the moving foot passes
 * close beside the standing foot, under the body, then extends. The
 * stored movement only says where the foot ends, so this works out the
 * route while folding: if the standing foot lies alongside the step's
 * line (its projection falls within PASSING_RANGE of the way along) and
 * the line runs more than PASSING_GAP from it, the foot is drawn in to
 * PASSING_GAP from the standing foot, on its own side, at that point.
 * Side steps and closes don't pass the standing foot, a step whose line
 * already runs that close is left alone, and arcs keep their own curve.
 * Provisional (owner's request, 2026-11-17).
 */
export function passingPoint(
  start: Point2D,
  end: Point2D,
  standing: Point2D,
): { point: Point2D; at: number } | undefined {
  const along = subPoints(end, start);
  const lengthSquared = along.x * along.x + along.y * along.y;
  if (lengthSquared < 1e-12) return undefined;
  const at =
    ((standing.x - start.x) * along.x + (standing.y - start.y) * along.y) /
    lengthSquared;
  if (at < PASSING_RANGE[0] || at > PASSING_RANGE[1]) return undefined;
  // From the standing foot out to the line, square to it.
  const outward = subPoints(addPoints(start, scalePoint(along, at)), standing);
  const gap = Math.hypot(outward.x, outward.y);
  if (gap <= PASSING_GAP) return undefined;
  return {
    point: addPoints(standing, scalePoint(outward, PASSING_GAP / gap)),
    at,
  };
}

/** Where a straight step passes the standing foot (see passingPoint),
 *  as worked out for that step by stepPassings. */
type Passing = { point: Point2D; at: number };

/**
 * How far a passing foot keeps from the partner's feet that stand still
 * during its step, centre to centre, in metres: the same 10 cm the
 * figure checks ask for (PARTNER_FOOT_CLEARANCE in authoring.mts).
 */
const PASSING_PARTNER_CLEARANCE = 0.1;

/**
 * Where a foot is after covering `progress` (0..1) of a step: along its
 * movement, except that a straight step that passes the standing foot
 * curves in past it (`passing`, from stepPassings), reaching the
 * passing point when it has covered the part of its route up to it (the
 * foot keeps an even pace), and leaving and landing where the straight
 * step does.
 */
export function stepPointAt(
  start: Point2D,
  headingBefore: number,
  movement: Movement,
  progress: number,
  passing: Passing | undefined,
): Point2D {
  if (movement.type === "straight") {
    const end = straightEndpoint(start, movement.direction, movement.distance);
    if (passing) {
      // Two quadratics joined at the passing point, each with its
      // control point on the line through the passing point parallel to
      // the step, so the foot is travelling the step's way as it passes
      // and never comes closer to the standing foot than PASSING_GAP
      // (each piece stays between its ends and its control point).
      const { point, at } = passing;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const unit = scalePoint(subPoints(end, start), 1 / length);
      const quadratic = (a: Point2D, control: Point2D, b: Point2D, u: number) =>
        addPoints(
          addPoints(
            scalePoint(a, (1 - u) * (1 - u)),
            scalePoint(control, 2 * u * (1 - u)),
          ),
          scalePoint(b, u * u),
        );
      const first = subPoints(point, scalePoint(unit, (at * length) / 2));
      const second = addPoints(
        point,
        scalePoint(unit, ((1 - at) * length) / 2),
      );
      // Share the step's time between the two pieces by their lengths,
      // so the foot moves at an even pace along the whole route rather
      // than rushing the shorter piece.
      const pieceLength = (a: Point2D, control: Point2D, b: Point2D) => {
        let total = 0;
        let previous = a;
        for (let i = 1; i <= 8; i++) {
          const next = quadratic(a, control, b, i / 8);
          total += Math.hypot(next.x - previous.x, next.y - previous.y);
          previous = next;
        }
        return total;
      };
      const firstLength = pieceLength(start, first, point);
      const split =
        firstLength / (firstLength + pieceLength(point, second, end));
      if (progress <= split) {
        return quadratic(start, first, point, progress / split);
      }
      return quadratic(point, second, end, (progress - split) / (1 - split));
    }
  }
  return movementPointAt(start, headingBefore, movement, progress);
}

/** The minimum distance from `point` to any of `others`. */
function nearest(point: Point2D, others: readonly Point2D[]): number {
  return Math.min(
    ...others.map((other) => Math.hypot(point.x - other.x, point.y - other.y)),
  );
}

const passingCache = new WeakMap<Figure, Map<DanceStep, Passing | undefined>>();

/**
 * For each of a figure's floor steps, where its foot passes the
 * standing foot (passingPoint), or undefined if it travels straight.
 *
 * A passing foot comes in towards its standing foot only as far as the
 * partner's feet allow: in the offset hold the lead's right foot walks
 * between the follow's feet, about 10 cm from each, so drawing his
 * foot in towards his left would take it onto hers. The pull towards
 * the standing foot is reduced, in tenths, until the curve keeps
 * PASSING_PARTNER_CLEARANCE from every partner foot that stands still
 * for the whole step; if none does, the step stays straight. Decided
 * once per step, from where the feet are when it starts (an endpoint
 * fold, which doesn't depend on the paths), so playback, trails and the
 * figure checks all see the same route. The pull is also reduced until
 * the two feet's outlines (footprintGap) keep PASSING_FOOT_CLEARANCE
 * between them, so feet pointing different ways, as in a turn, pass a
 * little wider than parallel ones. Provisional (2026-11-17).
 */
export function stepPassings(
  figure: Figure,
): Map<DanceStep, Passing | undefined> {
  const cached = passingCache.get(figure);
  if (cached) return cached;

  const ordered = [...figure.steps].sort((a, b) => a.beat - b.beat);
  const startOf = (step: DanceStep) => step.beat - 1;
  const endOf = (step: DanceStep) => step.beat - 1 + step.duration;
  // Where each foot rests after each step (airborne steps leave it).
  const restAfter = new Map<DanceStep, Point2D>();
  const orientationBefore = new Map<DanceStep, number>();
  // Which way each foot points as each step starts (see poseAtBeat's
  // directions), for keeping the passing foot's outline off the
  // standing foot's.
  const directionsBefore = new Map<DanceStep, Record<Foot, number>>();
  // How far a standing foot moved as it swivelled about its ball or heel
  // during a step (DanceStep.swivel), counted once that step is over.
  const swivelled: {
    partner: Partner;
    foot: Foot;
    end: number;
    shift: Point2D;
    /** Where the step comes in `ordered`: the fold below has already
     *  added the shift to the feet of every step after it. */
    order: number;
  }[] = [];
  {
    const positions: Record<Partner, Record<Foot, Point2D>> = {
      lead: { ...positionsOf(figure.startPose.lead) },
      follow: { ...positionsOf(figure.startPose.follow) },
    };
    const orientations: Record<Partner, number> = {
      lead: figure.startPose.lead.orientation,
      follow: figure.startPose.follow.orientation,
    };
    const directions: Record<Partner, Record<Foot, number>> = {
      lead: {
        left: footHeading(figure.startPose.lead, "left"),
        right: footHeading(figure.startPose.lead, "right"),
      },
      follow: {
        left: footHeading(figure.startPose.follow, "left"),
        right: footHeading(figure.startPose.follow, "right"),
      },
    };
    for (const [order, step] of ordered.entries()) {
      const free = isFreeFootFollow(step, figure.steps);
      const frame = free
        ? bodyHeadingBefore(step, figure.steps, figure.startPose)
        : orientations[step.partner];
      orientationBefore.set(step, frame);
      directionsBefore.set(step, { ...directions[step.partner] });
      const otherFoot: Foot = step.foot === "left" ? "right" : "left";
      if (!free) {
        const shift = standingSwivelShift(
          step.swivel,
          directions[step.partner][otherFoot],
          orientations[step.partner],
          step.orientation,
          standingShare(step, figure.steps),
        );
        if (shift.x !== 0 || shift.y !== 0) {
          swivelled.push({
            partner: step.partner,
            foot: otherFoot,
            end: endOf(step),
            shift,
            order,
          });
          positions[step.partner][otherFoot] = addPoints(
            positions[step.partner][otherFoot],
            shift,
          );
        }
        directions[step.partner][otherFoot] = swivelStandingFoot(
          directions[step.partner][otherFoot],
          orientations[step.partner],
          step.orientation,
        );
      }
      const pointing = step.footDirection ?? step.orientation;
      const turnShift = turnsOnTheSpot(step)
        ? swivelShift(
            step.swivel,
            directions[step.partner][step.foot],
            pointing,
          )
        : { x: 0, y: 0 };
      directions[step.partner][step.foot] = pointing;
      if (step.contact !== "air") {
        positions[step.partner][step.foot] = addPoints(
          movementEndpoint(
            positions[step.partner][step.foot],
            frame,
            step.movement,
          ),
          turnShift,
        );
      }
      restAfter.set(step, positions[step.partner][step.foot]);
      if (!free) orientations[step.partner] = step.orientation;
    }
  }
  // Where a foot rests at `beat`: after the last of its steps that has
  // finished by then.
  const restAt = (partner: Partner, foot: Foot, beat: number): Point2D => {
    let position = figure.startPose[partner][foot].position;
    let since = -1;
    for (const [order, step] of ordered.entries()) {
      if (step.partner !== partner || step.foot !== foot) continue;
      if (endOf(step) > beat + 1e-9) break;
      position = restAfter.get(step)!;
      since = order;
    }
    // Plus any swivel about the ball or heel it has finished since.
    for (const turn of swivelled)
      if (
        turn.partner === partner &&
        turn.foot === foot &&
        turn.order > since &&
        turn.end <= beat + 1e-9
      )
        position = addPoints(position, turn.shift);
    return position;
  };

  const result = new Map<DanceStep, Passing | undefined>();
  for (const step of ordered) {
    // Passing routes need a stationary supporting foot. With simultaneous
    // free-foot motion, preserve the explicitly authored path instead.
    const movingSupport = ordered.some(
      (other) =>
        other.partner === step.partner &&
        other.foot !== step.foot &&
        startOf(other) < endOf(step) - 1e-9 &&
        endOf(other) > startOf(step) + 1e-9,
    );
    if (
      movingSupport ||
      step.contact === "air" ||
      step.movement.type !== "straight"
    ) {
      result.set(step, undefined);
      continue;
    }
    const start = restAt(step.partner, step.foot, startOf(step));
    const end = restAfter.get(step)!;
    const other: Foot = step.foot === "left" ? "right" : "left";
    const standing = restAt(step.partner, other, startOf(step));
    const full = passingPoint(start, end, standing);
    if (!full) {
      result.set(step, undefined);
      continue;
    }
    // The partner's feet that don't move at any time during this step.
    const partner: Partner = step.partner === "lead" ? "follow" : "lead";
    const still = FEET.filter(
      (foot) =>
        !ordered.some(
          (moving) =>
            moving.partner === partner &&
            moving.foot === foot &&
            moving.contact !== "air" &&
            startOf(moving) < endOf(step) - 1e-9 &&
            endOf(moving) > startOf(step) + 1e-9,
        ),
    ).map((foot) => restAt(partner, foot, startOf(step)));
    const onLine = addPoints(start, scalePoint(subPoints(end, start), full.at));
    const bodyBefore = orientationBefore.get(step)!;
    const footsBefore = directionsBefore.get(step)!;
    // Which way the moving and standing feet point partway through the
    // step, as poseAtBeat turns them.
    const movingHeading = (u: number) =>
      lerpAngleDegrees(
        footsBefore[step.foot],
        step.footDirection ?? step.orientation,
        u,
      );
    const standingHeading = (u: number) =>
      swivelStandingFoot(
        footsBefore[other],
        bodyBefore,
        lerpAngleDegrees(bodyBefore, step.orientation, u),
      );
    let chosen: Passing | undefined;
    for (let pull = 10; pull >= 1; pull--) {
      const candidate = {
        point: addPoints(
          onLine,
          scalePoint(subPoints(full.point, onLine), pull / 10),
        ),
        at: full.at,
      };
      let clear = true;
      for (let i = 1; i < ARC_TRAIL_SAMPLES * 2 && clear; i++) {
        const point = stepPointAt(
          start,
          orientationBefore.get(step)!,
          step.movement,
          i / (ARC_TRAIL_SAMPLES * 2),
          candidate,
        );
        if (
          still.length > 0 &&
          nearest(point, still) < PASSING_PARTNER_CLEARANCE - 1e-9
        ) {
          clear = false;
        }
        // Nor so close that the feet's outlines come within
        // PASSING_FOOT_CLEARANCE of each other: feet pointing different
        // ways (in a turn) pass a little wider than parallel ones.
        const u = i / (ARC_TRAIL_SAMPLES * 2);
        if (
          footprintGap(point, movingHeading(u), standing, standingHeading(u)) <
          PASSING_FOOT_CLEARANCE - 1e-9
        ) {
          clear = false;
        }
      }
      if (clear) {
        chosen = candidate;
        break;
      }
    }
    result.set(step, chosen);
  }
  passingCache.set(figure, result);
  return result;
}
