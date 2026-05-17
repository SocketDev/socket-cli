/**
 * Scrubber adapter for synp.
 *
 * Synp (yarn.lock ↔ package-lock.json converter) has no CLI flags for
 * quiet or machine mode. On success it emits one line to stdout —
 * "Created <path>" — and does the actual conversion via
 * fs.writeFileSync. On error it prints a colored message + commander
 * help text to stdout.
 *
 * We drop the success line (the converted lockfile is the artifact on
 * disk, not stdout text). We also drop commander's "use --help for
 * hints" nudge. Real error text from synp flows through normally so
 * callers can surface it.
 */

import type { ScrubberAdapter } from '../scrubber.mts'

const DROP_LINES = new Set<string>(['use --help for hints'])

const CREATED_RE = /^Created\s+\S/

export const synpAdapter: ScrubberAdapter = {
  name: 'synp',
  classify(line: string): 'payload' | 'drop' | 'noise' | undefined {
    const trimmed = line.trim()
    if (!trimmed) {
      return undefined
    }
    if (CREATED_RE.test(trimmed)) {
      return 'drop'
    }
    if (DROP_LINES.has(trimmed)) {
      return 'drop'
    }
    return undefined
  },
}
