import { footEase, sequencePoseAtBeat } from "../dance/fold.mts";
import { footprintsAtBeat } from "../dance/footprints.mts";
import {
  addPoints,
  headingToUnitVector,
  scalePoint,
} from "../dance/heading.mts";
import { footHeading } from "../dance/pose.mts";
import type { Pose } from "../dance/pose.mts";
import type { Partner } from "../dance/step.mts";
import { centerOfWeight, isStandingFoot } from "../dance/weight.mts";
import {
  BODY_FILL_OPACITY,
  COUNT_HALO_COLOR,
  FREE_FOOT_FILL_OPACITY,
  GAP_OPACITY,
  LANDING_FOOTPRINT_OPACITY,
  NEXT_FOOTPRINT_OPACITY,
  PARTNER_COLOR,
  STANDING_FOOT_FILL_OPACITY,
  TRAIL_OPACITY,
  takenFootprintOpacity,
} from "./canvasStyle.mts";
import { BODY, FOOT_PATHS, placeAt } from "./figureShapes.mts";
import {
  FEET,
  PARTNERS,
  countOpacity,
  layoutSequence,
  pathFrom,
  toScreen,
  withCounts,
} from "./layout2d.mts";
import type { Layout2D } from "./layout2d.mts";
import type { RenderScene, SceneRenderer } from "./renderer.mts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** How far towards the heel a footprint's count sits, in metres. */
const COUNT_HEEL_OFFSET = 0.06;

type Attributes = Record<string, string | number | undefined>;

/** Creates an SVG element with the given attributes. Undefined values
 *  are left out, so an optional attribute can be written inline. */
function svg(
  tag: string,
  attributes: Attributes = {},
  children: Element[] = [],
): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, String(value));
  }
  element.append(...children);
  return element;
}

/**
 * The 2D floor plan: the couple seen from above, with each foot's path,
 * the footprints numbered with their counts, the feet now and the
 * dancers over their weight.
 *
 * It draws one <svg> into the element it is given, using DOM calls
 * rather than React. The drawing is in two parts:
 * - the background, which depends only on the scene: the scale bar and
 *   each foot's dotted path, with dashed jumps where figures don't join.
 *   Rebuilt when the scene changes;
 * - the foreground, which depends on the beat as well: the footprints
 *   (taken, landing, next), the feet now, the dancers and the counts.
 *   Rebuilt whenever the beat or the scene has changed since the last
 *   frame; a paused view costs nothing per frame.
 *
 * The picture is the same as when Canvas2D drew it with React: same
 * layers in the same order, same shapes, colours and sizes. Moving feet
 * are eased (footEase in fold.mts), as in the 3D view, so the two views
 * agree at every instant.
 */
export class Renderer2D implements SceneRenderer {
  private readonly root: SVGElement;
  private readonly background: SVGElement;
  private readonly foreground: SVGElement;

  private scene: RenderScene | null = null;
  private layout: Layout2D | null = null;
  /** The beat last drawn, or null when the foreground needs redrawing
   *  whatever the beat is (a new scene). */
  private drawnBeat: number | null = null;

  constructor(private readonly host: HTMLElement) {
    this.background = svg("g");
    this.foreground = svg("g");
    this.root = svg("svg", { width: "100%", height: "100%" }, [
      this.background,
      this.foreground,
    ]);
    host.append(this.root);
  }

  setScene(scene: RenderScene): void {
    // The layout depends only on the entries, so it is kept when only
    // the shown dancers change.
    if (this.scene === null || this.scene.entries !== scene.entries) {
      this.layout = layoutSequence(
        scene.entries.map(({ figure, transform }) => ({ figure, transform })),
      );
    }
    this.scene = scene;
    this.drawBackground();
    this.drawnBeat = null;
  }

  render(beat: number): void {
    if (beat === this.drawnBeat) return;
    this.drawnBeat = beat;
    this.drawForeground(beat);
  }

  dispose(): void {
    this.root.remove();
  }

