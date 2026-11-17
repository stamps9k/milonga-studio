import { sequenceTrailSegments } from "../dance/fold.mts";
import type { FootTrails, TrailGap } from "../dance/fold.mts";
import { sequenceFootprints } from "../dance/footprints.mts";
import type { Footprint, FootprintState } from "../dance/footprints.mts";
import { JOIN_FOOT_GAP_TOLERANCE } from "../dance/join.mts";
import type { Point2D } from "../dance/pose.mts";
import type { Foot, Figure, Partner } from "../dance/step.mts";
import type { FloorTransform } from "../dance/sequence.mts";
import {
  LANDING_FOOTPRINT_OPACITY,
  NEXT_FOOTPRINT_OPACITY,
  takenFootprintOpacity,
} from "./canvasStyle.mts";
import { formatScaleLength, niceScaleLength } from "./scaleBar.mts";

/**
 * The parts of the 2D floor plan that can be worked out without a page:
 * the conversion to screen space, the framing and sizes of the view, and
 * which footprint counts to show. Renderer2D turns these into SVG. Kept
 * separate so they can be tested under node:test, which has no DOM.
 */

export const PARTNERS: readonly Partner[] = ["lead", "follow"];
export const FEET: readonly Foot[] = ["left", "right"];

/** Floor space has +Y = "north" / facing forward (see heading.mts).
 *  Screen space (SVG) has +Y pointing down, so this renders floor-north
 *  as screen-up, matching a conventional top-down map view. */
export function toScreen(point: Point2D): Point2D {
  return { x: point.x, y: -point.y };
}

/** SVG path data for a polyline through floor points. */
export function pathFrom(points: Point2D[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points.map(toScreen);
  return (
    `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ")
  );
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Point2D[]): Bounds {
  return points.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxX: Math.max(acc.maxX, p.x),
      maxY: Math.max(acc.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

/**
 * The footprints to draw at this instant, and which of them get their
 * count shown. Only one count per spot: weight changes and pivots leave
 * a foot where it was, so several prints of the same foot can sit on
 * the same spot (a cha-cha's "4 & 1"), and their counts would print on
 * top of each other. The newest visible print at a spot wins, so an
 * upcoming step's count shows over an older one.
 */
export function withCounts(states: FootprintState[]) {
  const labelled = new Set<string>();
  const counts: FootprintState[] = [];
  for (let index = states.length - 1; index >= 0; index--) {
    const state = states[index];
    const { footprint } = state;
    if (state.phase === "later" || footprint.count === "") continue;
    // Prints within a centimetre of each other count as one spot.
    const key = [
      footprint.partner,
      footprint.foot,
      Math.round(footprint.position.x * 100),
      Math.round(footprint.position.y * 100),
    ].join(" ");
    if (labelled.has(key)) continue;
    labelled.add(key);
    counts.push(state);
  }
  return { footprints: states, counts };
}

/** Counts stay readable on faded prints: they fade more slowly than the
 *  prints, down to 0.45. */
export function countOpacity(
  phase: FootprintState["phase"],
  age: number,
): number {
  if (phase === "landing") return LANDING_FOOTPRINT_OPACITY;
  if (phase === "next") return NEXT_FOOTPRINT_OPACITY;
  return Math.max(0.45, Math.min(1, takenFootprintOpacity(age) * 2));
}

export interface ScaleBarLayout {
  x: number;
  y: number;
  length: number;
  label: string;
  tick: number;
  fontSize: number;
  strokeWidth: number;
}

/** Everything about the floor plan that depends only on the sequence,
 *  not on the current beat. */
export interface Layout2D {
  /** One set of foot trails per figure. */
  segments: FootTrails[];
  /** Where a foot's trail doesn't continue into the next figure. */
  gaps: TrailGap[];
  footprints: Footprint[];
  /** The SVG viewBox, in screen-space metres. */
  viewBox: string;
  scaleBar: ScaleBarLayout;
  strokeWidth: number;
  countFontSize: number;
}

/**
 * Lays out the floor plan for a sequence: trails, gaps, footprints,
 * framing and sizes. Returns null for an empty sequence (nothing to
 * frame). Computed once per sequence, not on every playback frame.
 */
export function layoutSequence(
  entries: { figure: Figure; transform: FloorTransform }[],
): Layout2D | null {
  if (entries.length === 0) return null;

  // One trail segment per figure, with the joins where a foot's trail
  // doesn't continue into the next figure listed separately, so they
  // can be drawn as gaps rather than as steps (see
  // sequenceTrailSegments in fold.mts).
  const { segments, gaps } = sequenceTrailSegments(
    entries,
    JOIN_FOOT_GAP_TOLERANCE,
  );

  const allScreenPoints = segments.flatMap((trails) =>
    PARTNERS.flatMap((partner) =>
      FEET.flatMap((foot) => trails[partner][foot].map(toScreen)),
    ),
  );
  const bounds = boundsOf(allScreenPoints);
  const extentX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const extentY = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const extent = Math.max(extentX, extentY);
  // Padding around the trails' bounding box: half the sequence's size
  // on each side (at least 0.5), so the whole sequence sits inside the
  // frame with room for the markers, the legend in the top-left corner
  // and the scale bar in the bottom-left, while still filling enough
  // of the canvas to be readable.
  const padding = Math.max(extent * 0.5, 0.5);

  const box = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: extentX + padding * 2,
    height: extentY + padding * 2,
  };

  // Scale bar in the bottom-left corner of the view, in metres so it
  // scales with the drawing: the largest round length up to a fifth of
  // the view's width (see scaleBar.mts).
  const scaleLength = niceScaleLength(box.width / 5);

  return {
    segments,
    gaps,
    footprints: sequenceFootprints(entries),
    viewBox: [box.x, box.y, box.width, box.height].join(" "),
    scaleBar: {
      x: box.x + box.width * 0.04,
      y: box.y + box.height * 0.95,
      length: scaleLength,
      label: formatScaleLength(scaleLength),
      tick: box.height * 0.012,
      fontSize: box.height * 0.028,
      strokeWidth: box.height * 0.003,
    },
    // Feet and dancers are drawn at real size (figureShapes.mts), so
    // only line widths and text scale with the view: thin enough to
    // outline a 9 cm foot when zoomed in on one figure, still visible
    // when a long sequence is zoomed out.
    strokeWidth: extent * 0.0025 + 0.004,
    countFontSize: 0.07,
  };
}
