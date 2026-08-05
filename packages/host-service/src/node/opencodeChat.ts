import type {
  ChatBlock,
  ChatMessage,
  ChatRuntime,
  ChatSession,
  ChatTurnResult,
  CreateChatSessionRequest,
  HarnessAsset,
  RuntimeEvent,
  SendChatMessageRequest
} from "@artemis/core";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

interface NodeChatRuntimeOptions {
  resolveHarnesses(): HarnessAsset[];
}

interface ParsedPart {
  id: string;
  input?: string;
  name?: string;
  output?: string;
  status?: "started" | "completed" | "errored";
  text?: string;
  type: "text" | "reasoning" | "tool";
}

interface EventContext {
  session: ChatSession;
  turnId: string;
}

export function createNodeChatRuntime({
  resolveHarnesses
}: NodeChatRuntimeOptions): ChatRuntime {
  const sessions = new Map<string, ChatSession>();

  return {
    async createChatSession(
      request: CreateChatSessionRequest
    ): Promise<ChatSession> {
      const now = new Date().toISOString();
      const harness = resolveHarnesses().find(
        (candidate) => candidate.id === request.harnessId
      );
      const session: ChatSession = {
        createdAt: now,
        harnessId: request.harnessId,
        harnessKind: harness?.kind,
        id: `chat-${randomUUID()}`,
        lastEventAt: now,
        model: request.model,
        opencodeSessionId: request.opencodeSessionId,
        startPath: request.startPath,
        status: "idle",
        title: request.title ?? "OpenCode session",
        workspaceId: request.workspaceId,
        workspacePath: request.workspacePath
      };
      sessions.set(session.id, session);
      return session;
    },

    async sendChatMessage(
      sessionId: string,
      request: SendChatMessageRequest
    ): Promise<ChatTurnResult> {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Unknown chat session: ${sessionId}`);
      }
      const result = await runOpenCodeTurn({
        harnesses: resolveHarnesses(),
        request,
        session
      });
      sessions.set(result.session.id, result.session);
      return result;
    }
  };
}

async function runOpenCodeTurn({
  harnesses,
  request,
  session
}: {
  harnesses: HarnessAsset[];
  request: SendChatMessageRequest;
  session: ChatSession;
}): Promise<ChatTurnResult> {
  const prompt = request.prompt.trim();
  const turnId = `turn-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const context = { session, turnId };
  const events: RuntimeEvent[] = [
    {
      harnessId: session.harnessId,
      id: `event-${randomUUID()}`,
      sessionId: session.id,
      timestamp: startedAt,
      turnId,
      type: "turn.started",
      workspaceId: session.workspaceId
    },
    {
      id: `event-${randomUUID()}`,
      sessionId: session.id,
      text: prompt,
      timestamp: startedAt,
      turnId,
      type: "user.message"
    }
  ];
  const startedSession: ChatSession = {
    ...session,
    lastEventAt: startedAt,
    startPath: request.startPath ?? session.startPath,
    status: "running"
  };

  const harness = harnesses.find((candidate) => candidate.id === session.harnessId);
  if (!harness || harness.kind !== "opencode") {
    return finishErroredTurn({
      context: { session: startedSession, turnId },
      events,
      message: "This chat backend currently supports OpenCode only."
    });
  }
  if (harness.health !== "ready" || !harness.executablePath) {
    return finishErroredTurn({
      context: { session: startedSession, turnId },
      events,
      message: "OpenCode is not installed or not on PATH."
    });
  }

  const cwd = resolve(startedSession.workspacePath, request.startPath ?? session.startPath ?? ".");
  if (!isDirectory(cwd)) {
    return finishErroredTurn({
      context: { session: startedSession, turnId },
      events,
      message: `Start path does not exist or is not a directory: ${cwd}`
    });
  }

  const args = [
    "run",
    "--format",
    "json",
    "--thinking",
    "--dir",
    cwd,
    ...(startedSession.model ? ["--model", startedSession.model] : []),
    ...(startedSession.opencodeSessionId
      ? ["--session", startedSession.opencodeSessionId]
      : []),
    prompt
  ];
  const parser = new OpenCodeRuntimeParser(context);

  const runResult = await runJsonCommand({
    args,
    command: harness.executablePath,
    cwd,
    onLine(line) {
      events.push(...parser.parseLine(line));
    }
  });

  const completedAt = new Date().toISOString();
  const opencodeSessionId = parser.observedSessionId ?? startedSession.opencodeSessionId;
  const parserErrorMessage = parser.errorMessage;
  const failed = !runResult.ok || Boolean(parserErrorMessage);
  const completedSession: ChatSession = {
    ...startedSession,
    lastEventAt: completedAt,
    opencodeSessionId,
    status: failed ? "failed" : "idle",
    title: titleForPrompt(startedSession.title, prompt)
  };

  if (!failed) {
    events.push({
      id: `event-${randomUUID()}`,
      opencodeSessionId,
      sessionId: startedSession.id,
      timestamp: completedAt,
      turnId,
      type: "turn.completed"
    });
  } else {
    events.push({
      exitCode: runResult.exitCode,
      id: `event-${randomUUID()}`,
      message: parserErrorMessage ?? runResult.errorMessage,
      sessionId: startedSession.id,
      timestamp: completedAt,
      turnId,
      type: "turn.errored"
    });
  }

  return {
    events,
    messages: messagesForTurn({
      events,
      prompt,
      sessionId: completedSession.id,
      turnId
    }),
    session: completedSession
  };
}

function finishErroredTurn({
  context,
  events,
  message
}: {
  context: EventContext;
  events: RuntimeEvent[];
  message: string;
}): ChatTurnResult {
  const now = new Date().toISOString();
  events.push({
    id: `event-${randomUUID()}`,
    message,
    sessionId: context.session.id,
    timestamp: now,
    turnId: context.turnId,
    type: "turn.errored"
  });
  const session: ChatSession = {
    ...context.session,
    lastEventAt: now,
    status: "failed"
  };
  return {
    events,
    messages: messagesForTurn({
      events,
      prompt:
        events.find((event) => event.type === "user.message")?.text ?? "",
      sessionId: session.id,
      turnId: context.turnId
    }),
    session
  };
}

function runJsonCommand({
  args,
  command,
  cwd,
  onLine
}: {
  args: string[];
  command: string;
  cwd: string;
  onLine(line: string): void;
}): Promise<{ errorMessage: string; exitCode?: number; ok: boolean }> {
  return new Promise((resolveResult) => {
    let buffer = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
        PATH: launchPath()
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        errorMessage:
          error.message.includes("ENOENT") || error.message.includes("spawn")
            ? "OpenCode is not installed or not on PATH."
            : error.message
      });
    });
    child.on("close", (exitCode) => {
      if (buffer.trim()) onLine(buffer);
      finish({
        errorMessage:
          exitCode === 0
            ? ""
            : cleanErrorText(stderr) || `OpenCode exited with code ${exitCode ?? "unknown"}.`,
        exitCode: exitCode ?? undefined
      });
    });

    function finish({
      errorMessage,
      exitCode
    }: {
      errorMessage: string;
      exitCode?: number;
    }) {
      if (settled) return;
      settled = true;
      resolveResult({
        errorMessage,
        exitCode,
        ok: !errorMessage && (exitCode === 0 || typeof exitCode === "undefined")
      });
    }
  });
}

