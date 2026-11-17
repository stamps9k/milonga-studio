import { useRef } from "react";
import type { Dance } from "../libs/dance/dance.mts";
import { useDanceLibrary } from "../hooks/useDanceLibrary.mts";

interface Props {
  dance: Dance;
  initialLocalId?: string;
  building: boolean;
  onNameChange: (name: string) => void;
  onNotesChange: (notes: string) => void;
  onSaved: (dance: Dance) => void;
  onOpen: (dance: Dance | null, localId?: string) => void;
}

const DanceControls = ({
  dance,
  initialLocalId,
  building,
  onNameChange,
  onNotesChange,
  onSaved,
  onOpen,
}: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
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
    newDance,
    refreshLocal,
    refreshPresets,
  } = useDanceLibrary({ dance, initialLocalId, onSaved, onOpen });

  return (
    <details className="border-bottom px-4 py-3" open>
      <summary className="fw-bold">
        Dances{" "}
        <span className="small fw-normal text-body-secondary">
          {dirty
            ? "Unsaved changes"
            : localId
              ? "Saved locally"
              : "Working copy"}
        </span>
      </summary>
      <div className="row g-3 mt-1">
        <div className="col-6">
          <label htmlFor="dance-name" className="form-label small">
            Dance name
          </label>
          <input
            id="dance-name"
            className="form-control"
            maxLength={200}
            value={dance.name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <label htmlFor="dance-notes" className="form-label small mt-2">
            Notes
          </label>
          <textarea
            id="dance-notes"
            className="form-control"
            rows={2}
            maxLength={10000}
            value={dance.notes ?? ""}
            onChange={(event) => onNotesChange(event.target.value)}
          />
          <div className="d-flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              className="btn btn-sm btn-accent"
              disabled={busy || building || !dance.name.trim()}
              onClick={() => void save(false)}>
              Save locally
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              disabled={busy || building || !dance.name.trim()}
              onClick={() => void save(true)}>
              Save a copy
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              disabled={busy || building}
              onClick={() => {
                newDance();
              }}>
              New dance
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              disabled={busy || building}
              onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Import dance JSON"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </div>
          <p className="small text-body-secondary mt-2 mb-0">
            Local saves belong to this browser and device. Clearing site data
            removes them; export JSON for a backup. Presets open as editable
            copies.
          </p>
          <div role="status" className="small mt-2">
            {busy ? "Working…" : message}
          </div>
          {error && (
            <p role="alert" className="text-danger small">
              {error}
            </p>
          )}
        </div>
        <div className="col-3">
          <h2 className="h6">Your local dances</h2>
          {localLoading && <p className="small">Loading local dances…</p>}
          {localError && (
            <p role="alert" className="text-danger small">
              {localError}
            </p>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-light mb-2"
            disabled={busy || localLoading}
            onClick={() => {
              void refreshLocal();
            }}>
            Refresh local dances
          </button>
          {!localLoading && !localError && locals.length === 0 && (
            <p className="small text-body-secondary">No local saves yet.</p>
          )}
          <ul
            className="list-unstyled mb-0"
            style={{ maxHeight: "180px", overflowY: "auto" }}>
            {locals.map((item) => (
              <li key={item.id} className="d-flex gap-2 mb-1">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-light text-start flex-grow-1"
                  disabled={busy || building}
                  onClick={() => openLocal(item)}>
                  {item.name}
                  <span className="d-block small text-body-secondary">
                    {new Date(item.updatedAt).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  aria-label={`Delete ${item.name}`}
                  disabled={busy}
                  onClick={() => void remove(item)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="col-3">
          <h2 className="h6">Preset dances</h2>
          {presetLoading && <p className="small">Loading presets…</p>}
          {presetError && (
            <p role="alert" className="text-danger small">
              {presetError}
            </p>
          )}
          {presetError && (
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              disabled={busy || presetLoading}
              onClick={() => {
                void refreshPresets();
              }}>
              Retry presets
            </button>
          )}
          {!presetLoading && !presetError && presets.length === 0 && (
            <p className="small text-body-secondary">No presets available.</p>
          )}
          <ul
            className="list-unstyled mb-0"
            style={{ maxHeight: "180px", overflowY: "auto" }}>
            {presets.map((item) => (
              <li key={item.id} className="mb-1">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-light w-100 text-start"
                  disabled={busy || building}
                  onClick={() => void openPreset(item.id)}>
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
};
export default DanceControls;
