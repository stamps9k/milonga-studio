import { useCallback, useState } from "react";

import { downloadJSON } from "../libs/browser/download.mts";
import { entriesToSequence } from "../libs/dance/serialize.mts";
import type { SequenceEntry } from "../libs/dance/sequence.mts";

export type ShareStatus = "idle" | "copied" | "error";

interface UseSequenceExportResult {
  shareStatus: ShareStatus;
  share: () => Promise<void>;
  exportSequence: () => void;
}

const SHARE_STATUS_RESET_MS = 1500;

/**
 * Share/export for the in-memory sequence useSequenceBuilder assembles.
 * There's no save/share backend yet (see useSequenceBuilder's own
 * comment), so both are client-side stand-ins until one exists: Share
 * copies the Sequence as JSON to the clipboard, Export downloads it as
 * a .json file.
 */
export function useSequenceExport(
  entries: SequenceEntry[],
): UseSequenceExportResult {
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");

  const share = useCallback(async () => {
    const sequence = entriesToSequence(entries);
    try {
      await navigator.clipboard.writeText(JSON.stringify(sequence, null, 2));
      setShareStatus("copied");
    } catch {
      setShareStatus("error");
    } finally {
      setTimeout(() => setShareStatus("idle"), SHARE_STATUS_RESET_MS);
    }
  }, [entries]);

  const exportSequence = useCallback(() => {
    const sequence = entriesToSequence(entries);
    const slug = sequence.name.toLowerCase().replace(/\s+/g, "-");
    downloadJSON(`${slug}.json`, sequence);
  }, [entries]);

  return { shareStatus, share, exportSequence };
}