  private visiblePartners(): Partner[] {
    const shown = this.scene?.shown;
    return PARTNERS.filter((partner) => shown?.[partner] ?? false);
  }

  private drawBackground(): void {
    const layout = this.layout;
    if (layout === null) {
      this.root.removeAttribute("viewBox");
      this.background.replaceChildren();
      return;
    }
    this.root.setAttribute("viewBox", layout.viewBox);

    const { scaleBar, strokeWidth } = layout;
    const scale = svg(
      "g",
      {
        "aria-label": `Scale: ${scaleBar.label}`,
        stroke: "var(--bs-secondary-color, #999)",
        "stroke-width": scaleBar.strokeWidth,
        "stroke-linecap": "round",
      },
      [
        svg("line", {
          x1: scaleBar.x,
          y1: scaleBar.y,
          x2: scaleBar.x + scaleBar.length,
          y2: scaleBar.y,
        }),
        ...[0, scaleBar.length].map((offset) =>
          svg("line", {
            x1: scaleBar.x + offset,
            y1: scaleBar.y - scaleBar.tick,
            x2: scaleBar.x + offset,
            y2: scaleBar.y + scaleBar.tick,
          }),
        ),
      ],
    );
    const label = svg("text", {
      x: scaleBar.x + scaleBar.length / 2,
      y: scaleBar.y - scaleBar.tick * 1.6,
      "text-anchor": "middle",
      "font-size": scaleBar.fontSize,
      stroke: "none",
      fill: "var(--bs-secondary-color, #999)",
    });
    label.textContent = scaleBar.label;
    scale.append(label);

    // Layer 1: each foot's path, dotted and faint, and dashed jumps
    // where a figure doesn't join.
    const trails = this.visiblePartners().map((partner) =>
      svg("g", { stroke: PARTNER_COLOR[partner] }, [
        ...layout.segments.flatMap((segment) =>
          FEET.map((foot) =>
            svg("path", {
              d: pathFrom(segment[partner][foot]),
              fill: "none",
              "stroke-width": strokeWidth * 1.4,
              "stroke-opacity": TRAIL_OPACITY,
              "stroke-dasharray": `0 ${strokeWidth * 4}`,
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
            }),
          ),
        ),
        ...layout.gaps
          .filter((gap) => gap.partner === partner)
          .map((gap) => {
            const from = toScreen(gap.from);
            const to = toScreen(gap.to);
            return svg("line", {
              x1: from.x,
              y1: from.y,
              x2: to.x,
              y2: to.y,
              "stroke-width": strokeWidth,
              "stroke-opacity": GAP_OPACITY,
              "stroke-dasharray": `${strokeWidth * 3} ${strokeWidth * 3}`,
              "stroke-linecap": "round",
            });
          }),
      ]),
    );

    this.background.replaceChildren(scale, ...trails);
  }

