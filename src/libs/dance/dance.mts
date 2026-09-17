import type { Sequence } from "./sequence.mts";

/**
 * Top-level saved/shared artifact — what a user actually creates, names,
 * and loads: a Sequence plus the metadata around it that has nothing to
 * do with choreography (playback, provenance, sharing). Keeping this
 * separate from Sequence means the geometric model (figures, transforms,
 * poses) stays free of concerns that only make sense for a saved record.
 */
export interface Dance {
  id: string;
  name: string;

  /** Playback tempo in beats per minute. */
  tempo: number;
  /** Optional reference to an associated track (e.g. a title/URL/file id
   *  — left loose until a music-source integration is decided). */
  music?: string;

  notes?: string;

  createdAt: string;
  updatedAt: string;

  /** Bumped on breaking changes to this data model, so saved/shared
   *  dances (e.g. via URL) can be migrated instead of silently
   *  misreading old data. */
  schemaVersion: number;

  sequence: Sequence;
}
