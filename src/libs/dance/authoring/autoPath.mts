// Automatic foot routes: `path: "auto"` (see MoveOptions.path).

import { footEase, footprintGap, poseAtBeat } from "../fold.mts";
import { normalizeDegrees } from "../heading.mts";
import { footHeading, type Pose } from "../pose.mts";
import type { DanceStep, Figure, Movement, Partner } from "../step.mts";
import { FigureError } from "./definition.mts";

/** The room an automatic route keeps between the moving foot's outline
 *  and every standing foot's (the dancer's own other foot and both of
 *  the partner's that aren't moving), in metres. Provisional. Half the
 *  centimetre a straight step's passing route keeps (`passingPoint` in
 *  fold/passing.mts), so a walk that already passes cleanly stays
 *  straight. */
export const AUTO_PATH_CLEARANCE = 0.005;

/** The flow limits: how far an automatic route may bow out from the
 *  straight line (the arc's sagitta) and how much longer than the
 *  straight line it may be. Beyond these the step stops reading as the
 *  step it is, so defineFigure refuses it instead. Provisional, agreed
 *  with the owner as roughly 12-15 cm and 15%. */
export const AUTO_PATH_MAX_BULGE = 0.12;
export const AUTO_PATH_MAX_LENGTH_RATIO = 1.15;

/** How finely the candidate routes are tried, in degrees of set-off,
 *  and how finely each is sampled, in beats. */
const ANGLE_STEP = 1;
const SAMPLE = 1 / 64;

const RAD_TO_DEG = 180 / Math.PI;

/** A step written with `path: "auto"`: its index in the figure's steps,
 *  the dancer's facing just before it (the frame Movement.arc.setOff is
 *  measured in), and where it came from for messages. */
export interface AutoStep {
  index: number;
  facing: number;
  where: string;
}

/**
 * The single arc from the same start to the same landing that sets off
 * `deviation` degrees clockwise of the straight line. It turns through
 * twice that (a circle meets a chord at equal angles at both ends), so
 *   curvature = 2 sin(deviation) / chord,
 *   arcLength = chord * deviation / sin(deviation)   (radians),
 * and it bows out from the chord by chord/2 * tan(deviation/2).
 */
function arcFor(
  straight: Extract<Movement, { type: "straight" }>,
  facing: number,
  deviation: number,
): Movement {
  if (deviation === 0) return straight;
  const radians = deviation / RAD_TO_DEG;
  const setOff =
    normalizeDegrees(straight.direction - deviation - facing + 180) - 180;
  return {
    type: "arc",
    curvature: (2 * Math.sin(radians)) / straight.distance,
    arcLength: (straight.distance * radians) / Math.sin(radians),
    ...(setOff !== 0 ? { setOff } : {}),
  };
}

/** How far an arc that sets off `deviation` degrees off the chord bows
 *  out, and how much longer it is, for a chord of length `chord`. */
function flow(chord: number, deviation: number) {
  const radians = Math.abs(deviation) / RAD_TO_DEG;
  return {
    bulge: (chord / 2) * Math.tan(radians / 2),
    ratio: radians === 0 ? 1 : radians / Math.sin(radians),
  };
}

/** Whether `partner`'s `foot` is moving at `beat` (0-based): some step
 *  of that foot is under way and travels. */
function moving(
  steps: Omit<DanceStep, "id">[],
  partner: Partner,
  foot: "left" | "right",
  beat: number,
): boolean {
  return steps.some(
    (step) =>
      step.partner === partner &&
      step.foot === foot &&
      step.beat - 1 < beat - 1e-9 &&
      beat + 1e-9 < step.beat - 1 + step.duration &&
      (step.movement.type === "arc" || step.movement.distance > 0),
  );
}

/** The least room, in metres, between the moving foot's outline and
 *  every standing foot's while `step` is under way, with linear and
 *  eased foot travel. */
