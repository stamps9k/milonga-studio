import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { solveSkeleton } from "../body/skeleton.mts";
import type { PartnerSkeleton } from "../body/skeleton.mts";
import type { Point3D } from "../body/vector3.mts";
import { sequencePoseAtBeat, sequenceTrailSegments } from "../dance/fold.mts";
import { footprintsAtBeat, sequenceFootprints } from "../dance/footprints.mts";
import type { Footprint } from "../dance/footprints.mts";
import { headingToUnitVector } from "../dance/heading.mts";
import { JOIN_FOOT_GAP_TOLERANCE } from "../dance/join.mts";
import type { Partner } from "../dance/step.mts";
import {
  LANDING_FOOTPRINT_OPACITY,
  NEXT_FOOTPRINT_OPACITY,
  PARTNER_COLOR,
  TRAIL_OPACITY,
  takenFootprintOpacity,
} from "./canvasStyle.mts";
import { FEET, PARTNERS } from "./layout2d.mts";
import type { RenderScene, SceneRenderer } from "./renderer.mts";
import {
  MANNEQUIN_BONES,
  VISIBLE_JOINTS,
  footprintOutline,
  frameSequence,
  toThree,
} from "./scene3d.mts";

/** Colours the CSS variables in PARTNER_COLOR resolve to when the page
 *  doesn't define them (WebGL can't read CSS variables itself). */
const FALLBACK_COLOR: Record<Partner, string> = {
  lead: "#f5a524",
  follow: "#2dd4bf",
};

/** How much darker each dancer's left side is than their right, so the
 *  two sides tell apart at a glance (the 2D view uses the foot shapes). */
const LEFT_SIDE_SHADE = 0.55;

const FLOOR_COLOR = 0x1b1e26;
const JOINT_COLOR = 0xe8e8e8;
const UP = new THREE.Vector3(0, 1, 0);

function vector(point: Point3D): THREE.Vector3 {
  return new THREE.Vector3(...toThree(point));
}

/** A floor point a millimetre or two above the floor, so marks on the
 *  floor don't flicker against it. */
function onFloor(x: number, y: number, lift: number): THREE.Vector3 {
  return vector({ x, y, z: lift });
}

/** Places a unit-height, Y-aligned mesh (a cylinder or box) so it runs
 *  from `from` to `to`. */
function stretchBetween(
  mesh: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
) {
  const along = new THREE.Vector3().subVectors(to, from);
  const length = along.length();
  mesh.position.copy(from).addScaledVector(along, 0.5);
  if (length > 1e-9) {
    mesh.quaternion.setFromUnitVectors(UP, along.divideScalar(length));
  }
  mesh.scale.y = Math.max(length, 1e-6);
}

/** One dancer's mannequin: rods for bones, balls for joints, a head with
 *  a nose for the facing, and flat blocks for the feet. */
class Mannequin {
  readonly group = new THREE.Group();
  private readonly bones: THREE.Mesh[] = [];
  private readonly joints: THREE.Mesh[] = [];
  private readonly head: THREE.Mesh;
  private readonly nose: THREE.Mesh;
  private readonly feet: Record<"left" | "right", THREE.Mesh>;

  constructor(color: THREE.Color, resources: THREE.BufferGeometry[]) {
    const right = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const left = new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(LEFT_SIDE_SHADE),
      roughness: 0.55,
    });
    const jointMaterial = new THREE.MeshStandardMaterial({
      color: JOINT_COLOR,
      roughness: 0.4,
    });
    const rod = new THREE.CylinderGeometry(1, 1, 1, 16);
    const ball = new THREE.SphereGeometry(1, 16, 12);
    const block = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(1, 1, 12);
    resources.push(rod, ball, block, cone);

    for (const bone of MANNEQUIN_BONES) {
      const mesh = new THREE.Mesh(rod, bone.side === "left" ? left : right);
      mesh.scale.set(bone.radius, 1, bone.radius);
      this.bones.push(mesh);
      this.group.add(mesh);
    }
    for (const name of VISIBLE_JOINTS) {
      const mesh = new THREE.Mesh(ball, jointMaterial);
      mesh.scale.setScalar(name.endsWith("Hand") ? 0.04 : 0.045);
      this.joints.push(mesh);
      this.group.add(mesh);
    }
    this.head = new THREE.Mesh(ball, right);
    this.head.scale.set(0.09, 0.11, 0.09);
    this.nose = new THREE.Mesh(cone, right);
    this.nose.scale.set(0.025, 0.06, 0.025);
    this.feet = {
      left: new THREE.Mesh(block, left),
      right: new THREE.Mesh(block, right),
    };
    this.group.add(this.head, this.nose, this.feet.left, this.feet.right);
    this.group.traverse((object) => {
      object.castShadow = true;
    });
  }

  update(skeleton: PartnerSkeleton) {
    const { joints } = skeleton;
    MANNEQUIN_BONES.forEach((bone, index) => {
      const mesh = this.bones[index];
      const radius = mesh.scale.x;
      stretchBetween(mesh, vector(joints[bone.from]), vector(joints[bone.to]));
      mesh.scale.x = radius;
      mesh.scale.z = radius;
    });
    VISIBLE_JOINTS.forEach((name, index) => {
      this.joints[index].position.copy(vector(joints[name]));
    });

    // The head sits on top of the neck rod (whose end is the base of the
    // skull), its centre 10 cm up. The nose points the way the body
    // faces, as in the 2D view.
    const headCentre = vector({ ...joints.head, z: joints.head.z + 0.1 });
    this.head.position.copy(headCentre);
    const facing = headingToUnitVector(skeleton.facing);
    const forward = vector({ x: facing.x, y: facing.y, z: 0 });
    this.nose.position.copy(headCentre).addScaledVector(forward, 0.1);
    this.nose.quaternion.setFromUnitVectors(UP, forward);

    // Feet: a 9 cm wide, 5 cm tall block from heel to toe tip, resting on
    // the floor (or tilted, when the heel is up).
    for (const side of FEET) {
      const mesh = this.feet[side];
      const { heel, toeTip } = skeleton.feet[side];
      const lift = (point: Point3D) => vector({ ...point, z: point.z + 0.025 });
      stretchBetween(mesh, lift(heel), lift(toeTip));
      // stretchBetween turned the block's Y axis along the foot; its
      // width (X) must lie across the foot, level with the floor.
      const along = new THREE.Vector3()
        .subVectors(lift(toeTip), lift(heel))
        .normalize();
      const across = new THREE.Vector3().crossVectors(along, UP).normalize();
      const up = new THREE.Vector3().crossVectors(across, along);
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(across, along, up),
      );
      mesh.scale.set(0.09, mesh.scale.y, 0.05);
    }
  }
}

