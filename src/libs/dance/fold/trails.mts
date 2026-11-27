/**
 * Foot trails: the path each foot traces through a figure or a placed
 * sequence, for drawing.
 */

import { isFreeFootFollow, bodyHeadingBefore } from "../overlap.mts";
import { addPoints, rotatePoint } from "../heading.mts";
import { footHeading } from "../pose.mts";
import type { Point2D, Pose } from "../pose.mts";
import type { FloorTransform } from "../sequence.mts";
import type { DanceStep, Figure, Foot, Partner } from "../step.mts";
import { stepPassings, stepPointAt } from "./passing.mts";
import {
  ARC_TRAIL_SAMPLES,
  FEET,
  PARTNERS,
  movementEndpoint,
} from "./paths.mts";
import {
  standingShare,
  standingSwivelShift,
  swivelShift,
  swivelStandingFoot,
  turnsOnTheSpot,
} from "./timing.mts";

export type FootTrails = Record<Partner, Record<Foot, Point2D[]>>;

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

  // Which way each foot points (as in poseAtBeat), for the feet that
  // turn about their ball or heel (DanceStep.swivel) and so move.
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

  const trails = emptyTrails(figure.startPose);
  const passings = stepPassings(figure);

  const orderedSteps: DanceStep[] = [...figure.steps].sort(
    (a, b) => a.beat - b.beat,
  );

  for (const step of orderedSteps) {
    const free = isFreeFootFollow(step, figure.steps);
    const frame = free
      ? bodyHeadingBefore(step, figure.steps, figure.startPose)
      : orientationBefore[step.partner];
    // The standing foot swivels with the body, and moves while it's down
    // if it turns about its ball or heel.
    if (!free) {
      const otherFoot: Foot = step.foot === "left" ? "right" : "left";
      const shift = standingSwivelShift(
        step.swivel,
        directions[step.partner][otherFoot],
        orientationBefore[step.partner],
        step.orientation,
        standingShare(step, figure.steps),
      );
      if (shift.x !== 0 || shift.y !== 0) {
        positions[step.partner][otherFoot] = addPoints(
          positions[step.partner][otherFoot],
          shift,
        );
        trails[step.partner][otherFoot].push(
          positions[step.partner][otherFoot],
        );
      }
      directions[step.partner][otherFoot] = swivelStandingFoot(
        directions[step.partner][otherFoot],
        orientationBefore[step.partner],
        step.orientation,
      );
    }
    const pointing = step.footDirection ?? step.orientation;
    const turnShift = turnsOnTheSpot(step)
      ? swivelShift(step.swivel, directions[step.partner][step.foot], pointing)
      : { x: 0, y: 0 };
    directions[step.partner][step.foot] = pointing;
    // The step's `orientation` is the partner's frame heading as of the
    // end of this step, regardless of which foot moved -- both feet of
    // a partner share one orientation (see PartnerPose). That holds for
    // airborne steps too, which can still turn the frame.
    if (step.contact === "air") {
      if (!free) orientationBefore[step.partner] = step.orientation;
      continue;
    }

    const start = positions[step.partner][step.foot];
    const end = addPoints(
      movementEndpoint(start, frame, step.movement),
      turnShift,
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
            frame,
            step.movement,
            i / ARC_TRAIL_SAMPLES,
            passing,
          ),
        );
      }
    }
    positions[step.partner][step.foot] = end;
    if (!free) orientationBefore[step.partner] = step.orientation;
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
