import type { ReactNode } from "react";

import {
  FREE_FOOT_FILL_OPACITY,
  GAP_OPACITY,
  MARKER_TEXT_COLOR,
  PARTNER_COLOR,
  PARTNER_LABEL,
  PARTNER_NAME,
  TRAIL_OPACITY,
} from "./canvasStyle.mts";

/**
 * Key to the 2D canvas, overlaid in its top-left corner. Each row shows
 * a miniature of a mark exactly as Canvas2D draws it (same colours and
 * opacities, from canvasStyle.mts) next to what it means. It is a
 * <details> element, open by default, so it can be collapsed out of the
 * way without any extra state.
 */

const NEUTRAL = "var(--bs-body-color, #ccc)";

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
      {(["lead", "follow"] as const).map((partner) => (
        <Row
          key={partner}
          glyph={
            <Glyph>
              <line
                x1="14"
                y1="7"
                x2="25"
                y2="7"
                stroke={PARTNER_COLOR[partner]}
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="11" cy="7" r="6" fill={PARTNER_COLOR[partner]} />
              <text
                x="11"
                y="10"
                textAnchor="middle"
                fontSize="8"
                fontWeight="700"
                fontFamily="JetBrains Mono"
                fill={MARKER_TEXT_COLOR}>
                {PARTNER_LABEL[partner]}
              </text>
            </Glyph>
          }>
          <strong>{PARTNER_NAME[partner]}</strong>: body over the weight, line =
          facing
        </Row>
      ))}
      <Row
        glyph={
          <Glyph>
            <circle cx="7" cy="7" r="4.5" fill={NEUTRAL} stroke={NEUTRAL} />
            <circle
              cx="20"
              cy="7"
              r="4.5"
              fill={NEUTRAL}
              fillOpacity={FREE_FOOT_FILL_OPACITY}
              stroke={NEUTRAL}
            />
          </Glyph>
        }>
        Standing foot / free foot
      </Row>
      <Row
        glyph={
          <Glyph>
            <line
              x1="2"
              y1="4"
              x2="26"
              y2="4"
              stroke={NEUTRAL}
              strokeOpacity={TRAIL_OPACITY.left}
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="2"
              y1="10"
              x2="26"
              y2="10"
              stroke={NEUTRAL}
              strokeOpacity={TRAIL_OPACITY.right}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </Glyph>
        }>
        Left foot trail (stronger) / right foot trail
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
