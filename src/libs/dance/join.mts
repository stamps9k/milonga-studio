import type { Figure, Foot, Partner } from "./step.mts";
import type { Pose } from "./pose.mts";
import type { FloorTransform } from "./sequence.mts";
import { applyTransform, fitTransform } from "./floor.mts";
import { normalizeDegrees } from "./heading.mts";

/**
 * Measures how well one figure follows on from where the couple is: the
 * previous figure's resolved endPose. It places the next figure exactly
 * the way the sequence builder does (fitTransform), then reports what
 * still doesn't line up:
 *
 * - foot gap: how far any foot would have to jump between where the
 *   previous figure left it and where the next figure starts it;
 * - facing change: how far either partner's frame would snap round at
 *   the join (the lead's is 0 by construction, since fitTransform aligns
 *   it; the follow's can differ, as after the Ocho);
 * - weighted foot: the next figure's first travelling step for a partner
 *   moves the foot that partner is standing on at the join, which a
 *   dancer can't do.
 *
 * This is the "these two figures don't connect cleanly" signal that
 * fitTransform's docs point at. It is measurement only: nothing here
 * stops a join from being used. The UI decides what to do with it.
 */

/** Largest foot gap, in floor units, still treated as a clean join.
 *  Provisional: 5 cm at the metre scale the seed uses, enough to absorb
 *  hand-typed rounding while still flagging real stance mismatches,
 *  which start at about 15 cm in the seed data. */
export const JOIN_FOOT_GAP_TOLERANCE = 0.05;

/** Largest change in a partner's facing, in degrees, still treated as a
 *  clean join. Provisional: small enough to flag a visible snap, large
 *  enough to ignore rounding in hand-typed orientations. */
export const JOIN_FACING_TOLERANCE = 10;

/** One way a join fails to line up. */
export type JoinIssue =
  | {
      kind: "foot-gap";
      partner: Partner;
      foot: Foot;
      /** Distance in floor units. */
      distance: number;
    }
  | {
      kind: "facing-change";
      partner: Partner;
      /** Signed turn in degrees, in (-180, 180]; positive is clockwise. */
      degrees: number;
    }
  | {
      kind: "weighted-foot";
      partner: Partner;
      /** The foot the next figure moves first, which carries all of the
       *  partner's weight at the join. */
      foot: Foot;
    };

export interface JoinAssessment {
  /** Where the next figure is placed -- the same transform the sequence
   *  builder would use. */
  transform: FloorTransform;
  /** The largest distance any foot jumps at the join, in floor units. */
  maxFootGap: number;
  /** Signed facing change per partner at the join, in degrees. */
  facingChange: Record<Partner, number>;
  /** Everything over tolerance, in a stable order: foot gaps (lead then
   *  follow, left then right), facing changes, then weighted feet. */
  issues: JoinIssue[];
  /** True when there are no issues. */
  fits: boolean;
}

const PARTNERS: readonly Partner[] = ["lead", "follow"];
const FEET: readonly Foot[] = ["left", "right"];

/** Signed shortest turn from `from` to `to`, in (-180, 180]. */
function signedTurn(from: number, to: number): number {
  const turn = normalizeDegrees(to - from);
  return turn > 180 ? turn - 360 : turn;
}

/** The first step of `figure` that moves `partner`'s foot across the
 *  floor, in beat order. Zero-distance steps (weight changes, pivots)
 *  and airborne steps don't move a foot that's carrying weight, so they
 *  don't count. */
function firstTravellingStep(figure: Figure, partner: Partner) {
  return [...figure.steps]
    .filter((step) => step.partner === partner)
    .sort((a, b) => a.beat - b.beat)
    .find(
      (step) =>
        step.contact === "floor" &&
        (step.movement.type === "arc" || step.movement.distance > 0),
    );
}

/**
 * Assesses placing `next` after a figure that ended at `previousEnd`
 * (already placed on the floor, i.e. a SequenceEntry's resolvedEndPose).
 */
export function assessJoin(previousEnd: Pose, next: Figure): JoinAssessment {
  const transform = fitTransform(next.startPose, previousEnd);
  const placedStart = applyTransform(transform, next.startPose);
  const issues: JoinIssue[] = [];

  let maxFootGap = 0;
  for (const partner of PARTNERS) {
    for (const foot of FEET) {
      const from = previousEnd[partner][foot].position;
      const to = placedStart[partner][foot].position;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      maxFootGap = Math.max(maxFootGap, distance);
      if (distance > JOIN_FOOT_GAP_TOLERANCE) {
        issues.push({ kind: "foot-gap", partner, foot, distance });
      }
    }
  }

  const facingChange = {} as Record<Partner, number>;
  for (const partner of PARTNERS) {
    const degrees = signedTurn(
      previousEnd[partner].orientation,
      placedStart[partner].orientation,
    );
    facingChange[partner] = degrees;
    if (Math.abs(degrees) > JOIN_FACING_TOLERANCE) {
      issues.push({ kind: "facing-change", partner, degrees });
    }
  }

  // Judged against the weights where the previous figure actually left
  // the couple, not against next.startPose's weights: the question is
  // whether the next figure's first step can be taken from here.
  // Provisional rule (the same one test/db/seed.test.mts applies within
  // figures): a travelling step needs a foot that isn't carrying all of
  // the partner's weight.
  for (const partner of PARTNERS) {
    const step = firstTravellingStep(next, partner);
    if (step && previousEnd[partner][step.foot].weight >= 1 - 1e-9) {
      issues.push({ kind: "weighted-foot", partner, foot: step.foot });
    }
  }

  return {
    transform,
    maxFootGap,
    facingChange,
    issues,
    fits: issues.length === 0,
  };
}
