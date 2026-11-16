import type { ReactNode } from "react";

import {
  BODY_FILL_OPACITY,
  FREE_FOOT_FILL_OPACITY,
  GAP_OPACITY,
  LANDING_FOOTPRINT_OPACITY,
  NEXT_FOOTPRINT_OPACITY,
  PARTNER_COLOR,
  PARTNER_NAME,
  STANDING_FOOT_FILL_OPACITY,
  TRAIL_OPACITY,
  takenFootprintOpacity,
} from "./canvasStyle.mts";
import { BODY, FOOT_PATHS } from "./figureShapes.mts";

/**
 * Key to the 2D canvas, overlaid in its top-left corner. Each row shows
 * a miniature of a mark exactly as Canvas2D draws it (same shapes, from
 * figureShapes.mts, and the same colours and opacities, from
 * canvasStyle.mts) next to what it means. It is a
 * <details> element, open by default, so it can be collapsed out of the
 * way without any extra state.
 */

const NEUTRAL = "var(--bs-body-color, #ccc)";

/** The canvas shapes are in metres; in the 28 x 14 px glyphs a metre is
 *  this many pixels. Strokes stay 1 px (non-scaling). */
const GLYPH_SCALE = 42;

function Shape({
  x,
  y = 7,
  children,
}: {
  x: number;
  y?: number;
  children: ReactNode;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${GLYPH_SCALE})`}>{children}</g>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="28"
      height="14"
      viewBox="0 0 28 14"
      aria-hidden="true"
      className="flex-shrink-0">
      {children}
    </svg>
  );
}

function Row({ glyph, children }: { glyph: ReactNode; children: ReactNode }) {
  return (
    <li>
      {glyph}
      <span>{children}</span>
    </li>
  );
}

const CanvasLegend = () => (
  <details className="canvas-legend" open>
    <style>{`
      .canvas-legend {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        max-width: 15rem;
        padding: 0.35rem 0.6rem;
        border-radius: 6px;
        background-color: rgba(20, 22, 28, 0.82);
        font-size: 0.72rem;
        line-height: 1.3;
        color: var(--bs-body-color, #ccc);
      }
      .canvas-legend summary {
        cursor: pointer;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-size: 0.65rem;
        color: var(--bs-secondary-color, #999);
      }
      .canvas-legend ul {
        list-style: none;
        margin: 0.35rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.25rem;
      }
      /* Styled here rather than with Bootstrap utilities so the legend
         lays out the same wherever it's rendered. */
      .canvas-legend li {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
    `}</style>
    <summary>Legend</summary>
    <ul>
      {(["lead", "follow"] as const).map((partner) => {
        const color = PARTNER_COLOR[partner];
        return (
          <Row
            key={partner}
            glyph={
              <Glyph>
                <Shape x={14} y={8}>
                  <g
                    stroke={color}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke">
                    <ellipse
                      {...BODY.shoulders}
                      fill={color}
                      fillOpacity={BODY_FILL_OPACITY}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      {...BODY.head}
                      fill={color}
                      fillOpacity={BODY_FILL_OPACITY}
                      vectorEffect="non-scaling-stroke"
                    />
                    <path d={BODY.nose} fill={color} stroke="none" />
                  </g>
                </Shape>
              </Glyph>
            }>
            <strong>{PARTNER_NAME[partner]}</strong> from above, over the
            weight; nose = facing
          </Row>
        );
      })}
      <Row
        glyph={
          <Glyph>
            {(
              [
                [8, STANDING_FOOT_FILL_OPACITY],
                [20, FREE_FOOT_FILL_OPACITY],
              ] as const
            ).map(([x, fillOpacity]) => (
              <Shape key={x} x={x}>
                <path
                  d={FOOT_PATHS.right}
                  fill={NEUTRAL}
                  fillOpacity={fillOpacity}
                  stroke={NEUTRAL}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </Shape>
            ))}
          </Glyph>
        }>
        Feet now: standing / free (big toe on the inside)
      </Row>
      <Row
        glyph={
          <Glyph>
            {[0, 2, 5].map((age, index) => (
              <Shape key={age} x={5 + index * 9}>
                <path
                  d={FOOT_PATHS.left}
                  fill={NEUTRAL}
                  fillOpacity={takenFootprintOpacity(age)}
                />
              </Shape>
            ))}
          </Glyph>
        }>
        Footprints taken, fading with age, numbered with the count
      </Row>
      <Row
        glyph={
          <Glyph>
            {(
              [
                [8, LANDING_FOOTPRINT_OPACITY],
                [20, NEXT_FOOTPRINT_OPACITY],
              ] as const
            ).map(([x, strokeOpacity]) => (
              <Shape key={x} x={x}>
                <path
                  d={FOOT_PATHS.left}
                  fill="none"
                  stroke={NEUTRAL}
                  strokeOpacity={strokeOpacity}
                  strokeWidth={1}
                  strokeDasharray="2.5 1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </Shape>
            ))}
          </Glyph>
        }>
        Landing now / next step
      </Row>
      <Row
        glyph={
          <Glyph>
            <line
              x1="3"
              y1="7"
              x2="26"
              y2="7"
              stroke={NEUTRAL}
              strokeOpacity={TRAIL_OPACITY * 2}
              strokeWidth="2"
              strokeDasharray="0 4"
              strokeLinecap="round"
            />
          </Glyph>
        }>
        Path of each foot
      </Row>
      <Row
        glyph={
          <Glyph>
            <line
              x1="2"
              y1="7"
              x2="26"
              y2="7"
              stroke={NEUTRAL}
              strokeOpacity={GAP_OPACITY}
              strokeWidth="1.5"
              strokeDasharray="3 3"
              strokeLinecap="round"
            />
          </Glyph>
        }>
        Jump between figures that don’t join
      </Row>
      <Row
        glyph={
          <Glyph>
            <line
              x1="14"
              y1="13"
              x2="14"
              y2="2"
              stroke={NEUTRAL}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <polyline
              points="10,6 14,2 18,6"
              fill="none"
              stroke={NEUTRAL}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Glyph>
        }>
        Line of dance (up the screen)
      </Row>
    </ul>
  </details>
);

export default CanvasLegend;
