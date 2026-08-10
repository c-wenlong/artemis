# Artemis UI Direction

Reference snapshot: 2026-08-10. Sources: live Superset (v-current, running locally),
Traycer `clients/gui-app` source at `047b28f`, and the existing Artemis prototype.

## The thesis

Artemis is not a terminal launcher with a GUI bolted on. Its reason to exist is
**rendering the agent's work as structured UI** — typed blocks with their own
affordances — instead of dumping a PTY into a pane. Superset does both and leans
host/workspace. Traycer commits hardest to the rendered-message model. Artemis
should take Traycer's rendering model and Superset's shell.

Everything below serves that.

## What's wrong with the current prototype

The prototype reads as a settings screen, not a cockpit:

- **Light, flat, low-contrast.** Every surface is the same near-white. Nothing
  recedes, so nothing can stand out. Both references are near-black with layered
  elevation and use color only for state.
- **Five equal-weight nav sections** (Workbench / Projects / Chat / Review /
  Settings) imply five equal destinations. In both references the conversation
  *is* the app; everything else is chrome around it.
- **The message surface is an empty placeholder.** The one differentiating
  surface is the least developed thing in the build.
- **Inventory is presented as inventory** — a two-column list of harnesses and
  skills with "Ready" pills. It's a report, not a control surface.

## Superset — what to take

From the running app:

**Shell.** Fixed left rail (~260px, darker than content), scrollable center
conversation, optional right dock for the terminal. The rail carries:
Home/Code segmented toggle → primary actions (New, Artifacts, Routines,
Customize) → **Pinned** workspaces → repo groups, each collapsible with its own
`+`. Account pill sits at the bottom.

**Workspace status as a dot, not a badge.** A filled/hollow/ringed dot before
each workspace name in the rail. Idle, running, and needs-attention are legible
in peripheral vision without reading a word. Artemis currently spends a whole
"Ready" pill on the same information.

**The tool-call collapse.** This is the single most important detail. Tool work
renders as a one-line clickable summary in the prose flow:

```
Checked which domain source actually shields  ›
Ran 3 commands, used 2 tools                  ›
Committed and installed to device             ›
```

Past-tense, human-readable, chevron to expand. The transcript reads as an
engineer's write-up with the mechanics folded away — not a log.

**Composer as a status bar.** Above the input: repo · branch · live diffstat
(`+3,414 −122`) · `Create PR`. Below it: model (`Opus 5 · Fast`), effort
(`High`), `Auto` chip, attach, mic. The composer is where run context lives, so
you never leave the conversation to see state or ship.

**Terminal is a dock, not the主 surface.** Right-side panel, tabbed, closable.
Present for when you need it, never the thing you read.

## Traycer — the architecture to copy

Traycer's `clients/gui-app/src/components/chat/` is the most direct blueprint
available, and it's on disk. The model is **typed segments**.

`chat-message-assistant-body.tsx` dispatches over a `MessageSegment` union to
~19 renderers in `segments/`:

| Segment | Renders as |
|---|---|
| `text` | Markdown prose (the answer) |
| `reasoning` | Collapsed thinking |
| `tool` / `command` | Collapsible card with input panel + output |
| `file_change` / `file_change_group` | Diff rows with revert affordance |
| `plan` / `todo` | Checklists, pinnable |
| `subagent` | Nested run with its own avatar |
| `artifact_card` | Produced-artifact card |
| `approval` / `interview` | Inline prompts that block the turn |
| `error` / `compaction` / `provider_notice` | System states |

Two shared primitives carry all of them (`segments/segment-card.tsx`,
`segments/segment-row.tsx`), and the design rules inside them are worth adopting
verbatim:

- **`SegmentCard`** — bordered chip→card for top-level segments. Three tones
  only: `default` (`border-border/40 bg-muted/30`), `destructive`, `primary`.
- **`SegmentRow`** — no border, no background, for *nested* activity. Hierarchy
  comes from the parent, not from stacking more boxes.
- **The entire header is the click target.** No separate disclosure button.
- **`expandable: false`** for segments whose header already says everything.
  A tool call whose summary captures the whole input gets no chevron — the
  chevron-width spacer keeps it aligned with its siblings.
- **Sticky headers go opaque when open** (`bg-background`), because a
  translucent sticky header lets scrolled content bleed through it.

And `chat-activity-groups.ts` does the grouping that produces Superset's
"Ran 3 commands, used 2 tools": consecutive operational segments (tool, command,
file-change, subagent, approval) collapse into one `ActivityGroupModel` with a
`label`, a `summary`, and an `activeStartedAt` that drives an elapsed heartbeat
on the collapsed header. **Reasoning is deliberately promoted out of the group**
and rendered inline — activity groups carry only operational work.

Note also `working-verb.ts`, `context-usage-chip.tsx`, and
`scroll-to-bottom-chip.tsx` — small touches that make a streaming surface feel
alive.

## Cursor

Not captured. The Mobbin link wouldn't finish loading in Chrome (>45s to
document-idle, twice). Worth a second pass — Cursor's inline-diff review and its
file-mention chips are the two things worth stealing there specifically.

## What this means for Artemis

The good news: **`packages/core/src/chat/types.ts` is already segment-shaped.**
There's a `RuntimeEvent` stream (`text.delta`, `reasoning.delta`,
`tool_call.started/completed/errored`, `turn.*`) folding into `ChatBlock[]` per
`ChatMessage`. That is Traycer's model with a smaller vocabulary. The gap is
rendering, not architecture.

Concretely, in priority order:

1. **Widen `ChatBlock`.** Four kinds today (`text`, `reasoning`, `tool_call`,
   `error`). The high-value additions, in order: `file_change`, `todo`/`plan`,
   `command` (split from generic `tool_call`), `artifact`.
2. **Build the two primitives first** — `SegmentCard` and `SegmentRow` — then
   write renderers against them. Every block kind gets a renderer; no block kind
   renders as raw text.
3. **Add activity grouping** over consecutive tool/command blocks, with a
   past-tense summary line and an elapsed heartbeat while active.
4. **Stream.** `sendChatMessage` is currently request/response — it returns
   `ChatTurnResult` with the whole turn. The `RuntimeEvent` types exist to be
   streamed; the renderer needs deltas to feel like the references. This likely
   forces the host out of Vite middleware (SSE or WebSocket), which is on the
   roadmap anyway.
5. **Re-shell around the conversation.** Collapse the five sections: rail
   (projects → workspaces with status dots) + conversation + optional terminal
   dock. Review becomes a segment type and a diffstat in the composer bar, not a
   destination. Settings becomes a modal. Inventory moves into the launcher —
   you pick a harness where you start a run, not in a catalog screen.
6. **Go dark, with layered elevation.** Near-black base, one step up for cards,
   one more for popovers. Color reserved for state: running, needs-attention,
   error, diff add/remove.

## Open questions

- Does Artemis render one conversation per workspace, or many (Traycer forks and
  nests subagents; Superset pins several workspaces at once)?
- Terminal dock at all in v1, or fully committed to rendered messages?
- Does the harness abstraction survive contact with rendering? Only opencode
  emits parseable JSON today; Claude/Codex/Gemini would each need an adapter to
  produce `RuntimeEvent`s, or they degrade to a terminal pane.
