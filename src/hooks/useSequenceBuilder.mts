import { useCallback, useState } from "react";

import { createFigureAdditionQueue } from "./figureAdditionQueue.mts";
import { fetchFigure } from "../libs/api/figures.mts";
import { placeEntry, removeEntry } from "../libs/dance/chain.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";

interface UseSequenceBuilderResult {
  entries: SequenceEntry[];
  /** Figure id of the entry most recently added -- used to highlight the
   *  matching item in the step library and sequence strip. Null until
   *  the first figure is added. */
  activeFigureId: string | null;
  addFigure: (figureId: string) => Promise<void>;
  /** Removes the entry at `index`; the entries after it are re-placed so
   *  the sequence stays continuous (see removeEntry in chain.mts). */
  removeFigure: (index: number) => void;
  loading: boolean;
  error: string | null;
}

/**
 * Builds an in-memory Sequence one figure at a time. Each added figure
 * is placed on the floor by fitting a FloorTransform that lines its
 * startPose up with the previous entry's resolvedEndPose (see
 * fitTransform in libs/dance/floor.mts), so the couple's position and
 * facing carry over between figures instead of jumping. The very first
 * entry has nothing before it, so it anchors at the floor origin. The
 * placement rules live in libs/dance/chain.mts.
 *
 * The builder owns the editable entries; DanceControls saves snapshots in
 * browser storage. Loading a dance mounts a fresh editor with its entries,
 * so outstanding figure requests cannot append to the newly opened dance.
 */
export function useSequenceBuilder(
  initialEntries: SequenceEntry[] = [],
): UseSequenceBuilderResult {
  const [entries, setEntries] = useState<SequenceEntry[]>(initialEntries);
  const [activeFigureId, setActiveFigureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State initialization gives this editor a stable queue, independent of
  // rerenders and of queues belonging to previously opened dances. Functional
  // placement reads the latest entries, including removals made while fetching.
  const [addFigure] = useState(() =>
    createFigureAdditionQueue({
      load: fetchFigure,
      append: (figure) => {
        setEntries((previousEntries) => [
          ...previousEntries,
          placeEntry(figure, previousEntries[previousEntries.length - 1]),
        ]);
        setActiveFigureId(figure.id);
      },
      setLoading,
      setError,
    }),
  );

  const removeFigure = useCallback((index: number) => {
    setEntries((previousEntries) => removeEntry(previousEntries, index));
  }, []);

  // The highlight follows the most recently added figure. If that figure
  // has since been removed from the sequence, highlight the last
  // remaining entry instead (or nothing). Derived on read rather than
  // stored, so removing a figure needs no second state update.
  const highlightedFigureId =
    activeFigureId !== null &&
    entries.some((entry) => entry.figure.id === activeFigureId)
      ? activeFigureId
      : (entries[entries.length - 1]?.figure.id ?? null);

  return {
    entries,
    activeFigureId: highlightedFigureId,
    addFigure,
    removeFigure,
    loading,
    error,
  };
}
