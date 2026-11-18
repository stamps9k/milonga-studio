import type { ReactNode } from "react";

export type ViewMode = "2d" | "3d";
export type ShareStatus = "idle" | "copied" | "error";

interface ToolbarProps {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  children: ReactNode;
}

/** The application menu bar stays compact; document menus and dialogs are
 * provided by DanceControls, while view selection remains renderer-only UI. */
const Toolbar = ({ view, onViewChange, children }: ToolbarProps) => (
  <header className="border-bottom bg-body">
    <style>{`
      .btn-accent:disabled { --bs-btn-disabled-color: var(--bs-btn-color); --bs-btn-disabled-bg: var(--bs-btn-bg); --bs-btn-disabled-border-color: var(--bs-btn-border-color); }
      .app-toolbar .dropdown-item:active { background-color: var(--amber, #e2a343); color: #14161c; }
      .app-toolbar .dropdown-item[aria-current="true"] { font-weight: 600; }
    `}</style>
    <div className="app-toolbar container-fluid px-4 py-2 d-flex align-items-center gap-2 flex-wrap">
      <div className="d-flex align-items-center gap-2 pe-3 border-end flex-shrink-0">
        <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true">
          <g fill="var(--amber)" transform="translate(9,18) rotate(-18)">
            <circle cy="-3.4" r="3.8" />
            <circle cy="3.8" r="2.7" />
          </g>
          <g fill="var(--teal)" transform="translate(19,9) rotate(18)">
            <circle cy="-3.4" r="3.8" />
            <circle cy="3.8" r="2.7" />
          </g>
        </svg>
        <h1 className="font-mono fw-bold fs-6 mb-0">Milonga Studio</h1>
      </div>
      {children}
      <div
        className="btn-group btn-group-sm ms-2"
        role="group"
        aria-label="View toggle">
        {(["2d", "3d"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={
              "btn " + (view === mode ? "btn-accent" : "btn-outline-light")
            }
            aria-pressed={view === mode}
            onClick={() => onViewChange(mode)}>
            {mode.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  </header>
);
export default Toolbar;
