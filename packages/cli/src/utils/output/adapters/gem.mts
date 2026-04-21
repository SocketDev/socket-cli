/**
 * Scrubber adapter for RubyGems (`gem`).
 *
 * Gem writes progress and status lines to stdout with no TTY check
 * (violates Unix convention). Observed patterns during install:
 *
 *   "Fetching rake-13.0.6.gem"
 *   "Successfully installed rake-13.0.6"
 *   "1 gem installed"
 *   "Parsing documentation for rake-13.0.6"
 *   "Installing ri documentation for rake-13.0.6"
 *   "Done installing documentation for rake after 0 seconds"
 *   "Building native extensions. This could take a while..."
 *   "........" (dot progress)
 *
 * All of the above are informational — route to stderr.
 */

import type { ScrubberAdapter } from '../scrubber.mts'

// Dot-only progress lines. Match with optional surrounding whitespace.
const DOT_PROGRESS_RE = /^\s*\.+\s*$/

// Common gem status-line prefixes, case-sensitive (gem writes them as
// shown). Accepts both "Fetching foo-1.0.gem" and "Fetching: foo".
const STATUS_RE = new RegExp(
  [
    '^(?:',
    'Fetching[:\\s]',
    '|Installing\\s',
    '|Installed\\s',
    '|Installing\\s+ri\\s+documentation',
    '|Installing\\s+RDoc\\s+documentation',
    '|Parsing\\s+documentation',
    '|Done\\s+installing',
    '|Successfully\\s+(?:installed|uninstalled)',
    '|Building\\s+native\\s+extensions',
    '|\\d+\\s+gems?\\s+installed',
    '|\\d+\\s+gems?\\s+uninstalled',
    ')',
  ].join(''),
)

export const gemAdapter: ScrubberAdapter = {
  name: 'gem',
  classify(line: string): 'payload' | 'drop' | 'noise' | undefined {
    if (DOT_PROGRESS_RE.test(line)) {
      return 'drop'
    }
    if (STATUS_RE.test(line)) {
      return 'noise'
    }
    return undefined
  },
}
