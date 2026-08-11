import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FileWindow,
  AssetInventorySnapshot,
  ProjectRef,
  ReviewSnapshot,
  RuntimeSettings,
  WorkspaceSummary
} from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import { createHostClient } from "./host";
import { useChat } from "./chat/useChat";
import { useLaunchPreset } from "./chat/useLaunchPreset";
import { useTerminals } from "./chat/useTerminals";
import { AppShell } from "./components/AppShell/AppShell";
import { Composer } from "./components/Composer/Composer";
import { Conversation } from "./components/Conversation/Conversation";
import { PeekDialog } from "./components/Conversation/PeekDialog";
import { CitationProvider } from "./components/segments/CitationContext";
import { Rail } from "./components/Rail/Rail";
import {
  DeleteWorktreeDialog,
  NewWorktreeDialog
} from "./components/Rail/WorktreeDialogs";
import { SettingsDialog } from "./components/SettingsDialog/SettingsDialog";
import { TerminalDock } from "./components/Terminal/TerminalDock";

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
  const [peek, setPeek] = useState<{ line?: number; window: FileWindow } | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [newWorktreeProjectId, setNewWorktreeProjectId] = useState<string | null>(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);

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

  /**
   * Open the file a citation names. Only wired when a workspace is selected —
   * a relative path means nothing without one, so the chips stay plain text
   * until there is somewhere to resolve them against.
   */
  const openCitation = useCallback(
    (path: string, line?: number) => {
      const workspace = selectedWorkspace;
      if (!workspace) return;
      setPeekError(null);
      void hostService
        .peekFile(workspace.worktreePath, path, line)
        .then((window) => setPeek({ line, window }))
        .catch((cause: unknown) =>
          setPeekError(cause instanceof Error ? cause.message : String(cause))
        );
    },
    [hostService, selectedWorkspace]
  );

  // Harness and model come from the workspace's remembered preset.
  const preset = useLaunchPreset({
    defaultModel: data.settings.opencodeDefaultModel ?? "",
    host: hostService,
    readyHarnesses,
    workspace: selectedWorkspace
  });
  const selectedHarnessId = preset.harnessId;
  const model = preset.model;

  const selectedHarness =
    readyHarnesses.find((harness) => harness.id === selectedHarnessId) ?? null;

  const terminals = useTerminals({
    harness: selectedHarness,
    host: hostService,
    workspace: selectedWorkspace
  });

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

  const refreshWorkspaces = useCallback(async () => {
    const workspaces = await hostService.listWorkspaces();
    setData((current) => ({ ...current, workspaces }));
    return workspaces;
  }, [hostService]);

  const handleCreateWorktree = useCallback(
    async (branch: string) => {
      if (!newWorktreeProjectId) return;
      const workspace = await hostService.createWorkspace(newWorktreeProjectId, branch);
      await refreshWorkspaces();
      // Select what was just made: creating a worktree is how you start work
      // in it, so landing somewhere else would need an extra click every time.
      setSelectedWorkspaceId(workspace.id);
    },
    [hostService, newWorktreeProjectId, refreshWorkspaces]
  );

  const handleDeleteWorktree = useCallback(
    async (force: boolean) => {
      if (!deletingWorkspaceId) return;
      await hostService.deleteWorkspace(deletingWorkspaceId, force);
      const workspaces = await refreshWorkspaces();
      // The selection cannot stay on something that no longer exists.
      setSelectedWorkspaceId((current) =>
        current === deletingWorkspaceId ? (workspaces[0]?.id ?? null) : current
      );
    },
    [deletingWorkspaceId, hostService, refreshWorkspaces]
  );

  const handleSaveSettings = useCallback(
    async (next: RuntimeSettings) => {
      const saved = await hostService.updateRuntimeSettings(next);
      const inventory = await hostService.getSnapshot();
      setData((current) => ({ ...current, inventory, settings: saved }));
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
            onModelChange={preset.setModel}
            onSelectHarness={preset.setHarnessId}
            isTerminalVisible={terminals.isVisible}
            onStop={() => void chat.stop()}
            onSubmit={handleSubmit}
            onToggleTerminal={() =>
              terminals.isVisible ? terminals.hide() : void terminals.open()
            }
            review={review}
            dockOnly={selectedHarness?.supportsStreaming === false}
            selectedHarnessId={selectedHarnessId}
            workspace={selectedWorkspace}
          />
        }
        conversation={
          <CitationProvider value={selectedWorkspace ? openCitation : null}>
          <Conversation
            harnessLabel={selectedHarness?.label ?? null}
            isStreaming={chat.isRunning}
            messages={chat.transcript.messages}
            onFork={(turnId) => void chat.fork(turnId)}
            onRevert={async (file) => {
              // The host needs the worktree to run `git apply` in. Without a
              // selected workspace there is nowhere to apply it.
              if (!selectedWorkspace || !file.patch) {
                throw new Error("There is no workspace to undo this in.");
              }
              await hostService.revertFileChange(
                selectedWorkspace.worktreePath,
                file.path,
                file.patch
              );
              setReview(await hostService.getReviewSnapshot(selectedWorkspace.id));
            }}
            turns={chat.transcript.turns}
            onOpenInTerminal={
              // Absent capability means an older host; assume it streams
              // rather than pushing every harness into the dock.
              selectedHarness && selectedHarness.supportsStreaming === false
                ? () => void terminals.openNew()
                : undefined
            }
            verbosity={data.settings.transcriptVerbosity ?? "full"}
          />
          {peek ? (
            <PeekDialog
              onClose={() => setPeek(null)}
              requestedLine={peek.line}
              window={peek.window}
            />
          ) : null}
          {peekError ? (
            <p className="app-alert" role="alert">
              {peekError}
              <button onClick={() => setPeekError(null)} type="button">
                Dismiss
              </button>
            </p>
          ) : null}
          </CitationProvider>
        }
        dock={
          terminals.isVisible ? (
            <TerminalDock
              activeId={terminals.activeId}
              host={hostService}
              onClose={(id) => void terminals.close(id)}
              onHide={terminals.hide}
              onNew={() => void terminals.openNew()}
              onSelect={terminals.select}
              terminals={terminals.terminals}
            />
          ) : undefined
        }
        rail={
          <Rail
            onDeleteWorktree={setDeletingWorkspaceId}
            onNewWorktree={setNewWorktreeProjectId}
            onOpenSettings={() => setSettingsOpen(true)}
            onSelectWorkspace={setSelectedWorkspaceId}
            projects={data.projects}
            selectedWorkspaceId={selectedWorkspaceId}
            workspaces={data.workspaces}
          />
        }
      />
      {terminals.error ? (
        <p className="app-error" role="alert">
          {terminals.error}
        </p>
      ) : null}
      <NewWorktreeDialog
        onClose={() => setNewWorktreeProjectId(null)}
        onCreate={handleCreateWorktree}
        open={newWorktreeProjectId !== null}
        projectName={
          data.projects.find((project) => project.id === newWorktreeProjectId)?.name ??
          "this project"
        }
      />
      <DeleteWorktreeDialog
        onClose={() => setDeletingWorkspaceId(null)}
        onDelete={handleDeleteWorktree}
        open={deletingWorkspaceId !== null}
        workspace={
          data.workspaces.find((workspace) => workspace.id === deletingWorkspaceId) ??
          null
        }
      />
      <SettingsDialog
        host={hostService}
        inventory={data.inventory}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        open={isSettingsOpen}
        settings={data.settings}
      />
    </>
  );
}
