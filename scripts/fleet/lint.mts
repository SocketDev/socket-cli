/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file Canonical minimal lint runner for socket-* repos. Scope modes:
 *   (default) Lint files modified in the working tree vs HEAD. --staged Lint
 *   files in the git index (used by .git-hooks/pre-commit). --all Lint the
 *   entire workspace. Flags: --fix Auto-fix issues. --quiet Suppress progress
 *   output. If the chosen scope has no lintable files, the script is a no-op.
 *   Config or infrastructure changes (.config/fleet/oxlintrc.json,
 *   .config/fleet/oxfmtrc.json, tsconfig*.json, pnpm-lock.yaml, .config/**,
 *   scripts/**, package.json) escalate to `--all` automatically, since they can
 *   affect everything. This is the minimal zero-dependency reference
 *   implementation. Larger repos (socket-lib, socket-registry, socket-sdk-js,
 *   etc.) use a richer version based on @socketsecurity/lib-stable helpers;
 *   this one keeps the same CLI contract so pre-commit hooks and CI work
 *   identically across repos.
 */

// prefer-async-spawn: sync-required — top-level CLI runner; entire
// flow is sync (sequential gates, exit-code aggregation).
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const args = process.argv.slice(2)
const mode: 'staged' | 'all' | 'modified' = args.includes('--all')
  ? 'all'
  : args.includes('--staged')
    ? 'staged'
    : 'modified'
const fix = args.includes('--fix')
const quiet = args.includes('--quiet') || args.includes('--silent')
const stdio: SpawnSyncOptions['stdio'] = quiet ? 'pipe' : 'inherit'
// On Windows, `pnpm` is a .cmd shim that Node refuses to exec directly
// via spawnSync (CVE-2024-27980 hardening). The shell wrapper resolves
// the shim; on POSIX we keep direct invocation so no shell-quoting
// surface is introduced.
const useShell = process.platform === 'win32'

const LINTABLE_EXTS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts'])

// Paths that, when touched, force a full-workspace lint.
const ESCALATION_PATTERNS = [
  /^\.config\//,
  /^scripts\//,
  /^pnpm-lock\.yaml$/,
  /^tsconfig.*\.json$/,
  /^package\.json$/,
  /^lockstep\.schema\.json$/,
]

function log(msg: string): void {
  if (!quiet) {
    logger.log(msg)
  }
}

function gitFiles(args: string[]): string[] {
  // spawnSync with array args — no shell interpolation, no injection
  // surface even if a future caller passes data into args.
  const r = spawnSync('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return []
  }
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function getStagedFiles(): string[] {
  return gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
}

function getModifiedFiles(): string[] {
  return gitFiles(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'])
}

function shouldEscalate(files: string[]): boolean {
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    for (let i = 0, { length } = ESCALATION_PATTERNS; i < length; i += 1) {
      const pattern = ESCALATION_PATTERNS[i]!
      if (pattern.test(f)) {
        return true
      }
    }
  }
  return false
}

function filterLintable(files: string[]): string[] {
  return files.filter(f => LINTABLE_EXTS.has(path.extname(f)) && existsSync(f))
}

// Wheelhouse-self dogfood paths. These dirs are in the canonical
// .config/oxlint{,rc}.json ignorePatterns because downstream fleet
// repos consume them as opaque tooling — but the wheelhouse itself
// authors the code and must lint it. Pass the paths explicitly so
// oxlint walks them, with the same config + plugin rule set.
//
// `template/**` ships byte-identical to every fleet repo via the
// sync-scaffolding cascade — including `template/.claude/hooks/`
// (the actual fleet hook code) and `template/.config/fleet/oxlint-plugin/`
// (the canonical rule definitions). The wheelhouse must lint these
// here, before they propagate, because downstream repos can't
// independently fix drift in fleet-canonical files.
//
// NOTE: The wheelhouse's OWN `<root>/.claude/` is excluded. That's
// local-dev tooling (the wheelhouse's machine-local hook setup), not
// fleet-canonical. It's a copy of `template/.claude/` plus per-machine
// overrides; linting it would double-flag every issue once in
// `template/` and once in `.claude/`.
const DOGFOOD_LINT_PATHS = ['.config/fleet/oxlint-plugin', 'template']

// Markdown lint pass — gated behind LINT_MARKDOWN=1 so existing fleet
// repos with pre-existing markdown hygiene findings aren't blocked
// until they've cleaned up. Operates over the markdownlint-cli2 config
// at .config/fleet/.markdownlint-cli2.jsonc, which scopes globs + ignores
// and registers the three fleet custom rules
// (socket-no-private-wheelhouse-leak, socket-no-relative-sibling-
// script, socket-readme-required-sections). When the env var is unset
// the function is a no-op and returns 0.
//
// Scope choice: markdown lint always runs over the whole tree (the
// canonical config's globs/ignores decide the scope, not the script).
// Per-file invocation would require pre-filtering for the same globs +
// is slower for the small overall file count typical in fleet repos.
function runMarkdown(): number {
  if (process.env['LINT_MARKDOWN'] !== '1') {
    return 0
  }
  if (!existsSync('.config/fleet/.markdownlint-cli2.jsonc')) {
    log('Skipping markdownlint: .config/fleet/.markdownlint-cli2.jsonc absent.')
    return 0
  }
  log('Running markdownlint-cli2…')
  const mdArgs = [
    'exec',
    'markdownlint-cli2',
    '--config',
    '.config/fleet/.markdownlint-cli2.jsonc',
  ]
  if (fix) {
    mdArgs.push('--fix')
  }
  const mdRes = spawnSync('pnpm', mdArgs, { shell: useShell, stdio })
  if (mdRes.status !== 0) {
    return 1
  }
  return 0
}

function runAll(): number {
  log('Formatting all files…')
  // spawnSync with array args, no shell interpolation. Matches the
  // socket/prefer-spawn-over-execsync rule: shell-string execSync is
  // banned because every interpolated value is a potential injection
  // vector; the array form structurally can't shell-expand its args.
  const oxfmtArgs = [
    'exec',
    'oxfmt',
    '-c',
    '.config/fleet/oxfmtrc.json',
    '--ignore-path',
    '.config/fleet/.prettierignore',
    fix ? '--write' : '--check',
    '.',
  ]
  const fmtRes = spawnSync('pnpm', oxfmtArgs, { shell: useShell, stdio })
  if (fmtRes.status !== 0) {
    return 1
  }
  log('Running oxlint on all files…')
  const oxlintArgs = ['exec', 'oxlint', '-c', '.config/fleet/oxlintrc.json']
  if (fix) {
    oxlintArgs.push('--fix')
  }
  const lintRes = spawnSync('pnpm', oxlintArgs, { shell: useShell, stdio })
  if (lintRes.status !== 0) {
    return 1
  }
  // Wheelhouse-self dogfood: lint the .config/fleet/oxlint-plugin/ + template/
  // trees too. The canonical .config/fleet/oxlintrc.json ignores those paths so
  // downstream fleet repos don't waste cycles linting opaque tooling, but
  // the wheelhouse is the author — every change here lands in every
  // fleet repo, so the rules must hold here first. .config/fleet/oxlintrc.dogfood.json
  // extends the base config with a narrower ignore list.
  //
  // The dogfood lint surface has known structural exemptions (e.g. rule
  // modules MUST `export default` per the oxlint plugin contract, so
  // `no-default-export` is exempt for them). Those exemptions live in
  // .config/fleet/oxlintrc.dogfood.json's `overrides`. Today this lint pass
  // is gated behind LINT_DOGFOOD=1 so it doesn't break the default
  // workflow while the exemption list is being curated. Set the env var
  // to opt in.
  if (process.env['LINT_DOGFOOD'] === '1') {
    if (!quiet) {
      logger.log('Running oxlint on wheelhouse-self dogfood paths…')
    }
    for (let i = 0, { length } = DOGFOOD_LINT_PATHS; i < length; i += 1) {
      const dogfoodPath = DOGFOOD_LINT_PATHS[i]!
      if (!existsSync(dogfoodPath)) {
        continue
      }
      // spawnSync (not execSync) — array args, no shell interpolation.
      // Avoids any chance of command injection via dogfoodPath.
      // spawnSync returns a status object rather than throwing on
      // non-zero exit, so we branch on status.
      const args = [
        'exec',
        'oxlint',
        '-c',
        '.config/fleet/oxlintrc.dogfood.json',
      ]
      if (fix) {
        args.push('--fix')
      }
      args.push(dogfoodPath)
      const r = spawnSync('pnpm', args, { shell: useShell, stdio })
      if (r.status !== 0) {
        return 1
      }
    }
  }
  const mdStatus = runMarkdown()
  if (mdStatus !== 0) {
    return mdStatus
  }
  return 0
}

function runFiles(files: string[]): number {
  if (files.length === 0) {
    log('No lintable files; skipping.')
    return 0
  }
  log(`Formatting ${files.length} file(s)...`)
  const oxfmtArgs = [
    'exec',
    'oxfmt',
    '-c',
    '.config/fleet/oxfmtrc.json',
    '--ignore-path',
    '.config/fleet/.prettierignore',
    fix ? '--write' : '--check',
    '--no-error-on-unmatched-pattern',
    ...files,
  ]
  const fmtRes = spawnSync('pnpm', oxfmtArgs, { shell: useShell, stdio })
  if (fmtRes.status !== 0) {
    return 1
  }
  log(`Running oxlint on ${files.length} file(s)...`)
  // --no-error-on-unmatched-pattern keeps the command exit-0 when
  // every listed file falls inside the config's ignorePatterns (e.g.
  // touching just .claude/ files, which the canonical config excludes).
  // Without it oxlint exits 1 with "No files found" — the user sees a
  // lint failure for files they were never going to lint.
  const oxlintArgs = [
    'exec',
    'oxlint',
    '-c',
    '.config/fleet/oxlintrc.json',
    '--no-error-on-unmatched-pattern',
  ]
  if (fix) {
    oxlintArgs.push('--fix')
  }
  oxlintArgs.push(...files)
  const lintRes = spawnSync('pnpm', oxlintArgs, { shell: useShell, stdio })
  if (lintRes.status !== 0) {
    return 1
  }
  // Markdown lint when any of the changed files is .md / .mdx. The
  // markdownlint-cli2 config picks its own scope from globs; we just
  // gate on whether to invoke at all so unrelated edits don't pay the
  // markdownlint startup cost.
  const touchedMarkdown = files.some(f => /\.(?:md|mdx)$/i.test(f))
  if (touchedMarkdown) {
    const mdStatus = runMarkdown()
    if (mdStatus !== 0) {
      return mdStatus
    }
  }
  return 0
}

function main(): void {
  if (mode === 'all') {
    log('Lint scope: all')
    process.exitCode = runAll()
    if (process.exitCode === 0) {
      log('Lint passed')
    } else {
      log('Lint failed')
    }
    return
  }

  const files = mode === 'staged' ? getStagedFiles() : getModifiedFiles()

  if (files.length === 0) {
    log(`No ${mode} files; skipping lint.`)
    return
  }

  if (shouldEscalate(files)) {
    log(`Config files changed; escalating to full lint.`)
    process.exitCode = runAll()
    if (process.exitCode === 0) {
      log('Lint passed')
    } else {
      log('Lint failed')
    }
    return
  }

  const lintable = filterLintable(files)
  log(
    `Lint scope: ${mode} (${lintable.length} of ${files.length} files lintable)`,
  )
  process.exitCode = runFiles(lintable)
  if (process.exitCode === 0) {
    log('Lint passed')
  } else {
    log('Lint failed')
  }
}

main()
