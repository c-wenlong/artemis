import { useState, type FormEvent } from "react";
import type { HarnessAsset, ReviewSnapshot, WorkspaceSummary } from "@artemis/core";
import "./Composer.css";

interface ComposerProps {
  workspace: WorkspaceSummary | null;
  review: ReviewSnapshot | null;
  harnesses: HarnessAsset[];
  selectedHarnessId: string | null;
  model: string;
  isBusy: boolean;
  onSelectHarness(harnessId: string): void;
  onModelChange(model: string): void;
  onSubmit(prompt: string): void;
}

function diffTotals(review: ReviewSnapshot | null) {
  if (!review) return { additions: 0, deletions: 0 };
  return review.files.reduce(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions
    }),
    { additions: 0, deletions: 0 }
  );
}

/**
 * The composer doubles as the run's status bar — Superset's arrangement. Repo,
 * branch and live diffstat sit directly above the input, harness and model
 * directly below, so nothing about the current run requires leaving the
 * conversation to see.
 */
export function Composer({
  workspace,
  review,
  harnesses,
  selectedHarnessId,
  model,
  isBusy,
  onSelectHarness,
  onModelChange,
  onSubmit
}: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const { additions, deletions } = diffTotals(review);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isBusy) return;
    onSubmit(trimmed);
    setPrompt("");
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-context" data-testid="composer-context">
        <span className="composer-repo">{workspace?.name ?? "No workspace"}</span>
        <span className="composer-branch mono">{workspace?.branch ?? "—"}</span>
        <span className="composer-diffstat mono">
          <span className="composer-added">+{additions}</span>
          {/* U+2212, not a hyphen: it aligns with the plus and reads as a sign. */}
          <span className="composer-removed">−{deletions}</span>
        </span>
      </div>

      <div className="composer-input-row">
        <textarea
          aria-label="Prompt"
          className="composer-input"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              handleSubmit(event);
            }
          }}
          placeholder={`Ask ${
            harnesses.find((harness) => harness.id === selectedHarnessId)?.label ??
            "an agent"
          } to build, explain, or fix something`}
          rows={3}
          value={prompt}
        />
      </div>

      <div className="composer-controls">
        <label className="composer-field">
          <span className="visually-hidden">Harness</span>
          <select
            aria-label="Harness"
            className="composer-select"
            onChange={(event) => onSelectHarness(event.target.value)}
            value={selectedHarnessId ?? ""}
          >
            {harnesses.map((harness) => (
              <option key={harness.id} value={harness.id}>
                {harness.label}
              </option>
            ))}
          </select>
        </label>

        <label className="composer-field">
          <span className="visually-hidden">Model</span>
          <input
            aria-label="Model"
            className="composer-model mono"
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="provider/model"
            type="text"
            value={model}
          />
        </label>

        <button className="composer-run" disabled={isBusy} type="submit">
          {isBusy ? "Running…" : "Run"}
        </button>
      </div>
    </form>
  );
}
