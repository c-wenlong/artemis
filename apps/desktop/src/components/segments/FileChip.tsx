import { fileKind } from "../../chat/fileRefs";
import "./FileChip.css";

/**
 * Per-kind glyphs. Deliberately drawn rather than imported: a chip sits inside
 * a line of prose, so the mark has to share the text's colour and optical
 * weight, which an icon-set SVG with its own stroke width does not.
 */
const GLYPH = {
  code: (
    <path d="M5.5 4 2.5 7l3 3M8.5 4l3 3-3 3" fill="none" strokeLinecap="round" />
  ),
  data: (
    <>
      <path d="M2.5 4.5h9M2.5 7h9M2.5 9.5h9" fill="none" strokeLinecap="round" />
      <path d="M5.5 2.5v9" fill="none" strokeLinecap="round" />
    </>
  ),
  doc: (
    <>
      <rect height="10" rx="1.5" width="8" x="3" y="2" fill="none" />
      <path d="M5.5 5.5h3M5.5 8h3" fill="none" strokeLinecap="round" />
    </>
  ),
  shell: <path d="M3.5 3.5 7 7l-3.5 3.5M8 10.5h3" fill="none" strokeLinecap="round" />
} as const;

interface FileChipProps {
  line?: number;
  path: string;
}

/**
 * A file reference in prose.
 *
 * Not a link yet — resolving a click to the file at the line is M9. It is a
 * `span` rather than a disabled button so that it does not advertise an
 * interaction it cannot honour.
 */
export function FileChip({ line, path }: FileChipProps) {
  const kind = fileKind(path);
  // Directories are context, not identity; the tail is what gets read.
  const name = path.split("/").pop() || path;

  return (
    <span className="file-chip" data-kind={kind} data-testid="file-chip" title={path}>
      <svg
        aria-hidden
        className="file-chip-glyph"
        height="14"
        stroke="currentColor"
        strokeWidth="1.25"
        viewBox="0 0 14 14"
        width="14"
      >
        {GLYPH[kind]}
      </svg>
      <span className="file-chip-name">{name}</span>
      {line === undefined ? null : (
        <span className="file-chip-line">line {line}</span>
      )}
    </span>
  );
}
