import { Type } from '@sinclair/typebox'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { getOrFetchSocketBlob } from './lib/blob-cache.mts'
import {
  readToolBoolean,
  readToolNumber,
  readToolString,
} from './tool-args.mts'
import { errorToolResult, textToolResult } from './tool-auth.mts'
import { truncateToolLabel } from './tool-input.mts'
import { invalidBlobHashResult } from './tool-package-file-contents.mts'

import type { ToolSpec } from './tool-types.mts'

export const PACKAGE_FILE_GREP_TOOL_NAME = 'package_file_grep'

export const PACKAGE_FILE_GREP_TOOL_DESCRIPTION =
  'Search a single file from a package for lines matching a JavaScript regular expression. Pass the `hash` printed next to each entry in `package_files` output. The file is fetched from Socket once per session and cached, so repeated greps on the same hash skip the network. Returns matching lines with line numbers (grep -n style); binary files are refused. Useful for locating a specific symbol, import, or string inside a dependency without dumping the whole file.'

// A caller-supplied regular expression runs against caller-chosen content, so
// the scan is bounded three ways: the pattern is length-capped, each line is
// sliced before matching, and the whole scan gets a wall-clock budget. That
// keeps a pathological pattern from pinning the process indefinitely.
export const MAX_GREP_PATTERN_LENGTH = 512
export const MAX_GREP_LINE_CHARS = 4096
export const GREP_BUDGET_MS = 2000
const GREP_BUDGET_CHECK_INTERVAL = 128

export const PackageFileGrepInputSchema = Type.Object({
  caseInsensitive: Type.Optional(
    Type.Boolean({ description: 'Match case-insensitively (default: false)' }),
  ),
  contextLines: Type.Optional(
    Type.Integer({
      description:
        'Lines of context to show before and after each match (0-5, default: 0)',
      maximum: 5,
      minimum: 0,
    }),
  ),
  hash: Type.String({
    description:
      'Blob hash exactly as shown by `package_files` (the token printed after each file size)',
  }),
  maxMatches: Type.Optional(
    Type.Integer({
      description:
        'Cap on number of matching lines returned (default: 100, max: 500)',
      maximum: 500,
      minimum: 1,
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        'Optional file path for display only; does not affect the lookup',
    }),
  ),
  pattern: Type.String({
    description:
      'JavaScript regular expression. Plain literal strings work too. Anchors and character classes are supported.',
  }),
})

export interface GrepScanResult {
  budgetExceeded: boolean
  matchIndexes: number[]
}

