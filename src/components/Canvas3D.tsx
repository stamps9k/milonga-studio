import { useEffect, useRef, useState } from "react";

import type { Partner } from "../libs/dance/step.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";
import { RenderLoop } from "../libs/render/renderer.mts";
import type {
  CharacterStatus,
  FigureStyle,
  Renderer3D,
} from "../libs/render/Renderer3D.mts";
import { CAMERA_MODES } from "../libs/render/scene3d.mts";
import type { CameraMode } from "../libs/render/scene3d.mts";
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

const CAMERA_LABEL: Record<CameraMode, string> = {
  orbit: "Orbit",
  above: "Above",
  side: "Side",
  lead: "Lead's view",
  follow: "Follow's view",
};

const CAMERA_TITLE: Record<CameraMode, string> = {
  orbit: "Turn and zoom the camera yourself",
  above: "Straight down, line of dance up the screen, like the 2D view",
  side: "From the side, the couple travelling left to right",
  lead: "Over the lead's shoulder, turning as he turns",
  follow: "Over the follow's shoulder, turning as she turns",
};

/**
 * The 3D view's place on the page: hosts Renderer3D (src/libs/render/)
 * the way Canvas2D hosts Renderer2D. The renderer, and Three.js with it,
 * is loaded only when the 3D view is first opened, so the 2D view
 * doesn't wait for it. React draws only what goes round the view: the
 * empty-state message, the Lead/Follow toggle, the camera buttons and
 * the controls hint.
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
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [followCouple, setFollowCouple] = useState(true);
  const [figureStyle, setFigureStyle] = useState<FigureStyle>("mannequin");
  const [characterStatus, setCharacterStatus] = useState<{
    status: CharacterStatus;
    error?: string;
  }>({ status: "not loaded" });
  // The renderer starts with these; later changes are passed on by the
  // handlers below.
  const cameraRef = useRef({ cameraMode, followCouple, figureStyle });

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
        renderer.setCameraMode(cameraRef.current.cameraMode);
        renderer.setFollowCouple(cameraRef.current.followCouple);
        renderer.onCharacterStatus = (status, error) =>
          setCharacterStatus({ status, error });
        renderer.setFigureStyle(cameraRef.current.figureStyle);
        // A drag in a preset view switches the camera to orbit.
        renderer.onCameraModeChange = (mode) => {
          cameraRef.current.cameraMode = mode;
          setCameraMode(mode);
        };
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

  const chooseCamera = (mode: CameraMode) => {
    cameraRef.current.cameraMode = mode;
    setCameraMode(mode);
    rendererRef.current?.setCameraMode(mode);
  };
  const chooseFigure = (style: FigureStyle) => {
    cameraRef.current.figureStyle = style;
    setFigureStyle(style);
    rendererRef.current?.setFigureStyle(style);
  };
  const toggleFollow = () => {
    const follow = !followCouple;
    cameraRef.current.followCouple = follow;
    setFollowCouple(follow);
    rendererRef.current?.setFollowCouple(follow);
  };

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
          <div
            className="position-absolute top-0 start-0 m-2 d-flex flex-wrap gap-2 align-items-center"
            style={{ maxWidth: "70%" }}>
            <div
              className="btn-group btn-group-sm"
              role="group"
              aria-label="Camera">
              {CAMERA_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  title={CAMERA_TITLE[mode]}
                  aria-pressed={cameraMode === mode}
                  className={
                    "btn " +
                    (cameraMode === mode ? "btn-light" : "btn-outline-light")
                  }
                  onClick={() => chooseCamera(mode)}>
                  {CAMERA_LABEL[mode]}
                </button>
              ))}
            </div>
            <div
              className="btn-group btn-group-sm"
              role="group"
              aria-label="Figures">
              {(["mannequin", "character"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={figureStyle === style}
                  title={
                    style === "mannequin"
                      ? "Jointed figures showing where every joint is"
                      : "Character models dancing the same steps"
                  }
                  className={
                    "btn " +
                    (figureStyle === style ? "btn-light" : "btn-outline-light")
                  }
                  onClick={() => chooseFigure(style)}>
                  {style === "mannequin" ? "Mannequin" : "Character"}
                </button>
              ))}
            </div>
            {figureStyle === "character" &&
              characterStatus.status === "loading" && (
                <span className="small text-body-secondary">
                  Loading characters&hellip;
                </span>
              )}
            {figureStyle === "character" &&
              characterStatus.status === "failed" && (
                <span className="small text-warning">
                  Couldn&rsquo;t load the characters
                  {characterStatus.error ? `: ${characterStatus.error}` : ""}
                </span>
              )}
            {cameraMode === "orbit" && (
              <>
                <button
                  type="button"
                  className={
                    "btn btn-sm " +
                    (followCouple ? "btn-light" : "btn-outline-light")
                  }
                  aria-pressed={followCouple}
                  title="Keep the couple in view as they travel"
                  onClick={toggleFollow}>
                  Follow the couple
                </button>
                <button
                  type="button"
                  className="btn btn-outline-light btn-sm"
                  onClick={() => rendererRef.current?.resetView()}>
                  Reset view
                </button>
              </>
            )}
          </div>
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
