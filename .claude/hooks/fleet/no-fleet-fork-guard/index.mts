#!/usr/bin/env node
// Claude Code PreToolUse hook — no-fleet-fork-guard.
//
// Blocks Edit/Write tool calls that target a fleet-canonical file
// path inside a downstream fleet repo. The fleet rule
// ("Never fork fleet-canonical files locally") says these files
// MUST be edited in socket-wheelhouse/template/... and cascaded
// out via sync-scaffolding — never branched locally in a downstream
// repo. Local forks turn into "drift to preserve" hacks that block
// fleet-wide improvements from reaching the forked repo.
//
// The hook detects a fleet-canonical edit by:
//   1. Resolving the absolute file path of the Edit/Write target.
//   2. Checking if the path is INSIDE socket-wheelhouse/template/
//      → allow (this IS the canonical home).
//   3. Otherwise, checking if the relative path contains /repo/ as a
//      path segment → allow (per-repo, not cascaded).
//   4. Otherwise, probing whether template/<rel> exists in the wheelhouse
//      → block if it does (the template is the single source of truth).
//
// The bypass phrase: `Allow fleet-fork bypass`. Reading the recent
// user turns from the transcript follows the same pattern as the
// no-revert-guard hook.
//
// Why a hook on top of the CLAUDE.md rule + memory: the rule
// documents the policy, the memory keeps the assistant honest across
// sessions, the hook is the actual enforcement at edit time. Catches
// the failure mode where Claude reaches for a "quick fix" in a
// downstream repo's canonical file (typically because the local
// version has a known bug and the user is in a hurry to land
// something else). The block flips the workflow back to
// "fix-in-template, cascade out" where it belongs.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit" | "Write" | "MultiEdit",
//     "tool_input": { "file_path": "...", ... },
//     "transcript_path": "/.../session.jsonl" }
//
// Exits:
//   0 — allowed (not a fleet-canonical edit, OR target is the template,
//       OR bypass phrase present).
//   2 — blocked (with a stderr message that explains the rule + the
//       canonical fix path + the bypass phrase).
//   0 (with stderr log) — fail-open on hook bugs so a bad deploy can't
//       brick the session.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { isDirSync } from '@socketsecurity/lib-stable/fs/inspect'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?:
    | {
        file_path?: string | undefined
        content?: string | undefined
        new_string?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

// True when a string carries both fleet-block markers. Two marker dialects are
// recognized: the lowercase parenthetical form used by gitignore / gitattributes
// / workflows (`BEGIN fleet-canonical (managed by socket-wheelhouse …)`), and
// the uppercase form CLAUDE.md uses (`<!-- BEGIN FLEET-CANONICAL … -->`). Both
// mark a HYBRID file: only the content between the markers is canonical, so the
// preamble + `🏗️ Project-Specific` postamble are repo-owned and editing them is
// not a fork. A fork INSIDE the block is still caught by the sync's
// claude_md_fleet_drift / *-fleet-block checks at commit time.
function textHasFleetBlockMarkers(text: string | undefined): boolean {
  if (text === undefined) {
    return false
  }
  const lowerForm =
    text.includes('BEGIN fleet-canonical (managed by socket-wheelhouse') &&
    text.includes('END fleet-canonical')
  const upperForm =
    text.includes('BEGIN FLEET-CANONICAL') &&
    text.includes('END FLEET-CANONICAL')
  return lowerForm || upperForm
}

const BYPASS_PHRASE = 'Allow fleet-fork bypass'

// How many recent user turns to scan for the bypass phrase. Matches
// the no-revert-guard hook's window.
const BYPASS_LOOKBACK_USER_TURNS = 8

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
 * FLEET-CANONICAL marker. Returns the repo root path or undefined if the file
 * is outside a fleet repo.
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
        if (claudeContent.includes('BEGIN FLEET-CANONICAL')) {
          return cur
        }
      } catch {
        // unreadable — skip and continue walking up
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  return undefined
}

// True when the on-disk file carries the fleet-block BEGIN/END markers — i.e.
// it's a hybrid file whose content outside the markers is repo-owned. The
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
  return PER_REPO_MARKER_PATHS.includes(rel.replace(/\\/g, '/'))
}

