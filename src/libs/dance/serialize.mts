import type { FloorTransform, Sequence, SequenceEntry } from "./sequence.mts";

const ORIGIN_TRANSFORM: FloorTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
};

/**
 * Wraps the in-memory entries useSequenceBuilder assembles into a proper
 * Sequence record, matching what a real save/share backend would
 * eventually persist (see api/dances.mts and useSequenceBuilder's own
 * comment -- there's no write API yet). `id`/`name` are placeholders
 * until saving is real; `startTransform` is the first entry's own
 * transform, which is exactly what useSequenceBuilder anchors it to
 * when there's no previous entry to derive it from.
 */
export function entriesToSequence(entries: SequenceEntry[]): Sequence {
  return {
    id: "local-sequence",
    name: "Untitled Sequence",
    startTransform: entries[0]?.transform ?? ORIGIN_TRANSFORM,
    entries,
  };
}
