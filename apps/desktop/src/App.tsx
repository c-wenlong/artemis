import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AssetInventorySnapshot,
  ProjectRef,
  ReviewSnapshot,
  RuntimeSettings,
  WorkspaceSummary
} from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import { createHostClient } from "./host";
import { useChat } from "./chat/useChat";
import { AppShell } from "./components/AppShell/AppShell";
import { Composer } from "./components/Composer/Composer";
import { Conversation } from "./components/Conversation/Conversation";
import { Rail } from "./components/Rail/Rail";
import { SettingsDialog } from "./components/SettingsDialog/SettingsDialog";

interface AppProps {
  /** Injected in tests; production resolves the host for the current runtime. */
  host?: ArtemisHostClient;
}

interface AppData {
  inventory: AssetInventorySnapshot | null;
  projects: ProjectRef[];
  settings: RuntimeSettings;
  workspaces: WorkspaceSummary[];
}

const initialData: AppData = {
  inventory: null,
  projects: [],
  settings: {},
  workspaces: []
};

export function App({ host }: AppProps = {}) {
  const hostService = useMemo(() => host ?? createHostClient(), [host]);

  const [data, setData] = useState<AppData>(initialData);
  const [review, setReview] = useState<ReviewSnapshot | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  // Load once. The previous implementation listed `selectedWorkspaceId` as a
  // dependency, so selecting a workspace refetched the entire inventory.
  useEffect(() => {
    let active = true;

    void (async () => {
      const [inventory, projects, workspaces] = await Promise.all([
        hostService.getSnapshot(),
        hostService.listProjects(),
        hostService.listWorkspaces()
      ]);
      const settings = await hostService.getRuntimeSettings();
      if (!active) return;

      setData({ inventory, projects, settings, workspaces });
      setSelectedWorkspaceId((current) => current ?? workspaces[0]?.id ?? null);
      setModel((current) => current || (settings.opencodeDefaultModel ?? ""));
      setSelectedHarnessId((current) => {
        if (current) return current;
        const ready = inventory.harnesses.filter(
          (harness) => harness.health === "ready"
        );
        const preferred = ready.find((harness) => harness.id === "opencode");
        return preferred?.id ?? ready[0]?.id ?? null;
      });
    })();

    return () => {
      active = false;
    };
  }, [hostService]);

  // Review follows the selection on its own, so switching workspace costs one
  // request rather than a full reload.
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    let active = true;

    void (async () => {
      const snapshot = await hostService.getReviewSnapshot(selectedWorkspaceId);
      if (active) setReview(snapshot);
    })();

    return () => {
      active = false;
    };
  }, [hostService, selectedWorkspaceId]);

  const readyHarnesses = useMemo(
    () =>
      data.inventory?.harnesses.filter((harness) => harness.health === "ready") ?? [],
    [data.inventory]
  );

  const selectedWorkspace =
    data.workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;

  const selectedHarness =
    readyHarnesses.find((harness) => harness.id === selectedHarnessId) ?? null;

  const chat = useChat({
    harnessId: selectedHarnessId,
    host: hostService,
    model,
    workspace: selectedWorkspace
  });

  const handleSubmit = useCallback(
    async (prompt: string) => {
      if (!selectedWorkspace) return;
      await chat.send(prompt);
      // A turn usually changes files; refresh the diffstat so the composer bar
      // keeps telling the truth.
      setReview(await hostService.getReviewSnapshot(selectedWorkspace.id));
    },
    [chat, hostService, selectedWorkspace]
  );

  const handleSaveSettings = useCallback(
    async (next: RuntimeSettings) => {
      const saved = await hostService.updateRuntimeSettings(next);
      const inventory = await hostService.getSnapshot();
      setData((current) => ({ ...current, inventory, settings: saved }));
      if (saved.opencodeDefaultModel) setModel(saved.opencodeDefaultModel);
    },
    [hostService]
  );

  return (
    <>
      <AppShell
        composer={
          <Composer
            harnesses={readyHarnesses}
            isBusy={chat.isRunning}
            model={model}
            onModelChange={setModel}
            onSelectHarness={setSelectedHarnessId}
            onStop={() => void chat.stop()}
            onSubmit={handleSubmit}
            review={review}
            selectedHarnessId={selectedHarnessId}
            workspace={selectedWorkspace}
          />
        }
        conversation={
          <Conversation
            harnessLabel={selectedHarness?.label ?? null}
            isStreaming={chat.isRunning}
            messages={chat.transcript.messages}
            turns={chat.transcript.turns}
          />
        }
        rail={
          <Rail
            onOpenSettings={() => setSettingsOpen(true)}
            onSelectWorkspace={setSelectedWorkspaceId}
            projects={data.projects}
            selectedWorkspaceId={selectedWorkspaceId}
            workspaces={data.workspaces}
          />
        }
      />
      <SettingsDialog
        inventory={data.inventory}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        open={isSettingsOpen}
        settings={data.settings}
      />
    </>
  );
}
