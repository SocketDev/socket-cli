/**
 * Output format detection utilities for Socket CLI.
 * Determines output format based on command flags.
 *
 * Key Functions:
 * - getOutputKind: Determine output format from flags
 *
 * Supported Formats:
 * - JSON: Machine-readable JSON output
 * - Markdown: Formatted markdown for reports
 * - Text: Plain text for terminal display
 *
 * Usage:
 * - Processes --json and --markdown flags
 * - Returns appropriate output format constant
 * - Defaults to text format for terminal display
 */

import { OUTPUT_JSON, OUTPUT_MARKDOWN, OUTPUT_TEXT } from '../../constants.mts'

import type { OutputKind } from '../../types.mjs'

export function getOutputKind(json: unknown, markdown: unknown): OutputKind {
  if (json) {
    return OUTPUT_JSON
  }
  if (markdown) {
    return OUTPUT_MARKDOWN
  }
  return OUTPUT_TEXT
}
