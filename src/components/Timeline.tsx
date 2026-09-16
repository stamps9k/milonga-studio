const Timeline = () => {
	return (
    <div className="d-flex align-items-center gap-3">
			<button className="btn btn-outline-light transport-btn p-2" type="button">
				<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="5" width="2" height="14"/><polygon points="16,5 16,19 4,12"/></svg>
			</button>
			<button className="btn btn-amber transport-play p-0 d-flex align-items-center justify-content-center" type="button">
				<svg width="17" height="17" viewBox="0 0 20 20" fill="currentColor"><polygon points="6,4 6,20 19,12"/></svg>
			</button>
			<button className="btn btn-outline-light transport-btn p-2" type="button">
				<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><rect x="15" y="5" width="2" height="14"/><polygon points="4,5 4,19 16,12"/></svg>
			</button>
			<input type="range" className="form-range flex-fill mx-2" min="0" max="42" value="14"></input>
			<span className="font-mono text-body-secondary flex-shrink-0">0:14 / 0:42</span>
		</div>
	);
}

export default Timeline;
