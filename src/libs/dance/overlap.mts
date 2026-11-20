/** Structural timing for one supporting action and its free-foot follows. */
import { lerpAngleDegrees } from "./heading.mts";
import type { Pose } from "./pose.mts";
import type { DanceStep } from "./step.mts";

type TimedStep = Pick<
  DanceStep,
  "partner" | "foot" | "beat" | "duration" | "weight" | "contact"
>;
const overlaps = (a: TimedStep, b: TimedStep) =>
  a.partner === b.partner &&
  a.beat < b.beat + b.duration - 1e-9 &&
  b.beat < a.beat + a.duration - 1e-9;

/** A free-foot path can follow the other foot's weight-taking action. It
 * controls only that foot's position, direction and pitch, never the frame,
 * rise, pelvis or weight transfer. Non-overlapping unweighted steps keep
 * their ordinary collection/embellishment behaviour. */
export function isFreeFootFollow(
  step: TimedStep,
  steps: readonly TimedStep[],
): boolean {
  return (
    step.weight === 0 &&
    step.contact !== "air" &&
    steps.some(
      (other) =>
        other !== step &&
        other.foot !== step.foot &&
        other.weight > 0 &&
        other.contact !== "air" &&
        overlaps(step, other),
    )
  );
}

/** Structural timing checks shared by authoring and snapshot import. */
export function stepOverlapError(
  steps: readonly TimedStep[],
): string | undefined {
  const sorted = [...steps].sort((a, b) => a.beat - b.beat);
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i],
        b = sorted[j];
      if (b.beat >= a.beat + a.duration - 1e-9) break;
      if (!overlaps(a, b)) continue;
      if (
        a.foot === b.foot ||
        a.contact === "air" ||
        b.contact === "air" ||
        (a.weight === 0) === (b.weight === 0)
      )
        return `${a.partner} steps overlap on beat ${b.beat}`;
    }
  for (const free of sorted.filter((s) => isFreeFootFollow(s, steps))) {
    let covered = free.beat;
    for (const driver of sorted.filter(
      (s) =>
        s.partner === free.partner &&
        s.foot !== free.foot &&
        s.weight > 0 &&
        s.contact !== "air",
    )) {
      if (driver.beat > covered + 1e-9) break;
      if (driver.beat + driver.duration > covered)
        covered = driver.beat + driver.duration;
    }
    if (covered < free.beat + free.duration - 1e-9)
      return `${free.partner} free-foot path extends beyond its supporting action`;
  }
}

/** Actual body frame when an action starts. Free-foot follows do not drive it. */
export function bodyHeadingBefore(
  step: Omit<DanceStep, "id">,
  steps: readonly Omit<DanceStep, "id">[],
  start: Pose,
): number {
  let facing = start[step.partner].orientation;
  for (const driver of [...steps]
    .filter((s) => s.partner === step.partner && !isFreeFootFollow(s, steps))
    .sort((a, b) => a.beat - b.beat)) {
    if (driver === step || driver.beat >= step.beat - 1e-9) break;
    if (driver.beat + driver.duration <= step.beat + 1e-9)
      facing = driver.orientation;
    else
      return lerpAngleDegrees(
        facing,
        driver.orientation,
        (step.beat - driver.beat) / driver.duration,
      );
  }
  return facing;
}
