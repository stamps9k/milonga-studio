import { useEffect, useRef, useState } from "react";

import type { Partner } from "../libs/dance/step.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";
import { RenderLoop } from "../libs/render/renderer.mts";
import type { Renderer3D } from "../libs/render/Renderer3D.mts";
import PartnerToggle from "./PartnerToggle";

interface Canvas3DProps {
  entries: SequenceEntry[];
  /** Current scrub/playback position, in beats along the whole
   *  sequence (see usePlayback). */
  currentBeat: number;
  /** Which dancers to draw (shared with the 2D view). */
  shown: Record<Partner, boolean>;
  onToggleShown: (partner: Partner) => void;
}

/**
 * The 3D view's place on the page: hosts Renderer3D (src/libs/render/)
 * the way Canvas2D hosts Renderer2D. The renderer, and Three.js with it,
 * is loaded only when the 3D view is first opened, so the 2D view
 * doesn't wait for it. React draws only what goes round the view: the
 * empty-state message, the Lead/Follow toggle, the reset button and the
 * controls hint.
 */
const Canvas3D = ({
  entries,
  currentBeat,
  shown,
  onToggleShown,
}: Canvas3DProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer3D | null>(null);
  const beatRef = useRef(currentBeat);
  const sceneRef = useRef({ entries, shown });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    beatRef.current = currentBeat;
  }, [currentBeat]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    // The import resolves after this effect returns, possibly after it
    // has already been cleaned up (StrictMode mounts twice): `cancelled`
    // stops a late renderer from being created.
    let cancelled = false;
    let loop: RenderLoop | null = null;
    import("../libs/render/Renderer3D.mts")
      .then(({ Renderer3D }) => {
        if (cancelled) return;
        const renderer = new Renderer3D(host);
        renderer.setScene(sceneRef.current);
        rendererRef.current = renderer;
        loop = new RenderLoop(renderer, () => beatRef.current);
        loop.start();
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailed(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
      loop?.stop();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    sceneRef.current = { entries, shown };
    rendererRef.current?.setScene({ entries, shown });
  }, [entries, shown]);

  const empty = entries.length === 0;

  return (
    <div id="view3d" className="position-relative" style={{ height: "50vh" }}>
      {empty && (
        <div className="d-flex align-items-center justify-content-center h-100 text-body-secondary small">
          Select figures from the library to see them here.
        </div>
      )}
      {failed !== null && (
        <div className="position-absolute top-50 start-50 translate-middle text-body-secondary small">
          The 3D view couldn&rsquo;t start: {failed}
        </div>
      )}
      {/* Kept mounted while the sequence is empty, so the renderer
          survives a sequence being emptied and refilled. */}
      <div ref={hostRef} className={empty ? "d-none" : "h-100"} />
      {!empty && ready && (
        <>
          <PartnerToggle shown={shown} onToggle={onToggleShown} />
          <button
            type="button"
            className="btn btn-outline-light btn-sm position-absolute top-0 start-0 m-2"
            onClick={() => rendererRef.current?.resetView()}>
            Reset view
          </button>
          <div
            className="position-absolute bottom-0 start-0 m-2 small text-body-secondary"
            style={{ pointerEvents: "none" }}>
            Drag to turn &middot; scroll to zoom &middot; right-drag to move
          </div>
        </>
      )}
    </div>
  );
};

export default Canvas3D;
