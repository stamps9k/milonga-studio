/**
 * Named stances a figure can start or end in, and the measurements
 * behind them: closed hold, the promenades, the contra check and the
 * spin turn's finish.
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
 * forward his right foot goes between her feet (owner's request; Smooth
 * and Standard references put it at up to half a body width).
 *
 * Half the stance width is exactly the shift that puts the lead's right
 * foot in line with the gap between her feet, so that's the value used.
 * Ballroom tango uses the same offset (see TANGO_HOLD).
 *
 * The promenade stances keep the same offset in the closed frame they
 * opened from. Because their line of travel runs towards -x, the
 * follow's +x shift puts her slightly behind the lead along the line,
 * as in real promenade (the V's point at his right hip and her left).
 */
export const HOLD_OFFSET = STANCE_WIDTH / 2;

/**
 * The shape of a closed hold on the floor, in metres:
 * - `offset`: how far the follow stands to the lead's right, as
 *   HOLD_OFFSET;
 * - `distance`: how far she stands in front of him, as PARTNER_DISTANCE;
 * - `promenadeDistance`: how far she is from him in the promenade
 *   stances, measured the same way in the closed frame they opened from;
 * - `drawBack`: how far the lead's right foot is drawn back behind his
 *   left in closed position, and the follow's left behind her right (her
 *   right foot is forward, towards him), measured along each dancer's
 *   facing. A close in this hold keeps that stagger (see applyMove).
 *
 * With a stagger the closed stance is measured from the drawn-back
 * feet, the ones the tango figures stand on in closed position: her
 * left foot is `offset` to the right of his right foot and `distance`
 * in front of it, so the bodies keep the hold's spacing while each
 * stands on that foot. Without one (drawBack 0) this is the same as
 * measuring from the middle of the feet.
 */
export interface HoldShape {
  offset: number;
  distance: number;
  promenadeDistance: number;
  drawBack: number;
}

/** Which closed hold a figure dances in: ballroom tango's compact hold,
 *  or the standard one every other style uses (including Argentine
 *  tango, whose figures are written with it). */
export type HoldKind = "standard" | "tango";

/**
 * Ballroom tango's closed hold: more compact than the standard hold,
 * with the lead's right foot drawn slightly back. Owner's choice: 0.35
 * in front (bodies about 0.36 apart, against 0.41 in the standard hold)
 * and a draw-back of 0.08. The offset stays HOLD_OFFSET: real tango's is
 * larger, but with feet STANCE_WIDTH apart her right foot only passes
 * between his feet (a walk, the Back Corté) at an offset up to half the
 * stance width, and a larger one would need every such step angled. The
 * book's toe-level-with-heel draw-back (a whole foot length) would put
 * her right foot on his toes. Provisional: judgement calls the owner
 * agreed from sketches, not measurements.
 */
export const TANGO_HOLD: HoldShape = {
  offset: HOLD_OFFSET,
  distance: 0.35,
  promenadeDistance: 0.38,
  drawBack: 0.08,
};

export const HOLD_SHAPES: Record<HoldKind, HoldShape> = {
  standard: {
    offset: HOLD_OFFSET,
    distance: PARTNER_DISTANCE,
    promenadeDistance: PARTNER_DISTANCE,
    drawBack: 0,
  },
  tango: TANGO_HOLD,
};

/** The hold a figure of `style` dances in: only ballroom tango ("tango")
 *  has its own. */
export function holdForStyle(style: string): HoldKind {
  return style === "tango" ? "tango" : "standard";
}

/** Whether `foot` is the one a hold draws back: the lead's right, the
 *  follow's left. */
export function isDrawnBack(partner: Partner, foot: Foot): boolean {
  return partner === "lead" ? foot === "right" : foot === "left";
}

