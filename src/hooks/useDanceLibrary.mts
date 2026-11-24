import { useConfirmation } from "./useConfirmation.mts";
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

export interface DanceDetails {
  name: string;
  notes: string;
}

export function fingerprintOf(dance: Dance): string {
  return JSON.stringify({
    name: dance.name,
    notes: dance.notes ?? "",
    music: dance.music,
    tempo: dance.tempo,
    entries: dance.sequence.entries,
  });
}

/** The fingerprint the editor will have once a save of `working` as
 *  `snapshot` lands: the editor keeps its own entries, tempo and music and
 *  takes only the saved name and notes (see the editor's `onSaved`). The
 *  snapshot itself can't be the baseline: `parseDance` rebuilds its
 *  entries, which changes key order and normalises angles (a path's
 *  set-off of -65 comes back as 295), so its fingerprint differs from the
 *  editor's for many figures even though nothing was edited. */
export function savedFingerprint(working: Dance, snapshot: Dance): string {
  return fingerprintOf({
    ...working,
    name: snapshot.name,
    notes: snapshot.notes ?? "",
  });
}

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
  const fingerprint = useMemo(() => fingerprintOf(dance), [dance]);
  const confirmation = useConfirmation();
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

  const mayReplace = async () =>
    !dirtyRef.current ||
    confirmation.ask({
      title: "Discard unsaved changes?",
      message:
        "Save or export JSON first to keep your changes. Opening another dance will replace the current working copy.",
      confirmLabel: "Discard changes",
      danger: true,
    });
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn’t complete this action.",
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = (copy: boolean, details?: DanceDetails) =>
    run(async () => {
      const now = new Date().toISOString();
      const id = copy || !localId ? crypto.randomUUID() : localId;
      const snapshot = parseDance({
        ...dance,
        ...details,
        sequence: { ...dance.sequence, name: details?.name ?? dance.name },
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
      setBaseline(savedFingerprint(dance, snapshot));
      setMessage("Saved on this browser.");
    });
  const openLocal = (item: Dance) =>
    run(async () => {
      if (await mayReplace()) onOpen(item, item.id);
    });
  const openPreset = (id: string) => {
    return run(async () => {
      const preset = await fetchDance(id);
      if (await mayReplace()) onOpen(preset);
    });
  };
  const importFile = (file: File) =>
    run(async () => {
      if (file.size > MAX_DANCE_BYTES)
        throw new Error("Dance files must be smaller than 2 MB.");
      // Validate before asking to replace: malformed files leave the editor intact.
      const imported = parseDanceJSON(await file.text());
      if (await mayReplace()) onOpen(imported);
    });
  const remove = (item: Dance) =>
    run(async () => {
      if (
        !(await confirmation.ask({
          title: "Delete local dance?",
          message: `Delete “${item.name}” from this browser? The open working copy will remain in the editor.`,
          confirmLabel: "Delete local save",
          danger: true,
        }))
      )
        return;
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

  return {
    confirmation: confirmation.confirmation,
    answerConfirmation: confirmation.answer,
    clearFeedback: () => {
      setError(null);
      setMessage(null);
    },
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
    newDance: () =>
      run(async () => {
        if (await mayReplace()) onOpen(null);
      }),
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
