import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFigures } from "../../db/figures/index.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";
import { assessJoin } from "../../src/libs/dance/join.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import {
  poseAtBeat,
  footEase,
  footprintGap,
  figureDurationBeats,
  sequenceDurationBeats,
  sequencePoseAtBeat,
} from "../../src/libs/dance/fold.mts";
import { footHeading } from "../../src/libs/dance/pose.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { SequenceEntry } from "../../src/libs/dance/sequence.mts";
import { bodyPosition } from "../../src/libs/dance/weight.mts";
import { solveSkeleton } from "../../src/libs/body/skeleton.mts";
import { assessLateralBalance } from "../../src/libs/body/balance.mts";
import { segmentDistance } from "../support/legClearance.mts";

const figures = new Map(
  loadFigures().map((a) => [
    a.name,
    {
      ...a,
      id: a.name,
      steps: a.steps.map((s, i) => ({ ...s, id: String(i) })),
    },
  ]),
);
function figure(name: string) {
  const f = figures.get(name);
  assert.ok(f, name);
  return f;
}
function close(a: number, b: number) {
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
}
function chain(names: string[]) {
  const entries: SequenceEntry[] = [];
  for (const name of names)
    entries.push(placeEntry(figure(name), entries.at(-1)));
  return entries;
}
const basic = chain([
  "Walking Step and Collect",
  "Side Step and Collect",
  "Cruzada",
]);
const ocho = chain(["Walking Step and Collect", "Weight Change", "Ocho"]);

function samePose(a: Pose, b: Pose) {
  for (const partner of ["lead", "follow"] as const) {
    close(a[partner].orientation, b[partner].orientation);
    close(a[partner].rise, b[partner].rise);
    const x = bodyPosition(a[partner]),
      y = bodyPosition(b[partner]);
    close(x.x, y.x);
    close(x.y, y.y);
    for (const foot of ["left", "right"] as const) {
      close(a[partner][foot].position.x, b[partner][foot].position.x);
      close(a[partner][foot].position.y, b[partner][foot].position.y);
      close(a[partner][foot].weight, b[partner][foot].weight);
      close(footHeading(a[partner], foot), footHeading(b[partner], foot));
    }
  }
}

test("Argentine practice: every rendered boundary agrees in feet, support, heading and body position", () => {
  close(sequenceDurationBeats(basic), 6);
  close(sequenceDurationBeats(ocho), 7);
  for (const entries of [basic, ocho]) {
    let boundary = 0;
    for (let i = 1; i < entries.length; i++) {
      const previous = entries[i - 1],
        next = entries[i];
      const duration = figureDurationBeats(previous.figure);
      boundary += duration;
      const join = assessJoin(previous.resolvedEndPose, next.figure);
      assert.deepEqual(join.issues, []);
      assert.ok(join.maxFootGap < 1e-8);
      for (const options of [{}, { footEasing: footEase }]) {
        const end = applyTransform(
          previous.transform,
          poseAtBeat(previous.figure, duration, options),
        );
        const start = applyTransform(
          next.transform,
          poseAtBeat(next.figure, 0, options),
        );
        samePose(end, start);
        samePose(sequencePoseAtBeat(entries, boundary, options)!, start);
        // Check playback immediately on either side too: cached join poses
        // alone would miss a folded endpoint or interpolation discontinuity.
        const before = sequencePoseAtBeat(entries, boundary - 1e-7, options)!;
        const after = sequencePoseAtBeat(entries, boundary + 1e-7, options)!;
        for (const partner of ["lead", "follow"] as const)
          for (const foot of ["left", "right"] as const) {
            assert.ok(
              Math.hypot(
                before[partner][foot].position.x -
                  after[partner][foot].position.x,
                before[partner][foot].position.y -
                  after[partner][foot].position.y,
              ) < 1e-5,
            );
            assert.ok(
              Math.abs(
                before[partner][foot].weight - after[partner][foot].weight,
              ) < 1e-5,
            );
          }
      }
    }
  }
});

