/*
 * @file The fleet-fork decision engine — "is this Edit/Write a local fork of a
 *   fleet-canonical file?" Shared by the Claude `no-fleet-fork-guard` hook and
 *   the cross-CLI adapters (`scripts/fleet/cross-cli/fleet-fork-detect.mts`
 *   turns Codex/Kimi tool calls into paths and runs each through this same
 *   `check`), so every CLI enforces the identical rule from a single source of
 *   truth. Lives under `_shared/` (ships to members, survives the bundle-only
 *   cutover) because the cascaded cross-CLI adapters run in members.
 *   The check detects a fleet-canonical edit by:
 *
 *   1. Resolving the absolute file path of the Edit/Write target.
 *   2. Checking if the path is INSIDE socket-wheelhouse/template/ → allow (this IS
 *      the canonical home).
 *   3. Otherwise, resolving the repo's canonical set from its `.gitattributes`
 *      `linguist-generated=true` entries → block when the path is canonical
 *      (the template is the single source of truth), with allowances for
 *      per-repo markers, operator-local overrides, fleet-block hybrid files,
 *      and the bypass phrase.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  containsFleetBeginMarker,
  textHasFleetBlockMarkers,
} from './fleet-markers.mts'
import { block, editGuard } from './guard.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
} from './transcript.mts'
import { isWheelhouseRoot } from './wheelhouse-root.mts'

const BYPASS_PHRASE = 'Allow fleet-fork bypass'

// File-path tokens that identify the socket-wheelhouse canonical
// home. If the resolved absolute path contains one of these, we're
// editing the source of truth — allow.
//
// `socket-wheelhouse/template/` covers the standard checkout shape
// (e.g. /Users/<user>/projects/socket-wheelhouse/template/...).
// `repo-template/template/` covers any rename / mirror / fork that
// keeps the trailing component.
const TEMPLATE_PATH_TOKENS = [
  '/socket-wheelhouse/template/',
  '/repo-template/template/',
]

/**
 * Find the fleet repo root for an absolute file path by walking up until we hit
 * a directory that has package.json AND a CLAUDE.md containing the
 * `<fleet-canonical>` marker. Returns the repo root path or undefined if the
 * file is outside a fleet repo.
 */
export function findFleetRepoRoot(filePath: string): string | undefined {
  let cur = path.dirname(filePath)
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    const pkgPath = path.join(cur, 'package.json')
    const claudePath = path.join(cur, 'CLAUDE.md')
    if (existsSync(pkgPath) && existsSync(claudePath)) {
      try {
        const claudeContent = readFileSync(claudePath, 'utf8')
        if (containsFleetBeginMarker(claudeContent)) {
          return cur
        }
      } catch {
        // unreadable — skip and continue walking up
      }
    }
    const parent = path.dirname(cur)
    /* c8 ignore start - parent===cur only fires on relative paths or exotic FSes; unreachable with absolute paths on Unix */
    if (parent === cur) {
      break
    }
    /* c8 ignore stop */
    cur = parent
  }
  return undefined
}

// True when the on-disk file carries the `<fleet-canonical>` block markers —
// i.e. it's a hybrid file whose content outside the markers is repo-owned. The
// markers are the same comment sentinels the sync's *-fleet-block checks use
// (gitignore, gitattributes, workflows). Comment-prefix-agnostic: match the
// marker text regardless of the leading `#`.
function hasFleetBlockMarkers(absPath: string): boolean {
  if (!existsSync(absPath)) {
    return false
  }
  try {
    return textHasFleetBlockMarkers(readFileSync(absPath, 'utf8'))
  } catch {
    /* c8 ignore next - file exists but is unreadable; untestable without OS-level permission tricks */
    return false
  }
}

// Per-repo marker files: listed in the manifest's EXPECTED_FILES (presence
// required, CONTENT VARIES per repo), NOT IDENTICAL_FILES (byte-identical
// canonical). Every repo's socket-wheelhouse.json carries its own repoName /
// layout / native / kind — editing it downstream is normal per-repo work, not a
// canonical fork. Without this exemption the parent-dir-under-template rule in
// isCanonicalRelativePath marks `.config/socket-wheelhouse.json` canonical
// (because template/.config/ exists), false-blocking legitimate marker edits.
const PER_REPO_MARKER_PATHS: readonly string[] = [
  '.config/socket-wheelhouse.json',
  '.socket-wheelhouse.json',
]

export function isPerRepoMarkerPath(rel: string): boolean {
  return PER_REPO_MARKER_PATHS.includes(normalizePath(rel))
}

// Operator-local files live INSIDE a canonical dir (`.claude/`) but are
// gitignored and never cascaded — Claude Code reads `settings.local.json` as a
// per-machine override. Without this exemption the parent-dir-under-template
// rule in isCanonicalRelativePath marks it canonical (because `template/.claude/`
// exists), false-blocking a legitimate local settings edit.
const OPERATOR_LOCAL_PATHS: readonly string[] = ['.claude/settings.local.json']

export function isOperatorLocalPath(rel: string): boolean {
  return OPERATOR_LOCAL_PATHS.includes(normalizePath(rel))
}

