import { createContext, useContext } from "react";

/**
 * How a file chip opens the file it names.
 *
 * A context rather than a prop because a chip is created deep inside rendered
 * markdown — `Markdown` maps over the children of every prose element — and
 * threading a callback through that would mean every renderer in the chain
 * carrying an argument it does not use.
 *
 * Absent means citations are not resolvable here: no workspace, or a host with
 * no disk. The chip renders as text in that case, rather than as a control that
 * cannot do anything.
 */
export type OpenCitation = (path: string, line?: number) => void;

const CitationContext = createContext<OpenCitation | null>(null);

export const CitationProvider = CitationContext.Provider;

export function useOpenCitation(): OpenCitation | null {
  return useContext(CitationContext);
}
