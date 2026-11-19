/**
 * Named stances a figure can start or end in, and the measurements
 * behind them: closed hold, the promenades and the contra check.
 * stancePose builds the feet of a stance.
 */

import { addPoints, headingToUnitVector, scalePoint } from "../heading.mts";
import type { Point2D, Pose } from "../pose.mts";
import type { Foot, Partner } from "../step.mts";

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
 *   3 cm lowering. See CONTRA_CHECK_* for the dimensions.
 */
export type StanceName =
  | "closed"
  | "crossed promenade"
  | "promenade apart"
  | "tango promenade"
  | "contra check";

/** In "crossed promenade", how far the crossing foot is behind the
 *  other foot, and how far across it, in metres, measured in the
 *  opened facing. From the owner's description of the whisk ("toe
 *  just behind the right heel"). */
export const CROSS_BEHIND = 0.25;
export const CROSS_ACROSS = 0.05;

/** In "promenade apart", how far the leading foot is past the trailing
 *  foot along the line of travel, in metres: the chassé's side step.
 *  The owner's side-step size for the waltz figures. */
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
 *  the line of travel from the inside foot, in metres. The owner's
 *  link steps wide, landing level with the other foot 0.4 out from
 *  where it was, from a closed stance 0.2 wide. */
export const TANGO_PROMENADE_WIDTH = 0.6;

/** The owner's compact contra check, in metres and degrees: how far
 *  the lead's left foot goes forward and inward from closed stance, the
 *  bodies' left turn and the lowering. Shared by Contra Check's end and
 *  its recoveries' start. */
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

export type ShortFoot = "L" | "R";

export const FOOT: Record<ShortFoot, Foot> = { L: "left", R: "right" };
export const OTHER: Record<Foot, Foot> = { left: "right", right: "left" };

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
      // A compact CBMP check. Feet retain their forward/back line while the bodies turn 15° left.
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
