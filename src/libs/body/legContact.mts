import type { HoldKind } from "../dance/authoring.mts";
import type { Foot, Partner } from "../dance/step.mts";
import type { CoupleSkeleton, PartnerSkeleton } from "./skeleton.mts";
import { add, distance, dot, normalize, scale, sub, vec } from "./vector3.mts";
import type { Point3D } from "./vector3.mts";

/**
 * Keeping the dancers' legs from passing through each other.
 *
 * In closed hold each partner's right leg goes between the other's legs,
 * in lanes only about 10 cm apart, so real legs brush and slide past
 * each other. The solver's legs are rigid: hip and ankle are fixed by
 * the hips and feet, and the knee bends straight towards the toes. Where
 * a knee would pass through the partner's leg, slideKnees swings it
 * sideways round the line from hip to ankle instead, the way a real knee
 * gives a little in or out to slide past. The hips and feet don't move,
 * so nothing the dance model describes changes; only the bend of the
 * legs does.
 *
 * Legs are measured as capsules (round-ended cylinders) round the
 * thigh and shin bones, with the mannequin's radii (LEG_RADII), so the
 * mannequins drawn from the same skeleton touch rather than overlap.
 */

/** The radii of the thigh and shin capsules, in metres: the mannequin's
 *  leg thickness (scene3d.mts draws its legs with these). */
export const LEG_RADII = { thigh: 0.06, shin: 0.045 } as const;

/**
 * How far a knee may swing sideways from its natural bend, in degrees,
 * round the line from hip to ankle. Provisional: a knee that points up
 * to about 30 degrees away from the toes still looks like a knee giving
 * a little in or out, not a twisted leg.
 */
export const MAX_KNEE_SWING = 30;

/**
 * How far leg capsules may press into each other before a knee swings,
 * in metres: real thighs and calves give a little where they touch, and
 * a rigid tube is a rough outline of a leg anyway. Provisional.
 */
export const LEG_CONTACT = 0.01;

/**
 * The contact allowed in ballroom tango's hold, in metres. Its compact,
 * staggered hold puts her right leg in the lane beside his right leg,
 * and the right thighs pressing together is tango's real point of
 * contact, so they may press in further before a knee swings. Owner's
 * choice over leaning the hips apart, which tango technique doesn't do.
 * Provisional.
 */
export const TANGO_LEG_CONTACT = 0.02;

/** The contact allowed in a hold of the given kind. */
export function legContactFor(hold: HoldKind): number {
  return hold === "tango" ? TANGO_LEG_CONTACT : LEG_CONTACT;
}

/** Closest distance between two line segments p1-q1 and p2-q2: the
 *  closest points of the infinite lines, clamped to the segments, with
 *  the other parameter solved again after clamping. */
export function segmentDistance(
  p1: Point3D,
  q1: Point3D,
  p2: Point3D,
  q2: Point3D,
): number {
  const d1 = sub(q1, p1),
    d2 = sub(q2, p2),
    r = sub(p1, p2);
  const a = dot(d1, d1),
    e = dot(d2, d2),
    f = dot(d2, r),
    c = dot(d1, r),
    b = dot(d1, d2);
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  if (a < 1e-12 && e < 1e-12) return distance(p1, p2);
  let s = 0;
  let t = 0;
  if (a < 1e-12) t = clamp(f / e);
  else if (e < 1e-12) s = clamp(-c / a);
  else {
    const denom = a * e - b * b;
    if (denom > 1e-12) s = clamp((b * f - c * e) / denom);
    t = (b * s + f) / e;
    if (t < 0) {
      t = 0;
      s = clamp(-c / a);
    } else if (t > 1) {
      t = 1;
      s = clamp((b - c) / a);
    }
  }
  return distance(add(p1, scale(d1, s)), add(p2, scale(d2, t)));
}

/** A leg bone as a capsule. */
interface Capsule {
  a: Point3D;
  b: Point3D;
  radius: number;
}

function legCapsules(skeleton: PartnerSkeleton, side: Foot): Capsule[] {
  const j = skeleton.joints;
  const hip = side === "left" ? j.leftUpperLeg : j.rightUpperLeg;
  const knee = side === "left" ? j.leftLowerLeg : j.rightLowerLeg;
  const ankle = side === "left" ? j.leftFoot : j.rightFoot;
  return [
    { a: hip, b: knee, radius: LEG_RADII.thigh },
    { a: knee, b: ankle, radius: LEG_RADII.shin },
  ];
}

/** The smallest gap between the leg hip-knee-ankle and any of the
 *  obstacles, surface to surface (negative where they overlap). */
