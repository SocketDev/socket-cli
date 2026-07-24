/**
 * @file The oxlint + oxfmt + markdownlint + plugin-load runner functions behind
 *   the fleet lint runner (scripts/fleet/lint.mts). Extracted to keep lint.mts
 *   under the file-size cap. `createLintRunners(context)` closes the runners
 *   over the CLI-derived context (fix / quiet / stdio / useShell / log) and
 *   returns `runAll` (whole-workspace) + `runFiles` (a scoped, already-filtered
 *   file set). Both keep oxlint BEFORE oxfmt so the format pass is the last
 *   writer and an oxlint autofix can never land unformatted. Type-aware
 *   linting (--type-aware, via the oxlint-tsgolint sidecar) runs on the
 *   whole-tree gate only — the pre-commit budget and template/ (no tsconfig
 *   project) keep runFiles/runDogfood non-type-aware.
 */

// prefer-async-spawn: sync-required — the lint runner is a top-level CLI whose
// entire flow is sync (sequential gates, exit-code aggregation).
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  cascadeMirrorOxfmtExcludeArgs,
  cascadeMirrorOxlintIgnoreArgs,
} from './cascade-mirror-scope.mts'
import { buildOxfmtArgs } from './format-scope.mts'
import {
  isTemplatePayloadPath,
  templatePayloadIgnoreArgs,
  templatePayloadLintPaths,
  toIgnorePatternArgs,
} from './template-payload-scope.mts'

const logger = getDefaultLogger()

// Max oxfmt format→check passes before declaring oscillation. oxfmt is
// non-idempotent on some content (comment / backtick / arrow reflow), so a
// single --fix pass can leave a residual the later --check RED's on.
const FORMAT_MAX_PASSES = 3

// Max oxlint --fix→verify passes before giving up. oxlint applies only
// non-overlapping fixes per pass, so adjacent/nested rewrites (e.g. the
// prefer-cached-for-loop rule on nested loops) need another pass — a single
// --fix leaves a residual a member's `fix --all` can't clear, stranding the
// full-tree gate RED. Same shape as FORMAT_MAX_PASSES above.
const OXLINT_MAX_PASSES = 4

// Hard cap so a wedged markdownlint run fails loud instead of hanging the
// aggregate lint forever (whole-tree runs in the largest fleet repos finish in
// seconds; a multi-minute run is a defect, not a big repo).
const MARKDOWN_TIMEOUT_MS = 300_000

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
// scripts/repo/check/dogfood-lint-has-no-new-violations.mts.)
const DOGFOOD_LINT_PATHS = ['template']

// The dogfood oxlint config is wheelhouse-only — it re-includes `template/`
// (the fleet source), a path that exists only in the wheelhouse — so it lives
// in `.config/repo/`, never the cascaded `.config/fleet/` tier. Generated +
// gitignored: runDogfood regenerates it via the wheelhouse generator below.
// In member repos the generator is absent and the dogfood pass is skipped.
const DOGFOOD_CONFIG = '.config/repo/oxlintrc.dogfood.json'
const DOGFOOD_CONFIG_GENERATOR = 'scripts/repo/gen/dogfood-oxlint-config.mts'

/**
 * The CLI-derived context the runners close over. Built once in lint.mts from
 * the parsed argv and handed to `createLintRunners`.
 */
export interface LintRunnerContext {
  /**
   * `--fix` — auto-fix issues (loop to a fixpoint), vs a single verify pass.
   */
  fix: boolean
  /**
   * `--quiet`/`--silent` — suppress progress output (pipe child stdio).
   */
  quiet: boolean
  /**
   * Child-process stdio mode derived from `quiet`.
   */
  stdio: SpawnSyncOptions['stdio']
  /**
   * True on Windows, where `pnpm` is a `.cmd` shim spawnSync can't exec
   * directly, so the child runs through a shell wrapper.
   */
  useShell: boolean
  /**
   * Progress logger honoring `--quiet` (no-op when quiet).
   */
  log: (message: string) => void
}

export interface LintRunners {
  /**
   * Lint + format the whole workspace (+ dogfood + markdown gates). 0 on pass.
   */
  runAll: () => number
  /**
   * Lint + format an already-scoped, already-filtered file set. 0 on pass.
   */
  runFiles: (files: string[]) => number
}

