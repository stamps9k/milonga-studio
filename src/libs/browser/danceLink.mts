import type { Dance } from "../dance/dance.mts";
import {
  MAX_DANCE_BYTES,
  parseDance,
  parseDanceJSON,
} from "../dance/persistence.mts";

export const MAX_SHARE_URL_LENGTH = 8000;

/** Versioned, gzip-compressed self-contained snapshot in ?dance=1.<base64url>.
 * CompressionStream is native in current browsers; JSON export remains the
 * fallback for older browsers or long dances. The version is the link codec,
 * separate from Dance.schemaVersion. No upload or catalogue fetch is involved. */
export async function danceShareURL(
  dance: Dance,
  base: string,
): Promise<string> {
  if (typeof CompressionStream === "undefined")
    throw new Error(
      "This browser can’t create share links. Export JSON instead.",
    );
  const json = JSON.stringify(parseDance(dance));
  if (new TextEncoder().encode(json).byteLength > MAX_DANCE_BYTES)
    throw new Error("This dance is too large to share. Export JSON instead.");
  const stream = new Blob([json])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  // Avoid spreading a potentially large array onto the JS call stack.
  const encoded = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const url = new URL(base);
  url.searchParams.set("dance", `1.${encoded}`);
  url.hash = "";
  if (url.href.length > MAX_SHARE_URL_LENGTH)
    throw new Error(
      "This dance is too long for a share link. Export JSON instead.",
    );
  return url.href;
}

export async function danceFromURL(url: string): Promise<Dance | null> {
  const encoded = new URL(url).searchParams.get("dance");
  if (encoded === null) return null;
  if (
    encoded.length > MAX_SHARE_URL_LENGTH ||
    !/^1\.[A-Za-z0-9_-]+$/.test(encoded)
  )
    throw new Error(
      "This dance link is invalid or uses an unsupported version.",
    );
  if (typeof DecompressionStream === "undefined")
    throw new Error(
      "This browser can’t open share links. Ask for a JSON export instead.",
    );
  try {
    const bytes = Uint8Array.from(
      atob(encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    const reader = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_DANCE_BYTES)
          throw new Error("Dance link expands beyond 2 MB.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseDanceJSON(
      new TextDecoder("utf-8", { fatal: true }).decode(result),
    );
  } catch (error) {
    throw new Error(
      `Couldn’t open this dance link: ${error instanceof Error ? error.message : "invalid data"}`,
      { cause: error },
    );
  }
}
