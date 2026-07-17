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
  filterFormatIgnored,
  getModifiedFiles,
  getStagedFiles,
  pickConfig,
} from './_shared/format-scope.mts'
import { isMainModule } from './_shared/is-main-module.mts'

// On Windows, `pnpm` is a .cmd shim Node refuses to exec directly via spawnSync
// (CVE-2024-27980 hardening); the shell wrapper resolves it. On POSIX we keep
// direct invocation so no shell-quoting surface is introduced.
const useShell = process.platform === 'win32'

// The decision `main` reduces argv down to before it ever spawns oxfmt —
// pure + exported so a test drives every argv shape without a subprocess.
export type FormatPlan =
  | { kind: 'run'; args: string[] }
  | { kind: 'skip' }
  | { kind: 'stdin'; args: string[] }

/**
 * Turn CLI argv into the oxfmt invocation plan `main` executes. `options`
 * lets a test inject the staged/modified file listers instead of shelling out
 * to git.
 */
export function resolveFormatPlan(
  argv: readonly string[],
  options?:
    | {
        filterFormatIgnored?:
          | ((files: readonly string[]) => string[])
          | undefined
        getModifiedFiles?: (() => string[]) | undefined
        getStagedFiles?: (() => string[]) | undefined
      }
    | undefined,
): FormatPlan {
  const opts = { __proto__: null, ...options } as {
    filterFormatIgnored?: ((files: readonly string[]) => string[]) | undefined
    getModifiedFiles?: (() => string[]) | undefined
    getStagedFiles?: (() => string[]) | undefined
  }
  const listStaged = opts.getStagedFiles ?? getStagedFiles
  const listModified = opts.getModifiedFiles ?? getModifiedFiles
  const filterIgnored = opts.filterFormatIgnored ?? filterFormatIgnored

  const check = argv.includes('--check')

  // Pipe mode: format stdin → stdout with the fleet config. Generators that
  // format an in-memory string (sync-oxlint-rules) route through here so no
  // script ever invokes a bare oxfmt binary. The filename only selects the
  // parser (.mts vs .json); nothing is read from disk.
  const stdinArg = argv.find(arg => arg.startsWith('--stdin-filepath='))
  if (stdinArg) {
    return {
      kind: 'stdin',
      args: ['exec', 'oxfmt', '-c', pickConfig('oxfmtrc.json'), stdinArg],
    }
  }

  let files = argv.filter(arg => !arg.startsWith('--'))
  const hasExplicitFiles = files.length > 0
  const hasGitScope = argv.includes('--staged') || argv.includes('--modified')
  if (hasGitScope) {
    files = argv.includes('--staged') ? listStaged() : listModified()
  }
  files = filterIgnored(files)
  // Nothing in an explicit or Git-derived scope — do NOT fall through to a
  // whole-tree format (an empty file list defaults to `.`). Pre-filter explicit
  // paths because oxfmt does not apply --ignore-path to argv-named files.
  if ((hasExplicitFiles || hasGitScope) && !files.length) {
    return { kind: 'skip' }
  }
  return { kind: 'run', args: buildOxfmtArgs({ check, files }) }
}

function main(): void {
  const argv = process.argv.slice(2)
  const plan = resolveFormatPlan(argv)

  if (plan.kind === 'skip') {
    return
  }

  if (plan.kind === 'stdin') {
    const res = spawnSync('pnpm', plan.args, {
      // Pipe consumers parse this stdout as source text — SFW_SILENT stops
      // the firewall shim from writing banner lines into the same stream.
      env: { ...process.env, SFW_SILENT: 'true' },
      shell: useShell,
      stdio: 'inherit',
    })
    process.exitCode = res.status ?? 1
    return
  }

  const res = spawnSync('pnpm', plan.args, {
    shell: useShell,
    stdio: 'inherit',
  })
  process.exitCode = res.status ?? 1
}

if (isMainModule(import.meta.url)) {
  main()
}
