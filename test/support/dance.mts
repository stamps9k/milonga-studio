import type { Dance } from "../../src/libs/dance/dance.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import { placeEntry } from "../../src/libs/dance/chain.mts";

export function sampleDance(): Dance {
  const pose: Pose = {
    lead: {
      left: { position: { x: -0.1, y: 0 }, weight: 0 },
      right: { position: { x: 0.1, y: 0 }, weight: 1 },
      orientation: 0,
      rise: 0,
    },
    follow: {
      left: { position: { x: 0.2, y: 0.4 }, weight: 1 },
      right: { position: { x: 0, y: 0.4 }, weight: 0 },
      orientation: 180,
      rise: 0,
    },
  };
  const figure: Figure = {
    id: "walk",
    name: "Walk",
    style: "tango",
    timeSignature: { beatsPerMeasure: 2, beatUnit: 4 },
    startPose: pose,
    endPose: pose,
    steps: [
      {
        id: "step",
        partner: "lead",
        foot: "left",
        contact: "floor",
        movement: { type: "straight", direction: 0, distance: 0.4 },
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
        footDirection: 5,
        swivel: "ball",
        footwork: "HT",
        riseTiming: "late",
        weightTiming: "late",
      },
    ],
  };
  const entry = structuredClone(placeEntry(figure, undefined));
  return {
    id: "test-dance",
    name: "Practice 日本語 💃",
    tempo: 72,
    notes: "A practice dance",
    music: "Track name",
    schemaVersion: 1,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    sequence: {
      id: "test-sequence",
      name: "Walk sequence",
      startTransform: entry.transform,
      entries: [entry],
    },
  };
}
