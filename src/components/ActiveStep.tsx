const ActiveStep = () => {
	return (
    <div className="d-flex align-items-center justify-content-between px-4 py-3 border-top font-mono">
			<span className="text-body-secondary">BEAT <span className="text-body fw-bold">14</span> / 42</span>
			<span className="text-body-secondary">FIGURE <span className="text-amber fw-bold">Ocho Cortado</span></span>
			<span id="thirdStat" className="text-body-secondary">TEMPO <span className="text-body fw-bold">72</span> bpm</span>
		</div>
	);
}

export default ActiveStep;