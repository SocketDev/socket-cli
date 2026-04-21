/**
 * Scrubber adapter for zpm / yarn 6.
 *
 * Zpm (Rust, packageManager yarn@6.0.0-rc.10) writes progress bars
 * to stdout with TTY auto-disable. Its Rust source has no NO_COLOR /
 * FORCE_COLOR respect (verified in packages/zpm-utils/src/progress.rs
 * and packages/zpm/src/commands/*.rs — zero matches for NO_COLOR).
 *
 * Under machine mode we pipe zpm's stdout (so TTY detection kicks in
 * and progress suppresses itself). Most remaining chatter is handled
 * by the base scrubber's ANSI stripping + noise regex. This adapter
 * adds zpm-specific status lines that the base regex doesn't match:
 *
 *   "➤ YN0000: Resolution step"
 *   "➤ YN0000: Fetch step"
 *   "➤ Done in 0s 123ms"
 *
 * The YN#### message codes are zpm's structured log prefix when
 * YARN_ENABLE_MESSAGE_NAMES is on; we route them to stderr.
 */

import type { ScrubberAdapter } from '../scrubber.mts'

// Matches lines like "➤ YN0000: ..." or "➤ Done in ..." regardless of
// leading whitespace. Zpm uses U+27A4 BLACK RIGHTWARDS ARROWHEAD as
// the bullet. The YN\d{4} code pattern is structured and distinctive.
const ZPM_LOG_RE = /^\s*(?:➤|YN\d{4}:|Done in\s)/

export const zpmAdapter: ScrubberAdapter = {
  name: 'zpm',
  classify(line: string): 'payload' | 'drop' | 'noise' | undefined {
    if (ZPM_LOG_RE.test(line)) {
      return 'noise'
    }
    return undefined
  },
}
