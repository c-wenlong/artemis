import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EditSummary, FileEdit } from "../../chat/fileEdits";
import { DiffView } from "./DiffView";
import "./MessageChrome.css";

/** Lines beyond which a message is folded. Roughly a screen of prompt. */
const LINE_BUDGET = 12;
const CHAR_BUDGET = 800;

export function isLong(text: string): boolean {
  return text.split("\n").length > LINE_BUDGET || text.length > CHAR_BUDGET;
}

/**
 * Folds a long message behind Show more.
 *
 * The decision is made from the text, not from a measured height: heights are
 * zero under jsdom, and a rule the tests cannot see is a rule that quietly
 * stops working. The clamp itself is CSS; this only decides whether to apply it.
 */
export function Truncate({ children, text }: { children: ReactNode; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const foldable = isLong(text);

  return (
    <>
      <div
        className="truncatable"
        data-expanded={foldable ? String(expanded) : "true"}
        data-foldable={String(foldable)}
        data-testid="truncatable"
      >
        {children}
      </div>
      {foldable ? (
        <button
          className="truncate-toggle"
          onClick={() => setExpanded((open) => !open)}
          type="button"
        >
          {expanded ? "Show less" : "Show more"}
          <Chevron open={expanded} />
        </button>
      ) : null}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      className="chrome-chevron"
      data-open={String(open)}
      height="12"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 12 12"
      width="12"
    >
      <path d="M3 4.5 6 7.5l3-3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden
      height="13"
      stroke="currentColor"
      strokeWidth="1.25"
      viewBox="0 0 14 14"
      width="13"
    >
      <rect fill="none" height="8" rx="1.5" width="8" x="4" y="4" />
      <path d="M10 4V3a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 0 2 3v5A1.5 1.5 0 0 0 3.5 9.5H4" fill="none" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg
      aria-hidden
      height="13"
      stroke="currentColor"
      strokeWidth="1.25"
      viewBox="0 0 14 14"
      width="13"
    >
      <path d="M4 11.5V6a2 2 0 0 1 2-2h4.5" fill="none" strokeLinecap="round" />
      <path d="M8.5 2 11 4.5 8.5 7" fill="none" strokeLinecap="round" />
      <circle cx="4" cy="12" fill="none" r="1.25" />
    </svg>
  );
}

function formatTime(iso?: string): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function MessageTime({ at }: { at?: string }) {
  const label = formatTime(at);
  if (!label) return null;
  return (
    <time className="message-time" dateTime={at} data-testid="message-time">
      {label}
    </time>
  );
}

/**
 * Copy, with the confirmation the click needs to feel like it landed.
 * Failure is silent by design: the clipboard is unavailable in some contexts
 * and an error banner over a copy button is worse than nothing happening.
 */
export function CopyButton({ label = "Copy", text }: { label?: string; text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="chrome-action"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => undefined
        );
      }}
      title={label}
      type="button"
    >
      <CopyIcon />
      <span className="visually-hidden">{label}</span>
      {copied ? (
        <span aria-live="polite" className="chrome-action-flash">
          Copied
        </span>
      ) : null}
    </button>
  );
}

