import { Fragment, useMemo } from "react";

import { assessSequenceJoins } from "../libs/dance/join.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";
import { describeJoin } from "./joinIssues.mts";

interface SequenceProps {
  entries: SequenceEntry[];
  activeFigureId?: string | null;
  loading?: boolean;
  error?: string | null;
}

const Sequence = ({
  entries,
  activeFigureId,
  loading,
  error,
}: SequenceProps) => {
  // A warning sits before any figure that doesn't follow on cleanly from
  // the one before it, with the reasons in its tooltip.
  const joins = useMemo(() => assessSequenceJoins(entries), [entries]);

  return (
    <div className="card p-3">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <div className="eyebrow">Sequence</div>
        <button
          className="btn btn-outline-light btn-sm p-1"
          type="button"
          data-bs-toggle="modal"
          data-bs-target="#sequenceModal">
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round">
            <path d="M7 3H3v4" />
            <path d="M13 3h4v4" />
            <path d="M3 13v4h4" />
            <path d="M17 13v4h-4" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="text-danger small mb-2">
          Couldn’t add figure: {error}
        </div>
      )}

      <div className="d-flex align-items-center flex-nowrap overflow-auto">
        {entries.length === 0 && !loading && (
          <span className="text-body-secondary small">
            Select figures from the library to build a sequence.
          </span>
        )}

        {entries.map((entry, index) => {
          const join = joins[index];
          const reasons = join && !join.fits ? describeJoin(join) : [];
          return (
            <Fragment key={`${entry.figure.id}-${index}`}>
              {reasons.length > 0 && (
                <span
                  className="text-warning small me-2 flex-shrink-0"
                  role="img"
                  aria-label={`Doesn’t follow on cleanly: ${reasons.join("; ")}`}
                  title={`Doesn’t follow on cleanly:\n${reasons.join("\n")}`}>
                  ⚠
                </span>
              )}
              <span
                className={
                  "btn btn-outline-light seq-chip disabled" +
                  (entry.figure.id === activeFigureId
                    ? " bg-amber-dim text-amber fw-bold"
                    : "")
                }>
                {entry.figure.name}
              </span>
              <span className="mx-2 flex-shrink-0"></span>
            </Fragment>
          );
        })}

        {loading && (
          <span className="btn btn-outline-light seq-chip disabled">
            Adding…
          </span>
        )}

        <button
          className="btn btn-outline-light p-2 flex-shrink-0"
          type="button"
          disabled
          title="Add figures from the Step Library on the left">
          <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round">
            <line x1="10" y1="3" x2="10" y2="17" />
            <line x1="3" y1="10" x2="17" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Sequence;
