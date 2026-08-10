import { useEffect, useRef, useState, type FormEvent } from "react";
import type { WorkspaceSummary } from "@artemis/core";
import "./WorktreeDialogs.css";

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

interface NewWorktreeDialogProps {
  open: boolean;
  projectName: string;
  onClose(): void;
  onCreate(branch: string): Promise<void>;
}

/**
 * Creating a worktree copies a whole tree, so this reports progress rather than
 * appearing to hang, and stays open on failure so the branch name can be fixed
 * without retyping it.
 */
export function NewWorktreeDialog({
  open,
  projectName,
  onClose,
  onCreate
}: NewWorktreeDialogProps) {
  const ref = useModal(open);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBranch("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = branch.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
      onClose();
    } catch (cause) {
      // Git's own message: "a branch named 'x' already exists" tells the user
      // what to do; "something went wrong" does not.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-label="New worktree"
      className="worktree-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={ref}
    >
      <form className="worktree-form" onSubmit={handleSubmit}>
        <h2 className="worktree-title">New worktree</h2>
        <p className="worktree-subtitle">
          A separate checkout of <strong>{projectName}</strong>, so an agent can
          work without touching your current one.
        </p>

        <label className="worktree-label" htmlFor="worktree-branch">
          Branch
        </label>
        <input
          autoFocus
          className="worktree-input mono"
          disabled={busy}
          id="worktree-branch"
          onChange={(event) => setBranch(event.target.value)}
          placeholder="feature/login"
          type="text"
          value={branch}
        />
        <p className="worktree-hint">
          Created if it does not exist, checked out if it does.
        </p>

        {error ? (
          <p className="worktree-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="worktree-actions">
          <button
            className="worktree-cancel"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button className="worktree-confirm" disabled={busy} type="submit">
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface DeleteWorktreeDialogProps {
  open: boolean;
  workspace: WorkspaceSummary | null;
  onClose(): void;
  onDelete(force: boolean): Promise<void>;
}

/**
 * Deleting a worktree can destroy uncommitted work that exists nowhere else.
 *
 * The host refuses a dirty worktree; this relays that refusal and offers
 * discarding as a *separate* button the user has to reach for. It never retries
 * with force on its own — that would turn a safety check into a speed bump.
 */
export function DeleteWorktreeDialog({
  open,
  workspace,
  onClose,
  onDelete
}: DeleteWorktreeDialogProps) {
  const ref = useModal(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!open || !workspace) return null;

  async function attempt(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      await onDelete(force);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-label="Delete worktree"
      className="worktree-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={ref}
    >
      <div className="worktree-form">
        <h2 className="worktree-title">Delete worktree</h2>
        <p className="worktree-subtitle">
          Removes the <strong>{workspace.name}</strong> checkout at{" "}
          <span className="mono">{workspace.worktreePath}</span>. The branch
          itself is kept.
        </p>

        {error ? (
          <p className="worktree-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="worktree-actions">
          <button
            className="worktree-cancel"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          {error ? (
            <button
              className="worktree-destructive"
              disabled={busy}
              onClick={() => void attempt(true)}
              type="button"
            >
              Discard changes and delete
            </button>
          ) : (
            <button
              className="worktree-destructive"
              disabled={busy}
              onClick={() => void attempt(false)}
              type="button"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
