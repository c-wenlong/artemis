import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";
import { SegmentCard } from "./SegmentCard";
import { SegmentRow } from "./SegmentRow";
import { workingVerb } from "./workingVerb";

/**
 * The two primitives every segment is built from, ported from Traycer's
 * `segments/segment-card.tsx` and `segments/segment-row.tsx`. Their rules are
 * what keep a transcript of thirty tool calls readable.
 */
describe("SegmentCard", () => {
  it("shows the header and hides the body until opened", async () => {
    const user = userEvent.setup();
    render(
      <SegmentCard header={<span>Ran 3 commands</span>}>
        <p>the details</p>
      </SegmentCard>
    );

    expect(screen.getByText("Ran 3 commands")).toBeInTheDocument();
    expect(screen.queryByText("the details")).toBeNull();

    await user.click(screen.getByRole("button", { name: /ran 3 commands/i }));
    expect(screen.getByText("the details")).toBeInTheDocument();
  });

  it("makes the entire header the click target, not a separate chevron", async () => {
    const user = userEvent.setup();
    render(
      <SegmentCard header={<span>Header text</span>}>
        <p>body</p>
      </SegmentCard>
    );

    // Clicking the words, not an icon, must toggle it.
    await user.click(screen.getByText("Header text"));
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("reports its open state to assistive technology", async () => {
    const user = userEvent.setup();
    render(
      <SegmentCard header={<span>Header</span>}>
        <p>body</p>
      </SegmentCard>
    );
    const trigger = screen.getByRole("button", { name: /header/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("renders as a static header when there is nothing to expand", () => {
    render(<SegmentCard header={<span>Committed 3 files</span>} />);
    // No toggle at all: a chevron that reveals nothing is a lie.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("segment-card")).toHaveAttribute(
      "data-expandable",
      "false"
    );
  });

  it("can start open, for a segment whose body is the point", () => {
    render(
      <SegmentCard defaultOpen header={<span>Header</span>}>
        <p>body</p>
      </SegmentCard>
    );
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("carries a tone for destructive and primary states", () => {
    const { rerender } = render(
      <SegmentCard header={<span>h</span>} tone="destructive">
        <p>b</p>
      </SegmentCard>
    );
    expect(screen.getByTestId("segment-card")).toHaveAttribute(
      "data-tone",
      "destructive"
    );

    rerender(
      <SegmentCard header={<span>h</span>} tone="primary">
        <p>b</p>
      </SegmentCard>
    );
    expect(screen.getByTestId("segment-card")).toHaveAttribute("data-tone", "primary");
  });

  it("shows a collapsed preview without opening the body", () => {
    render(
      <SegmentCard collapsedPreview={<span>exit 0</span>} header={<span>h</span>}>
        <p>full output</p>
      </SegmentCard>
    );
    expect(screen.getByText("exit 0")).toBeInTheDocument();
    expect(screen.queryByText("full output")).toBeNull();
  });
});

describe("SegmentRow", () => {
  it("is a bare collapsible with no card chrome", async () => {
    const user = userEvent.setup();
    render(
      <SegmentRow header={<span>read file.ts</span>}>
        <p>contents</p>
      </SegmentRow>
    );
    // Hierarchy comes from the parent; a nested row must not stack another box.
    expect(screen.queryByTestId("segment-card")).toBeNull();
    expect(screen.getByTestId("segment-row")).toBeInTheDocument();
    expect(screen.queryByText("contents")).toBeNull();

    await user.click(screen.getByRole("button", { name: /read file\.ts/i }));
    expect(screen.getByText("contents")).toBeInTheDocument();
  });

  it("keeps a footer visible whether open or closed", () => {
    render(
      <SegmentRow footer={<span>running 4s</span>} header={<span>h</span>}>
        <p>body</p>
      </SegmentRow>
    );
    expect(screen.getByText("running 4s")).toBeInTheDocument();
    expect(screen.queryByText("body")).toBeNull();
  });

  it("aligns a non-expandable row with its expandable siblings", () => {
    render(<SegmentRow header={<span>done</span>} />);
    expect(screen.queryByRole("button")).toBeNull();
    // A spacer stands in for the missing chevron so headers line up.
    expect(screen.getByTestId("segment-row-spacer")).toBeInTheDocument();
  });
});

describe("Markdown", () => {
  it("renders headings, emphasis and lists", () => {
    render(
      <Markdown>{"## How it works\n\nIt is **fast**.\n\n- one\n- two"}</Markdown>
    );
    expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
    expect(screen.getByText("fast").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders inline code and fenced blocks distinctly", () => {
    render(<Markdown>{"Use `npm start`.\n\n```js\nconst a = 1;\n```"}</Markdown>);
    expect(screen.getByText("npm start").tagName).toBe("CODE");
    const block = screen.getByTestId("code-block");
    expect(block).toHaveTextContent("const a = 1;");
  });

  it("renders links but never navigates the app away", () => {
    render(<Markdown>{"[docs](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  /**
   * Model output is untrusted input. It reaches this renderer straight from a
   * harness, so raw HTML must render as text rather than markup.
   */
  it("does not execute HTML embedded in model output", () => {
    render(
      <Markdown>{'Before <img src=x onerror="alert(1)"> <b>bold?</b> after'}</Markdown>
    );
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByTestId("markdown")).toHaveTextContent("bold?");
  });

  it("renders a partial fence mid-stream without collapsing", () => {
    // Deltas arrive mid-token; an unterminated fence must not blank the answer.
    render(<Markdown>{"Here you go:\n\n```ts\nconst partial ="}</Markdown>);
    expect(screen.getByTestId("markdown")).toHaveTextContent("Here you go:");
  });

  it("renders nothing for empty text rather than an empty box", () => {
    render(<Markdown>{""}</Markdown>);
    expect(screen.queryByTestId("markdown")).toBeNull();
  });
});

describe("workingVerb", () => {
  it("is stable for a given turn", () => {
    expect(workingVerb("turn-1")).toBe(workingVerb("turn-1"));
  });

  it("varies across turns so consecutive turns do not read identically", () => {
    const verbs = new Set(
      Array.from({ length: 24 }, (_, index) => workingVerb(`turn-${index}`))
    );
    expect(verbs.size).toBeGreaterThan(1);
  });

  it("is always a non-empty word", () => {
    for (const seed of ["", "x", "turn-abc"]) {
      expect(workingVerb(seed)).toMatch(/\S/);
    }
  });
});

describe("segment rendering does not fall back to raw text", () => {
  it("every block kind has a dedicated renderer", async () => {
    const { MessageList } = await import("../Conversation/MessageList");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <MessageList
        messages={[
          {
            blocks: [
              { id: "b1", status: "completed", text: "answer", type: "text" },
              { id: "b2", status: "completed", text: "thinking", type: "reasoning" },
              {
                id: "b3",
                name: "bash",
                status: "completed",
                output: "ok",
                type: "tool_call"
              },
              { id: "b4", message: "boom", status: "errored", type: "error" }
            ],
            createdAt: "2026-08-10T12:00:00.000Z",
            id: "m1",
            role: "assistant",
            sessionId: "s1",
            turnId: "t1"
          }
        ]}
        turns={{}}
      />
    );

    const message = screen.getByTestId("message-assistant");
    for (const kind of ["text", "reasoning", "tool_call", "error"]) {
      expect(
        within(message).getByTestId(`segment-${kind}`),
        `${kind} needs its own renderer`
      ).toBeInTheDocument();
    }
    spy.mockRestore();
  });
});
