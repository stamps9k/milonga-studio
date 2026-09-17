import { useEffect, useState } from "react";

import { fetchFigureSummaries } from "../libs/api/figures.mts";
import type { FigureSummary } from "../libs/dance/step.mts";

interface UseFiguresResult {
  figures: FigureSummary[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the figure catalog for browsing UIs (e.g. the step library).
 * Deliberately hits the lightweight /api/figures summary endpoint --
 * never the full nested Figure with steps/poses, which is only worth
 * fetching once a specific figure is selected (see fetchFigure in
 * libs/api/figures.mts).
 */
export function useFigures(): UseFiguresResult {
  const [figures, setFigures] = useState<FigureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchFigureSummaries();
        if (!cancelled) {
          setFigures(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { figures, loading, error };
}
