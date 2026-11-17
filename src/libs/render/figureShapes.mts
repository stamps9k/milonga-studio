import type { Foot } from "../dance/step.mts";

/**
 * The shapes the 2D renderer (Renderer2D) draws for feet and dancers, seen from above.
 *
 * All shapes are in metres at roughly real size, in screen-local
 * coordinates: centred on the origin, facing up the screen (toe or nose
 * towards -y, since SVG's y points down). Renderer2D places each one with
 * `translate(x y) rotate(heading)`. SVG's rotate turns clockwise on
 * screen, and with floor-north drawn up the screen that is the same
 * direction as the model's compass headings, so a heading can be used
 * unchanged.
 */

/** A cubic Bézier outline: a start point, then [c1, c2, end] triples. */
export interface Outline {
  start: [number, number];
  curves: [number, number][][];
}

/**
 * A right foot, about 27 cm long and 9 cm wide. The big toe and the arch
 * are on the inner side, which for a right foot is its left (-x); the
 * left foot is the mirror image. That asymmetry is what tells the two
 * feet apart at a glance. The origin is the middle of the foot, where
 * the model's foot position is.
 */
export const RIGHT_FOOT_OUTLINE: Outline = {
  start: [0, 0.125],
  curves: [
    // Heel round to the outer side, then up the outer edge.
    [
      [0.03, 0.125],
      [0.04, 0.08],
      [0.04, 0.03],
    ],
    [
      [0.04, -0.03],
      [0.05, -0.08],
      [0.04, -0.11],
    ],
    // Across the toes, little toe to big toe.
    [
      [0.03, -0.14],
      [0, -0.15],
      [-0.02, -0.145],
    ],
    // Big toe down the inner edge, narrowing into the arch.
    [
      [-0.045, -0.14],
      [-0.05, -0.11],
      [-0.045, -0.07],
    ],
    [
      [-0.04, -0.03],
      [-0.02, 0],
      [-0.025, 0.05],
    ],
    // Back round the inner heel.
    [
      [-0.03, 0.1],
      [-0.025, 0.125],
      [0, 0.125],
    ],
  ],
};

function mirror(outline: Outline): Outline {
  return {
    start: [-outline.start[0], outline.start[1]],
    curves: outline.curves.map((curve) => curve.map(([x, y]) => [-x, y])),
  };
}

export const FOOT_OUTLINES: Record<Foot, Outline> = {
  right: RIGHT_FOOT_OUTLINE,
  left: mirror(RIGHT_FOOT_OUTLINE),
};

function outlinePath(outline: Outline): string {
  const point = ([x, y]: [number, number]) => `${x} ${y}`;
  return (
    `M ${point(outline.start)} ` +
    outline.curves
      .map((curve) => `C ${curve.map(point).join(", ")}`)
      .join(" ") +
    " Z"
  );
}

/** SVG path data for each foot's silhouette. */
export const FOOT_PATHS: Record<Foot, string> = {
  left: outlinePath(FOOT_OUTLINES.left),
  right: outlinePath(FOOT_OUTLINES.right),
};

/**
 * A dancer seen from above: shoulders as a wide ellipse, the head in the
 * middle, and a small nose on the front of the head so the facing reads
 * even when the shoulders are nearly round. Drawn mostly transparent so
 * the feet underneath stay visible.
 */
export const BODY = {
  shoulders: { cx: 0, cy: 0.02, rx: 0.22, ry: 0.09 },
  head: { cx: 0, cy: -0.01, r: 0.085 },
  /** Triangle on the front of the head. */
  nose: "M -0.03 -0.085 L 0 -0.125 L 0.03 -0.085 Z",
} as const;

/** The SVG transform that places a shape at a screen point, turned to a
 *  compass heading in degrees. */
export function placeAt(point: { x: number; y: number }, heading: number) {
  return `translate(${point.x} ${point.y}) rotate(${heading})`;
}
