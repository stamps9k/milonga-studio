import { useEffect, useRef } from "react";

import type { Partner } from "../libs/dance/step.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";
import { Renderer2D } from "../libs/render/Renderer2D.mts";
import { RenderLoop } from "../libs/render/renderer.mts";
import CanvasLegend from "./CanvasLegend";
import PartnerToggle from "./PartnerToggle";

interface Canvas2DProps {
  entries: SequenceEntry[];
  /** Current scrub/playback position, in beats along the whole
   *  sequence (see usePlayback) -- the pose drawn is the sequence
   *  interpolated at this instant, not just its final state. */
  currentBeat: number;
  /** Which dancers to draw. A hidden dancer's trails, footprints, feet
   *  and counts are all left out; the framing stays the same, so the
   *  view doesn't jump when a dancer is shown or hidden. */
  shown: Record<Partner, boolean>;
  onToggleShown: (partner: Partner) => void;
}

/**
 * The 2D view's place on the page. The floor plan itself is drawn by
 * Renderer2D (src/libs/render/), outside React: this component creates
 * it once, runs its render loop, passes it the scene when the sequence
 * or the shown dancers change, and keeps the beat where the loop can
 * read it. React only draws what goes round the plan -- the empty-state
 * message, the legend and the Lead/Follow toggle.
 */
const Canvas2D = ({
  entries,
  currentBeat,
  shown,
  onToggleShown,
}: Canvas2DProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer2D | null>(null);
  // The loop reads the beat from here on every frame, so a new beat
  // reaches the drawing without React re-creating anything.
  const beatRef = useRef(currentBeat);

  useEffect(() => {
    beatRef.current = currentBeat;
  }, [currentBeat]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const renderer = new Renderer2D(host);
    const loop = new RenderLoop(renderer, () => beatRef.current);
    rendererRef.current = renderer;
    loop.start();
    return () => {
      loop.stop();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Declared after the effect above, so on mount the renderer exists by
  // the time this runs.
  useEffect(() => {
    rendererRef.current?.setScene({ entries, shown });
  }, [entries, shown]);

  const empty = entries.length === 0;

  return (
    <div id="view2d" className="dance-view canvas-grid position-relative">
      {empty && (
        <div className="d-flex align-items-center justify-content-center h-100 text-body-secondary small">
          Select figures from the library to see them here.
        </div>
      )}
      {/* Kept mounted while the sequence is empty, so the renderer
          survives a sequence being emptied and refilled. */}
      <div
        ref={hostRef}
        className={empty ? "d-none" : "canvas-renderer h-100"}
      />
      {!empty && <CanvasLegend />}
      {!empty && <PartnerToggle shown={shown} onToggle={onToggleShown} />}
    </div>
  );
};

export default Canvas2D;