class OpenCodeRuntimeParser {
  observedSessionId: string | undefined;
  private readonly errors: string[] = [];
  private readonly context: EventContext;
  private readonly previousTextByBlock = new Map<string, string>();
  private readonly seenToolStarts = new Set<string>();

  constructor(context: EventContext) {
    this.context = context;
  }

  get errorMessage(): string | undefined {
    return this.errors[0];
  }

  parseLine(line: string): RuntimeEvent[] {
    const parsed = parseJson(line);
    if (!parsed) return [];
    this.observedSessionId = findStringByKey(parsed, [
      "sessionID",
      "sessionId",
      "session_id"
    ]) ?? this.observedSessionId;

    const events: RuntimeEvent[] = [];
    const rawType = String(readPath(parsed, ["type"]) ?? readPath(parsed, ["event", "type"]) ?? "");
    const errorMessage = extractOpenCodeErrorMessage(parsed);
    if (errorMessage) {
      this.errors.push(errorMessage);
    }
    for (const part of extractParts(parsed, rawType)) {
      if (part.type === "text" || part.type === "reasoning") {
        if (!part.text) continue;
        const previous = this.previousTextByBlock.get(part.id) ?? "";
        const delta = part.text.startsWith(previous)
          ? part.text.slice(previous.length)
          : part.text;
        this.previousTextByBlock.set(part.id, part.text);
        if (!delta) continue;
        events.push({
          blockId: part.id,
          id: `event-${randomUUID()}`,
          sessionId: this.context.session.id,
          text: delta,
          timestamp: new Date().toISOString(),
          turnId: this.context.turnId,
          type: part.type === "reasoning" ? "reasoning.delta" : "text.delta"
        });
        continue;
      }

      const name = part.name ?? "tool";
      if (part.status === "errored") {
        events.push({
          blockId: part.id,
          id: `event-${randomUUID()}`,
          message: part.output ?? "Tool call failed.",
          name,
          sessionId: this.context.session.id,
          timestamp: new Date().toISOString(),
          turnId: this.context.turnId,
          type: "tool_call.errored"
        });
      } else if (part.status === "completed") {
        events.push({
          blockId: part.id,
          id: `event-${randomUUID()}`,
          name,
          output: part.output,
          sessionId: this.context.session.id,
          timestamp: new Date().toISOString(),
          turnId: this.context.turnId,
          type: "tool_call.completed"
        });
      } else if (!this.seenToolStarts.has(part.id)) {
        this.seenToolStarts.add(part.id);
        events.push({
          blockId: part.id,
          id: `event-${randomUUID()}`,
          input: part.input,
          name,
          sessionId: this.context.session.id,
          timestamp: new Date().toISOString(),
          turnId: this.context.turnId,
          type: "tool_call.started"
        });
      }
    }
    return events;
  }
}

