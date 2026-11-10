import { useMemo } from "react";

import { sequenceFootTrails, sequencePoseAtBeat } from "../libs/dance/fold.mts";
import { headingToUnitVector } from "../libs/dance/heading.mts";
import type { Foot, Partner } from "../libs/dance/step.mts";
import type { Point2D } from "../libs/dance/pose.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";

interface Canvas2DProps {
  entries: SequenceEntry[];
  /** Current scrub/playback position, in beats along the whole
   *  sequence (see usePlayback) -- the pose rendered is the sequence
   *  interpolated at this instant, not just its final state. */
  currentBeat: number;
}

const PARTNERS: readonly Partner[] = ["lead", "follow"];
const FEET: readonly Foot[] = ["left", "right"];

const PARTNER_COLOR: Record<Partner, string> = {
  lead: "var(--amber)",
  follow: "var(--teal)",
};

const PARTNER_LABEL: Record<Partner, string> = {
  lead: "L",
  follow: "F",
};

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
  const view = useMemo(() => {
    if (entries.length === 0) return null;

    const forFold = entries.map((entry) => ({
      figure: entry.figure,
      transform: entry.transform,
    }));
    const trails = sequenceFootTrails(forFold);
    const currentPose = sequencePoseAtBeat(forFold, currentBeat);
    if (currentPose === null) return null;

    const allScreenPoints = PARTNERS.flatMap((partner) =>
      FEET.flatMap((foot) => trails[partner][foot].map(toScreen)),
    );
    const bounds = boundsOf(allScreenPoints);
    const extentX = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const extentY = Math.max(bounds.maxY - bounds.minY, 1e-6);
    const extent = Math.max(extentX, extentY);
    // Zoomed out well beyond the trail's own bounding box, so the
    // whole sequence sits comfortably inside the frame with room to
    // spare, rather than filling it edge to edge.
    const padding = Math.max(extent * 1.4, 0.8);

    const viewBox = [
      bounds.minX - padding,
      bounds.minY - padding,
      extentX + padding * 2,
      extentY + padding * 2,
    ].join(" ");

    const footRadius = extent * 0.04 + 0.01;
    const strokeWidth = extent * 0.015 + 0.004;
    const facingLength = extent * 0.14 + 0.03;

    return {
      trails,
      currentPose,
      viewBox,
      footRadius,
      strokeWidth,
      facingLength,
    };
  }, [entries, currentBeat]);

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
          {PARTNERS.map((partner) => {
            const color = PARTNER_COLOR[partner];
            const partnerPose = view.currentPose[partner];
            const feetScreen = {
              left: toScreen(partnerPose.left.position),
              right: toScreen(partnerPose.right.position),
            };
            const center = {
              x: (feetScreen.left.x + feetScreen.right.x) / 2,
              y: (feetScreen.left.y + feetScreen.right.y) / 2,
            };
            const facingFloor = headingToUnitVector(partnerPose.orientation);
            const facingScreen = toScreen(facingFloor);
            const facingEnd = {
              x: center.x + facingScreen.x * view.facingLength,
              y: center.y + facingScreen.y * view.facingLength,
            };

            return (
              <g key={partner}>
                {FEET.map((foot) => (
                  <path
                    key={foot}
                    d={pathFrom(view.trails[partner][foot])}
                    fill="none"
                    stroke={color}
                    strokeWidth={view.strokeWidth}
                    strokeOpacity={foot === "left" ? 0.8 : 0.45}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}

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

                {FEET.map((foot) => {
                  const point = feetScreen[foot];
                  const weight = partnerPose[foot].weight;
                  return (
                    <circle
                      key={foot}
                      cx={point.x}
                      cy={point.y}
                      r={view.footRadius}
                      fill={color}
                      fillOpacity={0.15 + weight * 0.85}
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
                  fill="#14161c">
                  {PARTNER_LABEL[partner]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

export default Canvas2D;
