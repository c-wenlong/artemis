import { useEffect, useState } from "react";
import type { AppIcon } from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import "./AppearancePanel.css";

interface AppearancePanelProps {
  host: ArtemisHostClient;
  /** The variant currently stored in settings. */
  selectedIconId: string | null;
  onApplied(iconId: string): void;
}

const DEFAULT_ICON_ID = "deep-sea-gradient";

/**
 * Icon picker.
 *
 * Applying is immediate rather than staged behind Save: the whole point is
 * seeing it in the dock, and a preview that needs confirming would show the
 * change twice.
 *
 * The selection only moves once the host confirms. Showing a tile as chosen
 * while the dock still shows something else would be a small lie told by the
 * settings panel.
 */
export function AppearancePanel({
  host,
  selectedIconId,
  onApplied
}: AppearancePanelProps) {
  const [icons, setIcons] = useState<AppIcon[]>([]);
  const [applied, setApplied] = useState(selectedIconId ?? DEFAULT_ICON_ID);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const catalog = await host.listAppIcons();
        if (active) setIcons(catalog);
      } catch {
        // Browser mode has no dock to change; an empty list says so.
      }
    })();
    return () => {
      active = false;
    };
  }, [host]);

  async function choose(iconId: string) {
    if (iconId === applied || busyId) return;
    setBusyId(iconId);
    setError(null);
    try {
      await host.setAppIcon(iconId);
      setApplied(iconId);
      onApplied(iconId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">App icon</h3>

      {error ? (
        <p className="appearance-error" role="alert">
          {error}
        </p>
      ) : null}

      {icons.length === 0 ? (
        <p className="settings-hint">
          Changing the app icon requires the desktop app.
        </p>
      ) : (
        <div aria-label="App icon" className="appearance-grid" role="radiogroup">
          {icons.map((icon) => (
            <button
              aria-checked={icon.id === applied}
              aria-label={icon.label}
              className="appearance-option"
              disabled={busyId !== null}
              key={icon.id}
              onClick={() => void choose(icon.id)}
              role="radio"
              type="button"
            >
              <img
                alt=""
                className="appearance-swatch"
                src={`/icon-variants/${icon.id}.png`}
              />
              <span className="appearance-label">{icon.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Only worth explaining when there is something to choose; in browser
          mode the line above already says why the grid is missing. */}
      {icons.length > 0 ? (
        <p className="settings-hint" data-testid="appearance-note">
          Changes the icon of the running app — the dock, Cmd-Tab and the window
          menu — and is restored on the next launch. The icon Finder shows is
          built into the app and is not affected.
        </p>
      ) : null}
    </section>
  );
}
