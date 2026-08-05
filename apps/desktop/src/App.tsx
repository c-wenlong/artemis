import { useEffect, useMemo, useState } from "react";
import type {
  AgentSessionSummary,
  AssetInventorySnapshot,
  CreateChatSessionRequest,
  ProjectRef,
  ReviewSnapshot,
  RuntimeSettings,
  SendChatMessageRequest,
  WorkspaceSummary
} from "@artemis/core";
import { createHttpHostClient } from "@artemis/host-service/client";
import { AppShell, type AppSection } from "./components/AppShell/AppShell";
import { AssetInventory } from "./components/AssetInventory/AssetInventory";
import { BaselineWorkbench } from "./components/BaselineWorkbench/BaselineWorkbench";
import { ProjectLauncher } from "./components/ProjectLauncher/ProjectLauncher";
import { ReviewSurface } from "./components/ReviewSurface/ReviewSurface";

interface ArtemisData {
  inventory: AssetInventorySnapshot | null;
  projects: ProjectRef[];
  settings: RuntimeSettings;
  workspaces: WorkspaceSummary[];
  sessions: AgentSessionSummary[];
  review: ReviewSnapshot | null;
}

const initialData: ArtemisData = {
  inventory: null,
  projects: [],
  settings: {},
  workspaces: [],
  sessions: [],
  review: null
};

export function App() {
  const hostService = useMemo(() => createHttpHostClient(), []);
  const [activeSection, setActiveSection] = useState<AppSection>("workbench");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null
  );
  const [data, setData] = useState<ArtemisData>(initialData);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      const [inventory, projects, workspaces, sessions] = await Promise.all([
        hostService.getSnapshot(),
        hostService.listProjects(),
        hostService.listWorkspaces(),
        hostService.listSessions()
      ]);
      const settings = await hostService.getRuntimeSettings();
      const selected = selectedWorkspaceId ?? workspaces[0]?.id ?? null;
      const review = selected ? await hostService.getReviewSnapshot(selected) : null;

      if (!isMounted) return;

      setSelectedWorkspaceId(selected);
      setData({ inventory, projects, settings, workspaces, sessions, review });
      setIsLoading(false);
    }

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [hostService, selectedWorkspaceId]);

  const selectedWorkspace =
    data.workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
    data.workspaces[0] ??
    null;

  return (
    <AppShell
      activeSection={activeSection}
      isLoading={isLoading}
      onSectionChange={setActiveSection}
      projects={data.projects}
      selectedWorkspace={selectedWorkspace}
      sessions={data.sessions}
      workspaces={data.workspaces}
    >
      {(activeSection === "workbench" || activeSection === "chat") && data.inventory ? (
        <BaselineWorkbench
          inventory={data.inventory}
          projects={data.projects}
          review={data.review}
          selectedWorkspace={selectedWorkspace}
          settings={data.settings}
          sessions={data.sessions}
          workspaces={data.workspaces}
          onCreateChatSession={(request: CreateChatSessionRequest) =>
            hostService.createChatSession(request)
          }
          onSendChatMessage={(sessionId: string, request: SendChatMessageRequest) =>
            hostService.sendChatMessage(sessionId, request)
          }
          onOpenProjects={() => setActiveSection("projects")}
          onOpenSettings={() => setActiveSection("settings")}
          onSelectWorkspace={setSelectedWorkspaceId}
        />
      ) : null}
      {activeSection === "projects" ? (
        <ProjectLauncher
          projects={data.projects}
          selectedWorkspaceId={selectedWorkspaceId}
          sessions={data.sessions}
          workspaces={data.workspaces}
          onOpenChat={() => setActiveSection("chat")}
          onSelectWorkspace={setSelectedWorkspaceId}
        />
      ) : null}
      {activeSection === "settings" && data.inventory ? (
        <AssetInventory
          inventory={data.inventory}
          settings={data.settings}
          onSaveSettings={async (settings) => {
            const savedSettings = await hostService.updateRuntimeSettings(settings);
            const inventory = await hostService.getSnapshot();
            setData((current) => ({
              ...current,
              inventory,
              settings: savedSettings
            }));
          }}
        />
      ) : null}
      {activeSection === "review" && selectedWorkspace ? (
        <ReviewSurface review={data.review} workspace={selectedWorkspace} />
      ) : null}
    </AppShell>
  );
}