/**
 * Named positions a figure can start or end in (`start`, and
 * `expectEnd.stance`):
 * - "closed": closed hold. The midpoint of the lead's feet is at the
 *   origin, the lead faces line of dance (0) and the follow faces him
 *   (180), the hold's `distance` in front and `offset` to his right
 *   (see HoldShape; in ballroom tango his right foot and her left are
 *   drawn back).
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
 * - "tango promenade": the ballroom tango promenade, where the book's
 *   Progressive Link ends and the Closed Promenade starts. The same V
 *   and frame as the waltz promenades: the lead hasn't turned from
 *   closed position and the follow has turned a quarter to the right.
 *   Each stands on the inside foot (the lead's right, the follow's
 *   left); his left is where it would be in closed position and her
 *   right is still in front of it. See tangoPromenadePose.
 * - "contra check": the compact checked position in the original closed
 *   frame, lead LF / follow RF weighted, with 15° left contra rotation and
 *   3 cm lowering. See CONTRA_CHECK_* for the dimensions.
 * - "spin turn finish": where the owner's Underturned Natural Spin Turn
 *   (4–6) ends, so the Reverse Turn (4–6) can start there. Not the book's
 *   standard closed position: the lead stands on his left with his right
 *   forward on a diagonal, and the follow is slightly to his left and
 *   close in front, the slightly open finish the owner dances. See
 *   SPIN_TURN_FINISH. Named by the owner (2026-11-20).
 */
export type StanceName =
  | "closed"
  | "crossed promenade"
  | "promenade apart"
  | "tango promenade"
  | "contra check"
  | "spin turn finish";

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

/** The owner's compact contra check, in metres and degrees: how far
 *  the lead's left foot goes forward and inward from closed stance, the
 *  bodies' left turn and the lowering. Shared by Contra Check's end and
 *  its recoveries' start. */
export const CONTRA_CHECK_ADVANCE = 0.4;
export const CONTRA_CHECK_INWARD = 0.14;
export const CONTRA_CHECK_TURN = 15;
export const CONTRA_CHECK_LOWERING = 0.03;

/** "spin turn finish", measured from where the Underturned Natural Spin
 *  Turn (4–6) ends rather than designed, so the numbers aren't round;
 *  they're kept to full precision so the two figures join exactly. In
 *  metres, with the midpoint of the lead's feet at the origin, the lead
 *  facing 0 and the follow facing 180. `body` is each partner's pelvis
 *  offset (bodyOffset) at that moment, kept so the next figure starts
 *  without a jump. If the spin turn's ending changes, measure again. */
export const SPIN_TURN_FINISH = {
  lead: {
    left: { x: -0.1237436867076459, y: -0.1590990257669731 },
    right: { x: 0.1237436867076458, y: 0.159099025766973 },
    body: { x: -0.0892082629963074, y: 0.002392470494365 },
  },
  follow: {
    left: { x: -0.1590990257669732, y: 0.5833630944789014 },
    right: { x: -0.2021602127002605, y: 0.2456859152217565 },
    body: { x: 0.0892082629963074, y: -0.002392470494365 },
  },
} as const;

export const STANCE_NAMES: readonly StanceName[] = [
  "closed",
  "crossed promenade",
  "promenade apart",
  "tango promenade",
  "contra check",
  "spin turn finish",
];

export type ShortFoot = "L" | "R";

export const FOOT: Record<ShortFoot, Foot> = { L: "left", R: "right" };
export const OTHER: Record<Foot, Foot> = { left: "right", right: "left" };

/** Feet positions of a named stance, with each partner standing on the
 *  given foot, in the given hold. */
