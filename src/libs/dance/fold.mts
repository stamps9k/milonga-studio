import type { DanceStep, Figure, Foot, Movement, Partner } from "./step.mts";
import { footHeading } from "./pose.mts";
import type { PartnerPose, Point2D, Pose } from "./pose.mts";
import type { FloorTransform } from "./sequence.mts";
import { applyTransform } from "./floor.mts";
import {
  RAD_TO_DEG,
  addPoints,
  angleBetweenDegrees,
  headingToUnitVector,
  lerp,
  lerpAngleDegrees,
  normalizeDegrees,
  rotatePoint,
  scalePoint,
  subPoints,
} from "./heading.mts";

/**
 * Folds a Figure's ordered DanceSteps forward from its startPose to
 * trace where each foot actually travels -- "A Figure is a fold: a
 * starting Pose plus an ordered list of DanceSteps produces a Pose at
 * every beat" (see the design comment on Pose in pose.mts).
 *
 * A Figure's stored startPose/endPose are authored by hand and aren't
 * guaranteed to exactly equal what folding its own steps produces --
 * this module doesn't assume they do. (For the seeded figures,
 * test/db/seed.test.mts checks that they agree.)
 */

export type FootTrails = Record<Partner, Record<Foot, Point2D[]>>;

const PARTNERS: readonly Partner[] = ["lead", "follow"];
const FEET: readonly Foot[] = ["left", "right"];

function straightEndpoint(
  start: Point2D,
  direction: number,
  distance: number,
): Point2D {
  return addPoints(start, scalePoint(headingToUnitVector(direction), distance));
}

/**
 * Endpoint of an arc movement after travelling `arcLength` along it,
 * setting off along `initialHeading` (see arcHeading).
 */
function arcEndpoint(
  start: Point2D,
  initialHeading: number,
  curvature: number,
  arcLength: number,
): Point2D {
  const radius = 1 / curvature;
  const center = addPoints(
    start,
    scalePoint(headingToUnitVector(initialHeading + 90), radius),
  );
  const sweepDegrees = arcLength * curvature * RAD_TO_DEG;
  const relativeToCenter = subPoints(start, center);
  return addPoints(center, rotatePoint(relativeToCenter, sweepDegrees));
}

/**
 * The heading an arc sets off along: the partner's facing just before
 * the step, turned by the arc's `setOff` (0 when left out, so the foot
 * sets off the way the body faces). An arc is stored relative to the
 * facing rather than with an absolute heading, so it reads the same
 * wherever a figure is placed on the floor. `path: "around the back"`
 * in a figure file sets `setOff` so the foot leaves diagonally back
 * (see curveAround in authoring.mts).
 */
function arcHeading(
  headingBefore: number,
  movement: Extract<Movement, { type: "arc" }>,
): number {
  return headingBefore + (movement.setOff ?? 0);
}

/** Where a movement ends up, having fully completed. */
function movementEndpoint(
  start: Point2D,
  headingBefore: number,
  movement: Movement,
): Point2D {
  return movement.type === "straight"
    ? straightEndpoint(start, movement.direction, movement.distance)
    : arcEndpoint(
        start,
        arcHeading(headingBefore, movement),
        movement.curvature,
        movement.arcLength,
      );
}

/** Where a movement is after covering `progress` (0..1) of it. For an
 *  arc this traces the actual curve (travelling a fraction of its
 *  arcLength), not a straight-line shortcut between endpoints. */
function movementPointAt(
  start: Point2D,
  headingBefore: number,
  movement: Movement,
  progress: number,
): Point2D {
  return movement.type === "straight"
    ? straightEndpoint(start, movement.direction, movement.distance * progress)
    : arcEndpoint(
        start,
        arcHeading(headingBefore, movement),
        movement.curvature,
        movement.arcLength * progress,
      );
}

/**
 * How close a travelling foot comes to the standing foot as it passes
 * it, centre to centre, in metres. A foot is about 9 cm wide, so the
 * feet pass with about a centimetre between them, as feet brush past
 * each other in a ballroom walk. Provisional (2026-11-17).
 */
