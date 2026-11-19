/**
 * The checks defineFigure runs on a figure's whole movement: the hold
 * after every row, the feet (crossed feet, own feet, partner spacing)
 * sampled through the figure, and expectEnd.
 */

import { applyTransform } from "../floor.mts";
import {
  FOOTPRINT_LENGTH,
  FOOTPRINT_WIDTH,
  figureDurationBeats,
  footprintGap,
  poseAtBeat,
} from "../fold.mts";
import {
  addPoints,
  headingToUnitVector,
  normalizeDegrees,
  rotatePoint,
  subPoints,
} from "../heading.mts";
import { footHeading } from "../pose.mts";
import type { Point2D, Pose } from "../pose.mts";
import type { Figure, Foot, Partner } from "../step.mts";
import { bodyPosition } from "../weight.mts";
import { FigureError } from "./definition.mts";
import type { ExpectedEnd, FootCheck, StepRow } from "./definition.mts";
import { turnDegrees } from "./moves.mts";
import {
  FOOT,
  HOLD_OFFSET,
  OTHER,
  PARTNER_DISTANCE,
  stancePose,
} from "./stances.mts";

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
export function checkHold(
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
export function checkFeet(
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

/** Matching tolerance for expectEnd: 1 mm, enough for rounded values. */
const POSITION_TOLERANCE = 1e-3;
const ANGLE_TOLERANCE = 1e-6;

export function checkExpectedEnd(
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
