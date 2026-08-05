import { useEffect, useState } from "react";
import type {
  AssetHealth,
  AssetInventorySnapshot,
  RuntimeSettings
} from "@artemis/core";
import "./AssetInventory.css";

interface AssetInventoryProps {
  inventory: AssetInventorySnapshot;
  settings: RuntimeSettings;
  onSaveSettings(settings: RuntimeSettings): Promise<void>;
}

const healthLabel: Record<AssetHealth, string> = {
  ready: "Ready",
  missing: "Missing",
  "needs-setup": "Setup",
  unknown: "Unknown"
};

export function AssetInventory({
  inventory,
  settings,
  onSaveSettings
}: AssetInventoryProps) {
  const [opencodePath, setOpencodePath] = useState(
    settings.opencodeExecutablePath ?? ""
  );
  const [opencodeModel, setOpencodeModel] = useState(
    settings.opencodeDefaultModel ?? ""
  );
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const opencodeHarness = inventory.harnesses.find(
    (harness) => harness.id === "opencode"
  );

  useEffect(() => {
    setOpencodePath(settings.opencodeExecutablePath ?? "");
    setOpencodeModel(settings.opencodeDefaultModel ?? "");
  }, [settings.opencodeDefaultModel, settings.opencodeExecutablePath]);

  async function saveSettings() {
    setIsSaving(true);
    setStatus("");
    try {
      await onSaveSettings({
        ...settings,
        opencodeDefaultModel: opencodeModel.trim() || undefined,
        opencodeExecutablePath: opencodePath.trim() || undefined
      });
      setStatus("Saved. Harness discovery has been refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-page">
      <section className="settings-panel">
        <div>
          <p>OpenCode</p>
          <h3>Executable path</h3>
        </div>
        <div className="settings-control">
          <label>
            Path
            <input
              placeholder="/opt/homebrew/bin/opencode"
              value={opencodePath}
              onChange={(event) => setOpencodePath(event.target.value)}
            />
          </label>
          <button type="button" disabled={isSaving} onClick={() => void saveSettings()}>
            {isSaving ? "Saving" : "Save"}
          </button>
        </div>
        <div className="settings-control single-control">
          <label>
            Default model
            <input
              list="settings-opencode-model-options"
              placeholder="featherless/zai-org/GLM-5.2"
              value={opencodeModel}
              onChange={(event) => setOpencodeModel(event.target.value)}
            />
            <datalist id="settings-opencode-model-options">
              <option value="featherless/zai-org/GLM-5.2" />
            </datalist>
          </label>
        </div>
        <p className="settings-help">
          Use the path returned by `which opencode` in your normal terminal. If left
          blank, Artemis falls back to PATH discovery. The model should use the
          OpenCode `provider/model` form.
        </p>
        <div className="settings-state">
          <span className={`health health-${opencodeHarness?.health ?? "missing"}`}>
            {healthLabel[opencodeHarness?.health ?? "missing"]}
          </span>
          <code>{opencodeHarness?.executablePath ?? "No OpenCode executable configured"}</code>
        </div>
        {status ? <p className="settings-status">{status}</p> : null}
      </section>

      <div className="inventory-grid">
        <InventoryPanel title="Harnesses">
          {inventory.harnesses.map((harness) => (
            <AssetRow
              detail={[
                `${harness.command}${harness.version ? ` - ${harness.version}` : ""}`,
                harness.executablePath ?? `source: ${harness.source}`,
                harness.workspaceMentions && harness.workspaceMentions.length > 0
                  ? `mentioned in ${harness.workspaceMentions.slice(0, 2).join(", ")}`
                  : ""
              ]
                .filter(Boolean)
                .join(" / ")}
              health={harness.health}
              key={harness.id}
              title={harness.label}
            />
          ))}
        </InventoryPanel>

        <InventoryPanel title="Skills">
          {inventory.skills.map((skill) => (
            <AssetRow
              detail={`${skill.scope} - ${skill.path}`}
              health={skill.health}
              key={skill.id}
              title={skill.name}
            />
          ))}
        </InventoryPanel>

        <InventoryPanel title="MCP Servers">
          {inventory.mcpServers.map((server) => (
            <AssetRow
              detail={`${server.ownerTool} - ${server.transport}`}
              health={server.health}
              key={server.id}
              title={server.name}
            />
          ))}
        </InventoryPanel>

        <InventoryPanel title="Providers">
          {inventory.providers.map((provider) => (
            <AssetRow
              detail={provider.envVar}
              health={provider.health}
              key={provider.id}
              title={provider.name}
            />
          ))}
        </InventoryPanel>
      </div>
    </div>
  );
}

function InventoryPanel({
  children,
  title
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <article className="inventory-panel">
      <h3>{title}</h3>
      <div className="asset-list">{children}</div>
    </article>
  );
}

function AssetRow({
  detail,
  health,
  title
}: {
  detail: string;
  health: AssetHealth;
  title: string;
}) {
  return (
    <div className="asset-row">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <span className={`health health-${health}`}>{healthLabel[health]}</span>
    </div>
  );
}
