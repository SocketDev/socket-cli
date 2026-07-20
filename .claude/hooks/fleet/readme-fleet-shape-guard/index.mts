#!/usr/bin/env node
// Claude Code PreToolUse hook — readme-fleet-shape-guard.
//
// Blocks Edit/Write of the root README.md when the resulting content
// violates the canonical fleet skeleton:
//
//   (a) Missing or out-of-order canonical section. The 5 level-2
//       sections must appear in this order:
//         Why this repo exists / Install / Usage / Development / License
//
//   (b) Mentions `socket-wheelhouse` outside fenced code blocks.
//       socket-wheelhouse is a private repo; the link 404s for outside
//       readers.
//
//   (c) Invokes a command against a sibling-repo relative path.
//       `node ../socket-foo/scripts/...` and similar shapes assume the
//       reader has the sibling repo checked out at exactly the right
//       relative level — almost never true for an outside user.
//
//   (d) Missing a canonical social-follow badge. Every fleet README
//       carries both the X / Twitter and Bluesky follow badges under
//       the title (byte-identical fleet-canonical).
//
// Only fires on the REPO-ROOT README.md (basename === 'README.md' AND
// directory is repo root). Nested READMEs (packages/, docs/, .claude/,
// etc.) are scoped docs with their own shape; this hook is silent for
// them.
//
// Bypass phrase: `Allow readme-fleet-shape bypass`. Reading recent user
// turns follows the same pattern as no-revert-guard, plan-location-guard.
//
// Companion to:
//   - scripts/sync-scaffolding/checks/readme-skeleton-drift.mts
//     (sync-time check, no autofix)
//   - template/.config/fleet/markdownlint-rules/socket-{readme-required-sections,
//     readme-social-badges, no-private-wheelhouse-leak,
//     no-relative-sibling-script}.mts (lint-time check)
//
// This hook is the edit-time enforcement — it fires when the README is
// being written, catching the failure mode at its earliest surface.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetRepo } from '../_shared/fleet-repos.mts'
import {
  isOptedIn,
  loadRosterFromRepo,
  resolveRepoName,
} from '../_shared/fleet-roster.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
} from '../_shared/transcript.mts'
import { isWheelhouseRoot } from '../_shared/wheelhouse-root.mts'

const BYPASS_PHRASE = 'Allow readme-fleet-shape bypass'

// A NON-fleet repo adopts the shape by OPT-IN (adoption, not a bypass — it
// turns enforcement ON where the default is off): durably via the marker
// file, or for the session via this phrase (bare, or scoped `: <repo>`).
// Phrase matching is separator/case tolerant (`Opt-in` / `opt in` / `optin`
// all count). The Socket social-follow badges are fleet branding and are
// never asked of a foreign repo.
const OPT_IN_PHRASE = 'Opt-in readme-fleet-shape'
const OPT_IN_MARKER = '.config/readme-fleet-shape.json'

const REQUIRED_SECTIONS = [
  'Why this repo exists',
  'Install',
  'Usage',
  'Development',
  'License',
] as const

const WHEELHOUSE_LEAK_RE = /socket-wheelhouse/i
const SIBLING_PATH_RES: readonly RegExp[] = [
  /\b(?:bun|deno|node|npm|pnpm|yarn)\s+\.\.\/[\w@-]+\//,
  /(?:^|\s)\.\.\/socket-[\w-]+\//i,
  /(?:^|\s)\.\.\/sdxgen\//,
  /(?:^|\s)\.\.\/stuie\//,
]

// The canonical social-follow badge block every fleet README carries under
// the title (byte-identical fleet-canonical, not repo-contextual). Both must
// be present. Matched by the stable LINK target, not the badge image, so an
// image-host change (shields.io → the local assets/fleet/ SVGs) or reworded
// alt-text still counts.
const SOCIAL_BADGES: ReadonlyArray<{ name: string; signature: RegExp }> = [
  { name: 'Bluesky follow', signature: /bsky\.app\/profile\/socket\.dev/ },
  {
    name: 'X / Twitter follow',
    signature: /(?:twitter|x)\.com\/SocketSecurity/,
  },
]

// Repo root of THIS hook installation — the authoritative roster source. The
// hook lives at <repoRoot>/.claude/hooks/fleet/readme-fleet-shape-guard/
// index.mts, so the root is four levels up. loadRosterFromRepo prefers the
// in-repo template seed, so the wheelhouse resolves its own canonical roster and
// a member resolves its cascaded copy.
const HOOK_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
)

/**
 * True when the repo owning `readmePath` has opted into a freeform
 * (non-skeleton) README via the cascade roster's `optIns: ['freeform-readme']`.
 * Such a repo's README is product / marketplace-shaped, exempt from the
 * five-section skeleton; the universal social badges, wheelhouse-leak, and
 * sibling-path rules still apply. The target repo name is resolved from the
 * README's own directory, so a wheelhouse session editing a sibling member's
 * README looks the member up in the wheelhouse's authoritative roster.
 */
