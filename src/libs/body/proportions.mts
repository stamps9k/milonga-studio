import type { Partner } from "../dance/step.mts";

/**
 * A dancer's body measurements, in metres: the fixed bone lengths and
 * offsets the body solver (skeleton.mts) builds a skeleton from.
 *
 * Every measurement is a fraction of standing height, taken from the
 * standard anthropometric segment table (Drillis and Contini, as
 * tabulated in Winter, "Biomechanics and Motor Control of Human
 * Movement"), so a dancer of any height gets an ordinary adult build.
 * Where the table has no entry (the joint spacings, the toe and heel
 * offsets) the value is a rounded estimate, marked below. These are a
 * body for the mannequins to stand in, not anyone's measurements.
 */
export interface BodyProportions {
  height: number;
  /** Ankle joint above the floor, standing flat. */
  ankleHeight: number;
  /** Hip joint to knee, and knee to ankle. */
  thigh: number;
  shin: number;
  /** Hip joint above the floor, standing straight and flat. */
  hipHeight: number;
  /** Between the two hip joints. */
  hipWidth: number;
  /** From the floor: lower back (spine), mid-chest, base of the neck and
   *  base of the skull, standing. */
  spineHeight: number;
  chestHeight: number;
  neckHeight: number;
  headHeight: number;
  /** Between the two shoulder joints. */
  shoulderWidth: number;
  /** Shoulder to elbow, and elbow to wrist. */
  upperArm: number;
  forearm: number;
  /** Wrist to the tip of the middle finger. */
  hand: number;
  /** Heel to tip of the toes, and how far the ankle sits in front of
   *  the heel and the ball of the foot behind the tip of the toes. */
  footLength: number;
  ankleFromHeel: number;
  ballFromToe: number;
}

/** Proportions for a dancer `height` metres tall. */
export function proportionsForHeight(height: number): BodyProportions {
  const h = height;
  return {
    height: h,
    ankleHeight: 0.039 * h,
    // Table: knee at 0.285 h and hip joint at 0.530 h.
    thigh: (0.53 - 0.285) * h,
    shin: (0.285 - 0.039) * h,
    hipHeight: 0.53 * h,
    // Estimate: hip joints about 18 cm apart at 1.75 m.
    hipWidth: 0.1 * h,
    // Estimate: lower back a little above the hip joints.
    spineHeight: 0.58 * h,
    chestHeight: 0.72 * h,
    // Table: shoulders at 0.818 h, chin at 0.870 h.
    neckHeight: 0.83 * h,
    headHeight: 0.87 * h,
    // Table: shoulder width (biacromial) 0.259 h, which measures to the
    // outside of the shoulders; the joints are a little inside it.
    shoulderWidth: 0.22 * h,
    upperArm: 0.186 * h,
    forearm: 0.146 * h,
    // Table: hand length 0.108 h.
    hand: 0.108 * h,
    footLength: 0.152 * h,
    // Estimates.
    ankleFromHeel: 0.03 * h,
    ballFromToe: 0.04 * h,
  };
}

/** The mannequins' heights (owner's choice, 2026-11-17): typical adult
 *  proportions, lead 1.75 m and follow 1.70 m. */
export const DANCER_HEIGHTS: Record<Partner, number> = {
  lead: 1.75,
  follow: 1.7,
};

export const DEFAULT_PROPORTIONS: Record<Partner, BodyProportions> = {
  lead: proportionsForHeight(DANCER_HEIGHTS.lead),
  follow: proportionsForHeight(DANCER_HEIGHTS.follow),
};
