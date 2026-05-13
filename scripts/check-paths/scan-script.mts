/**
 * @fileoverview Rule G scanner for Makefile / Dockerfile / shell.
 *
 * Same shape as Rule A (multi-stage path constructed inline), applied
 * to executable artifacts that can't `import` a TS `paths.mts`. Each
 * canonical construction in a script must reference the source-of-
 * truth TS module by comment so the script can't drift from TS
 * without a flagged change.
 *
 * Dockerfile-aware: each `FROM ... AS ...` opens a new stage scope in
 * which earlier `ENV` / `ARG` declarations don't propagate, so the
 * 2+-times check is scoped per stage. Non-Dockerfile scripts share
 * one global scope (stage 0).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { pushFinding } from './state.mts'

export const SCRIPT_HAND_BUILT_RE =
  /build\/\$?\{?(?:BUILD_MODE|MODE|prod|dev)\}?\/[\w${}.-]*\/out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/g

export const scanScriptFile = (repoRoot: string, relPath: string): void => {
  const full = path.join(repoRoot, relPath)
  let content: string
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  const lines = content.split('\n')
  const isDockerfile =
    /Dockerfile/i.test(relPath) || /\.glibc$|\.musl$/.test(relPath)

  // First pass: collect every multi-stage path occurrence in this file,
  // scoped per Dockerfile stage (each `FROM ... AS ...` starts a new
  // scope where ENV/ARG don't propagate).
  type Hit = { line: number; text: string; pathStr: string; stage: number }
  const hits: Hit[] = []
  let stage = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*#/.test(line)) {
      // Skip comments — documentation, not construction.
      continue
    }
    if (isDockerfile && /^FROM\s+/i.test(line)) {
      stage += 1
      continue
    }
    SCRIPT_HAND_BUILT_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SCRIPT_HAND_BUILT_RE.exec(line)) !== null) {
      hits.push({
        line: i + 1,
        text: line.trim(),
        pathStr: m[0],
        stage,
      })
    }
  }

  // Group by (stage, pathStr) — only flag when a path is built 2+
  // times within the SAME Dockerfile stage (or anywhere in non-
  // Dockerfile scripts, where stages don't apply).
  const grouped = new Map<string, Hit[]>()
  for (const h of hits) {
    const key = `${h.stage}::${h.pathStr}`
    const list = grouped.get(key) ?? []
    list.push(h)
    grouped.set(key, list)
  }
  for (const [, list] of grouped) {
    if (list.length < 2) {
      continue
    }
    for (const hit of list) {
      pushFinding({
        rule: 'G',
        file: relPath,
        line: hit.line,
        snippet: hit.text,
        message: `Hand-built multi-stage path constructed ${list.length} times in this file: ${hit.pathStr}`,
        fix: 'Assign to a variable / ENV once near the top of the script / Dockerfile stage, with a comment naming the canonical paths.mts. Reference the variable everywhere downstream. References of a single construction are unlimited; reconstructing the same path is the violation.',
      })
    }
  }
}
