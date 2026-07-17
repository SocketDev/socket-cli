#!/usr/bin/env node
/**
 * @file Generate the cross-harness rule adapters for a fleet repo so the repo's
 *   CLAUDE.md governs every AI host, not just Claude Code. Each host reads its
 *   rules from a host-named path; this emits a thin adapter at each. Adapters
 *   are MEMBER-GENERATED (run per-repo, per-platform) and gitignored, NOT
 *   tracked. Why member-side: a tracked symlink is checked out as a plain text
 *   file on Windows (without `core.symlinks` + privilege), so it would hold the
 *   literal target path instead of the rules. Generating on the member's own OS
 *   yields a real symlink on mac/linux and a regular pointer file on Windows.
 *   Plain-markdown hosts (AGENTS.md, Windsurf, Cline, Copilot) get a relative
 *   symlink to ./CLAUDE.md (pointer-file fallback on Windows). Cursor + Kiro
 *   need frontmatter, so they get a small generated file pointing at CLAUDE.md
 *   (no content copied — DRY). Usage: node
 *   scripts/fleet/gen-harness-adapters.mts [--check] (no flag) create/repair
 *   the adapters in place. --check report drift (missing / wrong target /
 *   stale) without writing; exit 1 if any. Used by the check-only twin.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The canonical rule file every adapter points at.
const RULES_FILE = 'CLAUDE.md'

// Pointer body for the frontmatter hosts and the Windows symlink fallback. Tiny
// on purpose — the rules live in CLAUDE.md and are never copied.
const POINTER_BODY =
  'The authoritative engineering rules for this repository are in ' +
  '`./CLAUDE.md` (`./AGENTS.md` points at the same file). Read and follow them.\n'

// Cursor `.mdc` wants frontmatter for an always-on rule; `@CLAUDE.md` pulls the
// file in where the host resolves references.
const CURSOR_MDC =
  '---\n' +
  'description: Socket fleet engineering rules (canonical source is ./CLAUDE.md)\n' +
  'globs:\n' +
  'alwaysApply: true\n' +
  '---\n\n' +
  POINTER_BODY +
  '\n@CLAUDE.md\n'

// Kiro steering wants `inclusion: always`.
const KIRO_MD =
  '---\n' +
  'title: Socket fleet engineering rules\n' +
  'inclusion: always\n' +
  '---\n\n' +
  POINTER_BODY

// A `symlink` adapter is a relative symlink to CLAUDE.md (pointer-file fallback
// on Windows). A `file` adapter is a generated file with `content` (frontmatter
// hosts).
export type Adapter =
  | { dest: string; kind: 'symlink' }
  | { content: string; dest: string; kind: 'file' }

export const ADAPTERS: readonly Adapter[] = [
  { dest: '.clinerules/socket.md', kind: 'symlink' },
  { content: CURSOR_MDC, dest: '.cursor/rules/socket.mdc', kind: 'file' },
  { dest: '.github/copilot-instructions.md', kind: 'symlink' },
  { content: KIRO_MD, dest: '.kiro/steering/socket.md', kind: 'file' },
  { dest: '.windsurf/rules/socket.md', kind: 'symlink' },
  { dest: 'AGENTS.md', kind: 'symlink' },
]

// Relative POSIX symlink target from the adapter's directory to CLAUDE.md.
// e.g. `.windsurf/rules/socket.md` -> `../../CLAUDE.md`; `AGENTS.md` ->
// `CLAUDE.md`.
export function symlinkTarget(dest: string): string {
  const fromDir = path.posix.dirname(dest)
  return path.posix.relative(fromDir, RULES_FILE)
}

// Create (or repair) one adapter, idempotently. Symlink hosts get a real
// symlink; on Windows without symlink privilege (`EPERM`/`ENOSYS`) they fall
// back to a regular pointer file so the adapter still works.
export function writeAdapter(repoRoot: string, adapter: Adapter): void {
  const destAbs = path.join(repoRoot, adapter.dest)
  mkdirSync(path.dirname(destAbs), { recursive: true })
  // Remove any existing form first (symlink, file, or stale) so re-runs are
  // idempotent across a symlink <-> pointer-file flip.
  rmSync(destAbs, { force: true })
  if (adapter.kind === 'file') {
    writeFileSync(destAbs, adapter.content)
    return
  }
  const target = symlinkTarget(adapter.dest)
  try {
    symlinkSync(target, destAbs)
  } catch (e) {
    // Windows without symlink privilege throws EPERM (ENOSYS on some
    // filesystems); fall back to a regular pointer file so the adapter works.
    const code = (e as { code?: unknown | undefined } | null)?.code
    if (code === 'ENOSYS' || code === 'EPERM') {
      writeFileSync(destAbs, POINTER_BODY)
      return
    }
    throw e
  }
}

export function toPosix(p: string): string {
  return p.replaceAll('\\', '/')
}

// Report adapters that are missing, point at the wrong target, or whose
// generated content is stale. A symlink host is in sync if it is a symlink to
// the expected target OR (Windows fallback) a regular file holding POINTER_BODY.
export function findDrift(repoRoot: string): string[] {
  const drift: string[] = []
  for (let i = 0, { length } = ADAPTERS; i < length; i += 1) {
    const adapter = ADAPTERS[i]!
    const destAbs = path.join(repoRoot, adapter.dest)
    if (!existsSync(destAbs)) {
      drift.push(`missing adapter: ${adapter.dest}`)
      continue
    }
    if (adapter.kind === 'file') {
      if (readFileSync(destAbs, 'utf8') !== adapter.content) {
        drift.push(`stale adapter content: ${adapter.dest}`)
      }
      continue
    }
    const stats = lstatSync(destAbs)
    if (stats.isSymbolicLink()) {
      const got = toPosix(readlinkSync(destAbs))
      const want = symlinkTarget(adapter.dest)
      if (got !== want) {
        drift.push(
          `wrong symlink target: ${adapter.dest} -> ${got} (want ${want})`,
        )
      }
    } else if (readFileSync(destAbs, 'utf8') !== POINTER_BODY) {
      drift.push(
        `adapter is neither a symlink nor the pointer fallback: ${adapter.dest}`,
      )
    }
  }
  return drift
}

function main(): void {
  const checkOnly = process.argv.includes('--check')
  if (!existsSync(path.join(REPO_ROOT, RULES_FILE))) {
    logger.log(`[gen-harness-adapters] no ${RULES_FILE} — nothing to adapt.`)
    return
  }
  if (checkOnly) {
    const drift = findDrift(REPO_ROOT)
    if (drift.length > 0) {
      logger.fail(
        `[gen-harness-adapters] ${drift.length} adapter(s) drifted — run \`node scripts/fleet/gen-harness-adapters.mts\`:`,
      )
      for (let i = 0, { length } = drift; i < length; i += 1) {
        logger.error(`  ✗ ${drift[i]}`)
      }
      process.exitCode = 1
      return
    }
    logger.success(
      `[gen-harness-adapters] ${ADAPTERS.length} cross-harness adapters in sync.`,
    )
    return
  }
  for (let i = 0, { length } = ADAPTERS; i < length; i += 1) {
    writeAdapter(REPO_ROOT, ADAPTERS[i]!)
  }
  logger.success(
    `[gen-harness-adapters] wrote ${ADAPTERS.length} cross-harness adapters.`,
  )
}

if (isMainModule(import.meta.url)) {
  main()
}
