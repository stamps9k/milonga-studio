import type { Point2D } from "./pose.mts";

/**
 * Shared angle/vector primitives for every heading-like value in this
 * codebase: DanceStep.orientation, Movement direction, FloorTransform
 * rotation. All of them use the SAME convention -- 0 degrees = facing
 * +Y ("north" / line of dance), rotating CLOCKWISE as the angle
 * increases (a compass bearing, not the standard math convention where
 * 0 = +X and angles increase counterclockwise).
 *
 * Concretely: rotating the "north" point (0, 1) by 90 degrees gives
 * (1, 0) ("east"), matching how a Movement with direction=90 moves
 * purely in +X (see e.g. the seeded "Side Step" figure, where both
 * partners move +X under direction=90).
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function rotatePoint(point: Point2D, degrees: number): Point2D {
  const rad = degrees * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos + point.y * sin,
    y: -point.x * sin + point.y * cos,
  };
}

/** Unit vector pointing in the direction of `degrees` (see rotatePoint). */
export function headingToUnitVector(degrees: number): Point2D {
  return rotatePoint({ x: 0, y: 1 }, degrees);
}

export function addPoints(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subPoints(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scalePoint(point: Point2D, scalar: number): Point2D {
  return { x: point.x * scalar, y: point.y * scalar };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Interpolates between two angles (degrees) by the shortest path,
 *  wrapping correctly (e.g. 350 -> 10 goes forward through 360/0, a
 *  20-degree turn, not backward through 180 the long way). */
export function lerpAngleDegrees(a: number, b: number, t: number): number {
  const shortestDelta = normalizeDegrees(b - a + 180) - 180;
  return normalizeDegrees(a + shortestDelta * t);
}