/**
 * Non-fleet opt-in check. A foreign repo (origin not in the fleet roster)
 * owns its README shape by default; it ADOPTS the fleet skeleton + hygiene
 * rules (minus the social badges) either durably — a
 * `.config/readme-fleet-shape.json` with `{"optIn": true}` at its root — or
 * for the session via the opt-in phrase.
 */
export function foreignReadmeOptIn(
  readmeDir: string,
  repoName: string,
  transcriptPath: string | undefined,
): boolean {
  const repoRoot = findRepoRoot(readmeDir)
  if (repoRoot) {
    try {
      const parsed = JSON.parse(
        readFileSync(path.join(repoRoot, OPT_IN_MARKER), 'utf8'),
      ) as { optIn?: unknown | undefined } | undefined
      if (parsed?.optIn === true) {
        return true
      }
    } catch {
      // No marker (or unreadable/malformed) — fall through to the phrase.
    }
  }
  return bypassPhrasePresent(
    transcriptPath,
    [OPT_IN_PHRASE, `${OPT_IN_PHRASE}: ${repoName}`],
    BYPASS_LOOKBACK_USER_TURNS,
  )
}

export function isFreeformReadmeRepo(readmePath: string): boolean {
  const repoName = resolveRepoName(path.dirname(readmePath))
  if (!repoName) {
    return false
  }
  const roster = loadRosterFromRepo(HOOK_REPO_ROOT)
  /* c8 ignore start - safety net: roster always present when running from the wheelhouse repo */
  if (!roster) {
    return false
  }
  /* c8 ignore stop */
  return isOptedIn(roster, repoName, 'freeform-readme')
}

/**
 * Repo-root README detection. The hook only fires on the root README.md, not
 * nested READMEs. The check is path-shape only — basename match + parent
 * directory ≠ another README's parent.
 */
/**
 * Walk up from `startDir` to the repo root — the nearest ancestor holding a
 * `.git` entry (a directory in a normal checkout, a file in a linked worktree).
 * Returns undefined when no `.git` is found (the path is not inside a git
 * repo).
 */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = startDir
  while (!existsSync(path.join(dir, '.git'))) {
    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
  return dir
}

export function isRootReadme(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (path.basename(normalized) !== 'README.md') {
    return false
  }
  const dir = path.dirname(normalized)
  // Positively identify the repo root rather than allowlisting "scoped parent"
  // directory names: the README is the ROOT readme only when its directory IS
  // the repo root (the nearest ancestor holding a `.git` entry). The old
  // allowlist misclassified a README in any UNLISTED subdir (ci/, benches/,
  // assets/, npm/, docker/, scratchpad paths) as the repo-root README and
  // forced it into the fleet skeleton + social badges.
  const repoRoot = findRepoRoot(dir)
  return repoRoot !== undefined && normalizePath(repoRoot) === dir
}

/**
 * Compute the post-edit text for an Edit (splice old_string → new_string
 * against the on-disk file) or a Write (just `content`). Returns undefined when
 * the post-edit text can't be reliably computed (Edit against a file that
 * doesn't exist, or old_string not found).
 */
export function computePostEditText(
  toolName: string,
  filePath: string,
  newString: string | undefined,
  oldString: string | undefined,
  content: string | undefined,
): string | undefined {
  if (toolName === 'Write') {
    return content
  }
  if (toolName === 'Edit' || toolName === 'MultiEdit') {
    if (!existsSync(filePath)) {
      // Edit against a non-existent file is unusual; let it through.
      return undefined
    }
    let onDisk: string
    try {
      onDisk = readFileSync(filePath, 'utf8')
    } catch {
      /* c8 ignore start - TOCTOU: existsSync passed but readFileSync failed; unreachable in tests */
      return undefined
      /* c8 ignore stop */
    }
    if (oldString === undefined || newString === undefined) {
      return undefined
    }
    const idx = onDisk.indexOf(oldString)
    if (idx === -1) {
      return undefined
    }
    return (
      onDisk.slice(0, idx) + newString + onDisk.slice(idx + oldString.length)
    )
  }
  return undefined
}

interface ShapeFinding {
  kind:
    | 'missing-section'
    | 'missing-social-badges'
    | 'relative-sibling'
    | 'wheelhouse-leak'
  detail: string
}

