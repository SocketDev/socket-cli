#!/usr/bin/env node
/*
 * @file `check --all` gate: a PR/issue reference in tracked DOCS PROSE must be a
 *   markdown link, not a bare `#N`. A bare `#7317` renders as literal dead text
 *   in a `.md` file (and in a terminal report), so it must be written as an
 *   explicit link: `[#7317](https://github.com/<owner>/<repo>/pull/7317)`.
 *
 *   Why this COMPLEMENTS, and does not contradict, the anti-backref rule.
 *   `docs/agents.md/fleet/public-surface-hygiene.md` bans external issue/PR refs
 *   in commit messages and PR bodies, where a bare `#N` AUTO-LINKS to the same
 *   repo — so there the bare form is correct and a hand-written link is noise.
 *   Rendered docs are a DIFFERENT surface: GitHub does not auto-link `#N` inside
 *   a committed markdown file, and a terminal never does, so the SAME token that
 *   is correct in a commit body is dead text in a doc. Different surface,
 *   different rule: this gate governs docs prose only, and the pair holds the
 *   whole surface — bare in commits, linked in docs.
 *
 *   What counts as a ref. The canonical shapes are reused verbatim from
 *   `.git-hooks/_shared/scan-comments.mts` (the single source of truth the
 *   commit-time comment scanner uses), so the two surfaces can never drift:
 *     - VERB-FRAMED (`fixes #N`, `closes #N`, `follow-up to #N`,
 *       `reverts #N`, `cherry-picked #N`, `landed in #N`) via
 *       `PROCESS_ISSUE_REF_RE` — always a real ref, flagged on sight.
 *     - LONE bare `#N` via `LONE_ISSUE_REF_RE` (two-digit floor), but ONLY when a
 *       strong process verb (`merged`/`landed`/`reverts`…, `PROCESS_WORD_RE`)
 *       co-occurs on the line — scan-comments' own Tier-2 discriminator. A bare
 *       `#N` with no process verb is an ordinal (`the #10 tell`), an enumeration,
 *       or a citation, not a live ref, so it never flags. Reusing that exact
 *       co-occurrence keeps this gate's false positives at scan-comments' zero.
 *     - `UPSTREAM_CONTEXT_RE` exempts a lone `#N` on an upstream-Node-provenance
 *       line (`node v22`, `nodejs/node`, the `22.x` release line). Such a `#N`
 *       cites another project's tracker, so auto-linking it to THIS repo would
 *       be wrong; leaving it to the author is the safe call. Verb-framed refs
 *       still flag there, matching scan-comments' Tier-1 behaviour.
 *     - A cross-repo shorthand (`owner/repo#N`, the `#N` written flush against a
 *       `word/word` slug) names its own repo, so it is the anti-backref rule's
 *       surface, not a same-repo dead ref this gate can link. It is exempt.
 *
 *   Before matching, each line is reduced to its rendered prose: fenced code
 *   blocks (``` and ~~~), inline code spans, bare URLs/autolinks, existing
 *   markdown links (inline `[t](url)` and reference `[t][ref]`), link-definition
 *   lines, and HTML comments are all masked out. A `#N` that is already the link
 *   TEXT of `[#N](url)` is COMPLIANT and never flags; a `#N` inside a URL or a
 *   code span never flags.
 *
 *   No `--fix`. A fixer is deliberately omitted because it cannot be safely
 *   correct: a bare `#N` in prose cannot be proven to belong to the origin repo
 *   (it may be an elided cross-repo or upstream ref), so a generated same-repo
 *   link risks being confidently WRONG — worse than the dead text it replaces.
 *   (GitHub redirects `/pull/N` <-> `/issues/N`, so pull-vs-issues alone is not
 *   the blocker; provenance is.) The gate reports; the human writes the link.
 *
 *   Escape hatch: `<!-- pr-ref-link: allow -->` on the line, or
 *   `<!-- pr-ref-link: allow-file -->` anywhere in the file.
 *
 *   Scope: tracked `*.md`, minus fixtures dirs and generated CHANGELOG files,
 *   the same surface its prose siblings gate. Changelog fragments are excluded
 *   on purpose — they become GitHub Release notes, where `#N` auto-links, so a
 *   bare ref there is correct (the commit-body case, not the doc case).
 *
 *   Usage: node scripts/fleet/check/pr-refs-in-docs-are-linked.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  LONE_ISSUE_REF_RE,
  PROCESS_ISSUE_REF_RE,
  PROCESS_WORD_RE,
  UPSTREAM_CONTEXT_RE,
} from '../../../.git-hooks/_shared/scan-comments.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { collectMarkdownFiles } from './prose-parenthetical-asides-are-absent.mts'

const logger = getDefaultLogger()

export const PR_REF_LINK_ALLOW_LINE = '<!-- pr-ref-link: allow -->'
export const PR_REF_LINK_ALLOW_FILE = '<!-- pr-ref-link: allow-file -->'

// A lone bare ref needs two or more digits to flag. A single-digit `(#1)` in
// rendered prose is almost always an enumeration ordinal, not a tracker ref —
// the same discriminator scan-comments applies in its Tier-2 arm.
const MIN_LONE_REF_DIGITS = 2

// A markdown link-DEFINITION line (`[ref]: https://…`) is not prose; its label
// is a link target, not dead text, so the whole line is skipped.
const LINK_DEFINITION_RE = /^\s*\[[^\]]*\]:\s+\S/

// A `#N` written flush against an `owner/repo` slug (`pnpm/pnpm#13479`,
// `SocketDev/socket-mcp#182`) is an explicit cross-repo shorthand: it already
// names its own repo, so it is the anti-backref rule's surface, not a same-repo
// dead ref this gate could link. Anchored `$`, no trailing space, so only the
// flush `word/word#N` form matches — `and/or #12` (a space before `#`) does not.
const CROSS_REPO_SHORTHAND_RE = /[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

// Global copies of the canonical scan-comments regexes, so `exec` can walk every
// match on a line. Source and flags are reused verbatim — only `g` is added —
// so the two surfaces stay in lock-step. `lastIndex` is reset before each use.
export function withGlobalFlag(flags: string): string {
  return flags.includes('g') ? flags : `${flags}g`
}
// Verb-framed refs (`fixes` / `landed in` + a `#` number). Tier-1: always real.
const VERB_FRAMED_REF_RE = new RegExp(
  PROCESS_ISSUE_REF_RE.source,
  withGlobalFlag(PROCESS_ISSUE_REF_RE.flags),
)
// Lone `#N` refs. Canonical shape is `/#\d+\b/`; the two-digit floor is applied
// as a post-filter (see MIN_LONE_REF_DIGITS) so the reuse stays honest.
const LONE_REF_SCAN_RE = new RegExp(
  LONE_ISSUE_REF_RE.source,
  withGlobalFlag(LONE_ISSUE_REF_RE.flags),
)
// The `#\d+` token inside a matched verb-framed phrase.
const REF_TOKEN_RE = /#\d+/

/**
 * The line with every non-prose region masked to equal-length spaces: inline
 * code spans, existing markdown links in both inline and reference style, bare
 * URLs/autolinks, and HTML comments. Masking (not deletion) preserves column
 * offsets, so a match index maps straight back to a column in the raw line.
 * Pure.
 *
 * Inline links are masked BEFORE bare URLs on purpose: a URL run would
 * otherwise eat the trailing `)` of `[#N](url)` and strand the `#N` in the link
 * text, turning a compliant link into a false positive.
 */