export function isCanonicalRelativePath(
  rel: string,
  repoRoot?: string | undefined,
): boolean {
  const normalized = rel.replace(/\\/g, '/')
  if (!repoRoot) {
    return false
  }
  const dir = path.posix.dirname(normalized)
  // Root-level files (dir === '.') have no parent dir to probe — `template/.`
  // is the template dir itself and ALWAYS exists, which would wrongly mark
  // EVERY root file (pnpm-workspace.yaml, package.json) as canonical. Root
  // config like pnpm-workspace.yaml is the wheelhouse's OWN source of truth
  // (synthesized into downstream via the cascade, not via a template/ copy) —
  // there is no `template/pnpm-workspace.yaml`. So for a root file, require an
  // actual `template/<file>` to exist before calling it canonical.
  if (dir === '.') {
    return existsSync(path.join(repoRoot, 'template', normalized))
  }
  // A file is fleet-canonical iff its parent directory exists under template/
  // in the wheelhouse. Directory-level: if the dir is in the template, every
  // file in that dir is canonical.
  return isDirSync(path.join(repoRoot, 'template', dir))
}

export function isInsideTemplate(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return TEMPLATE_PATH_TOKENS.some(token => normalized.includes(token))
}

async function main(): Promise<number> {
  const raw = await readStdin()
  if (!raw.trim()) {
    return 0
  }

  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.stderr.write(
      'no-fleet-fork-guard: failed to parse stdin payload — fail-open\n',
    )
    return 0
  }

  const tool = payload.tool_name
  if (tool !== 'Edit' && tool !== 'MultiEdit' && tool !== 'Write') {
    return 0
  }

  const filePath = payload.tool_input?.file_path
  if (!filePath) {
    return 0
  }

  const absPath = path.resolve(filePath)

  // The canonical home is allowed.
  if (isInsideTemplate(absPath)) {
    return 0
  }

  // Walk up to find the fleet repo root. If the file isn't inside a
  // fleet repo at all, this hook doesn't apply — let it through.
  const repoRoot = findFleetRepoRoot(absPath)
  if (!repoRoot) {
    return 0
  }

  const relToRepo = path.relative(repoRoot, absPath)

  // Per-repo marker files carry per-repo content (EXPECTED_FILES, not
  // IDENTICAL_FILES) — editing them downstream is expected, not a fork.
  if (isPerRepoMarkerPath(relToRepo)) {
    return 0
  }

  if (!isCanonicalRelativePath(relToRepo, repoRoot)) {
    return 0
  }

  // Fleet-block allowance: a canonical file that carries the
  // `# ─── BEGIN/END fleet-canonical ───` markers is only PART fleet-managed —
  // content outside the markers is repo-owned (e.g. a workflow's repo-specific
  // jobs below the END marker). Allow edits when the markers are present
  // either on disk OR in the incoming content (the bootstrap that first adds
  // the markers). The sync's workflow-fleet-block check re-validates the marked
  // block at commit time, so a fork INSIDE the block is still caught.
  const incoming =
    payload.tool_input?.content ?? payload.tool_input?.new_string
  if (hasFleetBlockMarkers(absPath) || textHasFleetBlockMarkers(incoming)) {
    return 0
  }

  // Bypass-phrase check.
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return 0
  }

  process.stderr.write(
    [
      `🚨 no-fleet-fork-guard: blocked Edit/Write to fleet-canonical path.`,
      ``,
      `File:  ${relToRepo}`,
      `Repo:  ${path.basename(repoRoot)}`,
      ``,
      `Fleet-canonical files (anything tracked by`,
      `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts) MUST`,
      `be edited in socket-wheelhouse/template/${relToRepo} and`,
      `cascaded out — never branched locally in a downstream fleet repo.`,
      ``,
      `Fix path:`,
      `  1. Edit socket-wheelhouse/template/${relToRepo}`,
      `  2. Commit + push template`,
      `  3. Cascade with: node scripts/sync-scaffolding/cli.mts \\`,
      `       --target ${repoRoot} --fix`,
      ``,
      `If you genuinely need to bypass (e.g. emergency hotfix that`,
      `can't wait for cascade), the user must type \`${BYPASS_PHRASE}\``,
      `verbatim in a recent user turn. Reference:`,
      `docs/claude.md/no-local-fork-canonical.md`,
      ``,
    ].join('\n'),
  )
  return 2
}

main().then(
  code => process.exit(code),
  e => {
    process.stderr.write(
      `no-fleet-fork-guard: hook bug — fail-open. ${errorMessage(e)}\n`,
    )
    process.exit(0)
  },
)