export function stancePose(
  stance: StanceName,
  standing: Record<Partner, Foot>,
  hold: HoldKind = "standard",
): Pose {
  const half = STANCE_WIDTH / 2;
  const shape = HOLD_SHAPES[hold];
  const weight = (partner: Partner, foot: Foot) =>
    standing[partner] === foot ? 1 : 0;
  switch (stance) {
    case "crossed promenade":
      return crossedPromenadePose(weight, shape);
    case "promenade apart":
      return promenadeApartPose(weight, shape);
    case "tango promenade":
      return tangoPromenadePose(weight, shape);
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
            position: { x: shape.offset + half, y: shape.distance },
            weight: weight("follow", "left"),
          },
          right: {
            position: {
              x: shape.offset - half + CONTRA_CHECK_INWARD,
              y: shape.distance + CONTRA_CHECK_ADVANCE,
            },
            weight: weight("follow", "right"),
            direction: 180,
          },
          orientation: 180 - CONTRA_CHECK_TURN,
          rise: -CONTRA_CHECK_LOWERING,
        },
      };
    case "spin turn finish": {
      const partner = (who: Partner, orientation: number) => {
        const f = SPIN_TURN_FINISH[who];
        return {
          left: { position: { ...f.left }, weight: weight(who, "left") },
          right: { position: { ...f.right }, weight: weight(who, "right") },
          orientation,
          rise: 0,
          bodyOffset: { ...f.body },
        };
      };
      return { lead: partner("lead", 0), follow: partner("follow", 180) };
    }
    case "closed": {
      // The lead's feet straddle the origin, his right foot drawn back
      // (shape.drawBack, 0 outside tango). Her left foot is `offset` to
      // the right of his right foot and `distance` in front of it, and
      // her right foot is STANCE_WIDTH to her right and drawBack nearer
      // him. In the standard hold she is HOLD_OFFSET to his right: her
      // right foot is straight in front of the middle of his feet, so his
      // right foot is in line with the gap between hers.
      const back = shape.drawBack / 2;
      const followLeft = {
        x: half + shape.offset,
        y: shape.distance - back,
      };
      return {
        lead: {
          left: {
            position: { x: -half, y: back },
            weight: weight("lead", "left"),
          },
          right: {
            position: { x: half, y: 0 - back },
            weight: weight("lead", "right"),
          },
          orientation: 0,
          rise: 0,
        },
        follow: {
          left: { position: followLeft, weight: weight("follow", "left") },
          right: {
            position: {
              x: followLeft.x - STANCE_WIDTH,
              y: followLeft.y - shape.drawBack,
            },
            weight: weight("follow", "right"),
          },
          orientation: 180,
          rise: 0,
        },
      };
    }
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
  shape: HoldShape,
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
  const followLeft = { x: shape.offset, y: shape.distance };
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
  shape: HoldShape,
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
    x: shape.offset,
    y: shape.distance + 2 * PROMENADE_SEPARATION,
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
 * on. It is where the book's Progressive Link ends: the lead hasn't
 * turned, the follow has turned a quarter to the right and stepped
 * round to his right side, and each keeps the feet as in closed
 * position:
 *
 * - Lead: right foot at (0, 0); left foot STANCE_WIDTH to his left and
 *   the hold's `drawBack` in front of it (the right foot drawn back, as
 *   in closed position), so it is about 20 cm ahead along the line.
 * - Follow: left foot the hold's `promenadeDistance` across the line and
 *   its `offset` behind along it (at (0.1, 0.38) in the tango hold);
 *   right foot still where she stepped back on the link's first quick,
 *   in front of his left foot as in closed position (`offset` to his
 *   right and `distance` less both draw-backs ahead, in his facing). She
 *   turns into promenade over it, so it is in the V's mouth, about 21 cm
 *   from his left foot.
 *
 * In the tango hold the partners are a little further apart than the
 * compact closed distance: at 0.35 the inside legs (his right, her left)
 * touch as the hips open into the V. The weights come from `weight`,
 * normally on the inside feet.
 */
function tangoPromenadePose(
  weight: (partner: Partner, foot: Foot) => number,
  shape: HoldShape,
): Pose {
  // In the lead's facing (315): `right` across and `ahead` forward.
  const inLeadFrame = (right: number, ahead: number) =>
    addPoints(
      scalePoint(headingToUnitVector(315 + 90), right),
      scalePoint(headingToUnitVector(315), ahead),
    );
  const leadRight = { x: 0, y: 0 };
  // His left foot as in closed position: STANCE_WIDTH to his left, his
  // right drawn back behind it.
  const leadLeft = inLeadFrame(-STANCE_WIDTH, shape.drawBack);
  const followLeft = { x: shape.offset, y: shape.promenadeDistance };
  return {
    lead: {
      left: {
        position: leadLeft,
        weight: weight("lead", "left"),
      },
      right: { position: leadRight, weight: weight("lead", "right") },
      orientation: 315,
      rise: 0,
    },
    follow: {
      left: { position: followLeft, weight: weight("follow", "left") },
      right: {
        position: addPoints(
          leadLeft,
          inLeadFrame(shape.offset, shape.distance - 2 * shape.drawBack),
        ),
        weight: weight("follow", "right"),
      },
      orientation: 225,
      rise: 0,
    },
  };
}
