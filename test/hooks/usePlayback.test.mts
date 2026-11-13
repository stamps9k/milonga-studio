import { test } from "node:test";
import assert from "node:assert/strict";

import { playbackStartBeat } from "../../src/hooks/usePlayback.mts";

// The decision of where pressing play starts from. The hook itself needs
// a React renderer to test; this pure part covers the behaviour that
// changed: pressing play at the end restarts from the beginning.

test("playbackStartBeat: at the end of the sequence, play starts again from the beginning", () => {
  assert.equal(playbackStartBeat(7, 7), 0);
});

test("playbackStartBeat: past the end (the sequence got shorter), play starts from the beginning", () => {
  assert.equal(playbackStartBeat(9, 7), 0);
});

test("playbackStartBeat: anywhere before the end, play resumes from where it is", () => {
  assert.equal(playbackStartBeat(0, 7), 0);
  assert.equal(playbackStartBeat(3.25, 7), 3.25);
  assert.equal(playbackStartBeat(6.999, 7), 6.999);
});

test("playbackStartBeat: an empty sequence leaves the position alone", () => {
  assert.equal(playbackStartBeat(0, 0), 0);
});
