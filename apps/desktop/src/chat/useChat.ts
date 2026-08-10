import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSession, WorkspaceSummary } from "@artemis/core";
import type { ArtemisHostClient } from "@artemis/host-service/client";
import { emptyTranscript, reduceEvents, type Transcript } from "./reduce";

interface UseChatOptions {
  host: ArtemisHostClient;
  workspace: WorkspaceSummary | null;
  harnessId: string | null;
  model: string;
}

export interface ChatController {
  transcript: Transcript;
  isRunning: boolean;
  /** Non-null once a turn has failed to start; cleared on the next send. */
  error: string | null;
  send(prompt: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Owns one chat session per workspace and folds its event stream into a
 * transcript.
 *
 * The session is created lazily on first send — creating one on mount would
 * spawn a session for every workspace the user merely clicked through. On
 * mount it replays whatever the host recorded, so reopening shows the turn that
 * ran rather than an empty pane.
 */
export function useChat({
  host,
  workspace,
  harnessId,
  model
}: UseChatOptions): ChatController {
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);

  // A workspace change is a different conversation: resolve that workspace's
  // session and rebuild from whatever it recorded.
  //
  // The session is resolved here rather than lazily on first send because the
  // event log is keyed by session id — replaying under any other key (the
  // workspace id, say) silently finds nothing. Creating a session is an
  // in-memory lookup that starts no process, and it is idempotent per
  // workspace, so doing it on selection costs nothing.
  useEffect(() => {
    let active = true;
    sessionRef.current = null;
    setTranscript(emptyTranscript());
    setRunning(false);
    setError(null);

    if (!workspace || !harnessId) return;

    void (async () => {
      try {
        const session = await host.createChatSession({
          harnessId,
          model: model || undefined,
          workspaceId: workspace.id,
          workspacePath: workspace.worktreePath
        });
        if (!active) return;
        sessionRef.current = session;

        const recorded = await host.replayChatSession(session.id);
        if (active && recorded.length > 0) {
          setTranscript(reduceEvents(emptyTranscript(), recorded));
        }
      } catch {
        // A missing or unreadable log is not worth surfacing: the session
        // simply starts empty.
      }
    })();

    return () => {
      active = false;
    };
    // `model` is deliberately not a dependency: changing the model mid-session
    // must not discard the transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessId, host, workspace]);

  const send = useCallback(
    async (prompt: string) => {
      if (!workspace || !harnessId || isRunning) return;
      setError(null);
      setRunning(true);

      try {
        if (!sessionRef.current) {
          sessionRef.current = await host.createChatSession({
            harnessId,
            model: model || undefined,
            workspaceId: workspace.id,
            workspacePath: workspace.worktreePath
          });
        }

        await host.streamChatMessage(sessionRef.current.id, { prompt }, (events) => {
          setTranscript((current) => reduceEvents(current, events));
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setRunning(false);
      }
    },
    [harnessId, host, isRunning, model, workspace]
  );

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    await host.cancelChatTurn(session.id);
  }, [host]);

  return { transcript, isRunning, error, send, stop };
}