export function definePackageFileGrepTool(): ToolSpec {
  return {
    annotations: { readOnlyHint: true },
    description: PACKAGE_FILE_GREP_TOOL_DESCRIPTION,
    handler: async args => {
      const hash = readToolString(args, 'hash')
      const invalid = invalidBlobHashResult('Searching a package file', hash)
      if (invalid || !hash) {
        return errorToolResult(invalid ?? 'Searching a package file failed.')
      }
      const pattern = readToolString(args, 'pattern')
      if (!pattern || pattern.length > MAX_GREP_PATTERN_LENGTH) {
        return errorToolResult(
          `Searching a package file failed. Where: the \`pattern\` argument. Saw: ${pattern ? `${pattern.length} characters` : 'an empty pattern'}, wanted 1 to ${MAX_GREP_PATTERN_LENGTH} characters. Fix: search for a shorter expression.`,
        )
      }
      const caseInsensitive = readToolBoolean(args, 'caseInsensitive') ?? false
      const contextLines = readToolNumber(args, 'contextLines') ?? 0
      const maxMatches = readToolNumber(args, 'maxMatches') ?? 100
      const label = truncateToolLabel(readToolString(args, 'path') ?? hash)
      const flags = caseInsensitive ? 'i' : ''

      let regexp: RegExp
      try {
        regexp = new RegExp(pattern, flags)
      } catch (e) {
        return errorToolResult(
          `Searching a package file failed. Where: the \`pattern\` argument. Saw: ${errorMessage(e)}, wanted a valid JavaScript regular expression. Fix: escape the special characters, or search for a plain literal string.`,
        )
      }

      try {
        const blob = await getOrFetchSocketBlob(hash)
        if (blob.binary) {
          return errorToolResult(
            `Searching a package file failed. Where: ${label}. Saw: binary content (${blob.bytes} bytes, content-type: ${blob.contentType ?? 'unknown'}), wanted UTF-8 text. Fix: pick a text file from the \`package_files\` listing.`,
          )
        }
        const lines = blob.text.split(/\r?\n/)
        const { budgetExceeded, matchIndexes } = scanLinesForPattern(
          lines,
          regexp,
          maxMatches,
        )
        if (budgetExceeded && !matchIndexes.length) {
          return errorToolResult(
            `Searching a package file failed. Where: ${label}. Saw: the search exceeded its ${GREP_BUDGET_MS}ms budget with no match, wanted a pattern that completes. Fix: simplify the expression — stacked quantifiers backtrack exponentially, so a plain literal or an anchored search is far cheaper.`,
          )
        }
        if (!matchIndexes.length) {
          return textToolResult(`${label}: no matches for /${pattern}/${flags}`)
        }
        const truncationNote = blob.truncated
          ? `\n[note: the file is ${blob.bytes} bytes; only the first 1 MB was searched]`
          : ''
        const capNote =
          matchIndexes.length >= maxMatches
            ? `\n[note: stopped at maxMatches=${maxMatches}; more matches may exist]`
            : ''
        const budgetNote = budgetExceeded
          ? `\n[note: stopped after the ${GREP_BUDGET_MS}ms search budget; later lines were not searched]`
          : ''
        const matchCount = matchIndexes.length
        const header = `${label} — ${matchCount} match${matchCount === 1 ? '' : 'es'} for /${pattern}/${flags}`
        const body = renderGrepMatches(lines, matchIndexes, contextLines)
        return textToolResult(
          `${header}\n${body}${truncationNote}${capNote}${budgetNote}`,
        )
      } catch (e) {
        return errorToolResult(errorMessage(e))
      }
    },
    inputSchema: PackageFileGrepInputSchema,
    name: PACKAGE_FILE_GREP_TOOL_NAME,
    title: 'Package File Grep Tool',
  }
}

/**
 * Render matched lines in `grep -n` form, inserting `--` separators between
 * non-adjacent context windows.
 */
export function renderGrepMatches(
  lines: string[],
  matchIndexes: number[],
  contextLines: number,
): string {
  const lineWidth = String(lines.length).length
  const formatLine = (idx: number, sep: '-' | ':'): string =>
    `${String(idx + 1).padStart(lineWidth, ' ')}${sep} ${lines[idx]}`
  const out: string[] = []
  let lastPrinted = -1
  for (let m = 0; m < matchIndexes.length; m += 1) {
    const matchIdx = matchIndexes[m]!
    const start = Math.max(0, matchIdx - contextLines)
    const end = Math.min(lines.length - 1, matchIdx + contextLines)
    if (contextLines > 0 && lastPrinted >= 0 && start > lastPrinted + 1) {
      out.push('--')
    }
    for (let i = Math.max(start, lastPrinted + 1); i <= end; i += 1) {
      out.push(formatLine(i, i === matchIdx ? ':' : '-'))
    }
    lastPrinted = end
  }
  return out.join('\n')
}

/**
 * Collect the indexes of matching lines, stopping at `maxMatches` or when the
 * time budget runs out.
 */
export function scanLinesForPattern(
  lines: string[],
  pattern: RegExp,
  maxMatches: number,
  budgetMs = GREP_BUDGET_MS,
): GrepScanResult {
  const deadline = Date.now() + budgetMs
  const matchIndexes: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (
      i > 0 &&
      i % GREP_BUDGET_CHECK_INTERVAL === 0 &&
      Date.now() > deadline
    ) {
      return { budgetExceeded: true, matchIndexes }
    }
    const line = lines[i]!
    const probe =
      line.length > MAX_GREP_LINE_CHARS
        ? line.slice(0, MAX_GREP_LINE_CHARS)
        : line
    if (pattern.test(probe)) {
      matchIndexes.push(i)
      if (matchIndexes.length >= maxMatches) {
        break
      }
    }
  }
  return { budgetExceeded: false, matchIndexes }
}
