import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleDance } from "../support/dance.mts";
import {
  danceFromURL,
  danceShareURL,
} from "../../src/libs/browser/danceLink.mts";

test("links: a complete Unicode dance opens without any catalogue/server requests", async () => {
  const dance = sampleDance();
  const url = await danceShareURL(
    dance,
    "https://example.com/studio?theme=dark&dance=old#old",
  );
  assert.equal(new URL(url).searchParams.get("theme"), "dark");
  assert.equal(new URL(url).hash, "");
  assert.match(new URL(url).searchParams.get("dance")!, /^1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await danceFromURL(url), dance);
});
test("links: absent, invalid and future links have distinct outcomes", async () => {
  assert.equal(await danceFromURL("https://example.com"), null);
  for (const payload of [
    "",
    "2.abc",
    "1.!!!",
    "1.abc",
    "1." + "a".repeat(8001),
  ]) {
    await assert.rejects(danceFromURL(`https://example.com?dance=${payload}`));
  }
});
test("links: long URLs fail with a JSON fallback instead of copying a broken link", async () => {
  await assert.rejects(
    danceShareURL(
      sampleDance(),
      `https://example.com/?other=${"a".repeat(8000)}`,
    ),
    /Export JSON/,
  );
});
test("links: compressed oversized data is bounded during decompression", async () => {
  const stream = new Blob([" ".repeat(2_000_001)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = Buffer.from(compressed).toString("base64url");
  await assert.rejects(
    danceFromURL(`https://example.com/?dance=1.${encoded}`),
    /2 MB/,
  );
});
