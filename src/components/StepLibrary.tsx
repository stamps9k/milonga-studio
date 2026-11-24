import { useMemo, useState } from "react";

import { useFigures } from "../hooks/useFigures.mts";
import { useFigureDetails } from "../hooks/useFigureDetails.mts";
import { assessJoin } from "../libs/dance/join.mts";
import type { Pose } from "../libs/dance/pose.mts";
import { describeJoin } from "./joinIssues.mts";
import { capitalize, groupByStyle } from "./styleGroups.mts";

interface StepLibraryProps {
  onSelectFigure?: (figureId: string) => void;
  /** Where the couple is at the end of the current sequence (the last
   *  entry's resolvedEndPose), or null for an empty sequence. Each
   *  figure is checked against it to show whether it would follow on
   *  cleanly. */
  sequenceEnd?: Pose | null;
}

/** How a figure would join onto the current sequence: "fits", or the
 *  reasons it doesn't. Undefined while the figure's details are still
 *  loading, or when the sequence is empty (anything can start it). */
type FigureFit = { fits: true } | { fits: false; reasons: string[] };

const StepLibrary = ({
  onSelectFigure,
  sequenceEnd = null,
}: StepLibraryProps) => {
  const { figures, loading, error } = useFigures();
  const details = useFigureDetails(figures);
  const [query, setQuery] = useState("");
  const [hideMisfits, setHideMisfits] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Groups start collapsed; track only styles the user has opened. Search
  // reveals matching groups, then restores these choices when cleared.
  // Component-local state resets every group to collapsed on reload.
  const [expandedStyles, setExpandedStyles] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const searching = query.trim() !== "";

  const toggleStyle = (style: string) =>
    setExpandedStyles((previous) => {
      const next = new Set(previous);
      if (next.has(style)) {
        next.delete(style);
      } else {
        next.add(style);
      }
      return next;
    });

  // Figures that don't join cleanly are hidden by default, so the library
  // offers what can actually follow on. The switch stays visible whenever
  // something is hidden, so the library never shrinks without an obvious
  // way to see everything; turning it off shows the misfits flagged, and
  // adding one is still allowed (the sequence strip and canvas then show
  // the gap).
  const fitById = useMemo(() => {
    const fits = new Map<string, FigureFit>();
    if (sequenceEnd === null) return fits;
    for (const [id, figure] of details) {
      const assessment = assessJoin(sequenceEnd, figure);
      fits.set(
        id,
        assessment.fits
          ? { fits: true }
          : { fits: false, reasons: describeJoin(assessment) },
      );
    }
    return fits;
  }, [details, sequenceEnd]);

  // Grouped by style (tango/waltz/blues/...) -- the only categorical
  // field the data model actually has for figures -- with groups and the
  // figures in them in alphabetical order.
  const groups = useMemo(() => {
    // The search matches a figure's name or its style, case-insensitively,
    // so typing a dance ("waltz") lists every figure of that dance even
    // when none has the word in its name.
    const needle = query.trim().toLowerCase();
    const filtered = figures.filter(
      (figure) =>
        (!needle ||
          figure.name.toLowerCase().includes(needle) ||
          figure.style.toLowerCase().includes(needle)) &&
        !(hideMisfits && fitById.get(figure.id)?.fits === false),
    );

    return groupByStyle(filtered);
  }, [figures, query, hideMisfits, fitById]);

  const misfitCount = [...fitById.values()].filter((fit) => !fit.fits).length;

  return (
    <aside className={"figure-library" + (libraryOpen ? " library-open" : "")}>
      <style>{`
        .step-item:hover {
          background-color: var(--amber-dim);
          border-color: var(--amber);
          color: var(--amber);
        }
        .step-item.misfit {
          opacity: 0.5;
        }
        .step-item.misfit:hover {
          opacity: 1;
        }
        .style-toggle {
          background: none;
          border: 0;
          padding: 0;
          color: inherit;
          width: 100%;
          text-align: left;
        }
        .style-toggle:hover {
          color: var(--amber);
        }
        .style-toggle .chevron {
          display: inline-block;
          transition: transform 0.15s ease;
        }
        .style-toggle[aria-expanded="false"] .chevron {
          transform: rotate(-90deg);
        }
      `}</style>
      <div className="card p-3 overflow-hidden">
        <div className="library-heading eyebrow mb-2">Figure library</div>
        <button
          type="button"
          className="library-toggle btn btn-outline-light"
          aria-expanded={libraryOpen}
          aria-controls="figure-library-content"
          aria-label={
            libraryOpen ? "Hide figure library" : "Show figure library"
          }
          onClick={() => setLibraryOpen((open) => !open)}>
          Figure library{" "}
          <span aria-hidden="true">{libraryOpen ? "▴" : "▾"}</span>
        </button>
        <div id="figure-library-content" className="figure-library-content">
          <div className="input-group input-group-sm mb-3 flex-shrink-0">
            <span className="input-group-text bg-transparent border-secondary-subtle">
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6">
                <circle cx="9" cy="9" r="6" />
                <line x1="13.5" y1="13.5" x2="18" y2="18" />
              </svg>
            </span>
            <input
              type="text"
              className="form-control bg-transparent border-secondary-subtle text-body"
              placeholder="Search figures or dances…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}></input>
          </div>

          {sequenceEnd !== null && misfitCount > 0 && (
            <div className="form-check form-switch small mb-2 flex-shrink-0">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id="hide-misfits"
                checked={hideMisfits}
                onChange={(event) => setHideMisfits(event.target.checked)}
              />
              <label className="form-check-label" htmlFor="hide-misfits">
                Hide figures that don’t follow on
              </label>
            </div>
          )}

          {/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- This labeled scroll region needs focus for native keyboard scrolling. */}
          <div
            className="overflow-y-auto flex-grow-1"
            style={{ minHeight: 0 }}
            role="region"
            aria-label="Dance figures"
            tabIndex={0}>
            {loading && (
              <div className="text-body-secondary small">Loading figures…</div>
            )}

            {!loading && error && (
              <div className="text-danger small">
                Couldn’t load figures: {error}
              </div>
            )}

            {!loading && !error && groups.length === 0 && (
              <div className="text-body-secondary small">
                {query
                  ? `No figures match "${query}".`
                  : hideMisfits
                    ? "No figures follow on cleanly from here."
                    : "No figures yet."}
              </div>
            )}

            {!loading &&
              !error &&
              groups.map(([style, figuresInGroup]) => {
                const expanded = searching || expandedStyles.has(style);
                const listId = `figure-style-${style.replace(/\W+/g, "-")}`;
                return (
                  <div key={style}>
                    <button
                      type="button"
                      className="style-toggle eyebrow mb-1 d-flex align-items-center gap-1"
                      aria-expanded={expanded}
                      aria-controls={listId}
                      disabled={searching}
                      title={
                        searching
                          ? "All groups are open while searching"
                          : expanded
                            ? `Collapse ${capitalize(style)}`
                            : `Expand ${capitalize(style)}`
                      }
                      onClick={() => toggleStyle(style)}>
                      <span className="chevron" aria-hidden="true">
                        ▾
                      </span>
                      {capitalize(style)}
                      <span className="ms-auto text-body-secondary">
                        {figuresInGroup.length}
                      </span>
                    </button>
                    {expanded && (
                      <div
                        id={listId}
                        className="list-group list-group-flush mb-2">
                        {figuresInGroup.map((figure) => {
                          const fit = fitById.get(figure.id);
                          const misfit = fit !== undefined && !fit.fits;
                          return (
                            <button
                              key={figure.id}
                              type="button"
                              className={
                                "list-group-item d-flex align-items-center gap-2 rounded-3 mb-1 border-0 step-item" +
                                (misfit ? " misfit" : "")
                              }
                              title={
                                misfit
                                  ? `Doesn’t follow on cleanly:\n${fit.reasons.join("\n")}`
                                  : undefined
                              }
                              onClick={() => onSelectFigure?.(figure.id)}>
                              <span className="dot"></span>
                              {figure.name}
                              {misfit && (
                                <span
                                  className="ms-auto text-warning small"
                                  aria-label="Doesn’t follow on cleanly">
                                  ⚠
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
        </div>
      </div>
    </aside>
  );
};

export default StepLibrary;
