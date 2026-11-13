import type { Foot, Partner } from "../libs/dance/step.mts";

/**
 * The visual encoding of the 2D canvas, shared by Canvas2D (which draws
 * it) and CanvasLegend (which explains it), so the legend can't drift
 * out of step with what's actually drawn.
 */

export const PARTNER_COLOR: Record<Partner, string> = {
  lead: "var(--amber)",
  follow: "var(--teal)",
};

/** Letter drawn on each partner's body marker. */
export const PARTNER_LABEL: Record<Partner, string> = {
  lead: "L",
  follow: "F",
};

export const PARTNER_NAME: Record<Partner, string> = {
  lead: "Lead",
  follow: "Follow",
};

/** Fill opacity of a free (unweighted) foot; a standing foot is solid. */
export const FREE_FOOT_FILL_OPACITY = 0.12;

/** Trail line opacity per foot: the left foot's trail is drawn stronger
 *  so the two trails can be told apart. */
export const TRAIL_OPACITY: Record<Foot, number> = {
  left: 0.8,
  right: 0.45,
};

/** Opacity of the dashed line marking a jump between figures. */
export const GAP_OPACITY = 0.6;

/** Text colour on the body markers (dark, to read on amber and teal). */
export const MARKER_TEXT_COLOR = "#14161c";
