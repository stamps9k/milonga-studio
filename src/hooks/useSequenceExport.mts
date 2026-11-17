import { useCallback, useEffect, useRef, useState } from "react";

import { downloadJSON } from "../libs/browser/download.mts";
import { danceShareURL } from "../libs/browser/danceLink.mts";
import { parseDanceJSON } from "../libs/dance/persistence.mts";
import type { Dance } from "../libs/dance/dance.mts";

export type ShareStatus = "idle" | "copied" | "error";

/** JSON remains the portable backup. Links embed the same complete Dance,
 * compressed locally, without writing to a server. Report clipboard and URL
 * length failures explicitly so a failed share cannot look successful. */
export function useSequenceExport(dance: Dance) {
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const share = useCallback(async () => {
    setExportError(null);
    try {
      const url = await danceShareURL(dance, window.location.href);
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
    } catch (error) {
      setShareStatus("error");
      setExportError(
        error instanceof Error
          ? error.message
          : "Couldn’t copy the link. Export JSON instead.",
      );
    } finally {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShareStatus("idle"), 1500);
    }
  }, [dance]);

  const exportSequence = useCallback(() => {
    setExportError(null);
    try {
      const snapshot = parseDanceJSON(JSON.stringify(dance));
      const slug =
        snapshot.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "dance";
      downloadJSON(`${slug}.json`, snapshot);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Couldn’t export the dance.",
      );
    }
  }, [dance]);

  return { shareStatus, share, exportSequence, exportError };
}
