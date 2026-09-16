const Canvas3D = () => {
	return (
    <div id="view3d" className="d-none position-relative">
			<span className="badge bg-amber-dim text-amber border position-absolute top-0 start-0 m-3 font-mono fw-bold">
				PREVIEW &mdash; RENDERER IN DEVELOPMENT
			</span>
			<div className="position-absolute top-0 end-0 m-3 d-flex gap-2">
				<button className="btn btn-outline-light btn-sm p-2" type="button">
					<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="10" cy="10" rx="8" ry="4"/><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/></svg>
				</button>
				<button className="btn btn-outline-light btn-sm p-2" type="button">
					<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="9" r="6"/><line x1="13.5" y1="13.5" x2="18" y2="18"/><line x1="6.5" y1="9" x2="11.5" y2="9"/></svg>
				</button>
			</div>
			<svg viewBox="0 0 1100 380" width="100%" height="100%">
				<g stroke="rgba(73,80,87,0.28)" stroke-width="1">
					<line x1="550" y1="110" x2="90" y2="360"/>
					<line x1="550" y1="110" x2="290" y2="360"/>
					<line x1="550" y1="110" x2="490" y2="360"/>
					<line x1="550" y1="110" x2="610" y2="360"/>
					<line x1="550" y1="110" x2="810" y2="360"/>
					<line x1="550" y1="110" x2="1010" y2="360"/>
					<line x1="230" y1="200" x2="870" y2="200" stroke="rgba(73,80,87,0.22)"/>
					<line x1="150" y1="270" x2="950" y2="270" stroke="rgba(73,80,87,0.28)"/>
					<line x1="60" y1="340" x2="1040" y2="340" stroke="rgba(73,80,87,0.35)"/>
				</g>
				<g transform="translate(495,150)">
					<ellipse cx="0" cy="160" rx="34" ry="8" fill="rgba(0,0,0,0.3)"/>
					<circle cx="0" cy="0" r="13" fill="none" stroke="var(--amber)" stroke-width="2.5"/>
					<line x1="0" y1="13" x2="0" y2="80" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round"/>
					<line x1="0" y1="30" x2="-32" y2="52" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round"/>
					<line x1="0" y1="30" x2="28" y2="47" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round"/>
					<line x1="0" y1="80" x2="-22" y2="140" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round"/>
					<line x1="0" y1="80" x2="20" y2="135" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round"/>
				</g>
				<g transform="translate(570,190)">
					<ellipse cx="0" cy="130" rx="28" ry="6.5" fill="rgba(0,0,0,0.3)"/>
					<circle cx="0" cy="0" r="11" fill="none" stroke="var(--teal)" stroke-width="2.2"/>
					<path d="M -18 11 L 18 11 L 24 90 L -24 90 Z" fill="none" stroke="var(--teal)" stroke-width="2.2" stroke-linejoin="round"/>
					<line x1="-18" y1="20" x2="-30" y2="38" stroke="var(--teal)" stroke-width="2.2" stroke-linecap="round"/>
					<line x1="18" y1="20" x2="26" y2="36" stroke="var(--teal)" stroke-width="2.2" stroke-linecap="round"/>
					<line x1="-10" y1="90" x2="-16" y2="110" stroke="var(--teal)" stroke-width="2.2" stroke-linecap="round"/>
					<line x1="10" y1="90" x2="14" y2="110" stroke="var(--teal)" stroke-width="2.2" stroke-linecap="round"/>
				</g>
			</svg>
		</div>
	);
}

export default Canvas3D;
