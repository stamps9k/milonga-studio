import { useCallback, useState } from "react";

import { fetchFigure } from "../libs/api/figures.mts";
import { applyTransform, fitTransform } from "../libs/dance/floor.mts";
import type { FloorTransform, SequenceEntry } from "../libs/dance/sequence.mts";

const ORIGIN_TRANSFORM: FloorTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
};

interface UseSequenceBuilderResult {
  entries: SequenceEntry[];
  /** Figure id of the entry most recently added -- used to highlight the
   *  matching item in the step library and sequence strip. Null until
   *  the first figure is added. */
  activeFigureId: string | null;
  addFigure: (figureId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Builds an in-memory Sequence one figure at a time. Each added figure
 * is placed on the floor by fitting a FloorTransform that lines its
 * startPose up with the previous entry's resolvedEndPose (see
 * fitTransform in libs/dance/floor.mts), so the couple's position and
 * facing carry over between figures instead of jumping. The very first
 * entry has nothing before it, so it anchors at the floor origin.
 *
 * Nothing here is persisted -- there's no write API yet (see
 * api/dances.mts) -- this is purely in-memory sequence-building state
 * for the current session.
 */
export function useSequenceBuilder(): UseSequenceBuilderResult {
  const [entries, setEntries] = useState<SequenceEntry[]>([]);
  const [activeFigureId, setActiveFigureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFigure = useCallback(async (figureId: string) => {
    setLoading(true);
    setError(null);
    try {
      const figure = await fetchFigure(figureId);
      setEntries((previousEntries) => {
        const previousEntry = previousEntries[previousEntries.length - 1];
        const transform = previousEntry
          ? fitTransform(figure.startPose, previousEntry.resolvedEndPose)
          : ORIGIN_TRANSFORM;

        const entry: SequenceEntry = {
          figure,
          transform,
          resolvedStartPose: applyTransform(transform, figure.startPose),
          resolvedEndPose: applyTransform(transform, figure.endPose),
        };

        return [...previousEntries, entry];
      });
      setActiveFigureId(figureId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { entries, activeFigureId, addFigure, loading, error };
}
