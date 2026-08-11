import type { TranscriptVerbosity } from "@artemis/core";
import "./DeveloperPanel.css";

const CHOICES: Array<{
  detail: string;
  label: string;
  value: TranscriptVerbosity;
}> = [
  {
    detail: "Every tool call, in the order it ran.",
    label: "Everything",
    value: "full"
  },
  {
    detail: "Just the answer. The work folds behind the turn header.",
    label: "Output only",
    value: "output"
  }
];

interface DeveloperPanelProps {
  onChange(verbosity: TranscriptVerbosity): void;
  verbosity: TranscriptVerbosity;
}

/**
 * How much of a turn to render.
 *
 * A radio group rather than a checkbox: "show everything" and "show the answer"
 * are two readings of a transcript, not a feature being switched off. Both are
 * legitimate, and which one is right depends on whether you are debugging the
 * agent or reading its conclusion.
 */
export function DeveloperPanel({ onChange, verbosity }: DeveloperPanelProps) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Transcript detail</h3>

      <div aria-label="Transcript detail" className="verbosity-group" role="radiogroup">
        {CHOICES.map((choice) => (
          <label className="verbosity-choice" key={choice.value}>
            <input
              checked={verbosity === choice.value}
              name="transcript-verbosity"
              onChange={() => onChange(choice.value)}
              type="radio"
              value={choice.value}
            />
            <span className="verbosity-copy">
              <span className="verbosity-label">{choice.label}</span>
              <span className="verbosity-detail">{choice.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="settings-hint" data-testid="verbosity-note">
        This is also a context lever. A long run of tool calls is the bulk of
        what a transcript holds, and folding it away keeps the conversation
        readable without losing it — the turn header still opens any turn.
      </p>
    </section>
  );
}
