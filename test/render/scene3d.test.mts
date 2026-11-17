import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFigures } from "../../db/figures/index.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import type { SequenceEntry } from "../../src/libs/dance/sequence.mts";
import { JOINT_NAMES } from "../../src/libs/body/skeleton.mts";
import {
  MANNEQUIN_BONES,
  VISIBLE_JOINTS,
  approach,
  footprintOutline,
  frameSequence,
  presetCamera,
  toThree,
} from "../../src/libs/render/scene3d.mts";

const figures = loadFigures();

function chain(names: string[]): SequenceEntry[] {
  const entries: SequenceEntry[] = [];
  for (const name of names) {
    const figure = figures.find((candidate) => candidate.name === name);
    assert.ok(figure, `no figure called ${name}`);
    const stored = {
      ...figure,
      id: name,
      steps: figure.steps.map((step, index) => ({ ...step, id: `${index}` })),
    };
    entries.push(placeEntry(stored, entries[entries.length - 1]));
  }
  return entries;
}

test("toThree: height becomes y, and the line of dance points into the screen (-z)", () => {
  assert.deepEqual(toThree({ x: 1, y: 2, z: 3 }), [1, 3, -2]);
  // Right-handed: floor east (x) cross line of dance (-z in Three.js)
  // gives up (y), as east cross north gives up on the floor.
  const east = [1, 0, 0];
  const north = toThree({ x: 0, y: 1, z: 0 });
  const cross = [
    east[1] * north[2] - east[2] * north[1],
    east[2] * north[0] - east[0] * north[2],
    east[0] * north[1] - east[1] * north[0],
  ];
  // (+ 0 turns -0 into 0, which deepEqual tells apart.)
  assert.deepEqual(
    cross.map((value) => value + 0),
    [0, 1, 0],
  );
});

test("the mannequin's bones and balls only use joints the body solver provides", () => {
  const known = new Set<string>(JOINT_NAMES);
  for (const bone of MANNEQUIN_BONES) {
    assert.ok(known.has(bone.from) && known.has(bone.to));
    assert.ok(bone.radius > 0 && bone.radius < 0.15);
  }
  for (const joint of VISIBLE_JOINTS) assert.ok(known.has(joint));
  // Each limb is shaded by its own side.
  for (const bone of MANNEQUIN_BONES) {
    if (bone.side === "middle") continue;
    assert.ok(bone.from.startsWith(bone.side) && bone.to.startsWith(bone.side));
  }
});

test("frameSequence: the camera orbits the middle of the sequence, far enough back to see it", () => {
  assert.equal(frameSequence([]), null);
  const entries = chain(["Whisk", "Promenade Chassé", "Open Natural Turn"]);
  const framing = frameSequence(entries);
  assert.ok(framing);
  // Every foot's start and end lies within the framed distance.
  for (const entry of entries) {
    for (const pose of [entry.resolvedStartPose, entry.resolvedEndPose]) {
      for (const partner of ["lead", "follow"] as const) {
        for (const foot of ["left", "right"] as const) {
          const { x, y } = pose[partner][foot].position;
          const away = Math.hypot(x - framing.target.x, y - framing.target.y);
          assert.ok(away < framing.distance / 2);
        }
      }
    }
  }
  assert.ok(framing.target.z > 0.5 && framing.target.z < 1.5);
  // A short sequence still gets the minimum distance.
  assert.equal(frameSequence(chain(["Whisk"]))?.distance, 3.4);
});

test("footprintOutline: the 2D foot silhouette at real size, turned to the footprint's heading", () => {
  // A right foot at (1, 2) facing east (90): its toe points +x.
  const outline = footprintOutline({
    foot: "right",
    position: { x: 1, y: 2 },
    orientation: 90,
  });
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  // About 27 cm long along the heading, about 9 cm wide across it.
  const length = Math.max(...xs) - Math.min(...xs);
  const width = Math.max(...ys) - Math.min(...ys);
  assert.ok(length > 0.25 && length < 0.3, `length ${length}`);
  assert.ok(width > 0.07 && width < 0.11, `width ${width}`);
  // The toe end is further east than the heel end is west of the
  // centre: the heel is at -0.125, the toe at +0.15 (figureShapes.mts).
  assert.ok(Math.max(...xs) - 1 > 1 - Math.min(...xs));
  // The big toe is on the inside: for a right foot facing east, that's
  // north (+y, the foot's left).
  const toe = outline.reduce((a, b) => (b.x > a.x ? b : a));
  assert.ok(toe.y > 2 - 0.01);
});

const subject = (x: number, y: number, facing: number) => ({
  hips: { x, y, z: 0.9 },
  facing,
});

test("presetCamera: each preset keeps the couple in front of the camera", () => {
  // Closed hold facing north: lead at (0, 0), follow 0.4 north of him.
  const lead = subject(0, 0, 0);
  const follow = subject(0, 0.4, 180);
  assert.equal(presetCamera("orbit", lead, follow), null);

  const above = presetCamera("above", lead, follow);
  assert.ok(above);
  // Straight above the middle of the couple, the line of dance up the
  // screen.
  assert.deepEqual([above.position.x, above.position.y], [0, 0.2]);
  assert.ok(above.position.z > 4);
  assert.deepEqual(above.up, { x: 0, y: 1, z: 0 });

  const side = presetCamera("side", lead, follow);
  assert.ok(side);
  // East of the couple, level with them.
  assert.ok(side.position.x > 3);
  assert.equal(side.position.y, 0.2);
  assert.ok(side.position.z > 1 && side.position.z < 2);

  // Behind the lead (south of him), looking past him at the follow.
  const leads = presetCamera("lead", lead, follow);
  assert.ok(leads);
  assert.ok(leads.position.y < -2);
  assert.ok(leads.target.y > 0.5);
  // Behind the follow (north of her), looking south.
  const follows = presetCamera("follow", lead, follow);
  assert.ok(follows);
  assert.ok(follows.position.y > 2);
  assert.ok(follows.target.y < 0);
});

test("presetCamera: the dancers' views turn with them", () => {
  // The lead facing east: the camera is west of him, over his right
  // shoulder (south), looking east.
  const view = presetCamera("lead", subject(1, 1, 90), subject(1.4, 1, 270));
  assert.ok(view);
  assert.ok(view.position.x < 1 - 2);
  assert.ok(view.position.y < 1);
  assert.ok(view.target.x > 1);
});

test("approach: covers half the way per half-life, whatever the frame rate", () => {
  assert.equal(approach(0, 0.35), 0);
  assert.ok(Math.abs(approach(0.35, 0.35) - 0.5) < 1e-12);
  // Two half frames cover the same as one whole frame.
  const half = approach(0.1, 0.35);
  const whole = approach(0.2, 0.35);
  assert.ok(Math.abs(1 - (1 - half) * (1 - half) - whole) < 1e-12);
});
