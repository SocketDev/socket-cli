#!/usr/bin/env node
// Claude Code PreToolUse hook — no-nested-gitignore-guard.
//
// @file Every fleet repo keeps its ignore rules in a SINGLE `.gitignore` at the
//   repo root (the wheelhouse also carries the `template/<archetype>/.gitignore`
//   seed). This guard BLOCKS a Write / Edit / MultiEdit that CREATES a nested
//   per-directory `.gitignore` — a nested file fragments the single source of
//   truth: it is not generator-managed (the root block comes from FLEET_ENTRIES),
//   cascades as an extra tracked file, and is easy to miss when auditing what a
//   repo ignores. A `**/`-anchored line in the root `.gitignore` reaches any
//   depth (live copy AND the template mirror), so nesting buys nothing.
//
// Only blocks CREATION of a NEW nested `.gitignore` (editing one that already
// exists on disk — e.g. mid-migration — is never blocked). Fleet-only. Vendored
// / untracked-by-default trees (vendor/, third_party/, external/, upstream/,
// deps/…, node_modules/, *-vendored/*-bundled) are upstream-owned and exempt.
//
// Fix: put the ignore pattern in the repo root `.gitignore` (use `**/<path>` to
//      reach depth). Detail: docs/agents.md/fleet/single-gitignore.md.
//
// Bypass: `Allow nested-gitignore bypass`.
//
// Fails open on any parse/payload/git error (a guard bug must not block work).

import { existsSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// Upstream-owned trees that carry their own `.gitignore` (untracked-by-default,
// per CLAUDE.md) — a nested `.gitignore` there is not fleet-managed.
const VENDORED_PREFIX_RE =
  /(?:^|\/)(?:vendor|third_party|external|upstream|deps|node_modules|additions\/source-patched|pkg-node)\//
const VENDORED_SUFFIX_RE = /(?:-vendored|-bundled)(?:\/|$)/

/**
 * A repo-relative POSIX path is a NESTED `.gitignore` (a violation) when its
 * basename is `.gitignore` and it does NOT sit at a canonical root — the repo
 * root (`.gitignore`) or a template archetype root (`template/<archetype>/
 * .gitignore`). Any deeper `.gitignore` is nested. Pure; shared with the
 * `gitignore-is-single-file` belt check so the two never diverge.
 */
export function isNestedGitignore(repoRelativePath: string): boolean {
  const p = normalizePath(repoRelativePath)
  if (p !== '.gitignore' && !p.endsWith('/.gitignore')) {
    return false
  }
  if (p === '.gitignore') {
    return false
  }
  if (/^template\/[^/]+\/\.gitignore$/.test(p)) {
    return false
  }
  // cargo-fuzz generates + owns `<crate>/fuzz/.gitignore` (ignores its transient
  // target/artifacts/coverage output while the seed corpus stays tracked). It is
  // a tool-mandated convention, not a fleet fork — exempt it so a Rust fuzz repo
  // stays green.
  if (p === 'fuzz/.gitignore' || p.endsWith('/fuzz/.gitignore')) {
    return false
  }
  return true
}

/**
 * Resolve the git-toplevel-relative POSIX path for `filePath`, or undefined
 * when the file is not inside a git checkout (guard then fails open).
 */
export function repoRelativeGitPath(filePath: string): string | undefined {
  try {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path.dirname(filePath),
      stdio: 'pipe',
      stdioString: true,
    })
    if (result.status !== 0) {
      return undefined
    }
    const root = String(result.stdout ?? '').trim()
    if (!root) {
      return undefined
    }
    return normalizePath(path.relative(root, filePath))
  } catch {
    return undefined
  }
}

export const check = editGuard((filePath, content, payload) => {
  void content
  if (path.basename(filePath) !== '.gitignore') {
    return undefined
  }
  // Convention guard: only governs fleet repos.
  if (!isFleetTarget(payload)) {
    return undefined
  }
  // Only block CREATION of a NEW nested .gitignore.
  if (existsSync(filePath)) {
    return undefined
  }
  const rel = repoRelativeGitPath(filePath)
  if (!rel) {
    return undefined
  }
  if (VENDORED_PREFIX_RE.test(rel) || VENDORED_SUFFIX_RE.test(rel)) {
    return undefined
  }
  if (!isNestedGitignore(rel)) {
    return undefined
  }
  // Detection + the exact-phrase bypass footer are owned by defineHook's
  // auto-bypass (bypass: ['nested-gitignore']) — see _shared/bypass.mts.
  return block(
    [
      '🚨 no-nested-gitignore-guard: refusing to create a nested `.gitignore`.',
      '',
      `   ${rel}`,
      '',
      'Every fleet repo keeps ignore rules in ONE `.gitignore` at the repo root',
      '(fleet block from FLEET_ENTRIES + the repo-owned block below it). A nested',
      'per-dir `.gitignore` fragments that single source of truth.',
      '',
      'Fix: add the pattern to the root `.gitignore`. To reach a deep path, use a',
      `     \`**/\`-anchored line, e.g. \`**/${rel.replace(/\/\.gitignore$/, '')}/<file>\`.`,
      '     Detail: docs/agents.md/fleet/single-gitignore.md.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['nested-gitignore'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