export const PASSING_GAP = 0.1;

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
function stepPointAt(
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
 * figure checks all see the same route. Provisional (2026-11-17).
 */
function stepPassings(figure: Figure): Map<DanceStep, Passing | undefined> {
  const cached = passingCache.get(figure);
  if (cached) return cached;

  const ordered = [...figure.steps].sort((a, b) => a.beat - b.beat);
  const startOf = (step: DanceStep) => step.beat - 1;
  const endOf = (step: DanceStep) => step.beat - 1 + step.duration;
  // Where each foot rests after each step (airborne steps leave it).
  const restAfter = new Map<DanceStep, Point2D>();
  const orientationBefore = new Map<DanceStep, number>();
  {
    const positions: Record<Partner, Record<Foot, Point2D>> = {
      lead: { ...positionsOf(figure.startPose.lead) },
      follow: { ...positionsOf(figure.startPose.follow) },
    };
    const orientations: Record<Partner, number> = {
      lead: figure.startPose.lead.orientation,
      follow: figure.startPose.follow.orientation,
    };
    for (const step of ordered) {
      orientationBefore.set(step, orientations[step.partner]);
      if (step.contact !== "air") {
        positions[step.partner][step.foot] = movementEndpoint(
          positions[step.partner][step.foot],
          orientations[step.partner],
          step.movement,
        );
      }
      restAfter.set(step, positions[step.partner][step.foot]);
      orientations[step.partner] = step.orientation;
    }
  }
  // Where a foot rests at `beat`: after the last of its steps that has
  // finished by then.
  const restAt = (partner: Partner, foot: Foot, beat: number): Point2D => {
    let position = figure.startPose[partner][foot].position;
    for (const step of ordered) {
      if (step.partner !== partner || step.foot !== foot) continue;
      if (endOf(step) > beat + 1e-9) break;
      position = restAfter.get(step)!;
    }
    return position;
  };

  const result = new Map<DanceStep, Passing | undefined>();
  for (const step of ordered) {
    if (step.contact === "air" || step.movement.type !== "straight") {
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

function positionsOf(partner: PartnerPose): Record<Foot, Point2D> {
  return { left: partner.left.position, right: partner.right.position };
}

/**
 * Where a foot is partway through an airborne (`contact: "air"`) step.
 *
 * Contact (step.mts) says an airborne action describes a path for
 * rendering but doesn't change where the foot rests for the next step.
 * The movement only describes one direction of travel, so the foot is
 * modelled as going out along that path for the first half of the step
 * and retracing it back to where it started for the second half. That
 * keeps the animated foot continuous at both ends of the step (no jump
 * back to the resting spot when the step finishes).
 *
 * Provisional modelling choice, not a confirmed technique rule: a real
 * boleo or gancho doesn't necessarily return along the same line, and
 * the out/back split need not be even. If air steps gain their own
 * timing or return path data, this is the function to change.
 */
function airborneExcursionAt(
  rest: Point2D,
  headingBefore: number,
  movement: Movement,
  progress: number,
): Point2D {
  const outward = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
  return movementPointAt(rest, headingBefore, movement, outward);
}

function emptyTrails(startPose: Pose): FootTrails {
  const trails = {} as FootTrails;
  for (const partner of PARTNERS) {
    trails[partner] = {} as Record<Foot, Point2D[]>;
    for (const foot of FEET) {
      trails[partner][foot] = [startPose[partner][foot].position];
    }
  }
  return trails;
}

/**
 * Traces each foot's ordered LOCAL-frame trail (in the figure's own
 * coordinates, unplaced) by folding startPose forward through the
 * figure's steps in beat order. Each trail starts at that foot's
 * startPose position and gains one point per floor step that moves it.
 *
 * A trail records where the foot is placed on the floor, so airborne
 * steps add no point: the foot comes back to where it started (see
 * airborneExcursionAt), and drawing the excursion as part of the floor
 * trail would show a step that never happened. The animated pose from
 * poseAtBeat still shows the excursion while it's in progress.
 */
/** How many straight pieces an arc is drawn with in a trail. */
const ARC_TRAIL_SAMPLES = 12;

function localFootTrails(figure: Figure): FootTrails {
  const positions: Record<Partner, Record<Foot, Point2D>> = {
    lead: {
      left: figure.startPose.lead.left.position,
      right: figure.startPose.lead.right.position,
    },
    follow: {
      left: figure.startPose.follow.left.position,
      right: figure.startPose.follow.right.position,
    },
  };
  const orientationBefore: Record<Partner, number> = {
    lead: figure.startPose.lead.orientation,
    follow: figure.startPose.follow.orientation,
  };

  const trails = emptyTrails(figure.startPose);
  const passings = stepPassings(figure);

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );

  for (const step of orderedSteps) {
    // The step's `orientation` is the partner's frame heading as of the
    // end of this step, regardless of which foot moved -- both feet of
    // a partner share one orientation (see PartnerPose). That holds for
    // airborne steps too, which can still turn the frame.
    if (step.contact === "air") {
      orientationBefore[step.partner] = step.orientation;
      continue;
    }

    const start = positions[step.partner][step.foot];
    const end = movementEndpoint(
      start,
      orientationBefore[step.partner],
      step.movement,
    );

    // An arc, or a step that curves past the standing foot
    // (passingPoint), is drawn as a curve, not its chord: a few points
    // along it before the end point, enough for the bend to read in the
    // trail.
    const passing = passings.get(step);
    if (step.movement.type === "arc" || passing !== undefined) {
      for (let i = 1; i < ARC_TRAIL_SAMPLES; i++) {
        trails[step.partner][step.foot].push(
          stepPointAt(
            start,
            orientationBefore[step.partner],
            step.movement,
            i / ARC_TRAIL_SAMPLES,
            passing,
          ),
        );
      }
    }
    positions[step.partner][step.foot] = end;
    orientationBefore[step.partner] = step.orientation;
    trails[step.partner][step.foot].push(end);
  }

  return trails;
}

/**
 * Traces each foot's floor-space trail for one occurrence of a Figure:
 * its steps folded from startPose, then placed on the floor by
 * `transform` (see applyTransform/fitTransform in floor.mts, which use
 * the same rotation convention).
 */
export function figureFootTrails(
  figure: Figure,
  transform: FloorTransform,
): FootTrails {
  const local = localFootTrails(figure);
  const place = (point: Point2D): Point2D =>
    addPoints(rotatePoint(point, transform.rotation), transform.position);

  const placed = {} as FootTrails;
  for (const partner of PARTNERS) {
    placed[partner] = {} as Record<Foot, Point2D[]>;
    for (const foot of FEET) {
      placed[partner][foot] = local[partner][foot].map(place);
    }
  }
  return placed;
}

/** One foot's discontinuity between two consecutive sequence entries:
 *  where the previous entry's trail ends and the next entry's begins. */
export interface TrailGap {
  /** Index of the later entry -- the gap sits just before it. */
  entryIndex: number;
  partner: Partner;
  foot: Foot;
  from: Point2D;
  to: Point2D;
  /** Distance in metres. */
  distance: number;
}

/**
 * The floor-space trails of a whole Sequence kept as one segment per
 * entry, plus every place where a foot's trail doesn't continue from one
 * entry into the next by more than `gapTolerance`.
 *
 * Unlike sequenceFootTrails, nothing is joined up or dropped at the
 * boundaries, so a renderer can draw each figure's trail as it really
 * is and draw the gaps differently (for example dashed), instead of a
 * straight line across the gap that looks like a step nobody takes.
 * Gaps appear when two figures' stances don't match; see assessJoin in
 * join.mts. The caller passes the tolerance so this module doesn't
 * depend on join.mts.
 */
export function sequenceTrailSegments(
  entries: { figure: Figure; transform: FloorTransform }[],
  gapTolerance: number,
): { segments: FootTrails[]; gaps: TrailGap[] } {
  const segments = entries.map((entry) =>
    figureFootTrails(entry.figure, entry.transform),
  );
  const gaps: TrailGap[] = [];
  for (let entryIndex = 1; entryIndex < segments.length; entryIndex++) {
    for (const partner of PARTNERS) {
      for (const foot of FEET) {
        const previous = segments[entryIndex - 1][partner][foot];
        const from = previous[previous.length - 1];
        const to = segments[entryIndex][partner][foot][0];
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (distance > gapTolerance) {
          gaps.push({ entryIndex, partner, foot, from, to, distance });
        }
      }
    }
  }
  return { segments, gaps };
}

/** Concatenates the floor-space trails of a whole Sequence's entries,
 *  one figureFootTrails call per entry using that entry's own
 *  transform, joined end to end in order. This assumes every join is
 *  exact; where it isn't, the joined trail draws a straight line across
 *  the gap. sequenceTrailSegments keeps the gaps visible instead. */
export function sequenceFootTrails(
  entries: { figure: Figure; transform: FloorTransform }[],
): FootTrails {
  const combined: FootTrails = {
    lead: { left: [], right: [] },
    follow: { left: [], right: [] },
  };

  entries.forEach((entry, index) => {
    const trails = figureFootTrails(entry.figure, entry.transform);
    for (const partner of PARTNERS) {
      for (const foot of FEET) {
        const points = trails[partner][foot];
        // Skip each entry's first point after the first entry -- it's
        // the same point as the previous entry's last (that's the
        // continuity fitTransform is for), so keeping it would just
        // duplicate a vertex in the rendered trail.
        const toAppend = index === 0 ? points : points.slice(1);
        combined[partner][foot].push(...toAppend);
      }
    }
  });

  return combined;
}

// -----------------------------------------------------------------
// Continuous-time playback: a Figure/Sequence's Pose at any instant,
// not just at each step's boundary -- what the scrubber/Timeline needs.
// -----------------------------------------------------------------

/** How many beats one full playthrough of a figure takes: the latest
 *  point any step finishes at (beat is 1-indexed, so a step's own local
 *  interval is [beat - 1, beat - 1 + duration)). A figure with no steps
 *  takes 0 beats. */
export function figureDurationBeats(figure: Figure): number {
  return figure.steps.reduce(
    (max, step) => Math.max(max, step.beat - 1 + step.duration),
    0,
  );
}

/**
 * Interpolated Pose at a continuous local-beat position within one
 * figure (0 = startPose, figureDurationBeats(figure) = endPose).
 *
 * Foot position is interpolated smoothly along its movement's actual
 * path (a straight line, or the real arc, not a shortcut between
 * endpoints). Weight, orientation and rise are interpolated linearly
 * across the same step interval -- a simplification, since the schema
 * only states their value at a step's end, not how they move through
 * it, but it reads as a smooth, believable weight transfer rather than
 * a snap. A renderer can ease the foot's travel instead (PoseOptions).
 */
/**
 * For a "late" step (see WeightTiming in step.mts), the share of the step
 * the foot takes to arrive; the weight then changes over the rest. Two
 * thirds leaves the last third of the count for the weight change, so on
 * a close the feet visibly come together before the body moves across.
 * Provisional: a judgement call, not a technique rule.
 */
export const LATE_WEIGHT_FOOT_SHARE = 2 / 3;

/**
 * How far through its travel the foot is, and how far through its weight
 * change, at `progress` (0 to 1) through a step. For an "even" step both
 * follow the step's own progress. For a "late" step the foot arrives at
 * LATE_WEIGHT_FOOT_SHARE and stays, and only then does the weight move.
 * Orientation and rise still follow the step's own progress.
 */
export function stepPhases(
  step: Pick<DanceStep, "weightTiming">,
  progress: number,
): { foot: number; weight: number } {
  if (step.weightTiming !== "late") return { foot: progress, weight: progress };
  return {
    foot: Math.min(1, progress / LATE_WEIGHT_FOOT_SHARE),
    weight: Math.max(
      0,
      (progress - LATE_WEIGHT_FOOT_SHARE) / (1 - LATE_WEIGHT_FOOT_SHARE),
    ),
  };
}

/**
 * How to draw the motion between the states the model records, for a
 * renderer that wants something other than steady speed. These don't
 * change where anything ends up, only how it gets there.
 */
export interface PoseOptions {
  /**
   * Maps how far through its travel a moving foot is (0 to 1) to how far
   * along its path to draw it. Left out, a foot travels at a steady
   * speed. The renderers pass footEase, so a foot sets off gently and
   * lands softly instead of sliding at a constant speed and stopping
   * dead. Weight, orientation and rise stay linear, so the body keeps
   * moving steadily from step to step.
   */
  footEasing?: (progress: number) => number;
}

/**
 * Smoothstep: starts and ends at rest, fastest in the middle, and
 * symmetric, so halfway through the time the foot is halfway along.
 * Provisional (2026-11-17): a stand-in for real foot timing, which
 * differs by dance (a tango step is quick and then held).
 */
export function footEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * (3 - 2 * t);
}

/**
 * Which way the foot that isn't stepping points after the body turns
 * from `bodyBefore` to `bodyAfter` over it (degrees, compass headings).
 *
 * The rule (provisional, 2026-11-17): a standing foot is never twisted
 * further from the body than it already was. Its offset from the body's
 * facing can only shrink towards zero, never grow or change sign:
 * - while the body turns towards the way the foot points, the foot
 *   stays put and the body catches up (a ballroom chart's "body
 *   completes the turn" over a foot already placed further round);
 * - once the body faces the way the foot points, or when it turns away
 *   from it, the foot swivels with the body (turning on the ball of the
 *   standing foot).
 * With the foot pointing the way the body faces (offset 0), this is
 * the foot turning with the body, which is how every foot moved before
 * feet had their own direction, so figures that don't point a foot
 * play exactly as before.
 */
export function swivelStandingFoot(
  direction: number,
  bodyBefore: number,
  bodyAfter: number,
): number {
  const offset = angleBetweenDegrees(bodyBefore, direction);
  const turn = angleBetweenDegrees(bodyBefore, bodyAfter);
  const wanted = offset - turn;
  const kept =
    offset >= 0
      ? Math.min(Math.max(wanted, 0), offset)
      : Math.max(Math.min(wanted, 0), offset);
  return normalizeDegrees(bodyAfter + kept);
}

export function poseAtBeat(
  figure: Figure,
  localBeat: number,
  options: PoseOptions = {},
): Pose {
  const easeFoot = options.footEasing ?? ((progress: number) => progress);
  const positions: Record<Partner, Record<Foot, Point2D>> = {
    lead: {
      left: figure.startPose.lead.left.position,
      right: figure.startPose.lead.right.position,
    },
    follow: {
      left: figure.startPose.follow.left.position,
      right: figure.startPose.follow.right.position,
    },
  };
  const weights: Record<Partner, Record<Foot, number>> = {
    lead: {
      left: figure.startPose.lead.left.weight,
      right: figure.startPose.lead.right.weight,
    },
    follow: {
      left: figure.startPose.follow.left.weight,
      right: figure.startPose.follow.right.weight,
    },
  };
  const orientations: Record<Partner, number> = {
    lead: figure.startPose.lead.orientation,
    follow: figure.startPose.follow.orientation,
  };
  const rises: Record<Partner, number> = {
    lead: figure.startPose.lead.rise,
    follow: figure.startPose.follow.rise,
  };
  // Which way each foot points. A stepping foot turns to the step's
  // footDirection (the body's facing when it has none); the other foot
  // swivels with the body or holds (swivelStandingFoot).
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

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );
  const passings = stepPassings(figure);

  for (const step of orderedSteps) {
    const stepStart = step.beat - 1;
    const stepEnd = stepStart + step.duration;
    const otherFoot: Foot = step.foot === "left" ? "right" : "left";

    if (localBeat >= stepEnd) {
      // Fully complete by the queried time -- commit its result and
      // move on to whatever comes next. An airborne step has returned
      // to where it started, so its position is left unchanged; its
      // weight (normally 0, putting all weight on the standing foot),
      // orientation and rise still apply.
      if (step.contact !== "air") {
        positions[step.partner][step.foot] = movementEndpoint(
          positions[step.partner][step.foot],
          orientations[step.partner],
          step.movement,
        );
      }
      weights[step.partner][step.foot] = step.weight;
      weights[step.partner][otherFoot] = 1 - step.weight;
      directions[step.partner][otherFoot] = swivelStandingFoot(
        directions[step.partner][otherFoot],
        orientations[step.partner],
        step.orientation,
      );
      directions[step.partner][step.foot] =
        step.footDirection ?? step.orientation;
      orientations[step.partner] = step.orientation;
      rises[step.partner] = step.rise;
      continue;
    }

    if (localBeat <= stepStart) {
      // This step hasn't started yet -- leave it alone. Steps are only
      // sorted by beat, so a *different* foot/partner's step can share
      // this same beat (a normal case: both partners usually step on
      // the same count), so later entries still need checking rather
      // than assuming everything after this one is also in the future.
      continue;
    }

    // In progress: interpolate this one step, then keep going -- a
    // simultaneous step for the other partner (or a foot's later step)
    // can still need processing at this same localBeat.
    const progress = (localBeat - stepStart) / step.duration;
    const { foot: footPhase, weight: weightProgress } = stepPhases(
      step,
      progress,
    );
    const footProgress = easeFoot(footPhase);
    positions[step.partner][step.foot] =
      step.contact === "air"
        ? airborneExcursionAt(
            positions[step.partner][step.foot],
            orientations[step.partner],
            step.movement,
            footProgress,
          )
        : stepPointAt(
            positions[step.partner][step.foot],
            orientations[step.partner],
            step.movement,
            footProgress,
            passings.get(step),
          );
    weights[step.partner][step.foot] = lerp(
      weights[step.partner][step.foot],
      step.weight,
      weightProgress,
    );
    weights[step.partner][otherFoot] = 1 - weights[step.partner][step.foot];
    const bodyNow = lerpAngleDegrees(
      orientations[step.partner],
      step.orientation,
      progress,
    );
    directions[step.partner][otherFoot] = swivelStandingFoot(
      directions[step.partner][otherFoot],
      orientations[step.partner],
      bodyNow,
    );
    // The stepping foot turns as it travels, arriving pointed when it
    // lands.
    directions[step.partner][step.foot] = lerpAngleDegrees(
      directions[step.partner][step.foot],
      step.footDirection ?? step.orientation,
      footProgress,
    );
    orientations[step.partner] = bodyNow;
    rises[step.partner] = lerp(rises[step.partner], step.rise, progress);
  }

  // A foot's direction is only given when it differs from the body's
  // facing (see FootState.direction), so poses of figures that never
  // point a foot are unchanged.
  const footState = (partner: Partner, foot: Foot) => {
    const direction = directions[partner][foot];
    const pointed =
      Math.abs(angleBetweenDegrees(orientations[partner], direction)) > 1e-9;
    return {
      position: positions[partner][foot],
      weight: weights[partner][foot],
      ...(pointed ? { direction } : {}),
    };
  };
  const buildPartnerPose = (partner: Partner): PartnerPose => ({
    left: footState(partner, "left"),
    right: footState(partner, "right"),
    orientation: orientations[partner],
    rise: rises[partner],
  });

  return { lead: buildPartnerPose("lead"), follow: buildPartnerPose("follow") };
}

/** Total beats for a whole Sequence: each entry's figure played end to
 *  end, back to back. */
export function sequenceDurationBeats(entries: { figure: Figure }[]): number {
  return entries.reduce(
    (total, entry) => total + figureDurationBeats(entry.figure),
    0,
  );
}

interface LocatedEntry<E extends { figure: Figure }> {
  entry: E;
  /** Position of `entry` in the entries array. */
  index: number;
  /** globalBeat translated into that entry's own [0, figureDurationBeats]
   *  range, already clamped. */
  localBeat: number;
}

/** Which entry a globalBeat falls into, and its beat translated into
 *  that entry's own local range -- the shared delegation logic behind
 *  both sequencePoseAtBeat and sequenceCurrentStepsAtBeat, so the two
 *  can't disagree about which entry/localBeat is "current". */
function locateEntry<E extends { figure: Figure }>(
  entries: E[],
  globalBeat: number,
): LocatedEntry<E> | null {
  if (entries.length === 0) return null;

  let elapsed = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const duration = figureDurationBeats(entry.figure);
    const isLast = i === entries.length - 1;

    if (globalBeat < elapsed + duration || isLast) {
      const localBeat = Math.min(Math.max(globalBeat - elapsed, 0), duration);
      return { entry, index: i, localBeat };
    }
    elapsed += duration;
  }

  // Unreachable: the loop above always returns by its last iteration
  // (isLast becomes true), given entries.length > 0 was checked above.
  throw new Error("locateEntry: unreachable");
}