function clearance(
  figure: Figure,
  steps: Omit<DanceStep, "id">[],
  step: Omit<DanceStep, "id">,
): number {
  const other = step.partner === "lead" ? "follow" : "lead";
  const start = step.beat - 1;
  let least = Infinity;
  for (const options of [{}, { footEasing: footEase }])
    for (let t = SAMPLE; t < step.duration - 1e-9; t += SAMPLE) {
      const beat = start + t;
      const pose: Pose = poseAtBeat(figure, beat, options);
      const mover = pose[step.partner];
      const from = {
        p: mover[step.foot].position,
        h: footHeading(mover, step.foot),
      };
      const standing: { p: { x: number; y: number }; h: number }[] = [];
      const ownOther = step.foot === "left" ? "right" : "left";
      if (!moving(steps, step.partner, ownOther, beat))
        standing.push({
          p: mover[ownOther].position,
          h: footHeading(mover, ownOther),
        });
      for (const foot of ["left", "right"] as const)
        if (!moving(steps, other, foot, beat))
          standing.push({
            p: pose[other][foot].position,
            h: footHeading(pose[other], foot),
          });
      for (const s of standing)
        least = Math.min(least, footprintGap(from.p, from.h, s.p, s.h));
    }
  return least;
}

/**
 * Chooses the route of every `path: "auto"` step, in the order they
 * start, and returns the steps with those routes in place.
 *
 * A step stays straight if its foot passes AUTO_PATH_CLEARANCE clear of
 * the standing feet the whole way (the dancer's own other foot, and the
 * partner's feet that aren't moving at the time). Otherwise the
 * candidates are the single arcs to the same landing, tried from the
 * gentlest outwards on both sides (one degree of set-off at a time), and
 * the first that keeps that clearance is used. Only arcs within the flow
 * limits (AUTO_PATH_MAX_BULGE, AUTO_PATH_MAX_LENGTH_RATIO) are tried; if
 * none clears, the figure is refused with a message saying how close
 * the best one came, since that usually means the landing spot needs
 * moving rather than a bigger curve.
 *
 * Only standing feet are avoided. A foot that moves at the same time is
 * left to the ordinary checks: avoiding it would make the route depend
 * on the timing, and linear and eased playback time the feet
 * differently. The arcs are ordinary Movement arcs, so playback, the
 * views and storage are unchanged.
 */
export function routeAutoPaths(
  name: string,
  figureOf: (steps: Omit<DanceStep, "id">[]) => Figure,
  steps: Omit<DanceStep, "id">[],
  autos: AutoStep[],
): Omit<DanceStep, "id">[] {
  let current = steps;
  const ordered = [...autos].sort(
    (a, b) => current[a.index].beat - current[b.index].beat,
  );
  for (const auto of ordered) {
    const step = current[auto.index];
    const straight = step.movement;
    if (straight.type !== "straight") continue;
    let best = { gap: -Infinity, bulge: 0 };
    const tried: number[] = [0];
    for (let d = ANGLE_STEP; d < 90; d += ANGLE_STEP) {
      const { bulge, ratio } = flow(straight.distance, d);
      if (bulge > AUTO_PATH_MAX_BULGE || ratio > AUTO_PATH_MAX_LENGTH_RATIO)
        break;
      tried.push(d, -d);
    }
    let chosen: Movement | undefined;
    for (const deviation of tried) {
      const movement = arcFor(straight, auto.facing, deviation);
      const candidate = current.map((s, i) =>
        i === auto.index ? { ...s, movement } : s,
      );
      const gap = clearance(
        figureOf(candidate),
        candidate,
        candidate[auto.index],
      );
      if (gap >= AUTO_PATH_CLEARANCE) {
        chosen = movement;
        break;
      }
      if (gap > best.gap)
        best = { gap, bulge: flow(straight.distance, deviation).bulge };
    }
    if (!chosen) {
      throw new FigureError(
        `${name}, ${auto.where}: "auto" found no route within the flow limits (a bulge of at most ${AUTO_PATH_MAX_BULGE} m, ${Math.round((AUTO_PATH_MAX_LENGTH_RATIO - 1) * 100)}% longer than straight) that keeps the foot ${AUTO_PATH_CLEARANCE} m clear of the standing feet; the best comes within ${best.gap.toFixed(3)} m with a ${best.bulge.toFixed(2)} m bulge. Move the landing spot, or write the route yourself`,
      );
    }
    current = current.map((s, i) =>
      i === auto.index ? { ...s, movement: chosen! } : s,
    );
  }
  return current;
}
