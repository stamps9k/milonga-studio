import { useEffect, useRef, useState } from "react";

/**
 * Placeholder for the real 3D renderer -- deliberately not wired to any
 * dance data yet (see the design discussion: the actual pose->3D
 * pipeline is its own project for later). This just spins a plain CSS
 * cube continuously so the pane isn't dead space, and so the Toolbar's
 * eventual 2D/3D view switch has something real to toggle to.
 */

const CUBE_SIZE = 100;
const HALF = CUBE_SIZE / 2;

interface Face {
  key: string;
  transform: string;
  color: string;
}

const FACES: Face[] = [
  { key: "front", transform: `translateZ(${HALF}px)`, color: "var(--amber)" },
  { key: "back", transform: `rotateY(180deg) translateZ(${HALF}px)`, color: "var(--amber)" },
  { key: "right", transform: `rotateY(90deg) translateZ(${HALF}px)`, color: "var(--teal)" },
  { key: "left", transform: `rotateY(-90deg) translateZ(${HALF}px)`, color: "var(--teal)" },
  { key: "top", transform: `rotateX(90deg) translateZ(${HALF}px)`, color: "rgba(255,255,255,0.5)" },
  { key: "bottom", transform: `rotateX(-90deg) translateZ(${HALF}px)`, color: "rgba(255,255,255,0.5)" },
];

// Degrees per second around each axis -- arbitrary, just enough to read
// as a rotating solid rather than a flat spinning square.
const SPIN_X_DEG_PER_SEC = 18;
const SPIN_Y_DEG_PER_SEC = 27;

function useContinuousRotation() {
  const [angles, setAngles] = useState({ x: 0, y: 0 });
  const frameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = (time: number) => {
      if (lastTimeRef.current !== null) {
        const deltaSeconds = (time - lastTimeRef.current) / 1000;
        setAngles((previous) => ({
          x: (previous.x + SPIN_X_DEG_PER_SEC * deltaSeconds) % 360,
          y: (previous.y + SPIN_Y_DEG_PER_SEC * deltaSeconds) % 360,
        }));
      }
      lastTimeRef.current = time;
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return angles;
}

const Canvas3D = () => {
  const { x, y } = useContinuousRotation();

  return (
    <div id="view3d" className="position-relative" style={{ minHeight: 320 }}>
      <span className="badge bg-amber-dim text-amber border position-absolute top-0 start-0 m-3 font-mono fw-bold">
        PREVIEW &mdash; RENDERER IN DEVELOPMENT
      </span>
      <div className="position-absolute top-0 end-0 m-3 d-flex gap-2">
        <button
          className="btn btn-outline-light btn-sm p-2"
          type="button"
          disabled
          title="Orbit controls -- coming with the full 3D renderer"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="10" cy="10" rx="8" ry="4"/><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/></svg>
        </button>
        <button
          className="btn btn-outline-light btn-sm p-2"
          type="button"
          disabled
          title="Zoom -- coming with the full 3D renderer"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="9" r="6"/><line x1="13.5" y1="13.5" x2="18" y2="18"/><line x1="6.5" y1="9" x2="11.5" y2="9"/></svg>
        </button>
      </div>

      <div
        className="d-flex align-items-center justify-content-center"
        style={{ height: 320, perspective: 700 }}
      >
        <div
          style={{
            width: CUBE_SIZE,
            height: CUBE_SIZE,
            position: "relative",
            transformStyle: "preserve-3d",
            transform: `rotateX(${x}deg) rotateY(${y}deg)`,
          }}
        >
          {FACES.map((face) => (
            <div
              key={face.key}
              style={{
                position: "absolute",
                width: CUBE_SIZE,
                height: CUBE_SIZE,
                border: "1.5px solid rgba(255,255,255,0.35)",
                background: face.color,
                opacity: 0.75,
                transform: face.transform,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Canvas3D;
