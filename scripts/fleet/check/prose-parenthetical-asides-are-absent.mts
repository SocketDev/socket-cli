#!/usr/bin/env node
/*
 * @file `check --all` gate: prose in tracked markdown must not tuck an
 *   explanatory CLAUSE into a parenthetical aside. Why: the fleet owner wants
 *   direct prose — an aside like "the layout engine (the yoga-open-tui Rust
 *   crate exposed via napi)" reads as noise and should be rewritten with a
 *   comma, colon, or em-dash: "the layout engine: the yoga-open-tui Rust crate
 *   exposed via napi".
 *
 *   What counts as an ASIDE, not a legit paren. A top-level `(...)` group is
 *   flagged only when its inner text reads like a natural-language clause:
 *   four or more words, at least one lowercase word, and no code punctuation.
 *   Short markers stay legal — refs like "(#6)", versions like "(v3.2.1)",
 *   commit hashes, lead-ins like "(e.g. ...)", "(i.e. ...)", "(cf. ...)",
 *   "(see ...)", URLs, and anything inside inline `code` or a fenced block.
 *
 *   Escape hatch: put `<!-- prose-parens: allow -->` on the offending line to
 *   keep one intentional aside, or `<!-- prose-parens: allow-file -->` anywhere
 *   in a file to exempt the whole file.
 *
 *   Scope: tracked `*.md` under the repo, minus node_modules/dist/.git,
 *   `fixtures` dirs, and generated CHANGELOG files. Code comments and commit
 *   messages are separate surfaces handled elsewhere.
 *
 *   Usage: node scripts/fleet/check/prose-parenthetical-asides-are-absent.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from `git ls-files`, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// A clause needs at least this many whitespace-separated words to read as an
// aside rather than a short marker or reference.
const MIN_ASIDE_WORDS = 4

// Lead-ins that make a parenthetical a legitimate reference or gloss, never an
// aside to rewrite: e.g./i.e./cf./viz./resp./aka, "see ...", and bare URLs.
const ALLOW_LEADIN =
  /^(?:a\.k\.a\.|aka\b|cf\.|e\.g\.|eg\b|https?:\/\/|i\.e\.|ie\b|resp\.|see\b|viz\.)/i

// Punctuation that marks the content as code, not prose: backticks, braces,
// assignment/semicolons, and the `::` `=>` `->` operator sequences.
const CODE_CHAR = /[`{}=;]|::|=>|->/

// At least one lowercase alphabetic word — prose has these; identifiers,
// SCREAMING_CASE tokens, and pure symbol soup do not.
const LOWERCASE_WORD = /\b[a-z]{2,}\b/

// The aside shape the owner flagged: an APPOSITIVE that restates the preceding
// noun, so it opens with a determiner — "the layout engine (the yoga-open-tui
// Rust crate …)". Glosses, imperatives, and detail parentheticals that don't
// open this way are left alone.
const APPOSITIVE_START = /^(?:the|an?|this|that|these|those|its|their|our)\s/i

// Per-line and whole-file escape-hatch markers.
const ALLOW_LINE = '<!-- prose-parens: allow -->'
const ALLOW_FILE = '<!-- prose-parens: allow-file -->'

/**
 * True when the inner text of a `(...)` group is an explanatory clause that
 * should be rewritten, not a short marker/reference/gloss. Pure.
 */
export function isAsideParenthetical(inner: string): boolean {
  const text = inner.trim()
  if (!text || ALLOW_LEADIN.test(text) || CODE_CHAR.test(text)) {
    return false
  }
  if (!APPOSITIVE_START.test(text)) {
    return false
  }
  if (text.split(/\s+/).length < MIN_ASIDE_WORDS) {
    return false
  }
  return LOWERCASE_WORD.test(text)
}

/**
 * The inner texts of every top-level parenthetical aside in a line of prose
 * (inline code already stripped). Nested parens are treated as one group.
 */
