import { headingToUnitVector } from "../dance/heading.mts";

/**
 * A point or direction in the 3D space the body solver works in.
 *
 * x and y are the floor plane, exactly as in the dance model (metres,
 * +y = line of dance / "north", +x = "east"; see heading.mts), and z is
 * height above the floor, in metres. Keeping the floor axes unchanged
 * means a foot's floor position is just its (x, y) with z = 0. A 3D
 * renderer maps these onto its own axes (Three.js is y-up, so floor y
 * becomes its -z and height its y).
 */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export function vec(x: number, y: number, z: number): Point3D {
  return { x, y, z };
}

export function add(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Point3D, s: number): Point3D {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Point3D): number {
  return Math.sqrt(dot(a, a));
}

export function distance(a: Point3D, b: Point3D): number {
  return length(sub(a, b));
}

/** `a` scaled to length 1, or null if it has (almost) no length. */
export function normalize(a: Point3D): Point3D | null {
  const l = length(a);
  return l < 1e-12 ? null : scale(a, 1 / l);
}

/** The horizontal unit vector for a compass heading (0 = +y, clockwise;
 *  see heading.mts). */
export function headingVector(degrees: number): Point3D {
  const { x, y } = headingToUnitVector(degrees);
  return { x, y, z: 0 };
}

/**
 * Where the middle joint of a two-bone limb goes (a knee between hip
 * and ankle, an elbow between shoulder and wrist), given where the limb
 * starts (`root`) and ends (`end`), its two bone lengths, and `pole`:
 * the direction the joint should bend towards (forwards for a knee).
 *
 * The joint lies in the plane containing root, end and pole, on the
 * pole's side of the line from root to end, at the one spot where both
 * bones keep their lengths (the law of cosines gives the angle at the
 * root). If the end is out of reach, the limb points straight at it and
 * the joint lies on that line; the caller sees the shortfall as the
 * distance from the limb's end to `end`. If the end is too close for
 * the bones to fold that far, the joint folds completely.
 */
export function twoBoneJoint(
  root: Point3D,
  end: Point3D,
  upper: number,
  lower: number,
  pole: Point3D,
): Point3D {
  const toEnd = sub(end, root);
  const reach = length(toEnd);
  const along = normalize(toEnd) ?? vec(0, 0, -1);
  // The pole direction with its component along the limb removed: the
  // way the joint sticks out sideways from the root-end line.
  const out =
    normalize(sub(pole, scale(along, dot(pole, along)))) ??
    normalize(sub(vec(0, 0, -1), scale(along, -along.z))) ??
    vec(1, 0, 0);
  const clamped = Math.min(
    Math.max(reach, Math.abs(upper - lower)),
    upper + lower,
  );
  const cosRoot =
    clamped < 1e-12
      ? 1
      : (upper * upper + clamped * clamped - lower * lower) /
        (2 * upper * clamped);
  const angle = Math.acos(Math.min(1, Math.max(-1, cosRoot)));
  return add(
    root,
    add(
      scale(along, upper * Math.cos(angle)),
      scale(out, upper * Math.sin(angle)),
    ),
  );
}
