const Toolbar = () => {
	return (
    <div className="border-bottom">
			<div className="container-fluid px-4 py-3 d-flex align-items-center justify-content-between">
				<div>
					<div className="eyebrow mb-1">STAMPATRON.COM &nbsp;/&nbsp; DANCE</div>
					<h1 className="font-mono fw-bold h4 mb-0">Milonga Studio</h1>
				</div>
				<div className="d-flex align-items-center gap-3">
					<div className="btn-group" role="group" aria-label="View toggle">
						<input type="radio" className="btn-check" name="viewToggle" id="toggle2d" checked></input>
						<label className="btn btn-outline-light d-flex align-items-center gap-2">
							<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>
							2D
						</label>
						<input type="radio" className="btn-check" name="viewToggle" id="toggle3d"></input>
						<label className="btn btn-outline-light d-flex align-items-center gap-2">
							<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2 L18 6 L18 14 L10 18 L2 14 L2 6 Z"/><path d="M2 6 L10 10 L18 6"/><path d="M10 10 L10 18"/></svg>
							3D
						</label>
					</div>
					<button className="btn btn-outline-light d-flex align-items-center gap-2" type="button">
						<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="5" r="2.3"/><circle cx="5" cy="10" r="2.3"/><circle cx="15" cy="15" r="2.3"/><line x1="7.1" y1="8.8" x2="12.9" y2="6.2"/><line x1="7.1" y1="11.2" x2="12.9" y2="13.8"/></svg>
						Share
					</button>
					<button className="btn btn-amber d-flex align-items-center gap-2" type="button">
						<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#14161c" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v9"/><path d="M6.5 9l3.5 3.5L13.5 9"/><path d="M4 15.5h12"/></svg>
						Export
					</button>
				</div>
			</div>
		</div>
	);
}

export default Toolbar;
