import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AssetInventorySnapshot, RuntimeSettings } from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import { AppearancePanel } from "./AppearancePanel";
import "./SettingsDialog.css";

type SettingsTab = "general" | "appearance";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" }
];

interface SettingsDialogProps {
  open: boolean;
  host: ArtemisHostClient;
  inventory: AssetInventorySnapshot | null;
  settings: RuntimeSettings;
  onClose(): void;
  onSave(settings: RuntimeSettings): void | Promise<void>;
}

/**
 * Settings as a modal rather than a destination, and the asset inventory lives
 * inside it. Inventory was a whole nav section presenting itself as a report;
 * it belongs where you configure things, not where you work.
 */
export function SettingsDialog({
  open,
  host,
  inventory,
  settings,
  onClose,
  onSave
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<RuntimeSettings>(settings);
  const [tab, setTab] = useState<SettingsTab>("general");

  // Re-seed whenever the dialog opens so a cancelled edit does not persist.
  useEffect(() => {
    if (open) {
      setDraft(settings);
      // Reopening lands on General; the icon picker is a visit, not a home.
      setTab("general");
    }
  }, [open, settings]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSave(draft);
    onClose();
  }

  const readyHarnesses =
    inventory?.harnesses.filter((harness) => harness.health === "ready") ?? [];

  return (
    <dialog
      aria-label="Settings"
      className="settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <form className="settings-form" onSubmit={handleSubmit}>
        <header className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button
            aria-label="Close settings"
            className="settings-close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </header>

        <div aria-label="Settings sections" className="settings-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              aria-selected={tab === entry.id}
              className="settings-tab"
              key={entry.id}
              onClick={() => setTab(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>

        {/* One scroll container for the whole form: per-section scrolling
            clipped fields that sat near a section boundary. */}
        <div className="settings-body">
        {tab === "appearance" ? (
          <AppearancePanel
            host={host}
            onApplied={(iconId) =>
              setDraft((current) => ({ ...current, appIconId: iconId }))
            }
            selectedIconId={settings.appIconId ?? null}
          />
        ) : (
        <>
        <section className="settings-section">
          <h3 className="settings-section-title">OpenCode</h3>
          <label className="settings-label" htmlFor="opencode-model">
            Default model
          </label>
          <input
            className="settings-input mono"
            id="opencode-model"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                opencodeDefaultModel: event.target.value
              }))
            }
            placeholder="provider/model"
            type="text"
            value={draft.opencodeDefaultModel ?? ""}
          />

          <label className="settings-label" htmlFor="opencode-path">
            Executable path
          </label>
          <input
            className="settings-input mono"
            id="opencode-path"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                opencodeExecutablePath: event.target.value
              }))
            }
            placeholder="Leave blank to use PATH discovery"
            type="text"
            value={draft.opencodeExecutablePath ?? ""}
          />

          <label className="settings-label" htmlFor="scan-root">
            Scan root
          </label>
          <input
            className="settings-input mono"
            id="scan-root"
            onChange={(event) =>
              setDraft((current) => ({ ...current, scanRoot: event.target.value }))
            }
            placeholder="Defaults to your home directory"
            type="text"
            value={draft.scanRoot ?? ""}
          />
          <p className="settings-hint">
            Where Artemis looks for projects and agent config files. A tighter
            root means a faster scan.
          </p>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">
            Harnesses
            <span className="settings-count">{readyHarnesses.length} ready</span>
          </h3>
          <ul className="settings-list" data-testid="settings-harnesses">
            {readyHarnesses.map((harness) => (
              <li className="settings-list-item" key={harness.id}>
                <span className="settings-list-name">{harness.label}</span>
                {/* Some harnesses report a paragraph as their version; the full
                    string stays available on hover rather than wrapping. */}
                <span className="settings-list-meta mono" title={harness.version}>
                  {harness.version ?? "—"}
                </span>
              </li>
            ))}
            {readyHarnesses.length === 0 ? (
              <li className="settings-list-empty">No harnesses found on PATH.</li>
            ) : null}
          </ul>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">
            Skills
            <span className="settings-count">
              {inventory?.skills.length ?? 0} indexed
            </span>
          </h3>
          <p className="settings-hint">
            MCP servers are not indexed yet — Quiver integration lands in M10.
          </p>
        </section>
        </>
        )}
        </div>

        <footer className="settings-footer">
          <button className="settings-cancel" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="settings-save" type="submit">
            Save
          </button>
        </footer>
      </form>
    </dialog>
  );
}