function extractParts(raw: unknown, rawType: string): ParsedPart[] {
  const parts: ParsedPart[] = [];
  const candidates = collectObjects(raw).filter((value) => looksLikePart(value));
  candidates.forEach((part, index) => {
    const partType = String(part.type ?? part.kind ?? rawType).toLowerCase();
    const id = String(
      part.id ??
        part.partID ??
        part.partId ??
        part.toolCallID ??
        part.toolCallId ??
        `${rawType || "part"}-${index}`
    );
    const text = readText(part);
    if (isReasoningPart(partType)) {
      parts.push({ id, text, type: "reasoning" });
      return;
    }
    if (isToolPart(partType, rawType, part)) {
      parts.push({
        id,
        input: stringifyUnknown(part.input ?? part.args ?? part.arguments),
        name: String(part.name ?? part.tool ?? part.toolName ?? "tool"),
        output: readText(part) ?? stringifyUnknown(part.output ?? part.error),
        status: readToolStatus(partType, rawType, part),
        type: "tool"
      });
      return;
    }
    if (text) {
      parts.push({ id, text, type: "text" });
    }
  });

  if (parts.length === 0) {
    const text = readText(raw);
    if (text) {
      parts.push({
        id: rawType || "text",
        text,
        type: isReasoningPart(rawType.toLowerCase()) ? "reasoning" : "text"
      });
    }
  }
  return parts;
}

function extractOpenCodeErrorMessage(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const object = raw as Record<string, unknown>;
  const rawType = String(object.type ?? readPath(object, ["event", "type"]) ?? "");
  const maybeError = object.error ?? object.err;
  if (!rawType.toLowerCase().includes("error") && !maybeError) {
    return undefined;
  }

  const name = findStringByKey(raw, ["name"]);
  const message =
    findStringByKey(raw, ["message"]) ??
    readText(maybeError) ??
    stringifyUnknown(maybeError);
  const ref = findStringByKey(raw, ["ref", "reference"]);
  const prefix = name && name !== "Error" ? `${name}: ` : "";
  const suffix = ref ? ` (${ref})` : "";
  return message ? `${prefix}${message}${suffix}` : "OpenCode returned an error event.";
}

function messagesForTurn({
  events,
  prompt,
  sessionId,
  turnId
}: {
  events: RuntimeEvent[];
  prompt: string;
  sessionId: string;
  turnId: string;
}): ChatMessage[] {
  const createdAt = events[0]?.timestamp ?? new Date().toISOString();
  return [
    {
      blocks: [
        {
          id: `${turnId}-user-text`,
          status: "completed",
          text: prompt,
          type: "text"
        }
      ],
      createdAt,
      id: `${turnId}-user`,
      role: "user",
      sessionId,
      turnId
    },
    {
      blocks: accumulateBlocks(events),
      createdAt,
      id: `${turnId}-assistant`,
      role: "assistant",
      sessionId,
      turnId
    }
  ];
}