function legGap(
  hip: Point3D,
  knee: Point3D,
  ankle: Point3D,
  obstacles: readonly Capsule[],
): number {
  let gap = Infinity;
  for (const o of obstacles) {
    gap = Math.min(
      gap,
      segmentDistance(hip, knee, o.a, o.b) - LEG_RADII.thigh - o.radius,
      segmentDistance(knee, ankle, o.a, o.b) - LEG_RADII.shin - o.radius,
    );
  }
  return gap;
}

/** The knee swung `degrees` round the hip-ankle line (positive turns it
 *  clockwise looking from the hip down the leg). */
function swungKnee(
  hip: Point3D,
  knee: Point3D,
  ankle: Point3D,
  degrees: number,
): Point3D {
  const axis = normalize(sub(ankle, hip));
  if (axis === null) return knee;
  const rel = sub(knee, hip);
  const along = scale(axis, dot(rel, axis));
  const out = sub(rel, along);
  const side = vec(
    axis.y * out.z - axis.z * out.y,
    axis.z * out.x - axis.x * out.z,
    axis.x * out.y - axis.y * out.x,
  );
  const t = (degrees * Math.PI) / 180;
  return add(
    hip,
    add(along, add(scale(out, Math.cos(t)), scale(side, Math.sin(t)))),
  );
}

/**
 * How far to swing one knee, in degrees, so the leg clears `obstacles`:
 * 0 if the legs at most touch (pressing in no more than `contact`);
 * otherwise the smallest swing, towards whichever side opens the gap
 * faster, that brings them back to that, found by stepping
 * out a degree at a time and then bisecting, so the swing grows smoothly
 * as the overlap does. If no swing up to MAX_KNEE_SWING clears, the one
 * on that side leaving the largest gap.
 */
function kneeSwing(
  hip: Point3D,
  knee: Point3D,
  ankle: Point3D,
  obstacles: readonly Capsule[],
  contact: number,
): number {
  const gapAt = (degrees: number) =>
    legGap(hip, swungKnee(hip, knee, ankle, degrees), ankle, obstacles);
  if (gapAt(0) >= -contact) return 0;
  const sign = gapAt(1) >= gapAt(-1) ? 1 : -1;
  let best = { degrees: 0, gap: gapAt(0) };
  let previous = 0;
  for (let degrees = 1; degrees <= MAX_KNEE_SWING; degrees += 1) {
    const gap = gapAt(sign * degrees);
    if (gap >= -contact) {
      let low = previous;
      let high = degrees;
      for (let i = 0; i < 20; i++) {
        const middle = (low + high) / 2;
        if (gapAt(sign * middle) >= -contact) high = middle;
        else low = middle;
      }
      return sign * high;
    }
    if (gap > best.gap) best = { degrees: sign * degrees, gap };
    previous = degrees;
  }
  return best.degrees;
}

function withKnee(
  skeleton: PartnerSkeleton,
  side: Foot,
  knee: Point3D,
  degrees: number,
): PartnerSkeleton {
  return {
    ...skeleton,
    joints: {
      ...skeleton.joints,
      ...(side === "left" ? { leftLowerLeg: knee } : { rightLowerLeg: knee }),
    },
    kneeSwing: { ...skeleton.kneeSwing, [side]: degrees },
  };
}

/**
 * Swings the knees where a leg would press into the partner's legs by
 * more than `contact` (LEG_CONTACT, or legContactFor the hold), so the
 * legs slide past each other (see the
 * top of this file). The lead's legs give way first, against the
 * follow's legs as solved; then the follow's against the lead's new
 * ones, which clears whatever his swing limit left. Only the knees move,
 * and only where the legs would overlap.
 */
export function slideKnees(
  couple: CoupleSkeleton,
  contact: number = LEG_CONTACT,
): CoupleSkeleton {
  const result: Record<Partner, PartnerSkeleton> = { ...couple };
  for (const partner of ["lead", "follow"] as const) {
    const other = partner === "lead" ? "follow" : "lead";
    for (const side of ["left", "right"] as const) {
      const self = result[partner];
      const j = self.joints;
      const hip = side === "left" ? j.leftUpperLeg : j.rightUpperLeg;
      const knee = side === "left" ? j.leftLowerLeg : j.rightLowerLeg;
      const ankle = side === "left" ? j.leftFoot : j.rightFoot;
      const obstacles = [
        ...legCapsules(result[other], "left"),
        ...legCapsules(result[other], "right"),
      ];
      const degrees = kneeSwing(hip, knee, ankle, obstacles, contact);
      if (degrees !== 0)
        result[partner] = withKnee(
          self,
          side,
          swungKnee(hip, knee, ankle, degrees),
          degrees,
        );
    }
  }
  return result;
}