  private drawForeground(beat: number): void {
    const layout = this.layout;
    const scene = this.scene;
    const pose =
      scene === null
        ? null
        : sequencePoseAtBeat(scene.entries, beat, { footEasing: footEase });
    if (layout === null || scene === null || pose === null) {
      this.foreground.replaceChildren();
      return;
    }
    const { footprints, counts } = withCounts(
      footprintsAtBeat(layout.footprints, beat).filter(
        (state) => scene.shown[state.footprint.partner],
      ),
    );
    const { strokeWidth, countFontSize } = layout;
    const partners = this.visiblePartners();

    // Layer 2: footprints. Taken ones are filled and fade with age; the
    // one the foot is landing on and the next one are dashed outlines.
    // Oldest drawn first, so newer prints sit on top where they overlap.
    // Their counts are drawn last (layer 5) so feet and bodies don't
    // hide them.
    const prints = footprints.flatMap(({ footprint, phase, age }) => {
      if (phase === "later") return [];
      const color = PARTNER_COLOR[footprint.partner];
      const taken = phase === "taken";
      const opacity = taken
        ? takenFootprintOpacity(age)
        : phase === "landing"
          ? LANDING_FOOTPRINT_OPACITY
          : NEXT_FOOTPRINT_OPACITY;
      return [
        svg("g", {}, [
          svg("path", {
            d: FOOT_PATHS[footprint.foot],
            transform: placeAt(
              toScreen(footprint.position),
              footprint.orientation,
            ),
            fill: taken ? color : "none",
            "fill-opacity": taken ? opacity : undefined,
            stroke: taken ? "none" : color,
            "stroke-opacity": taken ? undefined : opacity,
            "stroke-width": strokeWidth,
            "stroke-dasharray": taken
              ? undefined
              : `${strokeWidth * 2.5} ${strokeWidth * 1.5}`,
          }),
        ]),
      ];
    });

    // Layer 3: where each foot is now. Solid outline; the standing foot
    // filled, the free foot almost empty.
    const feet = partners.flatMap((partner) =>
      FEET.map((foot) => {
        const partnerPose = pose[partner];
        return svg("path", {
          d: FOOT_PATHS[foot],
          transform: placeAt(
            toScreen(partnerPose[foot].position),
            footHeading(partnerPose, foot),
          ),
          fill: PARTNER_COLOR[partner],
          "fill-opacity": isStandingFoot(partnerPose, foot)
            ? STANDING_FOOT_FILL_OPACITY
            : FREE_FOOT_FILL_OPACITY,
          stroke: PARTNER_COLOR[partner],
          "stroke-width": strokeWidth,
        });
      }),
    );

    // Layer 4: the dancers, seen from above, over their weight
    // (centerOfWeight), so a weight change shows as the body moving from
    // one foot to the other. Lightly filled so the feet underneath show
    // through.
    const bodies = partners.map((partner) =>
      dancer(pose, partner, strokeWidth),
    );

    // Layer 5: the counts on the footprints, on top of everything with a
    // dark outline so they read over feet and bodies.
    const labels = counts.map(({ footprint, phase, age }) => {
      // Towards the heel of the print, not its middle: in closed hold
      // the lead often steps where the follow has just been, and since
      // they face opposite ways, putting each count at its own heel
      // keeps the two apart.
      const at = toScreen(
        addPoints(
          footprint.position,
          scalePoint(
            headingToUnitVector(footprint.orientation),
            -COUNT_HEEL_OFFSET,
          ),
        ),
      );
      const opacity = countOpacity(phase, age);
      const text = svg("text", {
        x: at.x,
        y: at.y,
        dy: countFontSize * 0.35,
        "text-anchor": "middle",
        "font-size": countFontSize,
        "font-weight": "700",
        fill: PARTNER_COLOR[footprint.partner],
        "fill-opacity": opacity,
        stroke: COUNT_HALO_COLOR,
        "stroke-width": countFontSize * 0.22,
        "stroke-opacity": opacity,
        "stroke-linejoin": "round",
        "paint-order": "stroke",
      });
      text.textContent = footprint.count;
      return text;
    });

    this.foreground.replaceChildren(...prints, ...feet, ...bodies, ...labels);
  }
}

/** One dancer's pictograph (figureShapes.mts BODY) over their weight,
 *  turned to their facing. */
function dancer(pose: Pose, partner: Partner, strokeWidth: number) {
  const partnerPose = pose[partner];
  const color = PARTNER_COLOR[partner];
  return svg(
    "g",
    {
      transform: placeAt(
        toScreen(centerOfWeight(partnerPose)),
        partnerPose.orientation,
      ),
      stroke: color,
      "stroke-width": strokeWidth,
    },
    [
      svg("ellipse", {
        ...BODY.shoulders,
        fill: color,
        "fill-opacity": BODY_FILL_OPACITY,
      }),
      svg("circle", {
        ...BODY.head,
        fill: color,
        "fill-opacity": BODY_FILL_OPACITY,
      }),
      svg("path", { d: BODY.nose, fill: color }),
    ],
  );
}
