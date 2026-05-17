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
//   3. Otherwise, checking if the path matches a fleet-canonical
//      surface prefix:
//        - .config/oxlint-plugin/
//        - .git-hooks/
//        - .claude/hooks/
//        - .claude/skills/_shared/
//        - docs/claude.md/
//      → block.
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

import {
  bypassPhrasePresent,
  readStdin,
} from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?: { file_path?: string } | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

// Fleet-canonical directory prefixes. Matches relative-to-repo-root.
// Order matters for nested prefixes (more-specific first), but these
// are all leaves — no nesting between them.
const CANONICAL_PREFIXES = [
  '.config/oxlint-plugin/',
  '.git-hooks/',
  '.claude/hooks/',
  '.claude/skills/_shared/',
  'docs/claude.md/',
]

// Fleet-canonical individual files (not under one of the prefix
// dirs). Matches relative-to-repo-root.
const CANONICAL_FILES: string[] = [
  // Add specific files here when needed. Most canonical content lives
  // under the prefix dirs above.
]

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
 * Find the fleet repo root for an absolute file path by walking up
 * until we hit a directory that has package.json AND a CLAUDE.md
 * containing the FLEET-CANONICAL marker. Returns the repo root path
 * or undefined if the file is outside a fleet repo.
 */
function findFleetRepoRoot(filePath: string): string | undefined {
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

function isInsideTemplate(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return TEMPLATE_PATH_TOKENS.some(token => normalized.includes(token))
}

function isCanonicalRelativePath(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/')
  for (const prefix of CANONICAL_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return true
    }
  }
  return CANONICAL_FILES.includes(normalized)
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
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') {
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

  if (!isCanonicalRelativePath(relToRepo)) {
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