export function findShapeViolations(
  text: string,
  options?: {
    skipSkeleton?: boolean | undefined
    skipSocialBadges?: boolean | undefined
  },
): ShapeFinding[] {
  const opts = { __proto__: null, ...options }
  const lines = text.split('\n')
  const findings: ShapeFinding[] = []

  // The five-section skeleton is infra-repo shape; product / marketplace repos
  // opt out via the roster (`freeform-readme`). The badge, wheelhouse-leak, and
  // sibling-path checks below stay universal regardless.
  if (!opts.skipSkeleton) {
    const headings: string[] = []
    for (let i = 0, { length } = lines; i < length; i += 1) {
      /* c8 ignore next */
      const m = /^##\s+(?<heading>.+?)\s*$/.exec(lines[i] ?? '')
      if (m && m.groups?.heading) {
        headings.push(m.groups.heading)
      }
    }
    let cursor = 0
    for (let r = 0, { length } = REQUIRED_SECTIONS; r < length; r += 1) {
      const want = REQUIRED_SECTIONS[r]
      let found = -1
      for (let h = cursor; h < headings.length; h += 1) {
        if (headings[h] === want) {
          found = h
          break
        }
      }
      if (found === -1) {
        findings.push({
          kind: 'missing-section',
          detail: `Missing canonical section "## ${want}" (or out of order)`,
        })
        break
      }
      cursor = found + 1
    }
  }

  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    /* c8 ignore next */
    const line = lines[i] ?? ''
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    if (WHEELHOUSE_LEAK_RE.test(line)) {
      findings.push({
        kind: 'wheelhouse-leak',
        detail: `Line ${i + 1} mentions socket-wheelhouse: ${line.trim().slice(0, 120)}`,
      })
      break
    }
  }

  for (let i = 0, { length } = lines; i < length; i += 1) {
    /* c8 ignore next */
    const line = lines[i] ?? ''
    let matched = false
    for (let j = 0, jl = SIBLING_PATH_RES.length; j < jl; j += 1) {
      if (SIBLING_PATH_RES[j]!.test(line)) {
        matched = true
        break
      }
    }
    if (matched) {
      findings.push({
        kind: 'relative-sibling',
        detail: `Line ${i + 1} invokes a sibling-relative path: ${line.trim().slice(0, 120)}`,
      })
      break
    }
  }

  if (!opts.skipSocialBadges) {
    for (let i = 0, { length } = SOCIAL_BADGES; i < length; i += 1) {
      const badge = SOCIAL_BADGES[i]!
      if (!badge.signature.test(text)) {
        findings.push({
          kind: 'missing-social-badges',
          detail: `Missing the canonical "${badge.name}" badge (every fleet README carries both the X / Twitter and Bluesky follow badges under the title)`,
        })
      }
    }
  }

  return findings
}

export const check = editGuard((filePath, content, payload) => {
  if (!isRootReadme(filePath)) {
    return undefined
  }

  // The wheelhouse SOURCE repo's own root README is detailed self-documentation
  // that legitimately names itself — the skeleton + no-leak shape applies to
  // MEMBER repos (whose README is the cascaded skeleton), not the source. The
  // sync-time companion (readme-skeleton-drift.mts) already exempts the source
  // (`path.resolve(targetDir) === REPO_ROOT`); without the same exemption here
  // the edit-time guard is STRICTER than its own check, blocking every edit to
  // the source README behind a bypass. Marker: template/CLAUDE.md (wheelhouse
  // only). isWheelhouseRoot checks THIS README's repo, so a member is unaffected.
  if (isWheelhouseRoot(path.dirname(filePath))) {
    return undefined
  }

  // The full shape (badges included) is the fleet's contract with itself; a
  // NON-fleet repo never owes the Socket follow badges, and owes the rest of
  // the shape only after adopting it via the opt-in marker/phrase. No opt-in →
  // the README is entirely the repo's own business.
  const readmeDir = path.dirname(filePath)
  const repoName = resolveRepoName(readmeDir)
  const isForeign = !repoName || !isFleetRepo(repoName)
  if (
    isForeign &&
    !foreignReadmeOptIn(readmeDir, repoName ?? '', payload.transcript_path)
  ) {
    return undefined
  }

  const tool = payload.tool_name!
  const input = payload.tool_input
  const newString =
    typeof input?.new_string === 'string' ? input.new_string : undefined
  const oldString =
    typeof input?.old_string === 'string' ? input.old_string : undefined

  const postEdit = computePostEditText(
    tool,
    filePath,
    newString,
    oldString,
    content,
  )
  if (postEdit === undefined) {
    return undefined
  }

  const findings = findShapeViolations(postEdit, {
    skipSkeleton: isFreeformReadmeRepo(filePath),
    skipSocialBadges: isForeign,
  })
  if (findings.length === 0) {
    return undefined
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  const lines: string[] = [
    `🚨 readme-fleet-shape-guard: blocked Edit/Write of root README.md.`,
    ``,
    `File: ${filePath}`,
    ``,
    `Violations:`,
  ]
  for (let i = 0, { length } = findings; i < length; i += 1) {
    lines.push(`  - ${findings[i]!.detail}`)
  }
  lines.push(``)
  lines.push(
    `Per the fleet "Canonical README" rule (CLAUDE.md → Canonical README),`,
  )
  lines.push(`root README.md must follow the skeleton at:`)
  lines.push(`  socket-wheelhouse/template/README.md`)
  lines.push(``)
  lines.push(`Required sections in order:`)
  for (let i = 0, { length } = REQUIRED_SECTIONS; i < length; i += 1) {
    lines.push(`  ${i + 1}. ## ${REQUIRED_SECTIONS[i]}`)
  }
  lines.push(``)
  lines.push(
    `One-shot bypass (rare): user types "${BYPASS_PHRASE}" verbatim in a recent message.`,
  )
  lines.push(``)
  return block(lines.join('\n'))
})

export const hook = defineHook({
  bypass: ['readme-fleet-shape'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