function accumulateBlocks(events: RuntimeEvent[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const indexById = new Map<string, number>();

  function upsert(block: ChatBlock) {
    const index = indexById.get(block.id);
    if (typeof index === "number") {
      blocks[index] = block;
    } else {
      indexById.set(block.id, blocks.length);
      blocks.push(block);
    }
  }

  for (const event of events) {
    if (event.type === "text.delta" || event.type === "reasoning.delta") {
      const existing = blocks[indexById.get(event.blockId) ?? -1];
      const type = event.type === "text.delta" ? "text" : "reasoning";
      upsert({
        id: event.blockId,
        status: "completed",
        text:
          existing && (existing.type === "text" || existing.type === "reasoning")
            ? existing.text + event.text
            : event.text,
        type
      });
    }
    if (event.type === "tool_call.started") {
      upsert({
        id: event.blockId,
        input: event.input,
        name: event.name,
        status: "running",
        type: "tool_call"
      });
    }
    if (event.type === "tool_call.completed") {
      const existing = blocks[indexById.get(event.blockId) ?? -1];
      upsert({
        id: event.blockId,
        input: existing?.type === "tool_call" ? existing.input : undefined,
        name: event.name ?? (existing?.type === "tool_call" ? existing.name : "tool"),
        output: event.output,
        status: "completed",
        type: "tool_call"
      });
    }
    if (event.type === "tool_call.errored") {
      const existing = blocks[indexById.get(event.blockId) ?? -1];
      upsert({
        id: event.blockId,
        input: existing?.type === "tool_call" ? existing.input : undefined,
        name: event.name ?? (existing?.type === "tool_call" ? existing.name : "tool"),
        output: event.message,
        status: "errored",
        type: "tool_call"
      });
    }
    if (event.type === "turn.errored") {
      upsert({
        id: `${event.turnId}-error`,
        message: event.message,
        status: "errored",
        type: "error"
      });
    }
  }

  if (blocks.length === 0) {
    blocks.push({
      id: "empty-response",
      message: "OpenCode completed without a chat response.",
      status: "errored",
      type: "error"
    });
  }
  return blocks;
}

function looksLikePart(value: Record<string, unknown>): boolean {
  return Boolean(
    value.type ||
      value.kind ||
      value.text ||
      value.content ||
      value.output ||
      value.tool ||
      value.toolName
  );
}

function collectObjects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  const object = value as Record<string, unknown>;
  const nested = Object.values(object).flatMap(collectObjects);
  return [object, ...nested];
}

function readText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const direct = object.text ?? object.content ?? object.markdown ?? object.message;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return direct.map(readText).filter(Boolean).join("");
  return undefined;
}

function readToolStatus(
  partType: string,
  rawType: string,
  part: Record<string, unknown>
): "started" | "completed" | "errored" {
  const status = String(part.status ?? part.state ?? rawType ?? partType).toLowerCase();
  if (status.includes("error") || status.includes("failed")) return "errored";
  if (
    status.includes("after") ||
    status.includes("complete") ||
    status.includes("result") ||
    status.includes("finished")
  ) {
    return "completed";
  }
  return "started";
}

function isReasoningPart(type: string): boolean {
  return type.includes("reasoning") || type.includes("thinking") || type.includes("thought");
}

function isToolPart(
  type: string,
  rawType: string,
  part: Record<string, unknown>
): boolean {
  const eventType = rawType.toLowerCase();
  return Boolean(
    type.includes("tool") ||
      eventType.includes("tool") ||
      part.tool ||
      part.toolName ||
      part.args ||
      part.arguments
  );
}

function findStringByKey(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof object[key] === "string") return object[key] as string;
  }
  for (const item of Object.values(object)) {
    const found = findStringByKey(item, keys);
    if (found) return found;
  }
  return undefined;
}

function parseJson(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "undefined" || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function titleForPrompt(currentTitle: string, prompt: string): string {
  if (currentTitle && currentTitle !== "OpenCode session") return currentTitle;
  return prompt.replace(/\s+/g, " ").trim().slice(0, 48) || "OpenCode session";
}

function cleanErrorText(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
}

function launchPath(): string {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Users/example/.local/bin",
    process.env.PATH ?? ""
  ]
    .filter(Boolean)
    .join(":");
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}
