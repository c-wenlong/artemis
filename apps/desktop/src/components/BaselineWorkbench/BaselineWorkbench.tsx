import { useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type {
  AgentSessionSummary,
  AssetInventorySnapshot,
  ChatBlock,
  ChatMessage,
  ChatSession,
  ChatTurnResult,
  CreateChatSessionRequest,
  HarnessAsset,
  ProjectRef,
  ReviewSnapshot,
  RuntimeSettings,
  SendChatMessageRequest,
  WorkspaceSummary
} from "@artemis/core";
import "./BaselineWorkbench.css";

interface BaselineWorkbenchProps {
  inventory: AssetInventorySnapshot;
  projects: ProjectRef[];
  review: ReviewSnapshot | null;
  selectedWorkspace: WorkspaceSummary | null;
  settings: RuntimeSettings;
  sessions: AgentSessionSummary[];
  workspaces: WorkspaceSummary[];
  onCreateChatSession(request: CreateChatSessionRequest): Promise<ChatSession>;
  onOpenProjects(): void;
  onOpenSettings(): void;
  onSelectWorkspace(workspaceId: string): void;
  onSendChatMessage(
    sessionId: string,
    request: SendChatMessageRequest
  ): Promise<ChatTurnResult>;
}

const preferredHarnessOrder = ["opencode", "pi", "codex", "claude", "amp", "gemini"];

export function BaselineWorkbench({
  inventory,
  projects,
  review,
  selectedWorkspace,
  settings,
  sessions,
  workspaces,
  onCreateChatSession,
  onOpenProjects,
  onOpenSettings,
  onSelectWorkspace,
  onSendChatMessage
}: BaselineWorkbenchProps) {
  const [leftWidth, setLeftWidth] = useState(214);
  const [rightWidth, setRightWidth] = useState(332);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(settings.opencodeDefaultModel ?? "");
  const [startPath, setStartPath] = useState(".");
  const [selectedHarnessId, setSelectedHarnessId] = useState("opencode");
  const [isRunning, setIsRunning] = useState(false);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const chatHarnesses = useMemo(
    () => orderedLaunchHarnesses(chatSelectableHarnesses(inventory.harnesses)),
    [inventory.harnesses]
  );
  const selectedHarness =
    chatHarnesses.find((harness) => harness.id === selectedHarnessId) ??
    chatHarnesses.find((harness) => harness.id === "opencode") ??
    chatHarnesses[0] ??
    null;
  const selectedProject = selectedWorkspace
    ? projects.find((project) => project.id === selectedWorkspace.projectId) ?? null
    : projects[0] ?? null;
  const workspaceSessions = selectedWorkspace
    ? sessions.filter((session) => session.workspaceId === selectedWorkspace.id)
    : sessions;
  const changedFiles = review?.files ?? [];
  const activePrState =
    changedFiles.length > 0 ? "local changes ready for PR" : "no PR candidate yet";

  useEffect(() => {
    setChatSession(null);
    setMessages([]);
  }, [selectedWorkspace?.id, selectedHarness?.id, model]);

  useEffect(() => {
    setModel(settings.opencodeDefaultModel ?? "");
  }, [settings.opencodeDefaultModel]);

  function beginResize(
    side: "left" | "right",
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;

    function handlePointerMove(moveEvent: PointerEvent) {
      const delta =
        side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const nextWidth = Math.min(440, Math.max(176, startWidth + delta));
      if (side === "left") {
        setLeftWidth(nextWidth);
      } else {
        setRightWidth(nextWidth);
      }
    }

    function stopResize() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isRunning) return;

    if (!selectedWorkspace || !selectedHarness) {
      appendLocalError("Select a workspace and an agent before sending a message.");
      return;
    }

    const optimistic = userMessage({
      prompt,
      sessionId: chatSession?.id ?? "pending",
      turnId: `local-${Date.now()}`
    });
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setIsRunning(true);

    try {
      const activeSession =
        chatSession ??
        (await onCreateChatSession({
          harnessId: selectedHarness.id,
          model: model.trim() || undefined,
          startPath: startPath || ".",
          title: prompt.slice(0, 48),
          workspaceId: selectedWorkspace.id,
          workspacePath: selectedWorkspace.worktreePath
        }));
      setChatSession(activeSession);

      const result = await onSendChatMessage(activeSession.id, {
        prompt,
        startPath: startPath || "."
      });
      setChatSession(result.session);
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimistic.id),
        ...result.messages
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((current) => [
        ...current.filter((entry) => entry.id !== optimistic.id),
        optimistic,
        assistantErrorMessage({
          message,
          sessionId: chatSession?.id ?? "failed",
          turnId: optimistic.turnId
        })
      ]);
    } finally {
      setIsRunning(false);
    }
  }

  function appendLocalError(message: string) {
    setMessages((current) => [
      ...current,
      assistantErrorMessage({
        message,
        sessionId: chatSession?.id ?? "local",
        turnId: `local-${Date.now()}`
      })
    ]);
  }

  return (
    <div
      className="baseline-workbench"
      style={
        {
          "--workbench-left": `${leftWidth}px`,
          "--workbench-right": `${rightWidth}px`
        } as CSSProperties
      }
    >
      <aside className="workspace-rail" aria-label="Workspace navigation">
        <div className="rail-title">
          <div>
            <span>project</span>
            <strong>{selectedProject?.name ?? "No project"}</strong>
          </div>
          <button type="button" onClick={onOpenProjects}>
            Open
          </button>
        </div>

        <section className="rail-block">
          <h3>Worktrees</h3>
          <div className="compact-list">
            {workspaces.map((workspace) => (
              <button
                className={workspace.id === selectedWorkspace?.id ? "active" : ""}
                key={workspace.id}
                type="button"
                onClick={() => onSelectWorkspace(workspace.id)}
              >
                <strong>{workspace.name}</strong>
                <span>{workspace.branch}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rail-block">
          <h3>Chats</h3>
          <div className="compact-list">
            {chatSession ? (
              <button className="active" type="button">
                <strong>{chatSession.title}</strong>
                <span>{chatSession.harnessId} / {chatSession.status}</span>
              </button>
            ) : workspaceSessions.length > 0 ? (
              workspaceSessions.map((session) => (
                <button key={session.id} type="button">
                  <strong>{session.title}</strong>
                  <span>{session.harness} / {session.status}</span>
                </button>
              ))
            ) : (
              <p className="empty-copy">No saved sessions in this worktree.</p>
            )}
          </div>
        </section>
      </aside>

      <button
        aria-label="Resize worktree sidebar"
        className="workbench-resizer resizer-left"
        type="button"
        onPointerDown={(event) => beginResize("left", event)}
      />

      <main className="workbench-main">
        <section className="chat-workspace" aria-label="Agent chat">
          <header className="chat-topline">
            <div>
              <span>chat</span>
              <strong>{selectedWorkspace?.name ?? "Choose a worktree"}</strong>
            </div>
            <div className="launch-controls">
              <label>
                <span>agent</span>
                <select
                  value={selectedHarness?.id ?? ""}
                  onChange={(event) => setSelectedHarnessId(event.target.value)}
                >
                  {chatHarnesses.map((harness) => (
                    <option key={harness.id} value={harness.id}>
                      {harness.label}
                      {harness.health === "ready" ? "" : ` (${harness.health})`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>model</span>
                <input
                  list="opencode-model-options"
                  placeholder="provider/model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
                <datalist id="opencode-model-options">
                  <option value="featherless/zai-org/GLM-5.2" />
                </datalist>
              </label>
              <label>
                <span>start</span>
                <input
                  value={startPath}
                  onChange={(event) => setStartPath(event.target.value)}
                />
              </label>
            </div>
          </header>

          <div className="message-stream">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <strong>OpenCode chat is ready to receive a task.</strong>
                <span>
                  Terminal output stays behind the runtime boundary; only parsed
                  messages, thinking, and tool activity show here.
                </span>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`message-line message-${message.role}`}
                  key={message.id}
                >
                  <span>{message.role === "assistant" ? "agent" : "user"}</span>
                  <div className="message-blocks">
                    {message.blocks.map((block) => (
                      <ChatBlockView block={block} key={block.id} />
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>

          <form className="cli-composer" onSubmit={submitTask}>
            <span>$</span>
            <textarea
              aria-label="Task prompt"
              placeholder={`send task to ${selectedHarness?.command ?? "opencode"}...`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" disabled={isRunning}>
              {isRunning ? "Running" : "Run"}
            </button>
          </form>
        </section>
      </main>

      <button
        aria-label="Resize inspector"
        className="workbench-resizer resizer-right"
        type="button"
        onPointerDown={(event) => beginResize("right", event)}
      />

      <aside className="inspector-rail" aria-label="Worktree and PR inspector">
        <section className="inspector-block">
          <div className="inspector-heading">
            <h3>Worktree</h3>
            <span>{selectedWorkspace?.status ?? "none"}</span>
          </div>
          <dl className="fact-grid">
            <div>
              <dt>branch</dt>
              <dd>{selectedWorkspace?.branch ?? "-"}</dd>
            </div>
            <div>
              <dt>changed</dt>
              <dd>{selectedWorkspace?.changedFileCount ?? 0}</dd>
            </div>
            <div>
              <dt>path</dt>
              <dd>{selectedWorkspace?.worktreePath ?? "-"}</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-block">
          <div className="inspector-heading">
            <h3>PRs</h3>
            <span>{activePrState}</span>
          </div>
          <div className="pr-summary">
            <strong>{review ? `${review.files.length} changed files` : "review not loaded"}</strong>
            <span>
              {review ? `compare ${selectedWorkspace?.branch ?? "-"} -> ${review.baseBranch}` : "open a worktree to inspect diffs"}
            </span>
          </div>
          <div className="changed-file-list">
            {changedFiles.length > 0 ? (
              changedFiles.slice(0, 8).map((file) => (
                <div className="changed-file-row" key={file.path}>
                  <span>{file.kind}</span>
                  <strong>{file.path}</strong>
                  <code>+{file.additions} -{file.deletions}</code>
                </div>
              ))
            ) : (
              <p className="empty-copy">No local file changes yet.</p>
            )}
          </div>
        </section>

        <section className="inspector-block">
          <div className="inspector-heading">
            <h3>Runtime</h3>
            <button type="button" onClick={onOpenSettings}>
              Settings
            </button>
          </div>
          <div className="runtime-list">
            <span>{chatHarnesses.filter((harness) => harness.health === "ready").length} ready harnesses</span>
            <span>{inventory.skills.length} skills indexed</span>
            <span>{inventory.mcpServers.length} MCP servers</span>
          </div>
        </section>
      </aside>
    </div>
  );
}

function ChatBlockView({ block }: { block: ChatBlock }) {
  if (block.type === "reasoning") {
    return (
      <details className="chat-block reasoning-block">
        <summary>thinking</summary>
        <pre>{block.text}</pre>
      </details>
    );
  }
  if (block.type === "tool_call") {
    return (
      <div className={`chat-block tool-block tool-${block.status}`}>
        <strong>{block.name}</strong>
        <span>{block.status}</span>
        {block.input ? <code>{block.input}</code> : null}
        {block.output ? <pre>{block.output}</pre> : null}
      </div>
    );
  }
  if (block.type === "error") {
    return (
      <div className="chat-block error-block">
        <pre>{block.message}</pre>
      </div>
    );
  }
  return (
    <div className="chat-block text-block">
      <pre>{block.text}</pre>
    </div>
  );
}

function chatSelectableHarnesses(harnesses: HarnessAsset[]): HarnessAsset[] {
  const selected = new Map<string, HarnessAsset>();
  const opencode = harnesses.find((harness) => harness.id === "opencode");
  if (opencode) selected.set(opencode.id, opencode);
  for (const harness of harnesses) {
    if (harness.health === "ready") selected.set(harness.id, harness);
  }
  return [...selected.values()];
}

function orderedLaunchHarnesses(harnesses: HarnessAsset[]): HarnessAsset[] {
  const rank = new Map(
    preferredHarnessOrder.map((harnessId, index) => [harnessId, index])
  );
  return [...harnesses].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? preferredHarnessOrder.length;
    const rightRank = rank.get(right.id) ?? preferredHarnessOrder.length;
    return leftRank - rightRank || left.label.localeCompare(right.label);
  });
}

function userMessage({
  prompt,
  sessionId,
  turnId
}: {
  prompt: string;
  sessionId: string;
  turnId: string;
}): ChatMessage {
  return {
    blocks: [
      {
        id: `${turnId}-user-text`,
        status: "completed",
        text: prompt,
        type: "text"
      }
    ],
    createdAt: new Date().toISOString(),
    id: `${turnId}-user`,
    role: "user",
    sessionId,
    turnId
  };
}

function assistantErrorMessage({
  message,
  sessionId,
  turnId
}: {
  message: string;
  sessionId: string;
  turnId: string;
}): ChatMessage {
  return {
    blocks: [
      {
        id: `${turnId}-error`,
        message,
        status: "errored",
        type: "error"
      }
    ],
    createdAt: new Date().toISOString(),
    id: `${turnId}-assistant-error`,
    role: "assistant",
    sessionId,
    turnId
  };
}
