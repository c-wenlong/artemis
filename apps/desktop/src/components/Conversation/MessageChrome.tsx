import { useState, type ReactNode } from "react";
import type { EditSummary } from "../../chat/fileEdits";
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

/**
 * What the turn changed on disk.
 *
 * Undo and Review are M8b. They are absent rather than disabled — a control
 * that cannot act is a worse promise than no control.
 */
export function EditSummaryCard({ summary }: { summary: EditSummary }) {
  const files = summary.files.length;

  return (
    <section className="edit-summary" data-testid="edit-summary">
      <header className="edit-summary-head">
        <span className="edit-summary-title">
          Edited {files} {files === 1 ? "file" : "files"}
        </span>
        <span className="edit-summary-total mono" data-testid="edit-total">
          <span className="edit-added">+{summary.added}</span>{" "}
          <span className="edit-removed">-{summary.removed}</span>
        </span>
      </header>
      <ul className="edit-summary-list">
        {summary.files.map((file) => (
          <li className="edit-summary-row" data-testid="edit-row" key={file.path}>
            <span className="edit-summary-path">{file.path}</span>
            <span className="edit-summary-counts mono">
              <span className="edit-added">{count(file.added, "+")}</span>{" "}
              <span className="edit-removed">{count(file.removed, "-")}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
