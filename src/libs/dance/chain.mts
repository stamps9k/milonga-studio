import { applyTransform, fitTransform } from "./floor.mts";
import type { Figure } from "./step.mts";
import type { FloorTransform, SequenceEntry } from "./sequence.mts";

/**
 * Building and editing a chain of figures on the floor. Every entry is
 * placed so that it continues from the one before it (fitTransform), and
 * the first entry is anchored at the floor origin -- the same rules the
 * sequence builder has always used, gathered here so adding and removing
 * figures can't place them differently.
 */

/** Where the first entry of a chain sits: the origin, facing line of
 *  dance. */
export const CHAIN_ORIGIN: FloorTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
};

/**
 * Places `figure` straight after `previous` (or at the origin when there
 * is nothing before it), returning a complete entry with its transform
 * and cached resolved poses.
 */
export function placeEntry(
  figure: Figure,
  previous: SequenceEntry | undefined,
): SequenceEntry {
  const transform = previous
    ? fitTransform(figure.startPose, previous.resolvedEndPose)
    : CHAIN_ORIGIN;
  return {
    figure,
    transform,
    resolvedStartPose: applyTransform(transform, figure.startPose),
    resolvedEndPose: applyTransform(transform, figure.endPose),
  };
}

/**
 * Removes the entry at `index` and re-places every entry after it, so
 * the chain stays continuous: each later figure now follows whatever
 * comes before it after the removal, instead of staying where it was and
 * leaving a jump.
 *
 * Entries before `index` are returned unchanged (the same objects).
 * Removing the first entry re-anchors the new first entry at the origin,
 * matching how a chain is first built. An out-of-range index returns the
 * entries unchanged.
 *
 * Example: in [Walking Step, Side Step, Ocho], removing Side Step places
 * the Ocho directly after Walking Step, exactly as if it had been added
 * there in the first place.
 */
export function removeEntry(
  entries: SequenceEntry[],
  index: number,
): SequenceEntry[] {
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
    return entries;
  }
  const result = entries.slice(0, index);
  for (const entry of entries.slice(index + 1)) {
    result.push(placeEntry(entry.figure, result[result.length - 1]));
  }
  return result;
}
