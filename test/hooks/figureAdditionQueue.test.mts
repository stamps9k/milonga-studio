import { test } from "node:test";
import assert from "node:assert/strict";

import { createFigureAdditionQueue } from "../../src/hooks/figureAdditionQueue.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import { sampleDance } from "../support/dance.mts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const requested: string[] = [];
  const appended: string[] = [];
  const loadingChanges: boolean[] = [];
  const errors: (string | null)[] = [];
  const requests = [deferred<Figure>(), deferred<Figure>(), deferred<Figure>()];
  const add = createFigureAdditionQueue({
    load: (id) => {
      const request = requests[requested.length];
      requested.push(id);
      return request.promise;
    },
    append: (figure) => appended.push(figure.id),
    setLoading: (value) => loadingChanges.push(value),
    setError: (value) => errors.push(value),
  });
  return { add, requested, appended, loadingChanges, errors, requests };
}

const figure = (id: string): Figure => ({
  ...sampleDance().sequence.entries[0].figure,
  id,
});

test("figure additions: rapid clicks append in order even when later results are ready first", async () => {
  const queue = fixture();
  const first = queue.add("first");
  const second = queue.add("second");
  const third = queue.add("third");
  assert.deepEqual(queue.loadingChanges, [true]);
  await Promise.resolve();
  assert.deepEqual(queue.requested, ["first"]);
  queue.requests[2].resolve(figure("third"));
  queue.requests[1].resolve(figure("second"));
  await Promise.resolve();
  assert.deepEqual(queue.appended, []);
  queue.requests[0].resolve(figure("first"));
  await Promise.all([first, second, third]);
  assert.deepEqual(queue.requested, ["first", "second", "third"]);
  assert.deepEqual(queue.appended, ["first", "second", "third"]);
  assert.deepEqual(queue.loadingChanges, [true, false]);
});

test("figure additions: loading stays true after an earlier addition completes", async () => {
  const queue = fixture();
  const first = queue.add("first");
  const second = queue.add("second");
  queue.requests[0].resolve(figure("first"));
  await first;
  assert.deepEqual(queue.appended, ["first"]);
  assert.deepEqual(queue.loadingChanges, [true]);
  queue.requests[1].resolve(figure("second"));
  await second;
  assert.deepEqual(queue.loadingChanges, [true, false]);
});

test("figure additions: a rejected request reports its error and does not block later clicks", async () => {
  const queue = fixture();
  const failed = queue.add("missing");
  const next = queue.add("next");
  queue.requests[0].reject(new Error("Figure unavailable"));
  await failed;
  assert.deepEqual(queue.appended, []);
  assert.equal(queue.errors.at(-1), "Figure unavailable");
  assert.deepEqual(queue.loadingChanges, [true]);
  queue.requests[1].resolve(figure("next"));
  await next;
  assert.deepEqual(queue.appended, ["next"]);
  assert.deepEqual(queue.loadingChanges, [true, false]);
});

test("figure additions: duplicate selections are preserved and a new batch resets the error", async () => {
  const queue = fixture();
  const failed = queue.add("walk");
  queue.requests[0].reject("Offline");
  await failed;
  assert.equal(queue.errors.at(-1), "Offline");
  const second = queue.add("walk");
  const third = queue.add("walk");
  assert.equal(queue.errors.at(-1), null);
  queue.requests[1].resolve(figure("walk"));
  queue.requests[2].resolve(figure("walk"));
  await Promise.all([second, third]);
  assert.deepEqual(queue.appended, ["walk", "walk"]);
  assert.deepEqual(queue.loadingChanges, [true, false, true, false]);
});

test("figure additions: separate editors have independent queues", async () => {
  const oldEditor = fixture();
  const newEditor = fixture();
  const oldAdd = oldEditor.add("old");
  const newAdd = newEditor.add("new");
  newEditor.requests[0].resolve(figure("new"));
  await newAdd;
  assert.deepEqual(newEditor.appended, ["new"]);
  assert.deepEqual(oldEditor.appended, []);
  oldEditor.requests[0].resolve(figure("old"));
  await oldAdd;
  assert.deepEqual(oldEditor.appended, ["old"]);
  assert.deepEqual(newEditor.appended, ["new"]);
});
