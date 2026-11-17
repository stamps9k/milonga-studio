import { applyTransform } from "./floor.mts";
import { figureDurationBeats, poseAtBeat } from "./fold.mts";
import { footHeading } from "./pose.mts";
import type { Point2D } from "./pose.mts";
import type { FloorTransform } from "./sequence.mts";
import type { Figure, Foot, Partner } from "./step.mts";

/**
 * Footprints: where each foot is placed during a sequence, and when.
 *
 * A dance chart draws a footprint wherever a foot lands, numbered with
 * the count it lands on, rather than a continuous line per foot. This
 * module lists those placements as plain data for any renderer (2D now,
 * 3D later), and says at any instant which have been taken and which are
 * coming up. It doesn't decide how they look.
 */

const PARTNERS: readonly Partner[] = ["lead", "follow"];
const FEET: readonly Foot[] = ["left", "right"];

export interface Footprint {
  partner: Partner;
  foot: Foot;
  /** Where the foot ends up, in floor space (placed by the entry's
   *  transform). */
  position: Point2D;
  /**
   * Which way the footprint points as the step finishes, in compass
   * degrees (0 = +Y, clockwise): the foot's own direction
   * (DanceStep.footDirection), which is the partner's facing unless the
   * step points the foot further round.
   */
  orientation: number;
  /** Which sequence entry the step belongs to. */
  entryIndex: number;
  /** When the step starts and finishes, in beats along the whole
   *  sequence (the same timeline as sequencePoseAtBeat). The foot
   *  arrives at endBeat. */
  startBeat: number;
  endBeat: number;
  /** The count the step starts on within its figure: "1", "2", "3&"
   *  (beat 3.5). Empty for the starting stance, which isn't a step. */
  count: string;
}

/** A step's beat as a dancer would count it: whole beats as numbers,
 *  half beats as "&" ("3&" for 3.5), anything else to two decimals. */
export function countLabel(beat: number): string {
  if (Number.isInteger(beat)) return String(beat);
  if (Number.isInteger(beat * 2)) return `${Math.floor(beat)}&`;
  return String(Number(beat.toFixed(2)));
}

/**
 * Every footprint in a sequence, in time order within each entry: first
 * the four feet of the starting stance (count ""), then one per step
 * that places a foot.
 *
 * Airborne steps are left out, because the foot doesn't land (the same
 * rule as the trails in fold.mts). Weight changes and pivots are kept:
 * the foot stays where it is, but it's a step on a count, and a pivot
 * changes which way the print points.
 *
 * The starting stance is only given for the first entry. Later entries
 * start where the previous one ended; if a figure doesn't join, the gap
 * is the trails' job (sequenceTrailSegments).
 */
export function sequenceFootprints(
  entries: { figure: Figure; transform: FloorTransform }[],
): Footprint[] {
  const footprints: Footprint[] = [];
  let elapsed = 0;

  entries.forEach(({ figure, transform }, entryIndex) => {
    if (entryIndex === 0) {
      const start = applyTransform(transform, figure.startPose);
      for (const partner of PARTNERS) {
        for (const foot of FEET) {
          footprints.push({
            partner,
            foot,
            position: start[partner][foot].position,
            orientation: footHeading(start[partner], foot),
            entryIndex,
            startBeat: 0,
            endBeat: 0,
            count: "",
          });
        }
      }
    }

    const steps = [...figure.steps]
      .filter((step) => step.contact !== "air")
      .sort((a, b) => a.beat - b.beat);
    for (const step of steps) {
      const localEnd = step.beat - 1 + step.duration;
      // The pose at the moment the step finishes: the foot has landed
      // and the turn on this step is complete.
      const landed = applyTransform(transform, poseAtBeat(figure, localEnd));
      footprints.push({
        partner: step.partner,
        foot: step.foot,
        position: landed[step.partner][step.foot].position,
        orientation: footHeading(landed[step.partner], step.foot),
        entryIndex,
        startBeat: elapsed + step.beat - 1,
        endBeat: elapsed + localEnd,
        count: countLabel(step.beat),
      });
    }

    elapsed += figureDurationBeats(figure);
  });

  return footprints;
}

/**
 * Where a footprint stands at an instant:
 * - "taken": the foot has already landed there;
 * - "landing": the step is in progress and the foot is on its way;
 * - "next": one of the partner's next steps, not started yet;
 * - "later": further ahead (a renderer normally leaves these out).
 */
export type FootprintPhase = "taken" | "landing" | "next" | "later";

export interface FootprintState {
  footprint: Footprint;
  phase: FootprintPhase;
  /** For a taken print, how many of the same partner's taken prints are
   *  newer: 0 for the most recent. Lets a renderer fade older prints.
   *  0 for the other phases. */
  age: number;
}

/**
 * Each footprint's phase at `beat` (in beats along the sequence), with
 * up to `upcoming` not-yet-started steps per partner marked "next". A
 * step finishing exactly at `beat` counts as taken, and one starting
 * exactly at `beat` as landing, matching sequencePoseAtBeat, where a
 * beat on a boundary belongs to the step starting there.
 */
export function footprintsAtBeat(
  footprints: Footprint[],
  beat: number,
  upcoming = 1,
): FootprintState[] {
  const states: FootprintState[] = footprints.map((footprint) => ({
    footprint,
    phase:
      footprint.endBeat <= beat
        ? "taken"
        : footprint.startBeat <= beat
          ? "landing"
          : "later",
    age: 0,
  }));

  for (const partner of PARTNERS) {
    const own = states.filter((state) => state.footprint.partner === partner);

    // Newest taken print first, so its index is its age. Sorting by the
    // landing beat (stable for equal beats) keeps the starting stance
    // oldest.
    own
      .filter((state) => state.phase === "taken")
      .sort((a, b) => b.footprint.endBeat - a.footprint.endBeat)
      .forEach((state, index) => {
        state.age = index;
      });

    own
      .filter((state) => state.phase === "later")
      .sort((a, b) => a.footprint.startBeat - b.footprint.startBeat)
      .slice(0, upcoming)
      .forEach((state) => {
        state.phase = "next";
      });
  }

  return states;
}
