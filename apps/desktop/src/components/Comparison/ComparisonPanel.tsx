import { useEffect, useRef, useState } from "react";
import type { HarnessAsset } from "@artemis/core";
import type { ComparisonController } from "../../chat/useComparison";
import { MessageList } from "../Conversation/MessageList";
import "./ComparisonPanel.css";

/**
 * Choosing who to ask.
 *
 * Only harnesses Artemis can parse appear: a comparison is read as diffs and
 * transcripts side by side, and one that can only run in a terminal has nothing
 * to put in a tab. Two is the minimum, because one harness is not a comparison.
 */
export function ComparisonSetup({
  harnesses,
  onClose,
  onStart
}: {
  harnesses: HarnessAsset[];
  onClose(): void;
  onStart(prompt: string, harnessIds: string[]): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const ready = chosen.length >= 2 && prompt.trim().length > 0;

  return (
    <dialog
      aria-label="Compare harnesses"
      className="settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={ref}
    >
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onStart(prompt.trim(), chosen);
        }}
      >
        <header className="settings-header">
          <h2 className="settings-title">Compare harnesses</h2>
          <button
            aria-label="Close"
            className="settings-close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Ask</h3>
            <label className="settings-label" htmlFor="comparison-prompt">
              Prompt
            </label>
            <textarea
              className="settings-input comparison-prompt"
              id="comparison-prompt"
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="One prompt, sent to every harness you pick"
              rows={3}
              value={prompt}
            />
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Harnesses</h3>
            <div className="comparison-choices">
              {harnesses.map((harness) => (
                <label className="verbosity-choice" key={harness.id}>
                  <input
                    checked={chosen.includes(harness.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, harness.id]
                          : current.filter((id) => id !== harness.id)
                      )
                    }
                    type="checkbox"
                  />
                  <span className="verbosity-copy">
                    <span className="verbosity-label">{harness.label}</span>
                    <span className="verbosity-detail">
                      {harness.version ?? "version unknown"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="settings-hint">
              Each harness gets its own worktree, branched from where you are
              now, so they cannot overwrite each other. Keeping one answer
              afterwards discards the others.
            </p>
          </section>
        </div>

        <footer className="settings-footer">
          <button className="settings-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="settings-save" disabled={!ready} type="submit">
            Start
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/**
 * A destructive step, named before it happens.
 *
 * Discarding a losing run throws away uncommitted work an agent spent real time
 * and money on, and git offers no way back. So the confirmation lists what is
 * about to go by name rather than saying "the others".
 */
function ConfirmDialog({
  confirmLabel,
  detail,
  onCancel,
  onConfirm,
  title
}: {
  confirmLabel: string;
  detail: string;
  onCancel(): void;
  onConfirm(): void;
  title: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      aria-label={title}
      className="settings-dialog comparison-confirm"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={ref}
    >
      <header className="settings-header">
        <h2 className="settings-title">{title}</h2>
      </header>
      <div className="settings-body">
        <p className="comparison-confirm-body">{detail}</p>
      </div>
      <footer className="settings-footer">
        <button className="settings-cancel" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="comparison-destructive" onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
      </footer>
    </dialog>
  );
}

const STATUS_LABEL = {
  done: "done",
  failed: "failed",
  idle: "waiting",
  running: "running"
} as const;

/**
 * The answers, side by side.
 *
 * Tabs rather than columns: three transcripts abreast are unreadable at any
 * window width, and the question being asked is "which of these is right",
 * which is answered by reading them one at a time.
 */
export function ComparisonPanel({
  comparison,
  harnesses
}: {
  comparison: ComparisonController;
  harnesses: HarnessAsset[];
}) {
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState<"keep" | "discard" | null>(null);

  const run = comparison.run;
  if (!run) return null;

  const entries = run.entries;
  const current = entries[Math.min(active, entries.length - 1)];
  const label = (id: string) =>
    harnesses.find((harness) => harness.id === id)?.label ?? id;

  const losers = entries
    .filter((entry) => entry.workspaceId !== current?.workspaceId)
    .map((entry) => label(entry.harnessId));

  return (
    <section aria-label="Comparison" className="comparison">
      <header className="comparison-head">
        <p className="comparison-prompt-echo">{run.prompt}</p>
        <div className="comparison-actions">
          <button
            className="settings-cancel"
            onClick={() => setConfirming("discard")}
            type="button"
          >
            Discard all
          </button>
          <button
            className="settings-save"
            disabled={!current || Boolean(current.error)}
            onClick={() => setConfirming("keep")}
            type="button"
          >
            Keep this one
          </button>
        </div>
      </header>

      {comparison.error ? (
        <p className="comparison-error" role="alert">
          {comparison.error}
        </p>
      ) : null}

      <div aria-label="Harnesses" className="comparison-tabs" role="tablist">
        {entries.map((entry, index) => {
          const state = comparison.states[entry.workspaceId];
          const status = entry.error ? "failed" : (state?.status ?? "idle");
          return (
            <button
              aria-selected={index === active}
              className="comparison-tab"
              data-failed={String(status === "failed")}
              data-testid="comparison-tab"
              key={entry.workspaceId}
              onClick={() => setActive(index)}
              role="tab"
              type="button"
            >
              <span className="comparison-tab-name">{label(entry.harnessId)}</span>
              <span className="comparison-tab-status">{STATUS_LABEL[status]}</span>
            </button>
          );
        })}
      </div>

      <div className="comparison-body">
        {current?.error ? (
          <p className="comparison-failed">
            {label(current.harnessId)} could not start: {current.error}
          </p>
        ) : current ? (
          <MessageList
            isStreaming={comparison.states[current.workspaceId]?.status === "running"}
            messages={comparison.states[current.workspaceId]?.transcript.messages ?? []}
            turns={comparison.states[current.workspaceId]?.transcript.turns ?? {}}
          />
        ) : null}
      </div>

      {confirming === "keep" && current ? (
        <ConfirmDialog
          confirmLabel="Keep it"
          detail={`Keeping ${label(current.harnessId)} permanently discards the work from ${losers.join(" and ")}. This cannot be undone.`}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void comparison.keep(current.workspaceId);
          }}
          title="Keep this answer?"
        />
      ) : null}

      {confirming === "discard" ? (
        <ConfirmDialog
          confirmLabel="Discard them"
          detail={`This permanently discards the work from every harness in this comparison — ${entries.map((entry) => label(entry.harnessId)).join(", ")}. This cannot be undone.`}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void comparison.discardAll();
          }}
          title="Discard every answer?"
        />
      ) : null}
    </section>
  );
}
