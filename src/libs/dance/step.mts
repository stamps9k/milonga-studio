import type { Pose } from "./pose.mts";

/**
 * Core step-level data model for Milonga Studio.
 *
 * Design goals from the planning discussion:
 * - Style-agnostic: the same shape describes tango, waltz, blues, etc.
 * - Feeds both the 2D canvas renderer and (later) a 3D IK renderer without
 *   a rewrite, so positions/orientation are plain floor-space data, not
 *   drawing instructions.
 * - Movement is expressed as a small set of composable primitives
 *   (straight line, constant-curvature arc) rather than a general spline,
 *   since that's what real technique actually reduces to.
 */

export type Partner = "lead" | "follow";
export type Foot = "left" | "right";

/** Whether the foot is weight-bearing on the floor, or an airborne leg
 *  action (boleo, voleo, gancho, etc). Airborne actions still describe a
 *  path for rendering, but never carry weight and don't affect the next
 *  step's starting position. */
export type Contact = "floor" | "air";

/**
 * How a foot travels from its previous position to this one.
 * A pivot (foot stationary, body/frame rotates) is just a movement with
 * zero distance/arcLength and a changed `orientation` on the step — it
 * doesn't need its own variant.
 */
export type Movement =
  | {
      type: "straight";
      /** Heading of travel, in degrees, measured on the floor (0 = facing
       *  line of dance / "north" — pick a fixed convention app-wide). */
      direction: number;
      /** Distance travelled, in floor units (e.g. cm). */
      distance: number;
    }
  | {
      type: "arc";
      /** Signed curvature (1 / radius). Positive = curving right,
       *  negative = curving left. Never exactly 0 — use 'straight' for
       *  that, so consumers can pattern-match instead of tolerance-checking
       *  a float. */
      curvature: number;
      /** Length of the path along the arc (not the straight-line chord). */
      arcLength: number;
    };

export interface DanceStep {
  /** Stable id for editing/reordering in the UI. */
  id: string;

  /** Which dancer this step belongs to. Lead/follow steps are stored in
   *  one interleaved timeline (see Figure) so frame relationships between
   *  partners can be checked/rendered together. */
  partner: Partner;
  foot: Foot;

  /** Path from the previous step's end position for this foot/partner. */
  movement: Movement;

  contact: Contact;

  /** 0–1: how much weight is on this foot at the end of the step.
   *  0 for pure embellishments/airborne actions. */
  weight: number;

  /** Absolute frame/torso heading at the end of this step, in degrees.
   *  Storing this directly (rather than only a delta) makes pivots trivial
   *  to express and keeps the 3D IK step simple: it's just a target. */
  orientation: number;

  /** Vertical displacement of the body at this step, relative to a neutral
   *  standing height (floor units). Structural for waltz-style rise and
   *  fall, left at 0 for flat styles like most tango/blues. */
  rise: number;

  /** Position within the figure's measure (e.g. 1, 2, 3 for a 3/4 waltz
   *  measure, or 1–4 for tango's even quarter notes). Paired with the
   *  owning Figure's timeSignature. */
  beat: number;

  /** How many beats (or fraction of a beat) this step occupies — enables
   *  phrasing like quick-quick-slow rather than assuming uniform beats. */
  duration: number;

  /** Optional human-readable technique name for the editor/UI
   *  (e.g. "side step", "brush", "rond de jambe"). Not used by the
   *  renderer. */
  label?: string;
}

export interface TimeSignature {
  beatsPerMeasure: number;
  /** Note value getting one beat, e.g. 4 for quarter-note beats. */
  beatUnit: number;
}

export interface Figure {
  id: string;
  name: string;
  /** Free-form but conventionally a known style key ('tango', 'waltz',
   *  'blues', ...). Purely an organizing/filtering tag — every field above
   *  is shared across styles, nothing here is style-specific. */
  style: string;
  timeSignature: TimeSignature;
  /** Both partners' steps, ordered by time. */
  steps: DanceStep[];

  /** Pose this figure assumes the couple is in before its first step.
   *  Lets a Sequence check whether this figure can follow another one. */
  startPose: Pose;
  /** Pose the couple is left in after this figure's last step — should
   *  equal the Pose obtained by folding `steps` onto `startPose`, but is
   *  stored explicitly so a Sequence can check figure-to-figure
   *  compatibility without re-deriving it every time. */
  endPose: Pose;
}
