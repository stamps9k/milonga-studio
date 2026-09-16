const StepLibrary = () => {
	return (
    <div className="col-3">
			<h1>Step Library</h1>
			<div className="card h-100 p-3">
        <div className="eyebrow mb-2">Figure library</div>
        <div className="input-group input-group-sm mb-3">
          <span className="input-group-text bg-transparent border-secondary-subtle">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><line x1="13.5" y1="13.5" x2="18" y2="18"/></svg>
          </span>
          <input type="text" className="form-control bg-transparent border-secondary-subtle text-body" placeholder="Search figures…"></input>
        </div>

        <div className="eyebrow mb-1">Basics</div>
        <div className="list-group list-group-flush mb-2">
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Salida</button>
          <button className="list-group-item active d-flex align-items-center gap-2"><span className="dot"></span>Ocho Cortado</button>
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Cruzada</button>
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Cadencia</button>
        </div>

        <div className="eyebrow mb-1">Turns</div>
        <div className="list-group list-group-flush mb-2">
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Molinete</button>
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Giro</button>
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Sacada</button>
        </div>

        <div className="eyebrow mb-1">Ornaments</div>
        <div className="list-group list-group-flush">
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Boleo</button>
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Gancho</button>
          <button className="list-group-item d-flex align-items-center gap-2"><span className="dot"></span>Volcada</button>
        </div>
      </div>
		</div>
	);
}

export default StepLibrary;
