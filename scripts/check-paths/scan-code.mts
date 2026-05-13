/**
 * @fileoverview Rule A + B scanner for .mts / .cts source files.
 *
 * Rule A — multi-stage path constructed inline (a `path.join(...)` /
 * `path.resolve(...)` call OR a template literal that stitches stage
 * tokens together).
 *
 * Rule B — cross-package traversal: `path.join(*, '..', '<sibling>',
 * 'build', ...)` reaching into a sibling package's build output
 * without going through its `exports`.
 *
 * Argument extraction uses a paren-balancing scanner (not just regex)
 * so nested calls like `path.join(getDir(child(x)), 'build', 'Final')`
 * are captured fully. Template literals get their `${...}`
 * placeholders stripped to a sentinel so a placeholder-only segment
 * can't accidentally match a stage token.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  BUILD_ROOT_SEGMENTS,
  KNOWN_SIBLING_PACKAGES,
  MODE_SEGMENTS,
  STAGE_SEGMENTS,
} from '../../.claude/hooks/path-guard/segments.mts'
import { pushFinding } from './state.mts'

// Locate `path.join(` or `path.resolve(` call sites; argument-list
// extraction uses a paren-balancing scanner below to handle arbitrary
// nesting depth (the previous regex-only approach silently missed any
// argument containing 2+ levels of nested function calls).
export const PATH_CALL_RE = /\bpath\.(?:join|resolve)\s*\(/g
export const STRING_LITERAL_RE = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g

// Template literal scanner. Captures backtick-delimited strings
// (including those with `${...}` placeholders) so Rule A also catches
// path construction via template literals — backtick variants of the
// same stitch-stages-inline pattern path.join() guards against.
export const TEMPLATE_LITERAL_RE =
  /`((?:\\.|(?:\$\{(?:[^{}]|\{[^{}]*\})*\})|(?!`)[^\\])*)`/g

/**
 * Convert a template-literal body into a synthetic forward-slash path
 * by replacing `${...}` placeholders with a sentinel and normalizing
 * separators. Returns the sequence of path segments split on `/`. The
 * sentinel doesn't match any STAGE/BUILD_ROOT/MODE token, so a
 * placeholder-only segment (`${binaryName}`) won't match those sets.
 */
export const templateLiteralSegments = (body: string): string[] => {
  // Strip placeholders so they don't introduce noise in segments.
  // Empty result for a placeholder is fine; downstream filters by set
  // membership and skips empties.
  const stripped = body.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '\x00')
  return stripped.split('/').filter(seg => seg.length > 0 && seg !== '\x00')
}

/**
 * Extract every `path.join(...)` and `path.resolve(...)` call from the
 * source text, returning each call's literal start offset and argument
 * substring. Uses paren-balancing so deeply-nested arguments like
 * `path.join(getDir(child(x)), 'build', 'Final')` are captured fully.
 */
export const extractPathCalls = (
  source: string,
): Array<{ offset: number; args: string }> => {
  const calls: Array<{ offset: number; args: string }> = []
  PATH_CALL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PATH_CALL_RE.exec(source)) !== null) {
    const callStart = match.index
    const argsStart = PATH_CALL_RE.lastIndex
    let depth = 1
    let i = argsStart
    let inString: '"' | "'" | '`' | undefined = undefined
    while (i < source.length && depth > 0) {
      const ch = source[i]!
      if (inString) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === inString) {
          inString = undefined
        }
      } else {
        if (ch === '"' || ch === "'" || ch === '`') {
          inString = ch
        } else if (ch === '(') {
          depth += 1
        } else if (ch === ')') {
          depth -= 1
          if (depth === 0) {
            break
          }
        }
      }
      i += 1
    }
    if (depth === 0) {
      calls.push({ offset: callStart, args: source.slice(argsStart, i) })
      PATH_CALL_RE.lastIndex = i + 1
    }
  }
  return calls
}

export const extractStringLiterals = (args: string): string[] => {
  const literals: string[] = []
  let match: RegExpExecArray | null
  STRING_LITERAL_RE.lastIndex = 0
  while ((match = STRING_LITERAL_RE.exec(args)) !== null) {
    if (match[2] !== undefined) {
      literals.push(match[2])
    }
  }
  return literals
}

