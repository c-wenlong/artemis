/**
 * Present-tense verb for a turn in flight, stable for the life of that turn.
 *
 * Traycer's `working-verb.ts` does the same thing, and the reason is worth
 * stating: a fixed "Working…" on every turn reads as a spinner, while a verb
 * that changes per turn makes it obvious the app is tracking *this* run rather
 * than showing a generic placeholder. It must not change mid-turn: text that
 * churns while you read it is worse than text that says nothing.
 */
const VERBS = [
  "Working",
  "Thinking",
  "Digging",
  "Reading",
  "Tracing",
  "Piecing it together",
  "Following the thread",
  "Poking around",
  "Chewing on it",
  "Untangling"
] as const;

export function workingVerb(seed: string): string {
  // FNV-1a: tiny, stable across runs, and good enough to spread short ids.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return VERBS[hash % VERBS.length]!;
}
