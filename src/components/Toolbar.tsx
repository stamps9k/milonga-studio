export type ViewMode = "2d" | "3d";
export type ShareStatus = "idle" | "copied" | "error";

interface ToolbarProps {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onShare: () => void;
  onExport: () => void;
  shareStatus: ShareStatus;
  /** Disables Share/Export when there's nothing in the sequence yet. */
  canExport: boolean;
}

const SHARE_LABEL: Record<ShareStatus, string> = {
  idle: "Share",
  copied: "Copied!",
  error: "Couldn't copy",
};

const Toolbar = ({
  view,
  onViewChange,
  onShare,
  onExport,
  shareStatus,
  canExport,
}: ToolbarProps) => {
  const exportTitle = canExport
    ? undefined
    : "Add a figure to the sequence first";

  return (
    <div className="border-bottom">
			<style>{`
				.btn-accent:disabled,
				.btn-accent.disabled {
					--bs-btn-disabled-color: var(--bs-btn-color);
					--bs-btn-disabled-bg: var(--bs-btn-bg);
					--bs-btn-disabled-border-color: var(--bs-btn-border-color);
				}
			`}</style>
			<div className="container-fluid px-4 py-3 d-flex align-items-center justify-content-between">
				<div className="d-flex align-items-center gap-2">
					<svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true">
						<g fill="var(--amber)" transform="translate(9,18) rotate(-18)">
							<circle cx="0" cy="-3.4" r="3.8" />
							<circle cx="0" cy="3.8" r="2.7" />
						</g>
						<g fill="var(--teal)" transform="translate(19,9) rotate(18)">
							<circle cx="0" cy="-3.4" r="3.8" />
							<circle cx="0" cy="3.8" r="2.7" />
						</g>
					</svg>
					<h1 className="font-mono fw-bold h4 mb-0">Milonga Studio</h1>
				</div>
				<div className="d-flex align-items-center gap-3">
					<div className="btn-group" role="group" aria-label="View toggle">
						<input
							type="radio"
							className="btn-check"
							name="viewToggle"
							id="toggle2d"
							checked={view === "2d"}
							onChange={() => onViewChange("2d")}
						/>
						<label className={"btn d-flex align-items-center gap-2" + (view === "2d" ? " btn-accent" : " btn-outline-light")} htmlFor="toggle2d">
							<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>
							2D
						</label>
						<input
							type="radio"
							className="btn-check"
							name="viewToggle"
							id="toggle3d"
							checked={view === "3d"}
							onChange={() => onViewChange("3d")}
						/>
						<label className={"btn d-flex align-items-center gap-2" + (view === "3d" ? " btn-accent" : " btn-outline-light")} htmlFor="toggle3d">
							<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 2 L18 6 L18 14 L10 18 L2 14 L2 6 Z"/><path d="M2 6 L10 10 L18 6"/><path d="M10 10 L10 18"/></svg>
							3D
						</label>
					</div>
					<button
						className="btn btn-outline-light d-flex align-items-center gap-2"
						type="button"
						onClick={onShare}
						disabled={!canExport}
						title={exportTitle}
					>
						<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="15" cy="5" r="2.3"/><circle cx="5" cy="10" r="2.3"/><circle cx="15" cy="15" r="2.3"/><line x1="7.1" y1="8.8" x2="12.9" y2="6.2"/><line x1="7.1" y1="11.2" x2="12.9" y2="13.8"/></svg>
						{SHARE_LABEL[shareStatus]}
					</button>
					<button
						className="btn btn-accent d-flex align-items-center gap-2"
						type="button"
						onClick={onExport}
						disabled={!canExport}
						title={exportTitle}
					>
						<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#14161c" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v9"/><path d="M6.5 9l3.5 3.5L13.5 9"/><path d="M4 15.5h12"/></svg>
						Export
					</button>
				</div>
			</div>
		</div>
	);
}

export default Toolbar;
