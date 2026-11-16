import { useMemo } from "react";

import {
  sequencePoseAtBeat,
  sequenceTrailSegments,
} from "../libs/dance/fold.mts";
import {
  footprintsAtBeat,
  sequenceFootprints,
} from "../libs/dance/footprints.mts";
import type { FootprintState } from "../libs/dance/footprints.mts";
import {
  addPoints,
  headingToUnitVector,
  scalePoint,
} from "../libs/dance/heading.mts";
import { JOIN_FOOT_GAP_TOLERANCE } from "../libs/dance/join.mts";
import { centerOfWeight, isStandingFoot } from "../libs/dance/weight.mts";
import type { Foot, Partner } from "../libs/dance/step.mts";
import type { Point2D } from "../libs/dance/pose.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";
import CanvasLegend from "./CanvasLegend";
import {
  BODY_FILL_OPACITY,
  COUNT_HALO_COLOR,
  FREE_FOOT_FILL_OPACITY,
  GAP_OPACITY,
  LANDING_FOOTPRINT_OPACITY,
  NEXT_FOOTPRINT_OPACITY,
  PARTNER_COLOR,
  STANDING_FOOT_FILL_OPACITY,
  TRAIL_OPACITY,
  takenFootprintOpacity,
} from "./canvasStyle.mts";
import { BODY, FOOT_PATHS, placeAt } from "./figureShapes.mts";
import { formatScaleLength, niceScaleLength } from "./scaleBar.mts";

interface Canvas2DProps {
  entries: SequenceEntry[];
  /** Current scrub/playback position, in beats along the whole
   *  sequence (see usePlayback) -- the pose rendered is the sequence
   *  interpolated at this instant, not just its final state. */
  currentBeat: number;
}

const PARTNERS: readonly Partner[] = ["lead", "follow"];

/** How far towards the heel a footprint's count sits, in metres. */
const COUNT_HEEL_OFFSET = 0.06;
const FEET: readonly Foot[] = ["left", "right"];

/** Floor space has +Y = "north" / facing forward (see heading.mts).
 *  Screen space (SVG) has +Y pointing down, so this renders floor-north
 *  as screen-up, matching a conventional top-down map view. */
function toScreen(point: Point2D): Point2D {
  return { x: point.x, y: -point.y };
}

