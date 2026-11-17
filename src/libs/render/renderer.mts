import type { Partner } from "../dance/step.mts";
import type { SequenceEntry } from "../dance/sequence.mts";

/**
 * The contract between the app and a view renderer (the 2D floor plan
 * now, the 3D view later).
 *
 * A renderer is a plain object that owns a piece of the page (an <svg>,
 * later a WebGL canvas) and draws into it directly. React creates it
 * once, hands it the scene whenever the scene changes, and otherwise
 * leaves it alone: React never re-renders the drawing itself. That
 * split is the one planned from the start for the 3D view, which has to
 * redraw every frame (the camera moves even when the dancers don't) and
 * can't be driven through React's render cycle.
 *
 * Renderers only read data produced by the dance model
 * (src/libs/dance/), so the 2D and 3D views always agree.
 */

/** What to draw: the placed sequence, and which dancers are shown. */
export interface RenderScene {
  entries: SequenceEntry[];
  /** A hidden dancer is left out entirely; the framing stays the same,
   *  so the view doesn't jump when a dancer is shown or hidden. */
  shown: Record<Partner, boolean>;
}

/** Where playback is, in beats along the whole sequence. A function
 *  rather than a value, so the render loop reads the latest position on
 *  every frame without the caller having to push it in. */
export type BeatSource = () => number;

export interface SceneRenderer {
  /** Replaces what is drawn. Cheap to call: the renderer redraws on its
   *  next frame. */
  setScene(scene: RenderScene): void;
  /** Draws the scene at `beat`. Called by RenderLoop on every animation
   *  frame, so a renderer should skip the work when nothing it depends
   *  on has changed since the last call. */
  render(beat: number): void;
  /** Removes everything the renderer added to the page. */
  dispose(): void;
}

/**
 * Calls a renderer once per animation frame with the current beat. Each
 * view runs its own loop, independent of playback (usePlayback has its
 * own clock) and of React, so a view can keep drawing while playback is
 * paused -- the 3D view's camera will need that.
 */
export class RenderLoop {
  private frame: number | null = null;

  constructor(
    private readonly renderer: SceneRenderer,
    private readonly beatSource: BeatSource,
  ) {}

  start(): void {
    if (this.frame !== null) return;
    const tick = () => {
      this.renderer.render(this.beatSource());
      this.frame = window.requestAnimationFrame(tick);
    };
    this.frame = window.requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.frame === null) return;
    window.cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