export function maskNonProse(line: string): string {
  const blank = (m: string): string => ' '.repeat(m.length)
  let out = line
  // Inline code spans — a `#N` in code is not rendered prose.
  out = out.replace(/`[^`]*`/g, blank)
  // Inline markdown links `[text](url)` — a `[#N](url)` is COMPLIANT, the ref is
  // already the link text, so masking the whole construct means it never flags.
  out = out.replace(/\[[^\]]*\]\([^)]*\)/g, blank)
  // Reference-style links `[text][ref]` and `[text][]` — also compliant links.
  out = out.replace(/\[[^\]]*\]\[[^\]]*\]/g, blank)
  // Bare URLs / autolinks — a `#N` fragment inside a URL is not a dead ref.
  out = out.replace(/<?https?:\/\/[^\s>]+>?/g, blank)
  // HTML comments carry machine markers, not rendered prose.
  out = out.replace(/<!--[\s\S]*?-->/g, blank)
  return out
}

/**
 * One entry per unlinked PR/issue ref in markdown prose, 1-based line and
 * column, with the offending `#N` token. Honors both escape hatches, skips
 * fenced blocks and link-definition lines, and exempts a lone ref on an
 * upstream-Node-provenance line. Pure over its input.
 */
export function scanMarkdownForUnlinkedRefs(
  content: string,
): Array<{ line: number; col: number; ref: string }> {
  if (content.includes(PR_REF_LINK_ALLOW_FILE)) {
    return []
  }
  const out: Array<{ line: number; col: number; ref: string }> = []
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (
      inFence ||
      raw.includes(PR_REF_LINK_ALLOW_LINE) ||
      LINK_DEFINITION_RE.test(raw)
    ) {
      continue
    }
    const prose = maskNonProse(raw)
    const covered = new Set<number>()
    const hits: Array<{ line: number; col: number; ref: string }> = []
    // Verb-framed refs — Tier-1 in scan-comments, so flagged regardless of any
    // upstream-Node context on the line.
    VERB_FRAMED_REF_RE.lastIndex = 0
    let vm: RegExpExecArray | null
    while ((vm = VERB_FRAMED_REF_RE.exec(prose))) {
      const token = REF_TOKEN_RE.exec(vm[0])
      if (!token) {
        continue
      }
      const at = vm.index + token.index
      if (CROSS_REPO_SHORTHAND_RE.test(prose.slice(0, at))) {
        continue
      }
      if (!covered.has(at)) {
        covered.add(at)
        hits.push({ line: i + 1, col: at + 1, ref: token[0] })
      }
    }
    // Lone bare refs — Tier-2. scan-comments only treats a lone `#N` as a real
    // ref when a strong process verb (merged/landed/reverts/…) co-occurs on the
    // line; without one a bare `#N` is an ordinal ("the #10 tell"), an
    // enumeration, or a citation, not a live ref, so it is left alone. Reusing
    // that co-occurrence keeps this gate as smart as the commit-comment scanner.
    // Still exempt on an upstream-Node-provenance line.
    if (PROCESS_WORD_RE.test(raw) && !UPSTREAM_CONTEXT_RE.test(raw)) {
      LONE_REF_SCAN_RE.lastIndex = 0
      let lm: RegExpExecArray | null
      while ((lm = LONE_REF_SCAN_RE.exec(prose))) {
        const digits = lm[0].length - 1
        if (
          digits < MIN_LONE_REF_DIGITS ||
          covered.has(lm.index) ||
          CROSS_REPO_SHORTHAND_RE.test(prose.slice(0, lm.index))
        ) {
          continue
        }
        covered.add(lm.index)
        hits.push({ line: i + 1, col: lm.index + 1, ref: lm[0] })
      }
    }
    // Column order within the line — the two passes gather out of order.
    hits.sort((a, b) => a.col - b.col)
    out.push(...hits)
  }
  return out
}

