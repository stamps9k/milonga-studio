import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface ModalInstance {
  show: () => void;
  hide: () => void;
  dispose: () => void;
}
declare global {
  interface Window {
    bootstrap: { Modal: new (element: HTMLElement) => ModalInstance };
  }
}

interface Props {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}

/** React owns the content; the Bootstrap bundle already loaded by index.html
 * owns backdrop, Escape, focus trapping and scroll locking. Portalling outside
 * the editor also avoids clipping by its layout. Omit the optional .fade:
 * hide/dispose must finish synchronously when opening a document remounts the
 * editor, otherwise Bootstrap can leave its backdrop and scroll lock behind.
 */
const AppDialog = ({ title, children, onClose, busy = false }: Props) => {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const hidden = useEffectEvent(() => onClose());
  const preventBusyClose = useEffectEvent((event: Event) => {
    if (busy) event.preventDefault();
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const restore = active?.closest(".dropdown-menu")
      ? active
          .closest(".dropdown")
          ?.querySelector<HTMLElement>('[data-bs-toggle="dropdown"]')
      : active;
    const BootstrapModal = window.bootstrap.Modal;
    const onHidden = () => hidden();
    const onHide = (event: Event) => preventBusyClose(event);
    const focus = () => {
      const input = element.querySelector<HTMLElement>("[data-dialog-focus]");
      input?.focus();
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
      )
        input.select();
    };
    // The portal is the last element in the document. Explicitly wrap Tab
    // at its edges so focus cannot move into browser chrome before Bootstrap
    // gets another focusin event to bring it back into the modal.
    const wrapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((control) => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        element.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener("keydown", wrapTab);
    const modal = new BootstrapModal(element);
    element.addEventListener("hidden.bs.modal", onHidden);
    element.addEventListener("hide.bs.modal", onHide);
    element.addEventListener("shown.bs.modal", focus);
    modal.show();
    return () => {
      // Remove callbacks first: hiding during unmount must not set state in
      // the old editor or let the busy guard prevent Bootstrap's cleanup.
      element.removeEventListener("keydown", wrapTab);
      element.removeEventListener("hidden.bs.modal", onHidden);
      element.removeEventListener("hide.bs.modal", onHide);
      element.removeEventListener("shown.bs.modal", focus);
      modal.hide();
      modal.dispose();
      if (restore?.isConnected) restore.focus();
    };
  }, []);

  return createPortal(
    <div ref={host} className="modal" tabIndex={-1} aria-labelledby={id}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content shadow-lg">
          <div className="modal-header">
            <h2 className="modal-title fs-5" id={id}>
              {title}
            </h2>
            <button
              type="button"
              className="btn-close"
              aria-label="Close dialog"
              disabled={busy}
              onClick={onClose}
            />
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
export default AppDialog;