/** Where one entry sits on a sequence's beat timeline. */
export interface EntrySpan {
  /** Global beat where the entry's figure starts. */
  startBeat: number;
  /** Global beat where it ends (startBeat + the figure's duration). */
  endBeat: number;
}

/**
 * Each entry's [startBeat, endBeat) span on the sequence's beat
 * timeline, in order. Entries play back to back, so each span starts
 * where the previous one ends; a zero-length figure gets an empty span.
 * Used to divide a scrubber into one segment per figure.
 */
export function sequenceEntrySpans(entries: { figure: Figure }[]): EntrySpan[] {
  let elapsed = 0;
  return entries.map((entry) => {
    const startBeat = elapsed;
    elapsed += figureDurationBeats(entry.figure);
    return { startBeat, endBeat: elapsed };
  });
}

/**
 * Index of the entry that is current at `globalBeat` -- the same one
 * sequencePoseAtBeat and sequenceCurrentStepsAtBeat use, so anything
 * highlighting "the current figure" agrees with what's drawn. A beat
 * exactly on a boundary belongs to the entry starting there; zero-length
 * entries are never current (except as the last entry); positions past
 * either end clamp to the first or last entry. Null for an empty
 * sequence.
 */
export function sequenceEntryIndexAtBeat(
  entries: { figure: Figure }[],
  globalBeat: number,
): number | null {
  return locateEntry(entries, globalBeat)?.index ?? null;
}

