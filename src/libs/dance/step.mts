import type { Pose, Point2D } from "./pose.mts";

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
 *  step's starting position. fold.mts animates an airborne foot out
 *  along its movement and back to where it started (a provisional
 *  choice -- see airborneExcursionAt there) and leaves it out of the
 *  floor trail. */
export type Contact = "floor" | "air";

/** The point of the foot a turn on the floor pivots about (see
 *  DanceStep.swivel). */
export type SwivelPoint = "ball" | "heel";

/**
 * When, within a step, the weight moves onto the stepping foot:
 * - "even": the weight moves across the whole step, at the same rate as
 *   the foot travels (the body goes through with the step);
 * - "late": the foot travels first with no weight on it, and the weight
 *   changes at the end of the step. This is how a close is danced: the
 *   feet come together, then the weight changes.
 *
 * Provisional: where "late" splits the step is LATE_WEIGHT_FOOT_SHARE in
 * fold.mts, a judgement call rather than a technique rule.
 */
export type WeightTiming = "even" | "late";

/**
 * When, within a step, the rise changes to the step's `rise`:
 * - "even": steadily across the whole step (a chart's "continue to rise
 *   on 2");
 * - "late": the rise holds where it was and changes over the end of the
 *   step (a chart's "commence to rise at end of 1", or "lower at end of
 *   3"). Where the change starts is LATE_RISE_SHARE in fold.mts.
 */
export type RiseTiming = "even" | "late";

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
      /** Distance travelled, in metres (the floor unit; see Units in
       *  AGENTS.md). */
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
      /** Which way the foot sets off, in degrees clockwise from the
       *  dancer's facing just before the step (so 180 sets off straight
       *  back, -135 diagonally back to the left). Left out for 0: the
       *  foot sets off the way the dancer faces, as every arc did before
       *  this field existed. Relative to the facing rather than an
       *  absolute heading, so placing a figure on the floor (a
       *  FloorTransform) needs no change to it. */
      setOff?: number;
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

  /** How the weight moves during the step (see WeightTiming). Left out
   *  for "even", so steps stored before this field existed play as
   *  they always did. */
  weightTiming?: WeightTiming;

  /** Absolute frame/torso heading at the end of this step, in degrees.
   *  Storing this directly (rather than only a delta) makes pivots trivial
   *  to express and keeps the 3D IK step simple: it's just a target. */
  orientation: number;

  /** Absolute heading the stepping foot points at the end of this step,
   *  in degrees (same convention as `orientation`). Left out when the
   *  foot points the way the body faces (`orientation`), as every step
   *  did before this field existed. A ballroom chart's "body turns
   *  less" is a step whose foot points further round than the body. How
   *  the other foot turns is worked out in fold.mts
   *  (swivelStandingFoot). */
  footDirection?: number;

  /** Where on the foot a foot turning on the floor pivots during this
   *  step: the ball or the heel. It applies to the step's own foot when
   *  the step turns it on the spot (a pivot, or "in place"), and to the
   *  standing foot as it swivels with the body during the step, until
   *  that foot sets off on a step of its own. Left out, a foot turns
   *  about the middle of its footprint, as every step did before this
   *  field existed. See swivelShift in fold.mts. */
  swivel?: SwivelPoint;

  /** true when the body travels round an arc during this step, its
   *  direction turning with the body's turn, instead of straight from
   *  where the weighted feet leave it to where they put it (as a dancer
   *  walking round a partner does). It starts and ends where it would
   *  anyway. Left out, the body goes straight. See bodyArcOffset in
   *  fold.mts. */
  bodyArc?: boolean;

  /** true when the body travels as if the stepping foot went straight
   *  to where it lands, rather than swinging out with the foot's curve
   *  (Movement "arc") or its passing by the standing foot. The weight
   *  still moves across as usual; only the moving foot's detour from the
   *  straight line is kept out of the body's position. For a foot curving
   *  round the standing foot on a step that takes weight, as the follow
   *  walking round the lead in a twist turn: a real foot carries little
   *  weight until it lands, so the body doesn't follow its curve. Left
   *  out, the body is where the weighted feet put it, the curve
   *  included. */
  steadyBody?: boolean;

  /** How far the chest, shoulders and hold are turned from the hips at
   *  the end of this step, in degrees clockwise (negative anticlockwise),
   *  at most 90 either way. `orientation` stays the way the hips and
   *  feet face; the upper body faces `orientation + chestTurn`. Changes
   *  steadily over the step from where the previous step left it, like
   *  bodyOffset; left out means none, so the upper body comes back
   *  square to the hips over a step that leaves it out. For the follow
   *  walking forward round the lead with her chest towards him. See
   *  chestFacing in pose.mts. */
  chestTurn?: number;

  /** Vertical displacement of the body at this step, relative to a neutral
   *  standing height, in metres. Structural for waltz-style rise and
   *  fall, left at 0 for flat styles like most tango/blues. */
  rise: number;
  /** Target pelvis displacement from the weighted feet at this step's end,
   * in metres in the figure's floor frame. Interpolated independently of
   * the feet; omitted means return to zero rather than inherit a lean. */
  bodyOffset?: Point2D;

  /** How the rise changes during the step (see RiseTiming). Left out for
   *  "even", so steps stored before this field existed play as they
   *  always did. */
  riseTiming?: RiseTiming;

  /** Which parts of the stepping foot meet the floor, in order, as a
   *  ballroom chart writes it: "HT" (heel, then toe: a heel lead), "T"
   *  (toe, or ball, staying up), "TH" (toe, then heel), "B" (ball), "F"
   *  (flat, whole foot) and so on. Only its first letter changes how the
   *  foot is drawn: a heel lead arrives toes up, a toe or ball lead
   *  arrives heel up, flat lands flat (see footPitchAt in fold.mts).
   *  Left out: the foot lands as it always did, with no pitch of its own. */
  footwork?: string;

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

/** Minimal projection of a Figure for browsing/catalog UIs (e.g. the
 *  step library) -- deliberately excludes steps/poses, which are only
 *  worth fetching once a specific figure is actually selected. */
export interface FigureSummary {
  id: string;
  name: string;
  style: string;
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
