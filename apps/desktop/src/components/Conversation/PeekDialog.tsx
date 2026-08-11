import { useEffect, useRef } from "react";
import type { FileWindow } from "@artemis/core";
import "./PeekDialog.css";

/**
 * The lines a citation points at.
 *
 * A window rather than the whole file: the question a citation raises is "is
 * that actually what it says there", and a few lines either side answers it.
 * The range is stated so the window can be placed in the file rather than read
 * as the whole of it.
 */
export function PeekDialog({
  onClose,
  requestedLine,
  window: view
}: {
  onClose(): void;
  /** The line the citation named, if it named one. */
  requestedLine?: number;
  window: FileWindow;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const endLine = view.startLine + Math.max(view.lines.length - 1, 0);

  return (
    <dialog
      aria-label={view.path}
      className="peek-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={ref}
    >
      <header className="peek-head">
        <div className="peek-heading">
          <h2 className="peek-title mono">{view.path}</h2>
          <p className="peek-range" data-testid="peek-range">
            {view.totalLines === 0
              ? "Empty file"
              : `Lines ${view.startLine}–${endLine} of ${view.totalLines}`}
          </p>
        </div>
        <button
          aria-label="Close file"
          className="settings-close"
          onClick={onClose}
          type="button"
        >
          ✕
        </button>
      </header>

      {/* A citation whose line no longer exists. The file still opens, because
          reading it is the point, but nothing is marked as the claim. */}
      {requestedLine !== undefined && view.focusLine === null && view.totalLines > 0 ? (
        <p className="peek-stale" data-testid="peek-stale">
          The cited line is not in this file any more. Showing the end of it.
        </p>
      ) : null}

      <div className="peek-body">
        {view.lines.map((text, index) => {
          const number = view.startLine + index;
          return (
            <div
              className="peek-line mono"
              data-focused={String(number === view.focusLine)}
              data-testid="peek-line"
              key={number}
            >
              <span className="peek-number">{number}</span>
              <span className="peek-text">{text}</span>
            </div>
          );
        })}
      </div>
    </dialog>
  );
}
