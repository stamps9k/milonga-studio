import { useMemo, useState } from "react";

import { useFigures } from "../hooks/useFigures.mts";
import type { FigureSummary } from "../libs/dance/step.mts";

interface StepLibraryProps {
  selectedFigureId?: string | null;
  onSelectFigure?: (figureId: string) => void;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

const StepLibrary = ({ selectedFigureId, onSelectFigure }: StepLibraryProps) => {
  const { figures, loading, error } = useFigures();
  const [query, setQuery] = useState("");

  // Grouped by style (tango/waltz/blues/...) -- the only categorical
  // field the data model actually has for figures.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? figures.filter((figure) => figure.name.toLowerCase().includes(needle))
      : figures;

    const byStyle = new Map<string, FigureSummary[]>();
    for (const figure of filtered) {
      const group = byStyle.get(figure.style);
      if (group) {
        group.push(figure);
      } else {
        byStyle.set(figure.style, [figure]);
      }
    }

    return [...byStyle.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [figures, query]);

  return (
    <div className="col-3">
      <h1>Step Library</h1>
      <div className="card h-100 p-3">
        <div className="eyebrow mb-2">Figure library</div>
        <div className="input-group input-group-sm mb-3">
          <span className="input-group-text bg-transparent border-secondary-subtle">
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
            >
              <circle cx="9" cy="9" r="6" />
              <line x1="13.5" y1="13.5" x2="18" y2="18" />
            </svg>
          </span>
          <input
            type="text"
            className="form-control bg-transparent border-secondary-subtle text-body"
            placeholder="Search figures…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          ></input>
        </div>

        {loading && (
          <div className="text-body-secondary small">Loading figures…</div>
        )}

        {!loading && error && (
          <div className="text-danger small">
            Couldn't load figures: {error}
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <div className="text-body-secondary small">
            {query ? `No figures match "${query}".` : "No figures yet."}
          </div>
        )}

        {!loading &&
          !error &&
          groups.map(([style, figuresInGroup]) => (
            <div key={style}>
              <div className="eyebrow mb-1">{capitalize(style)}</div>
              <div className="list-group list-group-flush mb-2">
                {figuresInGroup.map((figure) => (
                  <button
                    key={figure.id}
                    type="button"
                    className={
                      "list-group-item d-flex align-items-center gap-2" +
                      (figure.id === selectedFigureId ? " active" : "")
                    }
                    onClick={() => onSelectFigure?.(figure.id)}
                  >
                    <span className="dot"></span>
                    {figure.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};

export default StepLibrary;
