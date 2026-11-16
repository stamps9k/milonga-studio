import type { Partner } from "../libs/dance/step.mts";

/**
 * The visual encoding of the 2D canvas, shared by Canvas2D (which draws
 * it) and CanvasLegend (which explains it), so the legend can't drift
 * out of step with what's actually drawn.
 */

export const PARTNER_COLOR: Record<Partner, string> = {
  lead: "var(--amber)",
  follow: "var(--teal)",
};

export const PARTNER_NAME: Record<Partner, string> = {
  lead: "Lead",
  follow: "Follow",
};

/** Fill opacity of the dancer's current feet: a standing foot is
 *  nearly solid, a free foot only faintly filled (its outline is drawn
 *  at full strength either way). */
export const STANDING_FOOT_FILL_OPACITY = 0.9;
export const FREE_FOOT_FILL_OPACITY = 0.15;

/**
 * Fill opacity of a footprint already taken, by age (0 = the partner's
 * most recent). Recent prints are clear; older ones fade towards a floor
 * so the whole figure stays faintly visible as a map.
 */
export function takenFootprintOpacity(age: number): number {
  return Math.max(0.12, 0.5 * 0.72 ** age);
}

/** Outline opacity of the footprint the foot is landing on now, and of
 *  the next one after it. Both are dashed outlines, not filled, so it's
 *  clear the foot isn't there yet. */
export const LANDING_FOOTPRINT_OPACITY = 0.95;
export const NEXT_FOOTPRINT_OPACITY = 0.5;

/** Dark outline round the counts on footprints, so they read over feet
 *  and bodies. The counts themselves are in the partner's colour. */
export const COUNT_HALO_COLOR = "#14161c";

/** Each foot's path, drawn dotted and faint: background context behind
 *  the footprints. */
export const TRAIL_OPACITY = 0.28;

/** The dancer pictograph: shoulders and head lightly filled so the feet
 *  under them stay visible, outline and nose solid. */
export const BODY_FILL_OPACITY = 0.22;

/** Opacity of the dashed line marking a jump between figures. */
export const GAP_OPACITY = 0.6;
