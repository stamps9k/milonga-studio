const Canvas2D = () => {
	return (
    <div id="view2d" className="canvas-grid position-relative">
			<svg viewBox="0 0 1100 380" width="100%" height="100%">
				<circle cx="330" cy="270" r="3.5" fill="var(--amber)" opacity="0.18"/>
				<circle cx="370" cy="245" r="3.5" fill="var(--amber)" opacity="0.3"/>
				<circle cx="400" cy="215" r="3.5" fill="var(--amber)" opacity="0.45"/>
				<circle cx="450" cy="198" r="3.5" fill="var(--amber)" opacity="0.6"/>
				<circle cx="500" cy="192" r="3.5" fill="var(--amber)" opacity="0.8"/>
				<circle cx="360" cy="310" r="3.5" fill="var(--teal)" opacity="0.18"/>
				<circle cx="400" cy="285" r="3.5" fill="var(--teal)" opacity="0.3"/>
				<circle cx="440" cy="260" r="3.5" fill="var(--teal)" opacity="0.45"/>
				<circle cx="490" cy="242" r="3.5" fill="var(--teal)" opacity="0.6"/>
				<circle cx="540" cy="230" r="3.5" fill="var(--teal)" opacity="0.8"/>
				<line x1="560" y1="188" x2="590" y2="228" stroke="rgba(231,232,238,0.35)" stroke-width="1.5"/>
				<circle cx="560" cy="188" r="16" fill="var(--amber)"/>
				<line x1="560" y1="188" x2="600" y2="165" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round"/>
				<text x="560" y="192" text-anchor="middle" font-family="JetBrains Mono" font-size="12" font-weight="700" fill="#14161c">L</text>
				<circle cx="590" cy="228" r="16" fill="var(--teal)"/>
				<line x1="590" y1="228" x2="625" y2="207" stroke="var(--teal)" stroke-width="2.5" stroke-linecap="round"/>
				<text x="590" y="232" text-anchor="middle" font-family="JetBrains Mono" font-size="12" font-weight="700" fill="#14161c">F</text>
				<circle cx="640" cy="180" r="3.5" fill="var(--amber)" opacity="0.35" stroke="var(--amber)" stroke-dasharray="2 2"/>
				<circle cx="670" cy="225" r="3.5" fill="var(--teal)" opacity="0.35" stroke="var(--teal)" stroke-dasharray="2 2"/>
			</svg>
		</div>

	);
}

export default Canvas2D;
