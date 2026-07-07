/**
 * @file Canonical formatter for socket-* repos — the `format` / `format:check`
 *   package.json scripts route through here. Runs oxfmt over the working tree
 *   (or the file paths you pass) WITH the fleet `--ignore-path`, so it formats
 *   exactly the set the lint gate checks and never the whole tree raw.
 *   Why this script exists instead of an inline `oxfmt … .`: a bare
 *   `oxfmt --write .` omits `--ignore-path` and reformats `.claude/`, the
 *   `.agents/` mirror, vendored trees, and markdown that markdownlint owns —
 *   hundreds of files the gate never checks. The argv (including the
 *   non-negotiable `--ignore-path`) is built by `buildOxfmtArgs` in
 *   `_shared/format-scope.mts`, shared with `lint.mts`.
 *   Usage: `node scripts/fleet/format.mts` writes; `--check` verifies; trailing
 *   paths scope the run to those files; `--staged` / `--modified` scope it to
 *   exactly the staged (pre-commit) / working-tree-vs-HEAD delta, so a format
 *   lane touches only what is being committed and never the whole tree.
 */

// prefer-async-spawn: sync-required — top-level CLI runner, single oxfmt gate.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import {
  buildOxfmtArgs,
  getModifiedFiles,
  getStagedFiles,
} from './_shared/format-scope.mts'

// On Windows, `pnpm` is a .cmd shim Node refuses to exec directly via spawnSync
// (CVE-2024-27980 hardening); the shell wrapper resolves it. On POSIX we keep
// direct invocation so no shell-quoting surface is introduced.
const useShell = process.platform === 'win32'

function main(): void {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  let files = argv.filter(arg => !arg.startsWith('--'))
  if (argv.includes('--staged') || argv.includes('--modified')) {
    files = argv.includes('--staged') ? getStagedFiles() : getModifiedFiles()
    // Nothing in scope — do NOT fall through to a whole-tree format (an empty
    // file list would default to `.`). oxfmt skips paths it doesn't recognize.
    if (!files.length) {
      return
    }
  }
  const res = spawnSync('pnpm', buildOxfmtArgs({ check, files }), {
    shell: useShell,
    stdio: 'inherit',
  })
  process.exitCode = res.status ?? 1
}

main()
