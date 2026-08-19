# Artemis UI Direction

Reference snapshot: 2026-08-10. Sources: live Superset running locally, Traycer
`clients/gui-app` source at `047b28f`, Mobbin's Cursor Web set, and the existing
Artemis prototype.

## The thesis

Artemis is not a terminal launcher with a GUI bolted on. Its reason to exist is
**rendering the agent's work as structured UI**: typed blocks with their own
affordances: instead of dumping a PTY into a pane. Superset does both and leans
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
- **Inventory is presented as inventory**: a two-column list of harnesses and
  skills with "Ready" pills. It's a report, not a control surface.

## Superset: what to take

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
engineer's write-up with the mechanics folded away, not a log.

**Composer as a status bar.** Above the input: repo · branch · live diffstat
(`+3,414 −122`) · `Create PR`. Below it: model (`Opus 5 · Fast`), effort
(`High`), `Auto` chip, attach, mic. The composer is where run context lives, so
you never leave the conversation to see state or ship.

**Terminal is a dock, not the主 surface.** Right-side panel, tabbed, closable.
Present for when you need it, never the thing you read.

## Traycer: the architecture to copy

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

- **`SegmentCard`**: bordered chip→card for top-level segments. Three tones
  only: `default` (`border-border/40 bg-muted/30`), `destructive`, `primary`.
- **`SegmentRow`**: no border, no background, for *nested* activity. Hierarchy
  comes from the parent, not from stacking more boxes.
- **The entire header is the click target.** No separate disclosure button.
- **`expandable: false`** for segments whose header already says everything.
  A tool call whose summary captures the whole input gets no chevron: the
  chevron-width spacer keeps it aligned with its siblings.
- **Sticky headers go opaque when open** (`bg-background`), because a
  translucent sticky header lets scrolled content bleed through it.

And `chat-activity-groups.ts` does the grouping that produces Superset's
"Ran 3 commands, used 2 tools": consecutive operational segments (tool, command,
file-change, subagent, approval) collapse into one `ActivityGroupModel` with a
`label`, a `summary`, and an `activeStartedAt` that drives an elapsed heartbeat
on the collapsed header. **Reasoning is deliberately promoted out of the group**
and rendered inline: activity groups carry only operational work.

Note also `working-verb.ts`, `context-usage-chip.tsx`, and
`scroll-to-bottom-chip.tsx`: small touches that make a streaming surface feel
alive.

## Cursor Web: the opposite philosophy

From Mobbin's Cursor Web set (293 screens). Cursor is worth studying precisely
because it *disagrees* with Traycer about what to show.

**It hides the mechanics entirely.** In the agent conversation view there are no
tool cards, no collapsed activity groups, no reasoning block: none of Traycer's
nineteen segment types. There is the prompt, then prose. Superset folds the
mechanics away behind a chevron; Cursor omits them.

**In their place: inline `file:line` citation chips.** Every claim in the answer
carries a monospace reference immediately after it:

```
2. Static resolution: Express serves from public/ (symlinked to root
   content in this repo setup). server.js:6-10  AGENTS.md:9-12

•  Root route returns HTML 200 OK. terminal:3-11
•  Missing CSS asset also returns fallback HTML 200 OK (bug candidate #1). terminal:3-10
```

Note `terminal:3-11`: even shell output is a citable range. The answer is
auditable inline without expanding anything. This is a genuinely different bet
from Traycer's: **trust through evidence rather than trust through transparency.**

**Multi-model tabs.** The turn header is three cards: `Codex 5.3 High`,
`GPT-5.4 High`, `Composer 1.5`, each reading `Task completed`. Same prompt, three
models, switch between the answers. For Artemis, which already has a
multi-harness catalog, this is the most directly transferable idea in the whole
reference set: run one prompt across Claude/Codex/Gemini and compare.

**Run cards instead of a session table.** Each run: a stacked-paper thumbnail
(implying a changeset) carrying `7 files` and `+17 −0`, a status pill
(`Draft` / `Branch` / `Merged`), then title, model, repo, relative age. The
sidebar groups runs under `Yesterday` / `This Week` with a `+853` diffstat badge
per entry.

**Other details worth taking:** the repo·branch breadcrumb sits directly above
the composer; suggested-prompt chips (`Run security audit`, `Improve AGENTS.md`,
`Solve a TODO`) fill the empty state; the user's message renders as a bordered
full-width box that echoes the input it came from, not a chat bubble; the turn
closes with a quiet `Worked for 27s`; the content column stays narrow and
centered with generous whitespace.

Cursor Web is **light**, low-chrome, and calm: worth noting, since Superset and
Traycer are both near-black. Dark is not the only credible answer here.

### The tension to resolve

Traycer shows everything as typed segments. Cursor shows nothing and cites
sources. Superset sits between them with one-line collapsed summaries.

Artemis has to pick. My recommendation: **Superset's middle position, with
Cursor's citations.** Collapsed past-tense activity summaries keep the transcript
readable while leaving the mechanics one click away, and `file:line` chips make
the prose verifiable without expanding anything. Traycer's full segment
vocabulary is the right *architecture* to build on even if you render a quieter
subset of it: the renderers can exist and stay collapsed.

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
2. **Build the two primitives first** (`SegmentCard` and `SegmentRow`) then
   write renderers against them. Every block kind gets a renderer; no block kind
   renders as raw text.
3. **Add activity grouping** over consecutive tool/command blocks, with a
   past-tense summary line and an elapsed heartbeat while active.
4. **Stream.** `sendChatMessage` is currently request/response: it returns
   `ChatTurnResult` with the whole turn. The `RuntimeEvent` types exist to be
   streamed; the renderer needs deltas to feel like the references. This likely
   forces the host out of Vite middleware (SSE or WebSocket), which is on the
   roadmap anyway.
5. **Re-shell around the conversation.** Collapse the five sections: rail
   (projects → workspaces with status dots) + conversation + optional terminal
   dock. Review becomes a segment type and a diffstat in the composer bar, not a
   destination. Settings becomes a modal. Inventory moves into the launcher:
   you pick a harness where you start a run, not in a catalog screen.
6. **Add `file:line` citation chips** to the markdown renderer, resolving to the
   workspace. Cheap to build, and it's what makes a hidden-mechanics transcript
   trustworthy. Needs harnesses to emit ranges, or a post-hoc linkifier over
   paths mentioned in prose.
7. **Multi-harness comparison.** One prompt, N harnesses, tabbed results,
   following Cursor's model-tabs pattern. Artemis already has the catalog and the launcher
   to support this; no other reference here can do it across *vendors*.
8. **Commit to a palette.** Superset and Traycer are near-black; Cursor Web is
   light and calm. Either works: what kills the current prototype is having
   neither. If dark: near-black base, one step up for cards, one more for
   popovers, color reserved for state (running, needs-attention, error, diff
   add/remove).

## Open questions

- Does Artemis render one conversation per workspace, or many (Traycer forks and
  nests subagents; Superset pins several workspaces at once)?
- Terminal dock at all in v1, or fully committed to rendered messages?
- Does the harness abstraction survive contact with rendering? Only opencode
  emits parseable JSON today; Claude/Codex/Gemini would each need an adapter to
  produce `RuntimeEvent`s, or they degrade to a terminal pane.