test("Argentine collections take an explicit count without transferring support", () => {
  for (const name of ["Walking Step and Collect", "Side Step and Collect"]) {
    const f = figure(name),
      start = poseAtBeat(f, 1),
      end = poseAtBeat(f, 2);
    close(figureDurationBeats(f), 2);
    for (const options of [{}, { footEasing: footEase }])
      for (let beat = 1; beat <= 2; beat += 1 / 128) {
        const p = poseAtBeat(f, beat, options);
        for (const partner of ["lead", "follow"] as const)
          for (const foot of ["left", "right"] as const) {
            close(p[partner][foot].weight, start[partner][foot].weight);
            if (start[partner][foot].weight === 1)
              assert.deepEqual(
                p[partner][foot].position,
                start[partner][foot].position,
              );
          }
      }
    for (const partner of ["lead", "follow"] as const)
      close(
        Math.hypot(
          end[partner].left.position.x - end[partner].right.position.x,
          end[partner].left.position.y - end[partner].right.position.y,
        ),
        0.2,
      );
  }
  // The accepted open figures remain available with their original timing.
  close(figureDurationBeats(figure("Walking Step")), 1);
  close(figureDurationBeats(figure("Side Step")), 1);
});

test("Argentine ocho preparation transfers weight over one Q without moving any foot", () => {
  const f = figure("Weight Change"),
    start = f.startPose,
    end = poseAtBeat(f, 1);
  close(figureDurationBeats(f), 1);
  for (let beat = 0; beat <= 1; beat += 1 / 128) {
    const p = poseAtBeat(f, beat);
    for (const partner of ["lead", "follow"] as const)
      for (const foot of ["left", "right"] as const)
        assert.deepEqual(
          p[partner][foot].position,
          start[partner][foot].position,
        );
  }
  close(start.lead.left.weight, 1);
  close(start.follow.right.weight, 1);
  close(end.lead.right.weight, 1);
  close(end.follow.left.weight, 1);
  close(poseAtBeat(f, 0.5).lead.right.weight, 0.5);
  close(poseAtBeat(f, 0.5).follow.left.weight, 0.5);
});

test("Argentine practice: both complete chains retain full footprint/leg clearance, hold and body limits", () => {
  for (const entries of [basic, ocho])
    for (const options of [{}, { footEasing: footEase }])
      for (
        let beat = 0;
        beat <= sequenceDurationBeats(entries);
        beat += 1 / 256
      ) {
        const p = sequencePoseAtBeat(entries, beat, options)!,
          skeleton = solveSkeleton(p),
          feet = [],
          bones = [];
        const l = bodyPosition(p.lead),
          f = bodyPosition(p.follow);
        assert.ok(Math.hypot(f.x - l.x - 0.1, f.y - l.y - 0.4) <= 0.2);
        for (const partner of ["lead", "follow"] as const) {
          const s = skeleton[partner];
          assert.deepEqual(s.legShortfall, { left: 0, right: 0 });
          assert.ok(s.hipDrop <= 0.16, `Hip lowering at ${beat}`);
          assert.equal(
            assessLateralBalance(p[partner], s).plausible,
            true,
            `Balance at ${beat}`,
          );
          for (const side of ["left", "right"] as const) {
            feet.push({
              p: p[partner][side].position,
              heading: footHeading(p[partner], side),
            });
            const j = s.joints;
            bones.push(
              {
                partner,
                side,
                a: j[`${side}UpperLeg`],
                b: j[`${side}LowerLeg`],
                r: 0.06,
              },
              {
                partner,
                side,
                a: j[`${side}LowerLeg`],
                b: j[`${side}Foot`],
                r: 0.045,
              },
            );
          }
        }
        for (let i = 0; i < feet.length; i++)
          for (let k = i + 1; k < feet.length; k++) {
            const a = feet[i],
              b = feet[k];
            assert.ok(
              footprintGap(a.p, a.heading, b.p, b.heading) >= 0.005,
              `Footprints ${i}/${k} at ${beat}`,
            );
          }
        for (let i = 0; i < bones.length; i++)
          for (let k = i + 1; k < bones.length; k++) {
            const a = bones[i],
              b = bones[k];
            if (a.partner === b.partner && a.side === b.side) continue;
            assert.ok(
              segmentDistance(a.a, a.b, b.a, b.b) - a.r - b.r >= 0.005,
              `Legs ${a.partner} ${a.side}/${b.partner} ${b.side} at ${beat}`,
            );
          }
      }
});
