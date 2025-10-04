/** @fileoverview Main output cleaner that applies all scrubbers. */

import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import {
  scrubFirewallOutput,
  scrubNpmOutput,
  scrubPnpmOutput,
} from './package-managers.mts'
import { sanitizeTokens, stripTokenErrorMessages } from './security.mts'
import {
  normalizeLogSymbols,
  normalizeNewlines,
  stripZeroWidthSpace,
  toAsciiSafeString,
} from './text.mts'

/**
 * Apply all standard scrubbers to output for consistent test snapshots.
 * This is the main function that should be used for cleaning test output.
 */
export function cleanOutput(output: string | Buffer<ArrayBufferLike>): string {
  return toAsciiSafeString(
    normalizeLogSymbols(
      normalizeNewlines(
        stripZeroWidthSpace(
          scrubPnpmOutput(
            scrubNpmOutput(
              scrubFirewallOutput(
                sanitizeTokens(
                  stripTokenErrorMessages(stripAnsi(String(output).trim())),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ).trim()
}
