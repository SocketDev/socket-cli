/**
 * @file The pass-through emoji-tree footer. Renders one line per source with its
 *   item count + status, bounded by the FOOTER_OPEN/FOOTER_CLOSE markers so the
 *   model can lift it into the brief verbatim (it's the citation surface — there
 *   is no separate Sources: block). Ported from the upstream last30days footer.
 */

import { FOOTER_CLOSE, FOOTER_HEADLINE, FOOTER_OPEN } from '../markers.mts'

import type { SourceResult } from '../types.mts'

// A check for an ok source, a dash for skipped, a cross for an errored one.
function statusGlyph(status: SourceResult['status']): string {
  if (status === 'ok') {
    return '✅'
  }
  return status === 'skipped' ? '⏭️' : '❌'
}

// One footer line per source: glyph, name, item count, and the note (skip reason
// or error) when present.
function sourceLine(result: SourceResult): string {
  const count = result.items.length
  const base = `${statusGlyph(result.status)} ${result.source}: ${count} item${count === 1 ? '' : 's'}`
  return result.note ? `${base} (${result.note})` : base
}

// Render the bounded pass-through footer for a set of source results, plus the
// saved-file path. The markers let the contract check assert the model quotes
// the same envelope.
export function renderFooter(
  results: readonly SourceResult[],
  savedPath: string,
): string {
  const lines = results.map(sourceLine)
  return [
    FOOTER_OPEN,
    FOOTER_HEADLINE,
    '',
    ...lines,
    '',
    `Saved: ${savedPath}`,
    FOOTER_CLOSE,
  ].join('\n')
}