// The fleet-canonical file set is the repo's `.gitattributes`
// `linguist-generated=true` entries — a cascade-GENERATED projection of the sync
// manifest (IDENTICAL_FILES + OPTIONAL_IDENTICAL_FILES + generated globs, built
// by gitattributes-fleet-block.mts). `.gitattributes` ships to EVERY fleet repo,
// so this resolves canonical status in members AND the wheelhouse alike. The
// retired predecessor probed `<repoRoot>/template/<dir>`, which matched nothing:
// members carry no `template/`, and the wheelhouse moved its canonical source to
// `template/base/` — so the guard was inert everywhere.
export function fleetCanonicalEntries(repoRoot: string): string[] {
  let content = ''
  try {
    content = readFileSync(path.join(repoRoot, '.gitattributes'), 'utf8')
  } catch {
    return []
  }
  const entries: string[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = /^(\S+)\s.*\blinguist-generated=true\b/.exec(lines[i]!)
    if (match) {
      entries.push(normalizePath(match[1]!))
    }
  }
  return entries
}

export function isCanonicalRelativePath(
  rel: string,
  repoRoot?: string | undefined,
): boolean {
  if (!repoRoot) {
    return false
  }
  const normalized = normalizePath(rel)
  const entries = fleetCanonicalEntries(repoRoot)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    // Skip glob entries (supplemental generated globs) — this guard matches the
    // concrete canonical dirs + files; a glob is best-effort excluded so a bad
    // pattern can never over-block.
    if (entry.includes('*')) {
      continue
    }
    // Exact file match, or the edited path sits under a canonical dir entry.
    if (normalized === entry || normalized.startsWith(`${entry}/`)) {
      return true
    }
  }
  return false
}

export function isInsideTemplate(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return TEMPLATE_PATH_TOKENS.some(token => normalized.includes(token))
}

export const check = editGuard((filePath, content, payload) => {
  const absPath = path.resolve(filePath)

  // The canonical home is allowed.
  if (isInsideTemplate(absPath)) {
    return undefined
  }

  // Walk up to find the fleet repo root. If the file isn't inside a
  // fleet repo at all, this hook doesn't apply — let it through.
  const repoRoot = findFleetRepoRoot(absPath)
  if (!repoRoot) {
    return undefined
  }

  const relToRepo = path.relative(repoRoot, absPath)

  // Per-repo marker files carry per-repo content (EXPECTED_FILES, not
  // IDENTICAL_FILES) — editing them downstream is expected, not a fork.
  if (isPerRepoMarkerPath(relToRepo)) {
    return undefined
  }

  // Operator-local overrides (gitignored, never cascaded) are not forks.
  if (isOperatorLocalPath(relToRepo)) {
    return undefined
  }

  if (!isCanonicalRelativePath(relToRepo, repoRoot)) {
    return undefined
  }

  // Wheelhouse-own-README allowance: the wheelhouse's OWN root README.md is
  // authored repo content (`# socket-wheelhouse`, real badges, the Fleet-axes
  // prose), NOT a cascade copy of `template/README.md` — that template file is
  // the `<REPO_NAME>` placeholder fresh repos adopt, a DIFFERENT file. The
  // cascade synthesizes each downstream README from the placeholder + per-repo
  // data; it never overwrites the wheelhouse's own. So in the wheelhouse repo
  // (identified by the `template/CLAUDE.md` marker), editing root README.md is
  // legitimate authoring, not a downstream fork. Downstream repos still hit the
  // guard (they have no `template/`, so `isCanonicalRelativePath` already
  // returned false above for them anyway — this only matters in the wheelhouse).
  const relNormalized = normalizePath(relToRepo)
  if (relNormalized === 'README.md' && isWheelhouseRoot(repoRoot)) {
    return undefined
  }

  // Fleet-block allowance: a canonical file that carries `<fleet-canonical>`
  // open/close markers is only PART fleet-managed — content outside the markers
  // is repo-owned (e.g. a workflow's repo-specific jobs below the close marker).
  // Allow edits when the markers are present either on disk OR in the incoming
  // content (the bootstrap that first adds the markers). The sync's
  // workflow-fleet-block check re-validates the marked block at commit time, so
  // a fork INSIDE the block is still caught.
  if (hasFleetBlockMarkers(absPath) || textHasFleetBlockMarkers(content)) {
    return undefined
  }

  // Bypass-phrase check.
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  return block(
    [
      `🚨 no-fleet-fork-guard: blocked Edit/Write to fleet-canonical path.`,
      ``,
      `File:  ${relNormalized}`,
      `Repo:  ${path.basename(repoRoot)}`,
      ``,
      `Fleet-canonical files (anything tracked by`,
      `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts) MUST`,
      `be edited in socket-wheelhouse/template/${relNormalized} and`,
      `cascaded out — never branched locally in a downstream fleet repo.`,
      ``,
      `Fix path:`,
      `  1. Edit socket-wheelhouse/template/${relNormalized}`,
      `  2. Commit + push template`,
      `  3. Cascade with: node scripts/sync-scaffolding/cli.mts \\`,
      `       --target ${repoRoot} --fix`,
      ``,
      `If you genuinely need to bypass (e.g. emergency hotfix that`,
      `can't wait for cascade), the user must type \`${BYPASS_PHRASE}\``,
      `verbatim in a recent user turn. Reference:`,
      `docs/agents.md/fleet/no-local-fork.md`,
      ``,
    ].join('\n'),
  )
})
