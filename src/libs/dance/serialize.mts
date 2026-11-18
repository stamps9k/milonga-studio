import type { FloorTransform, Sequence, SequenceEntry } from "./sequence.mts";

const ORIGIN_TRANSFORM: FloorTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
};

/**
 * Wraps builder entries in a Sequence, using the first occurrence's saved
 * floor transform as its start. These default id/name values keep callers
 * that only need a bare sequence simple; the dance editor replaces them with
 * its document metadata before saving or exporting a complete Dance.
 */
export function entriesToSequence(entries: SequenceEntry[]): Sequence {
  return {
    id: "local-sequence",
    name: "Untitled Sequence",
    startTransform: entries[0]?.transform ?? ORIGIN_TRANSFORM,
    entries,
  };
}
