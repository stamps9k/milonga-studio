import {
  dot,
  sub,
  add,
  scale,
  distance,
} from "../../src/libs/body/vector3.mts";
import type { Point3D } from "../../src/libs/body/vector3.mts";
// Closest points on two finite, nonzero bone segments: solve the unconstrained
// pair, then clamp to endpoints and solve the remaining parameter again.
// Test-only capsule proxy for the mannequin; not a character-mesh guarantee.
export function segmentDistance(
  p1: Point3D,
  q1: Point3D,
  p2: Point3D,
  q2: Point3D,
) {
  const d1 = sub(q1, p1),
    d2 = sub(q2, p2),
    r = sub(p1, p2);
  const a = dot(d1, d1),
    e = dot(d2, d2),
    f = dot(d2, r),
    c = dot(d1, r),
    b = dot(d1, d2);
  let s = 0;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const denom = a * e - b * b;
  if (denom > 1e-12) s = clamp((b * f - c * e) / denom);
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a);
  }
  return distance(add(p1, scale(d1, s)), add(p2, scale(d2, t)));
}
