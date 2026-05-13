/**
 * @fileoverview Rule C + D scanner for `.github/workflows/*.yml`.
 *
 * Rule C — workflow constructs the same multi-stage path 2+ times
 * outside a canonical "Compute paths" step. The fix is to add one
 * `id: paths` step early in the job that computes the path and
 * exposes it via `$GITHUB_OUTPUT`; later steps reference it.
 *
 * Rule D — comments encode a fully-qualified multi-stage path string.
 * Comments may describe path *structure* with placeholders but
 * shouldn't carry a tool-parsable path — the canonical construction
 * IS the documentation.
 *
 * `isInsideComputePathsBlock` walks backwards from the current line
 * to find the enclosing step header; if that step is named
 * `Compute … paths` or has `id: paths`, the line is exempt from
 * Rule C (the canonical place to construct a path).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { pushFinding } from './state.mts'

export const WORKFLOW_PATH_RE =
  /build\/\$\{[^}]+\}\/[^"'`\s]*\/out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/g
export const WORKFLOW_GH_EXPR_PATH_RE =
  /build\/\$\{\{\s*[^}]+\}\}\/[^"'`\s]*\/out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/g

export const isInsideComputePathsBlock = (
  lines: string[],
  lineIdx: number,
): boolean => {
  // Walk backwards up to 60 lines looking for the start of the
  // current step. If that step is a "Compute paths" step, the line
  // is exempt.
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 60); i--) {
    const l = lines[i] ?? ''
    if (/^\s*-\s*name:/i.test(l)) {
      // Step boundary — check if THIS step is a Compute paths step.
      // The step body may include `id: paths` even if the name is
      // something else (e.g. `id: stub-paths`), so look at the next
      // ~20 lines for either marker.
      for (let j = i; j < Math.min(lines.length, i + 20); j++) {
        const m = lines[j] ?? ''
        if (
          /^\s*-\s*name:\s*Compute\s+[\w-]+\s+paths/i.test(m) ||
          /^\s*id:\s*[\w-]*paths\s*$/i.test(m)
        ) {
          return true
        }
        if (j > i && /^\s*-\s*name:/i.test(m)) {
          // Hit the next step — current step is NOT Compute paths.
          return false
        }
      }
      return false
    }
  }
  return false
}

export const scanWorkflowFile = (repoRoot: string, relPath: string): void => {
  const full = path.join(repoRoot, relPath)
  let content: string
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  const lines = content.split('\n')

  // First pass: collect every hand-built path occurrence outside a
  // "Compute paths" step. Per the mantra, a single reference is fine
  // — what's banned is reconstructing the same path 2+ times.
  type PathHit = {
    line: number
    snippet: string
    pathStr: string
  }
  const occurrences = new Map<string, PathHit[]>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*#/.test(line)) {
      // Skip comment lines from C scan; they're under D below.
      continue
    }
    if (isInsideComputePathsBlock(lines, i)) {
      // Inside the canonical construction step — exempt.
      continue
    }
    WORKFLOW_PATH_RE.lastIndex = 0
    WORKFLOW_GH_EXPR_PATH_RE.lastIndex = 0
    const matches: string[] = []
    let m: RegExpExecArray | null
    while ((m = WORKFLOW_PATH_RE.exec(line)) !== null) {
      matches.push(m[0])
    }
    while ((m = WORKFLOW_GH_EXPR_PATH_RE.exec(line)) !== null) {
      matches.push(m[0])
    }
    for (const pathStr of matches) {
      const list = occurrences.get(pathStr) ?? []
      list.push({ line: i + 1, snippet: line.trim(), pathStr })
      occurrences.set(pathStr, list)
    }
  }

  // Flag every occurrence of a shape that appears 2+ times.
  for (const [pathStr, hits] of occurrences) {
    if (hits.length < 2) {
      continue
    }
    for (const hit of hits) {
      pushFinding({
        rule: 'C',
        file: relPath,
        line: hit.line,
        snippet: hit.snippet,
        message: `Workflow constructs the same path ${hits.length} times: ${pathStr}`,
        fix: 'Add a "Compute <pkg> paths" step (id: paths) early in the job that computes this path ONCE and exposes it via $GITHUB_OUTPUT. Reference as ${{ steps.paths.outputs.<name> }} in subsequent steps. References of the constructed value are unlimited; reconstructing is the violation.',
      })
    }
  }

  // Rule D: comments encoding a fully-qualified multi-stage path
  // (separate scan since it has different semantics).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!/^\s*#/.test(line)) {
      continue
    }
    const literalShape =
      /build\/(?:dev|prod|shared)\/[a-z0-9-]+\/(?:wasm\/)?out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/i
    if (literalShape.test(line)) {
      pushFinding({
        rule: 'D',
        file: relPath,
        line: i + 1,
        snippet: line.trim(),
        message: 'Comment encodes a fully-qualified path string.',
        fix: 'Cite the canonical paths.mts (e.g. "see packages/<pkg>/scripts/paths.mts:getBuildPaths()") instead of duplicating the path string. Comments may describe structure with placeholders ("<mode>/<arch>") but should not be a parsable path.',
      })
    }
  }
}