/**
 * Every unlinked ref across the given relative markdown paths, formatted
 * `path:line:col #ref`, sorted.
 */
export function scanFilesForUnlinkedRefs(
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
    const hits = scanMarkdownForUnlinkedRefs(content)
    for (let j = 0, { length: hlen } = hits; j < hlen; j += 1) {
      const hit = hits[j]!
      offenders.push(`${rel}:${hit.line}:${hit.col} ${hit.ref}`)
    }
  }
  return offenders.toSorted()
}

/**
 * Every unlinked PR/issue ref across the repo's tracked markdown. Empty when
 * the prose is clean.
 */
export function findUnlinkedRefs(repoRoot: string): string[] {
  return scanFilesForUnlinkedRefs(repoRoot, collectMarkdownFiles(repoRoot))
}

export function main(): number {
  // Non-flag args scope the scan to explicit paths; otherwise the whole tracked
  // markdown tree gates.
  const paths = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const offenders = paths.length
    ? scanFilesForUnlinkedRefs(REPO_ROOT, paths.toSorted())
    : findUnlinkedRefs(REPO_ROOT)
  if (offenders.length) {
    logger.fail(
      '[pr-refs-in-docs-are-linked] markdown prose has bare PR/issue refs that render as dead text:',
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ✗ ${offenders[i]!}`)
    }
    logger.error(
      '  A bare #N does not auto-link in a rendered .md file or a terminal report.',
    )
    logger.error(
      '  Write it as an explicit link, e.g. [#7317](https://github.com/<owner>/<repo>/pull/7317).',
    )
    logger.error(
      `  Keep an intentional bare ref with '${PR_REF_LINK_ALLOW_LINE}'.`,
    )
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[pr-refs-in-docs-are-linked] markdown prose keeps PR/issue refs linked.',
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'check that PR and issue refs in docs prose are written as markdown links',
  help: `Usage: node scripts/fleet/check/pr-refs-in-docs-are-linked.mts [paths...] [flags]
  [paths...]   scope the scan to these files (default: the tracked markdown tree)
  --quiet      suppress the success line`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
