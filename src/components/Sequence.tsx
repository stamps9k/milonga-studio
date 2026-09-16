const Sequence = () => {
	return (
    <div className="card p-3">
			<div className="d-flex align-items-center justify-content-between mb-2">
				<div className="eyebrow">Sequence</div>
				<button className="btn btn-outline-light btn-sm p-1" type="button" data-bs-toggle="modal" data-bs-target="#sequenceModal">
					<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H3v4"/><path d="M13 3h4v4"/><path d="M3 13v4h4"/><path d="M17 13v4h-4"/></svg>
				</button>
			</div>
			<div className="d-flex align-items-center flex-nowrap overflow-auto">
				<span className="btn btn-outline-light seq-chip disabled">Salida</span>
				<span className="mx-2 flex-shrink-0"></span>
				<span className="btn btn-outline-light seq-chip disabled">Ocho</span>
				<span className="mx-2 flex-shrink-0"></span>
				<span className="btn btn-outline-light seq-chip disabled bg-amber-dim text-amber fw-bold">Ocho Cortado</span>
				<span className="mx-2 flex-shrink-0"></span>
				<span className="btn btn-outline-light seq-chip disabled">Cadencia</span>
				<span className="mx-2 flex-shrink-0"></span>
				<button className="btn btn-outline-light p-2 flex-shrink-0" type="button">
					<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="10" y1="3" x2="10" y2="17"/><line x1="3" y1="10" x2="17" y2="10"/></svg>
				</button>
			</div>
		</div>

	);
}

export default Sequence;
