#!/usr/bin/env node
/*
 * @file `check --all` gate: a FILE-DOC header that contains markdown must be a
 *   plain `/* … *\/` block, not a `/** … *\/` JSDoc comment. Why: oxfmt's JSDoc
 *   formatter only touches `/**` comments, and on a description carrying
 *   markdown structure (a `-` list, a `>` blockquote, a `1.` numbered list) it
 *   re-wraps + DROPS lines — silent content loss on a `pnpm run format`. A plain
 *   `/* *\/` block is left untouched, so the markdown survives. File-doc headers
 *   are documentation, not API JSDoc, so `/* *\/` is the right delimiter.
 *
 *   Scope: the LEADING block comment of an `.mts` file (after an optional
 *   shebang) under the canonical trees template/base/ + scripts/repo/, when it
 *   is a file-doc header — either `@file`-tagged, or not immediately followed by
 *   a symbol declaration (a leading `/**` that is JSDoc for the next
 *   export/function is left alone; converting it would strip real JSDoc). API
 *   JSDoc on functions is never flagged. Fix: change the leading `/**` to `/*`.
 *
 *   Usage: node scripts/fleet/check/markdown-doc-headers-are-plain.mts [--quiet]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const CANONICAL_TREES: readonly string[] = ['template/base', 'scripts/repo']

// A markdown list / blockquote / numbered line inside a comment body — what
// oxfmt's JSDoc reflow drops.
const MARKDOWN_LINE = /^\s*\*\s+([->]|\d+\.)\s/m
// The leading block comment, after an optional shebang line.
const LEADING_BLOCK = /^((?:#![^\n]*\n)?)(\/\*\*[\s\S]*?\*\/)/
// A symbol declaration right after the leading block — marks the leading `/**`
// as JSDoc for that symbol (NOT a file-doc header), so it must be left alone.
const SYMBOL_AFTER =
  /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|const|let|var|enum|abstract|declare|namespace)\b/

/**
 * True when a file's leading block is a `/**`-delimited FILE-DOC header whose
 * body carries markdown that oxfmt would mangle — i.e. it should be a plain
 * `/* *\/` block instead. Pure: takes file content, returns the verdict.
 */
export function headerWouldMangle(content: string): boolean {
  const m = LEADING_BLOCK.exec(content)
  if (!m) {
    return false
  }
  const block = m[2]!
  if (!MARKDOWN_LINE.test(block)) {
    return false
  }
  if (block.includes('@file')) {
    return true
  }
  const after = content.slice(m.index + m[0]!.length).replace(/^\s*/, '')
  return !SYMBOL_AFTER.test(after)
}

/**
 * Recursively collect `.mts` files under `dir`, skipping node_modules + dist.
 */
export function collectMtsFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === 'dist' || name === 'node_modules') {
      continue
    }
    const p = path.join(dir, name)
    let s: ReturnType<typeof statSync>
    try {
      s = statSync(p)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      out.push(...collectMtsFiles(p))
    } else if (p.endsWith('.mts')) {
      out.push(p)
    }
  }
  return out
}

/**
 * The file-doc headers across the canonical trees that would mangle under
 * oxfmt (relative paths). Empty when the tree is clean.
 */
export function findMangledHeaders(repoRoot: string): string[] {
  const offenders: string[] = []
  for (let i = 0, { length } = CANONICAL_TREES; i < length; i += 1) {
    const root = path.join(repoRoot, CANONICAL_TREES[i]!)
    const files = collectMtsFiles(root)
    for (let j = 0, { length: flen } = files; j < flen; j += 1) {
      const f = files[j]!
      if (headerWouldMangle(readFileSync(f, 'utf8'))) {
        offenders.push(path.relative(repoRoot, f))
      }
    }
  }
  return offenders.toSorted()
}

function main(): number {
  const offenders = findMangledHeaders(REPO_ROOT)
  if (offenders.length) {
    logger.fail(
      '[markdown-doc-headers-are-plain] file-doc headers with markdown are JSDoc-delimited (oxfmt will drop their content on format):',
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ✗ ${offenders[i]!}`)
    }
    logger.error(
      '  Change each leading `/**` to `/*` — a plain block comment is left',
    )
    logger.error('  untouched by oxfmt, so the markdown description survives.')
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[markdown-doc-headers-are-plain] file-doc headers with markdown are plain `/* */` blocks.',
    )
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