export const scanCodeFile = (repoRoot: string, relPath: string): void => {
  const full = path.join(repoRoot, relPath)
  let content: string
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  const lines = content.split('\n')
  // Build a line-offset map so we can map regex offsets back to line
  // numbers cheaply.
  const lineOffsets: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      lineOffsets.push(i + 1)
    }
  }
  const offsetToLine = (offset: number): number => {
    let lo = 0
    let hi = lineOffsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (lineOffsets[mid]! <= offset) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return lo + 1
  }

  for (const call of extractPathCalls(content)) {
    const literals = extractStringLiterals(call.args)
    const stages = literals.filter(l => STAGE_SEGMENTS.has(l))
    const buildRoots = literals.filter(l => BUILD_ROOT_SEGMENTS.has(l))
    const modes = literals.filter(l => MODE_SEGMENTS.has(l))

    // Rule A: 2+ stages OR (1 stage + 1 build-root + 1 mode).
    const triggersA =
      stages.length >= 2 ||
      (stages.length >= 1 && buildRoots.length >= 1 && modes.length >= 1)
    if (triggersA) {
      const line = offsetToLine(call.offset)
      const snippet = (lines[line - 1] ?? '').trim()
      pushFinding({
        rule: 'A',
        file: relPath,
        line,
        snippet,
        message: 'Multi-stage path constructed inline (outside paths.mts).',
        fix: 'Construct in the owning paths.mts (or use getFinalBinaryPath / getDownloadedDir from build-infra/lib/paths). Import the computed value here.',
      })
    }

    // Rule B: each '..' opens a window; the window stays open only
    // until the next non-'..' literal. A sibling-package literal
    // *immediately after* a '..' (no path segment between them)
    // triggers, AND there must be build context elsewhere in the
    // call. Resetting per-segment prevents false positives where '..'
    // appears earlier and sibling-name appears much later in an
    // unrelated position.
    const hasBuildContext = literals.some(
      l => BUILD_ROOT_SEGMENTS.has(l) || STAGE_SEGMENTS.has(l),
    )
    if (hasBuildContext) {
      for (let i = 0; i < literals.length - 1; i++) {
        if (
          literals[i] === '..' &&
          KNOWN_SIBLING_PACKAGES.has(literals[i + 1]!)
        ) {
          const sibling = literals[i + 1]!
          const line = offsetToLine(call.offset)
          const snippet = (lines[line - 1] ?? '').trim()
          pushFinding({
            rule: 'B',
            file: relPath,
            line,
            snippet,
            message: `Cross-package traversal into '${sibling}' build output.`,
            fix: `Add '${sibling}: workspace:*' as a dep, declare an exports entry on '${sibling}' (e.g. './scripts/paths' → './scripts/paths.mts'), and import the path from there.`,
          })
          break
        }
      }
    }
  }

  // Rule A (template literal variant). Backtick strings that stitch
  // stage tokens inline construct paths the same way `path.join(...)`
  // does — flag the same shapes. TEMPLATE_LITERAL_RE matches any
  // backtick string and we rely on segment composition to decide if
  // it's a path.
  TEMPLATE_LITERAL_RE.lastIndex = 0
  let tmpl: RegExpExecArray | null
  while ((tmpl = TEMPLATE_LITERAL_RE.exec(content)) !== null) {
    const body = tmpl[1] ?? ''
    if (!body.includes('/')) {
      continue
    }
    const segments = templateLiteralSegments(body)
    const stages = segments.filter(s => STAGE_SEGMENTS.has(s))
    const buildRoots = segments.filter(s => BUILD_ROOT_SEGMENTS.has(s))
    const modes = segments.filter(s => MODE_SEGMENTS.has(s))
    // Template literal trigger is tighter than path.join() because
    // backtick strings often appear in patch fixtures, error messages,
    // and other multi-line content that incidentally contains stage
    // tokens. Require the canonical build-output shape: build + out +
    // stage, or two stages + out, or build + stage + a literal mode.
    const hasBuildAndOut =
      buildRoots.includes('build') && buildRoots.includes('out')
    const hasOut = buildRoots.includes('out')
    const hasBuild = buildRoots.includes('build')
    const triggersA =
      (hasBuildAndOut && stages.length >= 1) ||
      (stages.length >= 2 && hasOut) ||
      (hasBuild && stages.length >= 1 && modes.length >= 1)
    if (triggersA) {
      const line = offsetToLine(tmpl.index)
      const snippet = (lines[line - 1] ?? '').trim()
      pushFinding({
        rule: 'A',
        file: relPath,
        line,
        snippet,
        message:
          'Multi-stage path constructed inline via template literal (outside paths.mts).',
        fix: 'Construct in the owning paths.mts (or use getFinalBinaryPath / getDownloadedDir from build-infra/lib/paths). Import the computed value here.',
      })
    }
  }
}
