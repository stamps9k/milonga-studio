import { sequenceTrailSegments } from "../dance/fold.mts";
import type { Footprint } from "../dance/footprints.mts";
import { headingToUnitVector } from "../dance/heading.mts";
import type { Point2D } from "../dance/pose.mts";
import type { Figure, Foot } from "../dance/step.mts";
import type { FloorTransform } from "../dance/sequence.mts";
import type { JointName } from "../body/skeleton.mts";
import type { Point3D } from "../body/vector3.mts";
import { FOOT_OUTLINES } from "./figureShapes.mts";
import { FEET, PARTNERS } from "./layout2d.mts";

/**
 * The parts of the 3D view that don't need WebGL: how floor space maps
 * onto Three.js's axes, which bones the mannequin is made of, where the
 * camera starts, and the outline of a footprint on the floor. Renderer3D
 * builds the scene from these. Kept apart so they can be tested under
 * node:test.
 */

/**
 * Floor space (the dance model's x and y, plus height z; see
 * body/vector3.mts) to Three.js's axes, which have y up. Floor x stays
 * x, height becomes y, and floor +y (the line of dance, "north")
 * becomes -z, which keeps the axes right-handed. A camera looking down
 * -z, as Three.js cameras do by default, looks up the line of dance.
 */
export function toThree(point: Point3D): [number, number, number] {
  return [point.x, point.z, -point.y];
}

/** One rigid segment of the mannequin, drawn between two joints. */
export interface Bone {
  from: JointName;
  to: JointName;
  /** Thickness, in metres. */
  radius: number;
  /** Which side of the body, for the left/right shading; "middle" for
   *  the spine and the bars across the hips and shoulders. */
  side: Foot | "middle";
}

/**
 * The mannequin: a simple jointed figure, with every joint the body
 * solver places visible as a ball and every bone a rod between two of
 * them. Thicknesses are rough real sizes (a thigh about 12 cm across),
 * chosen so the body reads at a glance and the joints stay visible.
 * The head, the nose and the feet are drawn separately (Renderer3D).
 */
export const MANNEQUIN_BONES: readonly Bone[] = [
  { from: "hips", to: "spine", radius: 0.1, side: "middle" },
  { from: "spine", to: "chest", radius: 0.11, side: "middle" },
  { from: "chest", to: "neck", radius: 0.1, side: "middle" },
  { from: "neck", to: "head", radius: 0.04, side: "middle" },
  { from: "leftUpperLeg", to: "rightUpperLeg", radius: 0.08, side: "middle" },
  { from: "leftUpperArm", to: "rightUpperArm", radius: 0.05, side: "middle" },
  ...(["left", "right"] as const).flatMap((side): Bone[] => [
    { from: `${side}UpperLeg`, to: `${side}LowerLeg`, radius: 0.06, side },
    { from: `${side}LowerLeg`, to: `${side}Foot`, radius: 0.045, side },
    { from: `${side}UpperArm`, to: `${side}LowerArm`, radius: 0.04, side },
    { from: `${side}LowerArm`, to: `${side}Hand`, radius: 0.033, side },
  ]),
];

/** Joints drawn as balls. The head, the hips' centre and the collarbones
 *  are inside other shapes, so they're left out. */
export const VISIBLE_JOINTS: readonly JointName[] = [
  "leftUpperLeg",
  "rightUpperLeg",
  "leftLowerLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "neck",
];

export interface CameraFraming {
  /** The point the camera orbits, in floor space. */
  target: Point3D;
  /** How far the camera starts from the target, in metres. */
  distance: number;
}

/**
 * Where the camera starts for a sequence: orbiting the middle of every
 * foot's path, at about waist height, far enough back to see the whole
 * sequence with the dancers in it. Null for an empty sequence.
 */
export function frameSequence(
  entries: { figure: Figure; transform: FloorTransform }[],
): CameraFraming | null {
  if (entries.length === 0) return null;
  const { segments } = sequenceTrailSegments(entries, Infinity);
  const points = segments.flatMap((trails) =>
    PARTNERS.flatMap((partner) =>
      FEET.flatMap((foot) => trails[partner][foot]),
    ),
  );
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const extent = Math.max(maxX - minX, maxY - minY);
  return {
    target: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: 0.9 },
    // At least 3.4 m, so a single figure still shows both dancers whole
    // (the view is about 40° tall).
    distance: Math.max(3.4, extent * 1.1 + 2),
  };
}

/** Points along a cubic Bézier per curve segment, for a smooth outline. */
const OUTLINE_SAMPLES = 8;

/**
 * A footprint's outline on the floor, in floor space: the 2D view's
 * foot silhouette (figureShapes.mts), at its real size, turned to the
 * footprint's heading and placed on its spot. The 2D shapes are in
 * screen space, toe towards -y; on the floor the toe points along the
 * heading.
 */
export function footprintOutline(
  footprint: Pick<Footprint, "foot" | "position" | "orientation">,
): Point2D[] {
  const outline = FOOT_OUTLINES[footprint.foot];
  const local: [number, number][] = [];
  let from = outline.start;
  for (const [c1, c2, to] of outline.curves) {
    for (let i = 0; i < OUTLINE_SAMPLES; i++) {
      const t = i / OUTLINE_SAMPLES;
      const u = 1 - t;
      local.push([
        u * u * u * from[0] +
          3 * u * u * t * c1[0] +
          3 * u * t * t * c2[0] +
          t * t * t * to[0],
        u * u * u * from[1] +
          3 * u * u * t * c1[1] +
          3 * u * t * t * c2[1] +
          t * t * t * to[1],
      ]);
    }
    from = to;
  }
  const forward = headingToUnitVector(footprint.orientation);
  const right = headingToUnitVector(footprint.orientation + 90);
  return local.map(([x, screenY]) => ({
    // Screen-local -y is the toe: forward along the heading.
    x: footprint.position.x + right.x * x - forward.x * screenY,
    y: footprint.position.y + right.y * x - forward.y * screenY,
  }));
}