function pathFrom(points: Point2D[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points.map(toScreen);
  return (
    `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ")
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
function withCounts(states: FootprintState[]) {
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
function countOpacity(phase: FootprintState["phase"], age: number): number {
  if (phase === "landing") return LANDING_FOOTPRINT_OPACITY;
  if (phase === "next") return NEXT_FOOTPRINT_OPACITY;
  return Math.max(0.45, Math.min(1, takenFootprintOpacity(age) * 2));
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(points: Point2D[]): Bounds {
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

const Canvas2D = ({ entries, currentBeat }: Canvas2DProps) => {
  const forFold = useMemo(
    () =>
      entries.map((entry) => ({
        figure: entry.figure,
        transform: entry.transform,
      })),
    [entries],
  );

  // Everything that depends only on the sequence -- trails, gaps, framing
  // and sizes -- is computed once per sequence change, not on every
  // playback frame; only the current pose below changes with the beat.
  const layout = useMemo(() => {
    if (forFold.length === 0) return null;

    // One trail segment per figure, with the joins where a foot's trail
    // doesn't continue into the next figure listed separately, so they
    // can be drawn as gaps rather than as steps (see
    // sequenceTrailSegments in fold.mts).
    const { segments, gaps } = sequenceTrailSegments(
      forFold,
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
    // of the canvas to be readable. (Previously 1.4x the size, which
    // left the dancers small in the middle of a mostly empty view.)
    const padding = Math.max(extent * 0.5, 0.5);

    const box = {
      x: bounds.minX - padding,
      y: bounds.minY - padding,
      width: extentX + padding * 2,
      height: extentY + padding * 2,
    };
    const viewBox = [box.x, box.y, box.width, box.height].join(" ");

    // Feet and dancers are drawn at real size (figureShapes.mts), so
    // only line widths and text scale with the view: thin enough to
    // outline a 9 cm foot when zoomed in on one figure, still visible
    // when a long sequence is zoomed out.
    const strokeWidth = extent * 0.0025 + 0.004;
    const countFontSize = 0.07;

    // Scale bar in the bottom-left corner of the view, in floor units so
    // it scales with the drawing: the largest round length up to a fifth
    // of the view's width (see scaleBar.mts).
    const scaleLength = niceScaleLength(box.width / 5);
    const scaleBar = {
      x: box.x + box.width * 0.04,
      y: box.y + box.height * 0.95,
      length: scaleLength,
      label: formatScaleLength(scaleLength),
      tick: box.height * 0.012,
      fontSize: box.height * 0.028,
      strokeWidth: box.height * 0.003,
    };

    return {
      segments,
      gaps,
      footprints: sequenceFootprints(forFold),
      viewBox,
      scaleBar,
      strokeWidth,
      countFontSize,
    };
  }, [forFold]);

  const currentPose = useMemo(
    () =>
      forFold.length === 0 ? null : sequencePoseAtBeat(forFold, currentBeat),
    [forFold, currentBeat],
  );

  const view =
    layout === null || currentPose === null
      ? null
      : {
          ...layout,
          currentPose,
          ...withCounts(footprintsAtBeat(layout.footprints, currentBeat)),
        };

  return (
    <div
      id="view2d"
      className="canvas-grid position-relative"
      style={{ height: "50vh" }}>
      {view === null ? (
        <div className="d-flex align-items-center justify-content-center h-100 text-body-secondary small">
          Select figures from the library to see them here.
        </div>
      ) : (
        <svg viewBox={view.viewBox} width="100%" height="100%">
          <g
            aria-label={`Scale: ${view.scaleBar.label}`}
            stroke="var(--bs-secondary-color, #999)"
            strokeWidth={view.scaleBar.strokeWidth}
            strokeLinecap="round">
            <line
              x1={view.scaleBar.x}
              y1={view.scaleBar.y}
              x2={view.scaleBar.x + view.scaleBar.length}
              y2={view.scaleBar.y}
            />
            {[0, view.scaleBar.length].map((offset) => (
              <line
                key={offset}
                x1={view.scaleBar.x + offset}
                y1={view.scaleBar.y - view.scaleBar.tick}
                x2={view.scaleBar.x + offset}
                y2={view.scaleBar.y + view.scaleBar.tick}
              />
            ))}
            <text
              x={view.scaleBar.x + view.scaleBar.length / 2}
              y={view.scaleBar.y - view.scaleBar.tick * 1.6}
              textAnchor="middle"
              fontSize={view.scaleBar.fontSize}
              stroke="none"
              fill="var(--bs-secondary-color, #999)">
              {view.scaleBar.label}
            </text>
          </g>

          {/* Layer 1: each foot's path, dotted and faint, and dashed
              jumps where a figure doesn't join. */}
          {PARTNERS.map((partner) => (
            <g key={`trails-${partner}`} stroke={PARTNER_COLOR[partner]}>
              {view.segments.flatMap((trails, entryIndex) =>
                FEET.map((foot) => (
                  <path
                    key={`${entryIndex}-${foot}`}
                    d={pathFrom(trails[partner][foot])}
                    fill="none"
                    strokeWidth={view.strokeWidth * 1.4}
                    strokeOpacity={TRAIL_OPACITY}
                    strokeDasharray={`0 ${view.strokeWidth * 4}`}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )),
              )}
              {view.gaps
                .filter((gap) => gap.partner === partner)
                .map((gap) => {
                  const from = toScreen(gap.from);
                  const to = toScreen(gap.to);
                  return (
                    <line
                      key={`gap-${gap.entryIndex}-${gap.foot}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      strokeWidth={view.strokeWidth}
                      strokeOpacity={GAP_OPACITY}
                      strokeDasharray={`${view.strokeWidth * 3} ${view.strokeWidth * 3}`}
                      strokeLinecap="round"
                    />
                  );
                })}
            </g>
          ))}

          {/* Layer 2: footprints. Taken ones are filled and fade with
              age; the one the foot is landing on and the next one are
              dashed outlines. Oldest drawn first, so newer prints sit on
              top where they overlap. Their counts are drawn last
              (layer 5) so feet and bodies don't hide them. */}
          {view.footprints.map(({ footprint, phase, age }, index) => {
            if (phase === "later") return null;
            const color = PARTNER_COLOR[footprint.partner];
            const taken = phase === "taken";
            const opacity = taken
              ? takenFootprintOpacity(age)
              : phase === "landing"
                ? LANDING_FOOTPRINT_OPACITY
                : NEXT_FOOTPRINT_OPACITY;
            const at = toScreen(footprint.position);
            return (
              <g key={`print-${index}`}>
                <path
                  d={FOOT_PATHS[footprint.foot]}
                  transform={placeAt(at, footprint.orientation)}
                  fill={taken ? color : "none"}
                  fillOpacity={taken ? opacity : undefined}
                  stroke={taken ? "none" : color}
                  strokeOpacity={taken ? undefined : opacity}
                  strokeWidth={view.strokeWidth}
                  strokeDasharray={
                    taken
                      ? undefined
                      : `${view.strokeWidth * 2.5} ${view.strokeWidth * 1.5}`
                  }
                />
              </g>
            );
          })}

          {/* Layer 3: where each foot is now. Solid outline; the
              standing foot filled, the free foot almost empty. */}
          {PARTNERS.map((partner) =>
            FEET.map((foot) => {
              const partnerPose = view.currentPose[partner];
              const standing = isStandingFoot(partnerPose, foot);
              return (
                <path
                  key={`foot-${partner}-${foot}`}
                  d={FOOT_PATHS[foot]}
                  transform={placeAt(
                    toScreen(partnerPose[foot].position),
                    partnerPose.orientation,
                  )}
                  fill={PARTNER_COLOR[partner]}
                  fillOpacity={
                    standing
                      ? STANDING_FOOT_FILL_OPACITY
                      : FREE_FOOT_FILL_OPACITY
                  }
                  stroke={PARTNER_COLOR[partner]}
                  strokeWidth={view.strokeWidth}
                />
              );
            }),
          )}

          {/* Layer 4: the dancers, seen from above, over their weight
              (centerOfWeight), so a weight change shows as the body
              moving from one foot to the other. Lightly filled so the
              feet underneath show through. */}
          {PARTNERS.map((partner) => {
            const partnerPose = view.currentPose[partner];
            const color = PARTNER_COLOR[partner];
            return (
              <g
                key={`body-${partner}`}
                transform={placeAt(
                  toScreen(centerOfWeight(partnerPose)),
                  partnerPose.orientation,
                )}
                stroke={color}
                strokeWidth={view.strokeWidth}>
                <ellipse
                  {...BODY.shoulders}
                  fill={color}
                  fillOpacity={BODY_FILL_OPACITY}
                />
                <circle
                  {...BODY.head}
                  fill={color}
                  fillOpacity={BODY_FILL_OPACITY}
                />
                <path d={BODY.nose} fill={color} />
              </g>
            );
          })}
          {/* Layer 5: the counts on the footprints, on top of everything
              with a dark outline so they read over feet and bodies. */}
          {view.counts.map(({ footprint, phase, age }, index) => {
            // Towards the heel of the print, not its middle: in closed
            // hold the lead often steps where the follow has just been,
            // and since they face opposite ways, putting each count at
            // its own heel keeps the two apart.
            const at = toScreen(
              addPoints(
                footprint.position,
                scalePoint(
                  headingToUnitVector(footprint.orientation),
                  -COUNT_HEEL_OFFSET,
                ),
              ),
            );
            return (
              <text
                key={`count-${index}`}
                x={at.x}
                y={at.y}
                dy={view.countFontSize * 0.35}
                textAnchor="middle"
                fontSize={view.countFontSize}
                fontWeight="700"
                fill={PARTNER_COLOR[footprint.partner]}
                fillOpacity={countOpacity(phase, age)}
                stroke={COUNT_HALO_COLOR}
                strokeWidth={view.countFontSize * 0.22}
                strokeOpacity={countOpacity(phase, age)}
                strokeLinejoin="round"
                paintOrder="stroke">
                {footprint.count}
              </text>
            );
          })}
        </svg>
      )}
      {view !== null && <CanvasLegend />}
    </div>
  );
};

export default Canvas2D;