/**
 * Interpolated Pose at a continuous position along a whole Sequence, in
 * floor space (already placed by whichever entry's transform is
 * current). 0 is the very start; sequenceDurationBeats(entries) is the
 * very end. Null if there are no entries yet.
 */
export function sequencePoseAtBeat(
  entries: { figure: Figure; transform: FloorTransform }[],
  globalBeat: number,
  options: PoseOptions = {},
): Pose | null {
  const located = locateEntry(entries, globalBeat);
  if (located === null) return null;

  return applyTransform(
    located.entry.transform,
    poseAtBeat(located.entry.figure, located.localBeat, options),
  );
}

/** Each partner's most recently *started* step as of `localBeat` --
 *  whichever is currently in progress, or the last one to have
 *  completed if nothing's in progress right now. Steps are grouped by
 *  partner (not "one active step" for the whole figure) because both
 *  partners normally step at once, and can be doing different things
 *  with different durations. Null for a partner that hasn't taken a
 *  step yet at this point in the figure. */
export function currentStepsAtBeat(
  figure: Figure,
  localBeat: number,
): Record<Partner, DanceStep | null> {
  const current: Record<Partner, DanceStep | null> = {
    lead: null,
    follow: null,
  };

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );

  for (const step of orderedSteps) {
    const stepStart = step.beat - 1;
    if (localBeat < stepStart) continue; // hasn't started yet
    // Started (in progress or since completed) -- later-sorted steps
    // for the same partner correctly overwrite this as localBeat
    // advances past them in turn.
    current[step.partner] = step;
  }

  return current;
}

export interface ActiveStepInfo {
  figureId: string;
  figureName: string;
  steps: Record<Partner, DanceStep | null>;
}

/** Sequence-level version of currentStepsAtBeat: which entry globalBeat
 *  falls into (see locateEntry), and each partner's current step within
 *  it. Null if there are no entries yet. */
export function sequenceCurrentStepsAtBeat(
  entries: { figure: Figure; transform: FloorTransform }[],
  globalBeat: number,
): ActiveStepInfo | null {
  const located = locateEntry(entries, globalBeat);
  if (located === null) return null;

  return {
    figureId: located.entry.figure.id,
    figureName: located.entry.figure.name,
    steps: currentStepsAtBeat(located.entry.figure, located.localBeat),
  };
}
