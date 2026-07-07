#!/usr/bin/env node
// Claude Code PreToolUse hook — no-unisolated-git-fixture-guard.
//
// Blocks Write/Edit on a test file that spawns `git` against a temp-dir
// fixture WITHOUT isolating the inherited git environment. When such a suite
// runs inside the pre-commit hook, git exports GIT_DIR / GIT_WORK_TREE /
// GIT_INDEX_FILE pointing at THE LIVE repo, and git honors those above the
// cwd-based discovery — so the fixture's `git config` / `git init` / `git
// commit` escape onto the real .git/config and HEAD. Observed damage: the
// real config gets `user.email=test@example.com` (junk-authored commits) and
// `core.bare=true` (breaks every worktree op), plus junk commits stacked on
// the working branch.
//
// Detection model:
//   - Fires only on a test file (`*.test.*`/`*.spec.*` or under test/).
//   - The file spawns git: `spawnSync(... 'git' ...)`, `spawn(... 'git' ...)`,
//     or `execFileSync(... 'git' ...)`.
//   - AND builds a temp-dir fixture: `mkdtemp`/`tmpdir()`/`os.tmpdir`, or runs
//     `git init`. (A test invoking git against the REAL repo for read-only
//     introspection is out of scope — the temp-fixture signal is what marks a
//     repo the test mutates.)
//   - Allowed (isolation present) when the file does ANY of:
//       * pins `GIT_CONFIG_GLOBAL` (and/or GIT_CONFIG_SYSTEM), OR
//       * strips the inherited context (mentions `GIT_DIR` in a delete /
//         env-scrub — e.g. `delete env['GIT_DIR']` or a LEAKY_GIT_VARS list), OR
//       * its git config writes are all `config --local` (can't escape the
//         fixture's own .git/config) AND it sets no global identity.
//   - Otherwise block.
//
// Bypass: `Allow unisolated-git-fixture bypass` typed verbatim in a recent
// user turn.
//
// Fails open on non-test files / parse problems — under-blocking beats
// blocking on infrastructure noise.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { materializePostEditContent } from '../_shared/edit-content.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow unisolated-git-fixture bypass'

// A path is a test file if its basename matches `*.test.*` / `*.spec.*` or it
// lives under a `test/` / `__tests__/` directory.
export function isTestFilePath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) {
    return true
  }
  return /(?:^|\/)(?:test|tests|__tests__)\//.test(normalized)
}

// The file spawns git as a child process.
const GIT_SPAWN_RE =
  /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*['"]git['"]/

export function spawnsGit(text: string): boolean {
  return GIT_SPAWN_RE.test(text)
}

// The file builds a temp-dir fixture repo (the signal that it MUTATES a repo it
// created, where leaked GIT_DIR redirects writes to the live repo).
const TEMP_FIXTURE_RE = /\bmkdtemp(?:Sync)?\b|\btmpdir\s*\(|\bos\.tmpdir\b/
const GIT_INIT_RE = /['"]init['"]/

export function buildsTempFixture(text: string): boolean {
  return TEMP_FIXTURE_RE.test(text) && GIT_INIT_RE.test(text)
}

// Isolation present: imports the shared isolate-git-env helper (the blessed
// one-liner), pins the config files, or strips the inherited GIT_DIR context.
export function isIsolated(text: string): boolean {
  // The blessed form: a side-effect (or named) import of the shared
  // `.git-hooks/_shared/isolate-git-env.mts`, which strips the GIT_* discovery
  // vars on import. Prefer this over re-spelling the scrub in every fixture.
  if (/isolate-git-env(?:\.mts)?['"]/.test(text)) {
    return true
  }
  // Pins the global/system config to /dev/null (or any path) — writes can't
  // reach a real config.
  if (/\bGIT_CONFIG_GLOBAL\b/.test(text)) {
    return true
  }
  // Strips the inherited repo-pointing context (delete env['GIT_DIR'], a
  // LEAKY_GIT_VARS scrub list, etc.).
  if (
    /\bGIT_DIR\b/.test(text) &&
    /\bdelete\b|LEAKY_GIT|GIT_WORK_TREE/.test(text)
  ) {
    return true
  }
  return false
}

export function shouldBlock(filePath: string, content: string): boolean {
  if (!isTestFilePath(filePath)) {
    return false
  }
  if (!spawnsGit(content) || !buildsTempFixture(content)) {
    return false
  }
  if (isIsolated(content)) {
    return false
  }
  return true
}

export const check = editGuard((filePath, content, payload) => {
  // Reason about the WHOLE post-edit file, not the Edit fragment: the isolation
  // import lives at the top of the file, so an Edit appending a git fixture
  // would false-positive if we only saw `new_string`.
  const full = materializePostEditContent(filePath, content, payload) ?? content
  if (!shouldBlock(filePath, full ?? '')) {
    return undefined
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }
  return block(
    [
      '[no-unisolated-git-fixture-guard] Blocked: git fixture is not isolated from the live repo',
      '',
      `  File: ${filePath}`,
      '',
      '  This test spawns `git` against a temp-dir fixture but never strips the',
      '  inherited GIT_DIR / GIT_WORK_TREE env or pins GIT_CONFIG_GLOBAL. Under',
      '  the pre-commit hook those vars point at the LIVE repo, so the fixture',
      '  writes onto the real .git/config (core.bare, junk identity) and HEAD.',
      '',
      '  Fix (preferred): side-effect import the shared isolation helper as',
      '  the FIRST import — it strips the GIT_* discovery vars on load:',
      "    import '<…>/.git-hooks/_shared/isolate-git-env.mts'",
      '  (vitest already does this via test/scripts/fleet/setup.mts; only',
      '  node:test git-fixture suites need the explicit import.) For the',
      '  stronger config-pin form, call isolateGitEnv({ pinConfigToNull: true }).',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
