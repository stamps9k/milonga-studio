import { useEffect, useRef, useState } from "react";

import { fetchFigure } from "../libs/api/figures.mts";
import type { Figure, FigureSummary } from "../libs/dance/step.mts";

/**
 * Fetches the full figure (steps and poses) for every figure in the
 * library, so the library can check how each one would join onto the
 * current sequence (assessJoin needs a figure's startPose and steps,
 * which the lightweight summaries leave out).
 *
 * Figures are fetched in parallel, once each, and kept for the session.
 * A figure that fails to load is simply missing from the map: the
 * library then shows it without a fit indicator rather than failing as
 * a whole. Failed figures aren't retried until the page reloads.
 *
 * This is one request per figure, which is fine for the current
 * catalogue of a handful of figures. If the catalogue grows large, a
 * bulk endpoint returning just the join-relevant data would scale
 * better.
 */
export function useFigureDetails(
  summaries: FigureSummary[],
): Map<string, Figure> {
  const [details, setDetails] = useState<Map<string, Figure>>(new Map());
  // Ids already requested, successful or not, so each figure is fetched
  // at most once per session even if the summaries list is replaced.
  const requested = useRef(new Set<string>());

  // No cancellation on cleanup: requests are deduplicated by `requested`
  // instead, so a cancelled first run (React StrictMode runs effects
  // twice in development) would otherwise leave figures never stored.
  // Setting state after unmount is a no-op in React 18+.
  useEffect(() => {
    const missing = summaries.filter(
      (summary) => !requested.current.has(summary.id),
    );
    if (missing.length === 0) return;
    for (const summary of missing) requested.current.add(summary.id);

    void Promise.allSettled(
      missing.map((summary) => fetchFigure(summary.id)),
    ).then((results) => {
      setDetails((previous) => {
        const next = new Map(previous);
        for (const result of results) {
          if (result.status === "fulfilled") {
            next.set(result.value.id, result.value);
          }
        }
        return next;
      });
    });
  }, [summaries]);

  return details;
}
