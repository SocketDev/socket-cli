/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file Canonical minimal lint runner for socket-* repos. Scope modes:
 *   (default, or explicit --modified / its alias --changed) Lint files modified
 *   in the working tree vs HEAD. --staged Lint
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

import {
  buildOxfmtArgs,
  getModifiedFiles,
  getStagedFiles,
} from './_shared/format-scope.mts'
import { pathToFileURL } from 'node:url'

import { resolveScopeMode } from './_shared/scope-flags.mts'

const logger = getDefaultLogger()

const args = process.argv.slice(2)
const mode = resolveScopeMode(args)
const fix = args.includes('--fix')
const quiet = args.includes('--quiet') || args.includes('--silent')
const stdio: SpawnSyncOptions['stdio'] = quiet ? 'pipe' : 'inherit'
// On Windows, `pnpm` is a .cmd shim that Node refuses to exec directly
// via spawnSync (CVE-2024-27980 hardening). The shell wrapper resolves
// the shim; on POSIX we keep direct invocation so no shell-quoting
// surface is introduced.
const useShell = process.platform === 'win32'

const LINTABLE_EXTS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts'])

// oxlint config picker. Prefers the composable `oxlint.config.mts` factory
// (a repo's `.config/repo/oxlint.config.mts` imports the fleet factory and
// augments it in JS — see `.config/fleet/oxlint.config.mts`). oxlint's own
// `extends` can't compose fleet + repo cleanly (it drops plugins/categories/
// ignorePatterns and mis-roots relative globs), so the fleet uses a JS factory
// instead. Falls back to `oxlintrc.json` for repos that haven't adopted the
// factory yet. Order at each tier: repo `.mts` → fleet `.mts` → repo `.json`
// → fleet `.json`.
function pickOxlintConfig(): string {
  const candidates = [
    path.join('.config', 'repo', 'oxlint.config.mts'),
    path.join('.config', 'fleet', 'oxlint.config.mts'),
    path.join('.config', 'repo', 'oxlintrc.json'),
    path.join('.config', 'fleet', 'oxlintrc.json'),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    if (existsSync(candidates[i]!)) {
      return candidates[i]!
    }
  }
  return path.join('.config', 'fleet', 'oxlintrc.json')
}

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