export function ForkButton({ onFork }: { onFork(): void }) {
  return (
    <button
      className="chrome-action"
      onClick={onFork}
      title="Fork from here"
      type="button"
    >
      <ForkIcon />
      <span className="visually-hidden">Fork from here</span>
    </button>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * `Worked for 2m 24s`, and the control that reveals how.
 *
 * The mechanics are collapsed by default. The answer is what was asked for; the
 * tool calls that produced it are evidence, available on demand. M8c turns the
 * default into a setting.
 */
export function TurnHeader({
  completedAt,
  expanded,
  hasActivity,
  onToggle,
  startedAt
}: {
  completedAt?: string;
  expanded: boolean;
  hasActivity: boolean;
  onToggle(): void;
  startedAt?: string;
}) {
  if (!startedAt || !completedAt) return null;
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(duration) || duration < 0) return null;

  const label = `Worked for ${formatDuration(duration)}`;
  if (!hasActivity) {
    return (
      <p className="turn-header" data-testid="turn-header">
        {label}
      </p>
    );
  }

  return (
    <button
      aria-expanded={expanded}
      className="turn-header turn-header--toggle"
      data-testid="turn-header"
      onClick={onToggle}
      type="button"
    >
      {label}
      <Chevron open={expanded} />
    </button>
  );
}

function count(value: number | null, sign: "+" | "-"): string {
  return value === null ? "" : `${sign}${value}`;
}

function Counts({ file }: { file: FileEdit }) {
  return (
    <span className="edit-summary-counts mono">
      <span className="edit-added">{count(file.added, "+")}</span>{" "}
      <span className="edit-removed">{count(file.removed, "-")}</span>
    </span>
  );
}

interface EditSummaryCardProps {
  onRevert?(file: FileEdit): Promise<void>;
  summary: EditSummary;
}

/**
 * What the turn changed on disk, and the two things you can do about it.
 *
 * Undo reverse-applies that one file's patch, so an unrelated edit of the
 * user's in the same file survives — which restoring from git would not. The
 * host refuses when the file has moved on since, and that refusal is shown
 * rather than swallowed: it is the property that makes the button safe.
 */
export function EditSummaryCard({ onRevert, summary }: EditSummaryCardProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [reverted, setReverted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const files = summary.files.length;
  const withDiffs = summary.files.filter((file) => file.patch);

  async function revert(file: FileEdit) {
    if (!onRevert || busy) return;
    setBusy(file.path);
    setError(null);
    try {
      await onRevert(file);
      setReverted((current) => new Set(current).add(file.path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="edit-summary" data-testid="edit-summary">
      <header className="edit-summary-head">
        <span className="edit-summary-title">
          Edited {files} {files === 1 ? "file" : "files"}
        </span>
        <span className="edit-summary-actions">
          <span className="edit-summary-total mono" data-testid="edit-total">
            <span className="edit-added">+{summary.added}</span>{" "}
            <span className="edit-removed">-{summary.removed}</span>
          </span>
          {withDiffs.length > 0 ? (
            <button
              className="edit-summary-review"
              onClick={() => setReviewing(true)}
              type="button"
            >
              Review
            </button>
          ) : null}
        </span>
      </header>

      {error ? (
        <p className="edit-summary-error" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="edit-summary-list">
        {summary.files.map((file) => {
          const isOpen = open === file.path;
          const isReverted = reverted.has(file.path);
          return (
            <li
              className="edit-summary-row"
              data-reverted={String(isReverted)}
              data-testid="edit-row"
              key={file.path}
            >
              <div className="edit-summary-line">
                {/* Only a file with a diff gets a control; the rest are text,
                    rather than a button that opens nothing. */}
                {file.patch ? (
                  <button
                    aria-expanded={isOpen}
                    className="edit-summary-path edit-summary-path--button"
                    onClick={() => setOpen(isOpen ? null : file.path)}
                    type="button"
                  >
                    {file.path}
                  </button>
                ) : (
                  <span className="edit-summary-path">{file.path}</span>
                )}

                <span className="edit-summary-line-end">
                  <Counts file={file} />
                  {isReverted ? (
                    <span className="edit-summary-undone">Undone</span>
                  ) : file.patch && onRevert ? (
                    <button
                      className="edit-summary-undo"
                      disabled={busy !== null}
                      onClick={() => void revert(file)}
                      type="button"
                    >
                      {busy === file.path ? "Undoing…" : "Undo"}
                    </button>
                  ) : null}
                </span>
              </div>
              {isOpen && file.patch ? <DiffView patch={file.patch} /> : null}
            </li>
          );
        })}
      </ul>

      {reviewing ? (
        <ChangesDialog files={withDiffs} onClose={() => setReviewing(false)} />
      ) : null}
    </section>
  );
}

/**
 * The whole change set in one place.
 *
 * Read-only. Approving or landing a change belongs with the review flow proper,
 * and a dialog that looked like it could approve but only closed would be worse
 * than one that plainly shows.
 */
function ChangesDialog({
  files,
  onClose
}: {
  files: readonly FileEdit[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      aria-label="Changes"
      className="changes-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={ref}
    >
      <header className="changes-head">
        <h2 className="changes-title">
          {files.length} changed {files.length === 1 ? "file" : "files"}
        </h2>
        <button
          aria-label="Close changes"
          className="settings-close"
          onClick={onClose}
          type="button"
        >
          ✕
        </button>
      </header>
      <div className="changes-body">
        {files.map((file) => (
          <section className="changes-file" key={file.path}>
            <h3 className="changes-file-name mono">
              {file.path}
              <Counts file={file} />
            </h3>
            {file.patch ? <DiffView patch={file.patch} /> : null}
          </section>
        ))}
      </div>
    </dialog>
  );
}