/** A footprint on the floor: a filled silhouette (taken prints) and a
 *  dashed outline (landing and next), as in the 2D view. */
interface FootprintMark {
  footprint: Footprint;
  fill: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  outline: THREE.LineLoop<THREE.BufferGeometry, THREE.LineDashedMaterial>;
}

/**
 * The 3D view: the couple as two jointed mannequins on a floor, with the
 * footprints and foot paths of the 2D view drawn on the floor under
 * them. The camera orbits the sequence: drag to turn round it, scroll to
 * zoom, right-drag to pan.
 *
 * Like Renderer2D it draws outside React, into a <canvas> it adds to the
 * element it is given. It reads only the dance model (sequencePoseAtBeat,
 * footprints) and the body solver (solveSkeleton), never React state.
 * Floor space is mapped onto Three.js's y-up axes by toThree
 * (scene3d.mts).
 *
 * It redraws a frame only when something has changed: the beat, the
 * scene, the camera (OrbitControls, which keeps moving briefly after a
 * drag), or the size of the view. A paused, untouched view costs nothing.
 */
export class Renderer3D implements SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly mannequins: Record<Partner, Mannequin>;
  /** Geometries and materials to free on dispose. */
  private readonly resources: THREE.BufferGeometry[] = [];
  /** Everything that depends on the sequence: footprints and trails. */
  private readonly floorMarks = new THREE.Group();
  private readonly grid = new THREE.GridHelper(20, 40, 0x596070, 0x383d49);
  private marks: FootprintMark[] = [];

  private sceneData: RenderScene | null = null;
  private drawnBeat: number | null = null;
  private needsFrame = true;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.style.display = "block";
    host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(FLOOR_COLOR).multiplyScalar(0.8);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Keep the camera above the floor.
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 40;
    this.controls.addEventListener("change", () => {
      this.needsFrame = true;
    });

    this.addFloorAndLights();
    this.scene.add(this.floorMarks);
    this.mannequins = {
      lead: new Mannequin(this.partnerColor("lead"), this.resources),
      follow: new Mannequin(this.partnerColor("follow"), this.resources),
    };
    this.scene.add(this.mannequins.lead.group, this.mannequins.follow.group);

    this.resizeObserver = new window.ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  setScene(scene: RenderScene): void {
    const entriesChanged =
      this.sceneData === null || this.sceneData.entries !== scene.entries;
    this.sceneData = scene;
    if (entriesChanged) {
      this.buildFloorMarks();
      this.resetView();
    }
    for (const partner of PARTNERS) {
      this.mannequins[partner].group.visible = scene.shown[partner];
    }
    this.drawnBeat = null;
    this.needsFrame = true;
  }

  /** Puts the camera back where it started for this sequence: behind the
   *  start of the line of dance, a little to the right and above. */
  resetView(): void {
    const framing = frameSequence(this.sceneData?.entries ?? []);
    const target = framing?.target ?? { x: 0, y: 0, z: 0.9 };
    const distance = framing?.distance ?? 5;
    this.controls.target.copy(vector(target));
    // Grid lines on whole half metres from the floor's origin.
    this.grid.position.x = Math.round(target.x * 2) / 2;
    this.grid.position.z = Math.round(-target.y * 2) / 2;
    // From the south-east of the target (floor -y is behind the line of
    // dance), looking down at about 30°.
    const offset = vector({ x: 0.45, y: -0.8, z: 0.53 })
      .normalize()
      .multiplyScalar(distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.needsFrame = true;
  }

  render(beat: number): void {
    const scene = this.sceneData;
    if (scene !== null && beat !== this.drawnBeat) {
      this.drawnBeat = beat;
      this.updateDancers(scene, beat);
      this.needsFrame = true;
    }
    // Damping keeps the camera moving for a moment after a drag.
    if (this.controls.update()) this.needsFrame = true;
    if (!this.needsFrame) return;
    this.needsFrame = false;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearFloorMarks();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.resources.forEach((geometry) => geometry.dispose());
    this.grid.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private partnerColor(partner: Partner): THREE.Color {
    // PARTNER_COLOR holds CSS such as "var(--amber)"; resolve it against
    // the page so the 3D view uses the same colours as the 2D one.
    const name = /var\((--[^),]+)/.exec(PARTNER_COLOR[partner])?.[1];
    const value = name
      ? window.getComputedStyle(this.host).getPropertyValue(name).trim()
      : "";
    const color = new THREE.Color(FALLBACK_COLOR[partner]);
    if (value) {
      try {
        color.setStyle(value);
      } catch {
        // Keep the fallback.
      }
    }
    return color;
  }

  private addFloorAndLights() {
    const floorGeometry = new THREE.PlaneGeometry(60, 60);
    this.resources.push(floorGeometry);
    const floor = new THREE.Mesh(
      floorGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x14161c,
        roughness: 1,
        // Pushed back in the depth buffer so the grid and the footprints,
        // millimetres above it, always draw on top.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Half-metre grid, to judge step sizes by, moved under each new
    // sequence (resetView). 20 m across: some renderers drop grid lines
    // that run far behind the camera, so it is kept to the dancing area
    // rather than spread over the whole floor.
    this.grid.position.y = 0.001;
    this.scene.add(this.grid);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x303540, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 8, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  private resize() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.needsFrame = true;
  }

  private clearFloorMarks() {
    for (const child of [...this.floorMarks.children]) {
      this.floorMarks.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.marks = [];
  }

  /** The foot paths and footprints, which depend only on the entries. */
  private buildFloorMarks() {
    this.clearFloorMarks();
    const entries = this.sceneData?.entries ?? [];
    if (entries.length === 0) return;

    // Each foot's path: faint dotted lines, as in the 2D view.
    const { segments } = sequenceTrailSegments(
      entries,
      JOIN_FOOT_GAP_TOLERANCE,
    );
    for (const partner of PARTNERS) {
      for (const trails of segments) {
        for (const foot of FEET) {
          const points = trails[partner][foot].map((p) =>
            onFloor(p.x, p.y, 0.002),
          );
          if (points.length < 2) continue;
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineDashedMaterial({
              color: this.partnerColor(partner),
              transparent: true,
              opacity: TRAIL_OPACITY * 1.5,
              dashSize: 0.02,
              gapSize: 0.04,
            }),
          );
          line.computeLineDistances();
          line.userData.partner = partner;
          this.floorMarks.add(line);
        }
      }
    }

    // Footprints: a filled silhouette and a dashed outline each; which
    // one shows, and how strongly, depends on the beat (updateDancers).
    for (const footprint of sequenceFootprints(entries)) {
      const outline = footprintOutline(footprint);
      const color = this.partnerColor(footprint.partner);
      const shape = new THREE.Shape(
        outline.map((p) => new THREE.Vector2(p.x, p.y)),
      );
      const fill = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          depthWrite: false,
        }),
      );
      // The shape is drawn in the floor's (x, y); laying it flat maps
      // (x, y, 0) to (x, 0, -y), which is toThree's mapping.
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.003;
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          outline.map((p) => onFloor(p.x, p.y, 0.004)),
        ),
        new THREE.LineDashedMaterial({
          color,
          transparent: true,
          dashSize: 0.025,
          gapSize: 0.015,
        }),
      );
      line.computeLineDistances();
      this.floorMarks.add(fill, line);
      this.marks.push({ footprint, fill, outline: line });
    }
  }

  private updateDancers(scene: RenderScene, beat: number) {
    const pose = sequencePoseAtBeat(scene.entries, beat);
    if (pose !== null) {
      const skeletons = solveSkeleton(pose);
      for (const partner of PARTNERS) {
        this.mannequins[partner].update(skeletons[partner]);
      }
    }

    for (const child of this.floorMarks.children) {
      const partner = child.userData.partner as Partner | undefined;
      if (partner) child.visible = scene.shown[partner];
    }
    const states = footprintsAtBeat(
      this.marks.map((mark) => mark.footprint),
      beat,
    );
    states.forEach(({ phase, age }, index) => {
      const { fill, outline, footprint } = this.marks[index];
      const shown = scene.shown[footprint.partner] && phase !== "later";
      fill.visible = shown && phase === "taken";
      outline.visible = shown && phase !== "taken";
      if (phase === "taken") fill.material.opacity = takenFootprintOpacity(age);
      outline.material.opacity =
        phase === "landing"
          ? LANDING_FOOTPRINT_OPACITY
          : NEXT_FOOTPRINT_OPACITY;
    });
  }
}