export function findAsideParentheticals(prose: string): string[] {
  const offenders: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0, { length } = prose; i < length; i += 1) {
    const ch = prose[i]
    if (ch === '(') {
      if (depth === 0) {
        start = i + 1
      }
      depth += 1
    } else if (ch === ')' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const inner = prose.slice(start, i)
        if (isAsideParenthetical(inner)) {
          offenders.push(inner.trim())
        }
        start = -1
      }
    }
  }
  return offenders
}

/**
 * Scan markdown content for parenthetical asides, respecting fenced code
 * blocks, inline code, and the escape-hatch markers. Returns one entry per
 * offending aside as `{ line, text }` (1-based line numbers). Pure.
 */
export function scanMarkdown(
  content: string,
): Array<{ line: number; text: string }> {
  if (content.includes(ALLOW_FILE)) {
    return []
  }
  const out: Array<{ line: number; text: string }> = []
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || raw.includes(ALLOW_LINE)) {
      continue
    }
    // Strip inline code spans so their parens never count as prose.
    const prose = raw.replace(/`[^`]*`/g, '')
    const asides = findAsideParentheticals(prose)
    for (let j = 0, { length: alen } = asides; j < alen; j += 1) {
      out.push({ line: i + 1, text: asides[j]! })
    }
  }
  return out
}

/**
 * Repo-relative paths of tracked `*.md` files worth scanning: everything under
 * git control minus `fixtures` dirs and generated CHANGELOG files. Only tracked
 * files gate — transient reports, worktrees, and build output stay out.
 */
export function collectMarkdownFiles(repoRoot: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    return []
  }
  const { stdout } = result
  const listed = typeof stdout === 'string' ? stdout : String(stdout)
  const relPaths = listed.split('\0')
  const files: string[] = []
  for (let i = 0, { length } = relPaths; i < length; i += 1) {
    const raw = relPaths[i]!
    if (!raw) {
      continue
    }
    const normalized = normalizePath(raw)
    if (
      normalized.includes('/fixtures/') ||
      path.basename(normalized).startsWith('CHANGELOG')
    ) {
      continue
    }
    files.push(normalized)
  }
  return files.toSorted()
}

/**
 * Every parenthetical aside across the given relative markdown paths, as
 * `path:line — text` strings. Empty when the prose is clean.
 */
export function scanFiles(
  repoRoot: string,
  files: readonly string[],
): string[] {
  const offenders: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let content: string
    try {
      content = readFileSync(path.join(repoRoot, rel), 'utf8')
    } catch {
      continue
    }
    const hits = scanMarkdown(content)
    for (let j = 0, { length: hlen } = hits; j < hlen; j += 1) {
      offenders.push(`${rel}:${hits[j]!.line} — (${hits[j]!.text})`)
    }
  }
  return offenders.toSorted()
}

/**
 * Every parenthetical aside across the repo's tracked markdown. Empty when the
 * prose is clean.
 */
export function findProseAsides(repoRoot: string): string[] {
  return scanFiles(repoRoot, collectMarkdownFiles(repoRoot))
}

function main(): number {
  // Non-flag args scope the scan to explicit paths (self-check a batch);
  // otherwise the whole tracked markdown tree gates.
  const paths = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const offenders = paths.length
    ? scanFiles(REPO_ROOT, paths)
    : findProseAsides(REPO_ROOT)
  if (offenders.length) {
    logger.fail(
      '[prose-parenthetical-asides-are-absent] markdown prose tucks explanatory clauses into parenthetical asides:',
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ✗ ${offenders[i]!}`)
    }
    logger.error(
      '  Rewrite each aside into the sentence with a comma, colon, or em-dash.',
    )
    logger.error(
      `  Keep one intentional aside with a trailing '${ALLOW_LINE}'.`,
    )
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[prose-parenthetical-asides-are-absent] markdown prose keeps asides out of parentheses.',
    )
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  main()
}
