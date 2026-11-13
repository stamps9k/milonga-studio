import { useMemo } from "react";

import {
  sequencePoseAtBeat,
  sequenceTrailSegments,
} from "../libs/dance/fold.mts";
import { headingToUnitVector } from "../libs/dance/heading.mts";
import { JOIN_FOOT_GAP_TOLERANCE } from "../libs/dance/join.mts";
import { centerOfWeight, isStandingFoot } from "../libs/dance/weight.mts";
import type { Foot, Partner } from "../libs/dance/step.mts";
import type { Point2D } from "../libs/dance/pose.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";
import CanvasLegend from "./CanvasLegend";
import {
  FREE_FOOT_FILL_OPACITY,
  GAP_OPACITY,
  MARKER_TEXT_COLOR,
  PARTNER_COLOR,
  PARTNER_LABEL,
  TRAIL_OPACITY,
} from "./canvasStyle.mts";
import { formatScaleLength, niceScaleLength } from "./scaleBar.mts";

interface Canvas2DProps {
  entries: SequenceEntry[];
  /** Current scrub/playback position, in beats along the whole
   *  sequence (see usePlayback) -- the pose rendered is the sequence
   *  interpolated at this instant, not just its final state. */
  currentBeat: number;
}

const PARTNERS: readonly Partner[] = ["lead", "follow"];
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

    const footRadius = extent * 0.04 + 0.01;
    const strokeWidth = extent * 0.015 + 0.004;
    const facingLength = extent * 0.14 + 0.03;

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
      viewBox,
      scaleBar,
      footRadius,
      strokeWidth,
      facingLength,
    };
  }, [forFold]);

  const currentPose = useMemo(
    () =>
      forFold.length === 0 ? null : sequencePoseAtBeat(forFold, currentBeat),
    [forFold, currentBeat],
  );

  const view =
    layout === null || currentPose === null ? null : { ...layout, currentPose };

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

          {PARTNERS.map((partner) => {
            const color = PARTNER_COLOR[partner];
            const partnerPose = view.currentPose[partner];
            const feetScreen = {
              left: toScreen(partnerPose.left.position),
              right: toScreen(partnerPose.right.position),
            };
            // The body marker sits over the partner's weight, not at the
            // midpoint of the feet, so a weight transfer shows as the body
            // travelling from one foot to the other (see weight.mts).
            const center = toScreen(centerOfWeight(partnerPose));
            const facingFloor = headingToUnitVector(partnerPose.orientation);
            const facingScreen = toScreen(facingFloor);
            const facingEnd = {
              x: center.x + facingScreen.x * view.facingLength,
              y: center.y + facingScreen.y * view.facingLength,
            };

            return (
              <g key={partner}>
                {view.segments.flatMap((trails, entryIndex) =>
                  FEET.map((foot) => (
                    <path
                      key={`${entryIndex}-${foot}`}
                      d={pathFrom(trails[partner][foot])}
                      fill="none"
                      stroke={color}
                      strokeWidth={view.strokeWidth}
                      strokeOpacity={TRAIL_OPACITY[foot]}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )),
                )}

                {/* Where a figure doesn't start where the previous one
                    left this foot: a thin dashed line marks the jump, so
                    it isn't mistaken for a step. */}
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
                        stroke={color}
                        strokeWidth={view.strokeWidth * 0.6}
                        strokeOpacity={GAP_OPACITY}
                        strokeDasharray={`${view.strokeWidth * 2} ${view.strokeWidth * 2}`}
                        strokeLinecap="round"
                      />
                    );
                  })}

                <line
                  x1={center.x}
                  y1={center.y}
                  x2={facingEnd.x}
                  y2={facingEnd.y}
                  stroke={color}
                  strokeWidth={view.strokeWidth}
                  strokeLinecap="round"
                />

                <circle
                  cx={center.x}
                  cy={center.y}
                  r={view.footRadius * 1.4}
                  fill={color}
                />

                {/* Feet are drawn as standing (filled) or free (outline)
                    rather than shaded by weight: the body marker above
                    already shows where the weight is and how it moves,
                    so the feet only need to say which one is planted. */}
                {FEET.map((foot) => {
                  const point = feetScreen[foot];
                  const standing = isStandingFoot(partnerPose, foot);
                  return (
                    <circle
                      key={foot}
                      cx={point.x}
                      cy={point.y}
                      r={view.footRadius}
                      fill={color}
                      fillOpacity={standing ? 1 : FREE_FOOT_FILL_OPACITY}
                      stroke={color}
                      strokeWidth={view.strokeWidth * 0.6}
                    />
                  );
                })}

                <text
                  x={center.x}
                  y={center.y}
                  dy={view.footRadius * 0.35}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono"
                  fontSize={view.footRadius * 1.6}
                  fontWeight="700"
                  fill={MARKER_TEXT_COLOR}>
                  {PARTNER_LABEL[partner]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {view !== null && <CanvasLegend />}
    </div>
  );
};

export default Canvas2D;