// Assert the socket/ oxlint plugin actually loaded. A dead plugin (a rule with
// a missing dep / bad import) makes oxlint silently disable EVERY socket/ rule
// and still exit 0 — so a green oxlint run is meaningless until the plugin is
// confirmed loaded. Runs the existing oxlint-plugin-loads check as a sync
// subprocess (keeps this sync flow sync; reuses the one assertion). No-op +
// pass when the repo has no plugin. Returns 0 on ok / no-plugin, 1 on a dead
// or mis-wired plugin. This is what closes the silent-disable window: the
// pre-push runs lint.mts, not check --all, so without this a dead plugin sails
// through commit + lint + pre-push.
function assertPluginLoaded(): number {
  const checkPath = path.join(
    'scripts',
    'fleet',
    'check',
    'oxlint-plugin-loads.mts',
  )
  if (!existsSync(checkPath)) {
    return 0
  }
  const res = spawnSync(process.execPath, [checkPath, '--quiet'], { stdio })
  return res.status === 0 ? 0 : 1
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

// Wheelhouse-self dogfood path: `template/` ONLY — the canonical SOURCE of
// every fleet-canonical file (`template/.claude/hooks/`, `template/.config/
// fleet/oxlint-plugin/`, `template/scripts/fleet/`, …) that ships byte-identical
// to every fleet repo via the sync-scaffolding cascade. `template/**` is in the
// canonical ignorePatterns (downstream repos consume it as opaque tooling), so
// it's passed explicitly + re-included by the dogfood config so oxlint walks it
// with the full socket/* rule set. The wheelhouse must lint here, BEFORE the
// code propagates — downstream repos can't fix drift in a cascaded file.
//
// The LIVE cascaded copies in their NON-template locations (`<root>/.config/
// fleet/oxlint-plugin/`, `<root>/.claude/`, `<root>/scripts/fleet/`, …) are NOT
// dogfood-linted: they're byte-identical mirrors of `template/`, fixing-at-
// source (template) + cascade is the flow, and linting a mirror double-flags
// every issue. (Keep in lock-step with DOGFOOD_PATHS in
// scripts/repo/dogfood-lint-has-no-new-violations.mts.)
const DOGFOOD_LINT_PATHS = ['template']

// The dogfood oxlint config is wheelhouse-only — it re-includes `template/`
// (the fleet source), a path that exists only in the wheelhouse — so it lives
// in `.config/repo/`, never the cascaded `.config/fleet/` tier. Absent in member
// repos, where the dogfood pass is skipped.
const DOGFOOD_CONFIG = '.config/repo/oxlintrc.dogfood.json'

// Markdown lint pass — gated behind LINT_MARKDOWN=1 so existing fleet
// repos with pre-existing markdown hygiene findings aren't blocked
// until they've cleaned up. Operates over the markdownlint-cli2 config
// at .config/fleet/.markdownlint-cli2.jsonc, which scopes globs + ignores
// and registers the fleet custom `socket-*` rules listed in that config's
// `customRules` array. When the env var is unset the function is a no-op
// and returns 0.
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

// Max oxfmt format→check passes before declaring oscillation. oxfmt is
// non-idempotent on some content (comment / backtick / arrow reflow), so a
// single --fix pass can leave a residual the later --check RED's on.
const FORMAT_MAX_PASSES = 3

// Format `files` (the whole scoped tree when omitted). In --check mode: one
// verify pass. In --fix mode: loop format→check to a stable fixpoint (cap
// FORMAT_MAX_PASSES), so a one-pass non-idempotency residual never reaches the
// verify gate; fail LOUD on genuine oscillation (a real oxfmt bug, not a silent
// re-run). Returns 0 on success, 1 on a format error or non-convergence.
// spawnSync with array args (no shell interpolation) per
// socket/prefer-spawn-over-execsync — the array form structurally can't
// shell-expand its args.
function runOxfmt(files?: readonly string[]): number {
  const fileArgs = files === undefined ? {} : { files: [...files] }
  if (!fix) {
    const res = spawnSync(
      'pnpm',
      buildOxfmtArgs({ check: true, ...fileArgs }),
      {
        shell: useShell,
        stdio,
      },
    )
    return res.status === 0 ? 0 : 1
  }
  for (let pass = 1; pass <= FORMAT_MAX_PASSES; pass += 1) {
    const fmtRes = spawnSync(
      'pnpm',
      buildOxfmtArgs({ check: false, ...fileArgs }),
      { shell: useShell, stdio },
    )
    if (fmtRes.status !== 0) {
      return 1
    }
    const checkRes = spawnSync(
      'pnpm',
      buildOxfmtArgs({ check: true, ...fileArgs }),
      { shell: useShell, stdio: 'ignore' },
    )
    if (checkRes.status === 0) {
      return 0
    }
  }
  logger.error(
    `oxfmt did not converge after ${FORMAT_MAX_PASSES} format passes — the ` +
      'formatter is oscillating on some file (a real oxfmt bug). Run ' +
      '`pnpm run format:check` to find it, then reword the offending content ' +
      '(usually a backtick / @-tag / arrow-in-comment reflow).',
  )
  return 1
}

function runAll(): number {
  log('Formatting all files…')
  if (runOxfmt() !== 0) {
    return 1
  }
  log('Running oxlint on all files…')
  const oxlintArgs = ['exec', 'oxlint', '-c', pickOxlintConfig()]
  if (fix) {
    oxlintArgs.push('--fix')
  }
  const lintRes = spawnSync('pnpm', oxlintArgs, { shell: useShell, stdio })
  if (lintRes.status !== 0) {
    return 1
  }
  // A green oxlint run is vacuous if the socket/ plugin failed to load (every
  // socket/ rule silently disabled). Fail-closed here so lint.mts — the gate
  // the pre-push runs — never passes on a dead plugin.
  if (assertPluginLoaded() !== 0) {
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
  if (process.env['LINT_DOGFOOD'] === '1' && existsSync(DOGFOOD_CONFIG)) {
    if (!quiet) {
      logger.log('Running oxlint on wheelhouse-self dogfood paths…')
    }
    let dogfoodFailed = false
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
        DOGFOOD_CONFIG,
        '--no-error-on-unmatched-pattern',
      ]
      if (fix) {
        args.push('--fix')
      }
      args.push(dogfoodPath)
      const r = spawnSync('pnpm', args, { shell: useShell, stdio })
      if (r.status !== 0) {
        // Without --fix the gate only needs the first failure, so fail fast.
        // WITH --fix, oxlint exits non-zero whenever ANY unfixable violation
        // remains — returning here would abort the loop before --fix reaches
        // the later dogfood paths. Keep going so every path gets fixed, then
        // report the failure after the loop.
        if (!fix) {
          return 1
        }
        dogfoodFailed = true
      }
    }
    if (dogfoodFailed) {
      return 1
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
  if (runOxfmt(files) !== 0) {
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
    pickOxlintConfig(),
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
  // A green oxlint run is vacuous if the socket/ plugin failed to load — see
  // runAll(). Fail-closed on a dead plugin in the scoped path too.
  if (assertPluginLoaded() !== 0) {
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

/**
 * The loud-scope contract for fix runs: a `--fix` outside `--all` only touches
 * the files git already sees as changed, so a repo-wide autofix campaign run
 * that way is a SILENT no-op on the whole backlog (two delegated wave runs
 * reported success while fixing nothing, 2026-07-07). Every scoped fix run
 * ends with this reminder so the operator can tell "fixed my edits" apart
 * from "fixed the repo".
 */
export function fixScopeReminder(scopeMode: string): string {
  return (
    `fix applied to ${scopeMode.toUpperCase()} files only — the repo-wide backlog is untouched.\n` +
    'For a wave: pnpm run lint --fix --all  (add LINT_DOGFOOD=1 to reach template/).'
  )
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
    if (fix) {
      log(fixScopeReminder(mode))
    }
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
  if (fix) {
    log(fixScopeReminder(mode))
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main()
}