// oxlint config picker. Prefers the composable `oxlint.config.mts` factory
// (a repo's `.config/repo/oxlint.config.mts` imports the fleet factory and
// augments it in JS — see `.config/fleet/oxlint.config.mts`). oxlint's own
// `extends` can't compose fleet + repo cleanly (it drops plugins/categories/
// ignorePatterns and mis-roots relative globs), so the fleet uses a JS factory
// instead. Falls back to `oxlintrc.json` for repos that haven't adopted the
// factory yet. Order at each tier: repo `.mts` → fleet `.mts` → repo `.json`
// → fleet `.json`.
export function pickOxlintConfig(): string {
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

// The JSON that holds the canonical `ignorePatterns` for a picked oxlint config.
// A `.json` config IS the source. A `.mts` factory (oxlint.config.mts) is built
// from a sibling `oxlintrc.json` (see the factory's `import base from
// './oxlintrc.json'`); a repo-tier factory falls back to the fleet base it
// imports (`.config/fleet/oxlintrc.json`), which every factory ultimately wraps.
function ignorePatternSource(configPath: string): string | undefined {
  if (configPath.endsWith('.json')) {
    return existsSync(configPath) ? configPath : undefined
  }
  const sibling = path.join(path.dirname(configPath), 'oxlintrc.json')
  if (existsSync(sibling)) {
    return sibling
  }
  const fleetBase = path.join('.config', 'fleet', 'oxlintrc.json')
  return existsSync(fleetBase) ? fleetBase : undefined
}

// oxlint 1.75 roots a config's `ignorePatterns` at the DIRECTORY CONTAINING THE
// CONFIG (e.g. `.config/fleet/`) and refuses to match files outside it, so the
// fleet configs — which live under `.config/` but must ignore repo-root paths
// like `scripts/fleet/**` and `.claude/**` — silently lint every "ignored" file
// (1.73 rooted patterns at the project root). CLI `--ignore-pattern` flags stay
// rooted at the cwd (repo root), so re-emit the config's ignorePatterns as CLI
// args to restore the intended scope. The config's canonical `oxlintrc.json`
// stays the single source of truth (a `.mts` factory wraps it); the
// `#…`-prefixed fleet-canonical markers are gitignore comments and are dropped.
export function oxlintIgnoreArgs(configPath: string): string[] {
  const source = ignorePatternSource(configPath)
  if (source === undefined) {
    return []
  }
  let patterns: unknown
  try {
    const parsed = JSON.parse(readFileSync(source, 'utf8')) as {
      ignorePatterns?: unknown | undefined
    }
    patterns = parsed.ignorePatterns
  } catch {
    return []
  }
  if (!Array.isArray(patterns)) {
    return []
  }
  // The pattern→args re-emission (with `/**` recursion twins) lives in
  // template-payload-scope.mts and is shared with the payload pass's floor.
  return toIgnorePatternArgs(patterns)
}

/**
 * Build `runAll` + `runFiles`, closed over the CLI-derived `context`.
 */
export function createLintRunners(context: LintRunnerContext): LintRunners {
  const { fix, log, quiet, stdio, useShell } = context

  // Mutation guard for the live cascade-mirror payloads — scripts/fleet/**,
  // .git-hooks/**, bootstrap/**, the .claude/*/fleet/** tiers, … A fixer must
  // never rewrite them: they are gated at the template SOURCE and a member-side
  // edit is clobbered by the next cascade. Hit live: a `fix --all` wave edited
  // 200+ mirror files in socket-packageurl-js when a repo-tier config shadowed
  // the canonical ignore block, so the bar is re-asserted here on every
  // MUTATING spawn instead of trusting config plumbing. The globs are
  // root-anchored, so the wheelhouse's template/base/** sources — which the
  // any-depth canonical globs also match — stay fixable via the dogfood +
  // template-payload passes. Read-only lint keeps its current scope and may
  // still REPORT mirror findings; only mutation is barred.
  const mirrorOxlintGuardArgs = fix ? cascadeMirrorOxlintIgnoreArgs() : []
  const mirrorOxfmtGuardArgs = fix ? cascadeMirrorOxfmtExcludeArgs() : []

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

  // Markdown lint pass — gated behind LINT_MARKDOWN=1 so existing fleet
  // repos with pre-existing markdown hygiene findings aren't blocked
  // until they've cleaned up. Operates over the markdownlint-cli2 config
  // at .config/fleet/.markdownlint-cli2.jsonc, which scopes globs + ignores
  // and registers the fleet custom `socket-*` rules listed in that config's
  // `customRules` array. When the env var is unset the function is a no-op
  // and returns 0. Scope: markdown lint always runs over the whole tree (the
  // canonical config's globs/ignores decide the scope, not the script).
  function runMarkdown(): number {
    if (process.env['LINT_MARKDOWN'] !== '1') {
      return 0
    }
    if (!existsSync('.config/fleet/.markdownlint-cli2.jsonc')) {
      log(
        'Skipping markdownlint: .config/fleet/.markdownlint-cli2.jsonc absent.',
      )
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
    const mdRes = spawnSync('pnpm', mdArgs, {
      shell: useShell,
      stdio,
      timeout: MARKDOWN_TIMEOUT_MS,
    })
    if (mdRes.signal) {
      logger.error(
        `markdownlint-cli2 timed out after ${MARKDOWN_TIMEOUT_MS / 1000}s ` +
          `(killed with ${mdRes.signal}). ` +
          'Saw: no exit before the cap; wanted: a whole-tree pass in seconds. ' +
          'Fix: bisect with a per-file harness (config globs, custom-rule loading), ' +
          'then repair the canonical config or rule at the template source.',
      )
      return 1
    }
    if (mdRes.status !== 0) {
      return 1
    }
    return 0
  }

  // Format `files` (the whole scoped tree when omitted). In --check mode: one
  // verify pass. In --fix mode: loop format→check to a stable fixpoint (cap
  // FORMAT_MAX_PASSES), so a one-pass non-idempotency residual never reaches the
  // verify gate; fail LOUD on genuine oscillation (a real oxfmt bug, not a
  // silent re-run). Returns 0 on success, 1 on a format error or non-convergence.
  function runOxfmt(files?: readonly string[] | undefined): number {
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
    // The mirror guard rides on BOTH the write pass and its convergence probe:
    // probing a scope the write pass may not touch would fail convergence
    // forever on any drifted mirror. Mirror drift still surfaces — the
    // read-only gate above keeps its full scope.
    for (let pass = 1; pass <= FORMAT_MAX_PASSES; pass += 1) {
      const fmtRes = spawnSync(
        'pnpm',
        [
          ...buildOxfmtArgs({ check: false, ...fileArgs }),
          ...mirrorOxfmtGuardArgs,
        ],
        { shell: useShell, stdio },
      )
      if (fmtRes.status !== 0) {
        return 1
      }
      const checkRes = spawnSync(
        'pnpm',
        [
          ...buildOxfmtArgs({ check: true, ...fileArgs }),
          ...mirrorOxfmtGuardArgs,
        ],
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

  // Run oxlint on `baseArgs` (WITHOUT --fix). In --check mode: one pass, gate on
  // its status. In --fix mode: loop `--fix`→verify to a fixpoint (cap
  // OXLINT_MAX_PASSES) so a one-pass residual on overlapping/nested rewrites
  // never reaches the gate — then a final no-fix pass reports any genuinely
  // unfixable violation LOUD and gates on it. Returns 0 on clean, 1 otherwise.
  function runOxlint(baseArgs: readonly string[]): number {
    if (fix) {
      for (let pass = 1; pass <= OXLINT_MAX_PASSES; pass += 1) {
        // Mirror guard on the MUTATING spawn only — the verify probe and the
        // final gate pass below keep the configured (report-capable) scope.
        spawnSync('pnpm', [...baseArgs, ...mirrorOxlintGuardArgs, '--fix'], {
          shell: useShell,
          stdio,
        })
        const verify = spawnSync('pnpm', [...baseArgs], {
          shell: useShell,
          stdio: 'ignore',
        })
        if (verify.status === 0) {
          return 0
        }
      }
    }
    const res = spawnSync('pnpm', [...baseArgs], { shell: useShell, stdio })
    return res.status === 0 ? 0 : 1
  }

  // Template code-payload pass (wheelhouse-only by construction): lint the
  // `template/base/` sources of the fleet-canonical cascade with the SAME
  // canonical config the live tree uses — but with the payload ignore floor
  // instead of the canonical ignore list, whose `**/`-anchored mirror globs
  // are what shadowed these paths from every default gate. Runs unGATED (no
  // LINT_DOGFOOD) in --all, --staged, --modified, and explicit-file scopes so
  // template debt can no longer cascade downstream unlinted. `targets` is the
  // already-scoped payload file set in file mode, or the payload dirs for the
  // whole-tree pass; when it's empty (member repos, or a scope touching no
  // payload file) the pass is a no-op.
  function runTemplatePayload(targets: readonly string[]): number {
    if (targets.length === 0) {
      return 0
    }
    log(`Running oxlint on ${targets.length} template payload path(s)...`)
    const config = pickOxlintConfig()
    return runOxlint([
      'exec',
      'oxlint',
      '-c',
      config,
      ...templatePayloadIgnoreArgs(),
      '--no-error-on-unmatched-pattern',
      ...targets,
    ])
  }

  // Wheelhouse-self dogfood: lint the template/ tree with the dogfood config.
  // Gated behind LINT_DOGFOOD=1 + the dogfood generator existing (member repos
  // have neither). Returns 0 on pass / skip, 1 on any dogfood violation.
  function runDogfood(): number {
    if (process.env['LINT_DOGFOOD'] !== '1') {
      return 0
    }
    // The dogfood config is generated + gitignored — regenerate it on a fresh
    // checkout. A repo without the generator (a member) has no dogfood
    // surface, so the pass is a no-op there. A failed generation fails LOUD:
    // silently skipping would false-green the dogfood gate.
    if (!existsSync(DOGFOOD_CONFIG)) {
      if (!existsSync(DOGFOOD_CONFIG_GENERATOR)) {
        return 0
      }
      const gen = spawnSync(process.execPath, [DOGFOOD_CONFIG_GENERATOR], {
        stdio,
      })
      if (gen.status !== 0 || !existsSync(DOGFOOD_CONFIG)) {
        logger.error(
          `Dogfood config regeneration failed: ${DOGFOOD_CONFIG} is absent ` +
            `and \`node ${DOGFOOD_CONFIG_GENERATOR}\` did not write it. ` +
            'Run the generator directly to see its error, then re-run the lint.',
        )
        return 1
      }
    }
    if (!quiet) {
      logger.log('Running oxlint on wheelhouse-self dogfood paths…')
    }
    let dogfoodFailed = false
    for (let i = 0, { length } = DOGFOOD_LINT_PATHS; i < length; i += 1) {
      const dogfoodPath = DOGFOOD_LINT_PATHS[i]!
      if (!existsSync(dogfoodPath)) {
        continue
      }
      const args = [
        'exec',
        'oxlint',
        '-c',
        DOGFOOD_CONFIG,
        ...oxlintIgnoreArgs(DOGFOOD_CONFIG),
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
    return dogfoodFailed ? 1 : 0
  }

  function runAll(): number {
    // oxlint before oxfmt — the format pass is the last writer, so oxlint
    // autofixes can never land unformatted.
    log('Running oxlint on all files…')
    const allConfig = pickOxlintConfig()
    if (
      runOxlint([
        'exec',
        'oxlint',
        '-c',
        allConfig,
        ...oxlintIgnoreArgs(allConfig),
        // Type-aware rules run on the whole-tree gate only: runFiles() keeps
        // the pre-commit 10s budget, runDogfood() lints template/ which has no
        // tsconfig project. Needs the oxlint-tsgolint sidecar (fleet catalog).
        '--type-aware',
      ]) !== 0
    ) {
      return 1
    }
    // Second oxlint leg (still before the format pass): the template
    // code-payload sources the canonical ignores shadow.
    if (runTemplatePayload(templatePayloadLintPaths()) !== 0) {
      return 1
    }
    log('Formatting all files…')
    if (runOxfmt() !== 0) {
      return 1
    }
    // A green oxlint run is vacuous if the socket/ plugin failed to load (every
    // socket/ rule silently disabled). Fail-closed here so lint.mts — the gate
    // the pre-push runs — never passes on a dead plugin.
    if (assertPluginLoaded() !== 0) {
      return 1
    }
    if (runDogfood() !== 0) {
      return 1
    }
    return runMarkdown()
  }

  function runFiles(files: string[]): number {
    if (files.length === 0) {
      log('No lintable files; skipping.')
      return 0
    }
    log(`Running oxlint on ${files.length} file(s)...`)
    // --no-error-on-unmatched-pattern keeps the command exit-0 when every
    // listed file falls inside the config's ignorePatterns (e.g. touching just
    // .claude/ files, which the canonical config excludes). Without it oxlint
    // exits 1 with "No files found" — a lint failure for files never meant to
    // be linted.
    const filesConfig = pickOxlintConfig()
    const baseArgs = [
      'exec',
      'oxlint',
      '-c',
      filesConfig,
      ...oxlintIgnoreArgs(filesConfig),
      '--no-error-on-unmatched-pattern',
      ...files,
    ]
    if (runOxlint(baseArgs) !== 0) {
      return 1
    }
    // Template code-payload files in the scope are silently skipped by the
    // canonical ignore args above (their paths are shadowed by the mirror
    // globs), so give them the dedicated payload pass — same config, floor
    // ignores — before the format leg.
    if (runTemplatePayload(files.filter(isTemplatePayloadPath)) !== 0) {
      return 1
    }
    log(`Formatting ${files.length} file(s)...`)
    if (runOxfmt(files) !== 0) {
      return 1
    }
    if (assertPluginLoaded() !== 0) {
      return 1
    }
    // Markdown lint when any changed file is .md / .mdx. The markdownlint-cli2
    // config picks its own scope from globs; we just gate on whether to invoke
    // at all so unrelated edits don't pay the markdownlint startup cost.
    const touchedMarkdown = files.some(f => /\.(?:md|mdx)$/i.test(f))
    if (touchedMarkdown) {
      return runMarkdown()
    }
    return 0
  }

  return { runAll, runFiles }
}
