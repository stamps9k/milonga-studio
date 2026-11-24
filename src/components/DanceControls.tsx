import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Dance } from "../libs/dance/dance.mts";
import { useDanceLibrary } from "../hooks/useDanceLibrary.mts";
import type { ShareStatus } from "./Toolbar";
import AppDialog from "./AppDialog";
import DanceDetailsDialog from "./DanceDetailsDialog";
import { capitalize, groupByStyle } from "./styleGroups.mts";

interface Props {
  dance: Dance;
  initialLocalId?: string;
  building: boolean;
  onNameChange: (name: string) => void;
  onNotesChange: (notes: string) => void;
  onSaved: (dance: Dance) => void;
  onOpen: (dance: Dance | null, localId?: string) => void;
  onShare: () => void;
  onExport: () => void;
  shareStatus: ShareStatus;
  exportError: string | null;
  onDismissExportFeedback: () => void;
  canExport: boolean;
}

type Dialog = "details" | "save" | "copy" | "manage" | null;

const DanceControls = ({
  dance,
  initialLocalId,
  building,
  onNameChange,
  onNotesChange,
  onSaved,
  onOpen,
  onShare,
  onExport,
  shareStatus,
  exportError,
  onDismissExportFeedback,
  canExport,
}: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const library = useDanceLibrary({ dance, initialLocalId, onSaved, onOpen });
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
    confirmation,
    answerConfirmation,
    clearFeedback,
  } = library;
  const disabled = busy || building;
  const openDialog = (next: Dialog) => {
    clearFeedback();
    onDismissExportFeedback();
    setDialog(next);
  };
  const saveDance = () => {
    if (localId) void save(false);
    else openDialog("save");
  };
  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!dialog && !disabled) {
        if (event.shiftKey) openDialog("copy");
        else saveDance();
      }
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => shortcut(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const status = busy
    ? "Working…"
    : dirty
      ? "Unsaved changes"
      : localId
        ? "Saved locally"
        : "Working copy";
  const feedback =
    error ??
    exportError ??
    message ??
    (shareStatus === "copied" ? "Share link copied to clipboard." : null);

  return (
    <>
      <nav
        aria-label="Application menus"
        className="d-flex align-items-center gap-1 flex-shrink-0">
        <div className="dropdown">
          <button
            type="button"
            className="btn btn-sm btn-link text-body text-decoration-none dropdown-toggle"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            disabled={disabled}>
            File
          </button>
          <ul className="dropdown-menu shadow" style={{ minWidth: "15rem" }}>
            <li>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => void newDance()}>
                New dance
              </button>
            </li>
            <li>
              <hr className="dropdown-divider" />
            </li>
            <li>
              <button
                type="button"
                className="dropdown-item d-flex justify-content-between gap-4"
                onClick={saveDance}>
                Save locally{" "}
                <span className="small text-body-secondary" aria-hidden="true">
                  ⌘ / Ctrl S
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => openDialog("copy")}>
                Save a copy…
              </button>
            </li>
            <li>
              <hr className="dropdown-divider" />
            </li>
            <li>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => fileRef.current?.click()}>
                Import JSON…
              </button>
            </li>
            <li>
              <button
                type="button"
                className="dropdown-item"
                disabled={!canExport}
                onClick={onExport}>
                Export JSON
              </button>
            </li>
            <li>
              <hr className="dropdown-divider" />
            </li>
            <li>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => openDialog("manage")}>
                Manage local dances…
              </button>
            </li>
          </ul>
        </div>
        <div className="dropdown">
          <button
            type="button"
            className="btn btn-sm btn-link text-body text-decoration-none dropdown-toggle"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            disabled={disabled}>
            Open
          </button>
          <ul
            className="dropdown-menu shadow overflow-y-auto"
            style={{ minWidth: "18rem", maxWidth: "28rem", maxHeight: "65vh" }}>
            <li>
              <h2 className="dropdown-header">Your local dances</h2>
            </li>
            {localLoading && (
              <li>
                <span className="dropdown-item-text small text-body-secondary">
                  Loading local dances…
                </span>
              </li>
            )}
            {localError && (
              <li>
                <span
                  className="dropdown-item-text small text-danger"
                  role="alert">
                  {localError}
                </span>
              </li>
            )}
            {!localLoading && !localError && locals.length === 0 && (
              <li>
                <span className="dropdown-item-text small text-body-secondary">
                  No local saves yet
                </span>
              </li>
            )}
            {locals.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="dropdown-item text-wrap"
                  aria-current={localId === item.id ? "true" : undefined}
                  onClick={() => void openLocal(item)}>
                  {item.name}
                  <span className="d-block small text-body-secondary">
                    {new Date(item.updatedAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="dropdown-item small text-body-secondary"
                disabled={localLoading}
                onClick={refreshLocal}>
                Refresh local dances
              </button>
            </li>
            <li>
              <hr className="dropdown-divider" />
            </li>
            <li>
              <h2 className="dropdown-header">Preset dances</h2>
            </li>
            {presetLoading && (
              <li>
                <span className="dropdown-item-text small text-body-secondary">
                  Loading presets…
                </span>
              </li>
            )}
            {presetError && (
              <li>
                <span
                  className="dropdown-item-text small text-danger"
                  role="alert">
                  {presetError}
                </span>
              </li>
            )}
            {presetError && (
              <li>
                <button
                  type="button"
                  className="dropdown-item"
                  disabled={presetLoading}
                  onClick={refreshPresets}>
                  Retry presets
                </button>
              </li>
            )}
            {!presetLoading && !presetError && presets.length === 0 && (
              <li>
                <span className="dropdown-item-text small text-body-secondary">
                  No presets available
                </span>
              </li>
            )}
            {/* Grouped by dance style, like the figure library, with the
                groups and the presets in them in alphabetical order. */}
            {groupByStyle(presets).map(([style, group]) => (
              <li key={style}>
                <h3 className="dropdown-header small text-uppercase pt-1 pb-0">
                  {capitalize(style)}
                </h3>
                <ul className="list-unstyled" aria-label={capitalize(style)}>
                  {group.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="dropdown-item text-wrap ps-4"
                        onClick={() => void openPreset(item.id)}>
                        {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            <li>
              <hr className="dropdown-divider" />
            </li>
            <li>
              <span className="dropdown-item-text small text-body-secondary text-wrap">
                Presets open as editable copies.
              </span>
            </li>
          </ul>
        </div>
        <div className="dropdown">
          <button
            type="button"
            className="btn btn-sm btn-link text-body text-decoration-none dropdown-toggle"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            disabled={disabled}>
            Dance
          </button>
          <ul className="dropdown-menu shadow">
            <li>
              <button
                type="button"
                className="dropdown-item"
                onClick={() => openDialog("details")}>
                Dance details…
              </button>
            </li>
          </ul>
        </div>
        <div className="dropdown">
          <button
            type="button"
            className="btn btn-sm btn-link text-body text-decoration-none dropdown-toggle"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            disabled={disabled}>
            Share
          </button>
          <ul className="dropdown-menu shadow">
            <li>
              <button
                type="button"
                className="dropdown-item"
                disabled={!canExport}
                onClick={onShare}>
                {shareStatus === "copied"
                  ? "Copied!"
                  : shareStatus === "error"
                    ? "Try copying share link again"
                    : "Copy share link"}
              </button>
            </li>
            <li>
              <button
                type="button"
                className="dropdown-item"
                disabled={!canExport}
                onClick={onExport}>
                Export JSON
              </button>
            </li>
          </ul>
        </div>
      </nav>
      <div
        className="dance-document d-flex align-items-center gap-2 border-start ps-3 ms-2 me-auto overflow-hidden"
        style={{ minWidth: 0 }}>
        <button
          type="button"
          className="btn btn-sm btn-link text-body fw-semibold text-truncate text-decoration-none p-0"
          style={{ maxWidth: "24rem" }}
          title="Edit dance name and notes"
          disabled={disabled}
          onClick={() => openDialog("details")}>
          {dance.name}
        </button>
        <span
          className={
            "badge rounded-pill fw-normal " +
            (dirty ? "text-bg-warning" : "text-bg-secondary")
          }
          role="status">
          {status}
        </span>
      </div>
      <button
        type="button"
        className="dance-save btn btn-sm btn-accent flex-shrink-0"
        disabled={disabled}
        onClick={saveDance}
        title="Save on this browser (Ctrl/Cmd+S)">
        Save
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

      {dialog && dialog !== "manage" && (
        <DanceDetailsDialog
          mode={dialog}
          name={dance.name}
          notes={dance.notes ?? ""}
          busy={busy}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={async (details) => {
            if (dialog === "details") {
              onNameChange(details.name);
              onNotesChange(details.notes);
              return true;
            }
            return save(dialog === "copy", details);
          }}
        />
      )}
      {dialog === "manage" && (
        <AppDialog title="Manage local dances" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p className="small text-body-secondary">
              These saves belong to this browser. Clearing site data removes
              them; export JSON for a backup.
            </p>
            {localError && (
              <div role="alert" className="alert alert-danger">
                {localError}
              </div>
            )}
            {localLoading ? (
              <p>Loading local dances…</p>
            ) : locals.length === 0 ? (
              <p className="text-body-secondary">No local saves yet.</p>
            ) : (
              <ul
                className="list-group list-group-flush overflow-y-auto"
                style={{ maxHeight: "45vh" }}>
                {locals.map((item) => (
                  <li
                    key={item.id}
                    className="list-group-item d-flex align-items-center gap-3 px-0">
                    <div className="me-auto text-break">
                      {item.name}
                      <span className="d-block small text-body-secondary">
                        {new Date(item.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger flex-shrink-0"
                      aria-label={`Delete ${item.name}`}
                      onClick={() => {
                        setDialog(null);
                        void remove(item).then(() => setDialog("manage"));
                      }}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary me-auto"
              disabled={localLoading}
              onClick={refreshLocal}>
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => setDialog(null)}>
              Done
            </button>
          </div>
        </AppDialog>
      )}
      {confirmation && (
        <AppDialog
          title={confirmation.title}
          onClose={() => answerConfirmation(false)}>
          <div className="modal-body">
            <p className="mb-0">{confirmation.message}</p>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              data-dialog-focus
              className="btn btn-outline-secondary"
              onClick={() => answerConfirmation(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={
                confirmation.danger ? "btn btn-danger" : "btn btn-accent"
              }
              onClick={() => answerConfirmation(true)}>
              {confirmation.confirmLabel}
            </button>
          </div>
        </AppDialog>
      )}
      {feedback && !dialog && !confirmation && (
        <FeedbackToast
          // A new message is a new toast, with its own timer.
          key={feedback}
          text={feedback}
          isError={Boolean(error || exportError)}
          onDismiss={() => {
            clearFeedback();
            onDismissExportFeedback();
          }}
        />
      )}
    </>
  );
};

/** How long a confirmation toast stays up before fading, and the fade. */
const TOAST_VISIBLE_MS = 5000;
const TOAST_FADE_MS = 500;

/** The notification in the corner. Confirmations ("Saved on this
 *  browser.", "Share link copied…") fade out after TOAST_VISIBLE_MS and
 *  then dismiss themselves; errors stay until dismissed, so they can be
 *  read. Bootstrap hides a toast without `show` at once, so the fade is
 *  an opacity transition on a toast that keeps `show`. */
function FeedbackToast({
  text,
  isError,
  onDismiss,
}: {
  text: string;
  isError: boolean;
  onDismiss: () => void;
}) {
  const [fading, setFading] = useState(false);
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (isError) return;
    const fade = window.setTimeout(() => setFading(true), TOAST_VISIBLE_MS);
    const gone = window.setTimeout(
      () => dismiss(),
      TOAST_VISIBLE_MS + TOAST_FADE_MS,
    );
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [isError]);
  return (
    <div className="toast-container position-fixed bottom-0 end-0 p-3">
      <div
        className="toast show"
        style={{
          opacity: fading ? 0 : 1,
          transition: `opacity ${TOAST_FADE_MS}ms ease`,
        }}
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}>
        <div className="toast-header">
          <strong className="me-auto">Milonga Studio</strong>
          <button
            type="button"
            className="btn-close"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          />
        </div>
        <div className="toast-body">{text}</div>
      </div>
    </div>
  );
}
export default DanceControls;
