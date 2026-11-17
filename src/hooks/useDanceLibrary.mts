import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dance, DanceSummary } from "../libs/dance/dance.mts";
import {
  MAX_DANCE_BYTES,
  parseDance,
  parseDanceJSON,
} from "../libs/dance/persistence.mts";
import { fetchDance, fetchDanceSummaries } from "../libs/api/dances.mts";
import {
  deleteLocalDance,
  listLocalDances,
  saveLocalDance,
} from "../libs/browser/danceStorage.mts";

interface DanceLibraryOptions {
  dance: Dance;
  initialLocalId?: string;
  onSaved: (dance: Dance) => void;
  onOpen: (dance: Dance | null, localId?: string) => void;
}

/** Named local saves are explicit snapshots. Presets/imports/links have no
 * local id until saved; names never act as identity. Saving during edits marks
 * only the captured snapshot as saved. Refresh on focus picks up other tabs;
 * simultaneous writes to the same local record use last-completed-write wins.
 * The hook owns loading, storage failures and dirty-work protection so the
 * controls only render state and invoke actions. */
export function useDanceLibrary({
  dance,
  initialLocalId,
  onSaved,
  onOpen,
}: DanceLibraryOptions) {
  const [localId, setLocalId] = useState(initialLocalId);
  // Only editable content determines dirtiness; save identity/timestamps may
  // change after a successful write without changing what the user edited.
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: dance.name,
        notes: dance.notes ?? "",
        music: dance.music,
        tempo: dance.tempo,
        entries: dance.sequence.entries,
      }),
    [dance],
  );
  const [baseline, setBaseline] = useState(fingerprint);
  const dirty = baseline !== fingerprint;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const [locals, setLocals] = useState<Dance[]>([]);
  const [presets, setPresets] = useState<DanceSummary[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [presetLoading, setPresetLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const refreshLocal = useCallback(
    () =>
      listLocalDances()
        .then((dances) => {
          setLocals(dances);
          setLocalError(null);
        })
        .catch((error: unknown) => {
          setLocalError(
            error instanceof Error
              ? error.message
              : "Couldn’t load local dances.",
          );
        })
        .finally(() => setLocalLoading(false)),
    [],
  );
  const refreshPresets = useCallback(
    () =>
      fetchDanceSummaries()
        .then((dances) => {
          setPresets(dances);
          setPresetError(null);
        })
        .catch(() => {
          setPresetError(
            "Couldn’t load presets. You can still open local dances or import JSON.",
          );
        })
        .finally(() => setPresetLoading(false)),
    [],
  );

  useEffect(() => {
    void refreshLocal();
    void refreshPresets();
    const focus = () => void refreshLocal();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refreshLocal, refreshPresets]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mayReplace = () =>
    !dirtyRef.current ||
    window.confirm(
      "Discard unsaved changes and open another dance? Save locally or export first to keep them.",
    );
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn’t complete this action.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = (copy: boolean) =>
    run(async () => {
      const now = new Date().toISOString();
      const id = copy || !localId ? crypto.randomUUID() : localId;
      const snapshot = parseDance({
        ...dance,
        id,
        updatedAt: now,
        createdAt: copy || !localId ? now : dance.createdAt,
      });
      await saveLocalDance(snapshot);
      setLocals((previous) => [
        snapshot,
        ...previous.filter((item) => item.id !== id),
      ]);
      setLocalId(id);
      onSaved(snapshot);
      setBaseline(fingerprint);
      setMessage("Saved on this browser.");
    });
  const openLocal = (item: Dance) => {
    if (mayReplace()) onOpen(item, item.id);
  };
  const openPreset = (id: string) => {
    return run(async () => {
      const preset = await fetchDance(id);
      if (mayReplace()) onOpen(preset);
    });
  };
  const importFile = (file: File) =>
    run(async () => {
      if (file.size > MAX_DANCE_BYTES)
        throw new Error("Dance files must be smaller than 2 MB.");
      // Validate before asking to replace: malformed files leave the editor intact.
      const imported = parseDanceJSON(await file.text());
      if (mayReplace()) onOpen(imported);
    });
  const remove = (item: Dance) => {
    if (!window.confirm(`Delete “${item.name}” from this browser?`)) return;
    return run(async () => {
      await deleteLocalDance(item.id);
      setLocals((previous) => previous.filter((dance) => dance.id !== item.id));
      if (localId === item.id) {
        setLocalId(undefined);
        setBaseline("");
      }
      setMessage(
        "Deleted the local save. The open dance is still in the editor.",
      );
    });
  };

  return {
    dirty,
    localId,
    locals,
    presets,
    localLoading,
    presetLoading,
    localError,
    presetError,
    message,
    error,
    busy,
    save,
    openLocal,
    openPreset,
    importFile,
    remove,
    newDance: () => {
      if (mayReplace()) onOpen(null);
    },
    refreshLocal: () => {
      setLocalLoading(true);
      void refreshLocal();
    },
    refreshPresets: () => {
      setPresetLoading(true);
      void refreshPresets();
    },
  };
}
