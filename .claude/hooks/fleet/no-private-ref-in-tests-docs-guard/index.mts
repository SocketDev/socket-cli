#!/usr/bin/env node
// Claude Code PreToolUse hook — no-private-ref-in-tests-docs-guard.
//
// HARD-BLOCKS Write/Edit of a unit-test or documentation file whose new
// content references non-public infrastructure:
//
//   - a `SocketDev/<repo>` slug (or github.com/SocketDev URL, or
//     git@github.com:SocketDev remote) whose repo is NOT in the fleet roster —
//     the roster (`fleet-repos.json`) is the SOLE sanctioned private-name
//     list, so any org repo outside it must not be named in tests/docs
//     (fictional slugs like `acme/widgets` instead);
//   - a `linear.app` issue URL;
//   - a Slack thread/archive link.
//
// Tests and docs ship in public repos and survive squashes — a private repo
// name, ticket, or thread link in them is a durable leak. The sibling
// `private-name-nudge` primes the same rule on Bash publish surfaces; this
// guard enforces the deterministic subset at file-write time. Company and
// customer NAMES stay nudge-territory: a denylist of them would itself be
// the leak.
//
// Bypass: `Allow private-ref-in-tests-docs bypass` in a recent user turn
// (e.g. a doc legitimately citing a public non-fleet SocketDev repo).

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { FLEET_REPO_NAMES } from '../_shared/fleet-repos.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow private-ref-in-tests-docs bypass'

// SocketDev org references in any of the shapes that name a repo:
//   SocketDev/<repo>   github.com/SocketDev/<repo>   git@github.com:SocketDev/<repo>
const ORG_REPO_RE = /\bSocketDev[/:]([\w.-]+)/g // socket-lint: allow uncommented-regex

const LINEAR_RE = /\blinear\.app\//i // socket-lint: allow uncommented-regex
const SLACK_RE = /\b(?:app\.)?slack\.com\/(?:archives|client)\//i // socket-lint: allow uncommented-regex

const FLEET_NAMES_LOWER: ReadonlySet<string> = new Set(
  FLEET_REPO_NAMES.map(n => n.toLowerCase()),
)

// True when `filePath` is a unit-test or documentation surface. Plans +
// reports under .claude/ are non-committable scratch, not shipped docs.
export function isTestOrDocPath(filePath: string): boolean {
  const p = normalizePath(filePath)
  if (p.includes('/.claude/plans/') || p.includes('/.claude/reports/')) {
    return false
  }
  if (/\.test\.[cm]?[jt]sx?$/.test(p) || p.includes('/test/')) {
    return true
  }
  return p.endsWith('.md') || p.includes('/docs/')
}

// The private references found in `content`: non-roster SocketDev repo slugs,
// Linear URLs, Slack thread links. Empty when the content is clean.
export function privateRefsIn(content: string): string[] {
  const found: string[] = []
  for (const m of content.matchAll(ORG_REPO_RE)) {
    const repo = m[1]!.replace(/\.git$/, '')
    if (!FLEET_NAMES_LOWER.has(repo.toLowerCase())) {
      found.push(`SocketDev/${repo} (not in the fleet roster)`)
    }
  }
  if (LINEAR_RE.test(content)) {
    found.push('a linear.app issue URL')
  }
  if (SLACK_RE.test(content)) {
    found.push('a Slack thread link')
  }
  return [...new Set(found)]
}

export const hook = defineHook({
  check: editGuard((filePath, content, payload) => {
    if (!isTestOrDocPath(filePath)) {
      return undefined
    }
    if (!content) {
      return undefined
    }
    const refs = privateRefsIn(content)
    if (!refs.length) {
      return undefined
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return undefined
    }
    return block(
      [
        '[no-private-ref-in-tests-docs-guard] Blocked: private reference in a test/doc file.',
        '',
        `  File:  ${filePath}`,
        ...refs.map(r => `  Found: ${r}`),
        '',
        '  Unit tests and docs ship publicly and survive squashes. Use a',
        '  FICTIONAL slug (e.g. acme/widgets) — never a real private repo,',
        '  Linear issue, or Slack thread. The fleet roster (fleet-repos.json)',
        '  is the only sanctioned place private repo names appear.',
        '',
        `  Bypass: type "${BYPASS_PHRASE}" if this reference is genuinely public.`,
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
