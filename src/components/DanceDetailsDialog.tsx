import { useState } from "react";
import type { DanceDetails } from "../hooks/useDanceLibrary.mts";
import AppDialog from "./AppDialog";

interface Props {
  mode: "details" | "save" | "copy";
  name: string;
  notes: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (details: DanceDetails) => Promise<boolean>;
}

/** Drafts live only in this dialog. Cancel/Escape never mutates the working
 * dance; save applies exactly the submitted fields after storage commits. */
const DanceDetailsDialog = ({
  mode,
  name,
  notes,
  busy,
  error,
  onClose,
  onSubmit,
}: Props) => {
  const [draftName, setDraftName] = useState(
    mode === "copy" ? `${name.slice(0, 193)} (copy)` : name,
  );
  const [draftNotes, setDraftNotes] = useState(notes);
  const title =
    mode === "details"
      ? "Dance details"
      : mode === "copy"
        ? "Save As"
        : "Save dance locally";
  return (
    <AppDialog title={title} busy={busy} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ name: draftName.trim(), notes: draftNotes }).then(
            (saved) => {
              if (saved) onClose();
            },
          );
        }}>
        <div className="modal-body">
          <label htmlFor="dance-name" className="form-label">
            Dance name
          </label>
          <input
            id="dance-name"
            className="form-control"
            data-dialog-focus
            required
            maxLength={200}
            value={draftName}
            disabled={busy}
            onChange={(event) => setDraftName(event.target.value)}
          />
          <label htmlFor="dance-notes" className="form-label mt-3">
            Notes <span className="text-body-secondary small">(optional)</span>
          </label>
          <textarea
            id="dance-notes"
            className="form-control"
            rows={4}
            maxLength={10000}
            value={draftNotes}
            disabled={busy}
            onChange={(event) => setDraftNotes(event.target.value)}
          />
          {mode !== "details" && (
            <p className="small text-body-secondary mt-3 mb-0">
              Saved only in this browser. Export JSON to keep a portable backup.
            </p>
          )}
          {error && (
            <div role="alert" className="alert alert-danger mt-3 mb-0">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={busy}
            onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-accent"
            disabled={busy || !draftName.trim()}>
            {busy
              ? "Saving…"
              : mode === "details"
                ? "Apply changes"
                : mode === "copy"
                  ? "Save As"
                  : "Save"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
};
export default DanceDetailsDialog;
