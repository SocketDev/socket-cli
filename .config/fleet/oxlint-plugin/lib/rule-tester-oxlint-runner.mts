/*
 * @file Internal support for `rule-tester.mts`: locate the `oxlint` binary,
 *   build the per-rule `.oxlintrc.json`, spawn oxlint against a batch of
 *   fixtures, and parse the JSON diagnostics stream back into
 *   `OxlintDiagnostic[]`. Split out of `rule-tester.mts` to keep that file
 *   under the fleet's soft line cap — `RuleTester` imports these helpers
 *   back; nothing here is part of the public `rule-tester.mts` API.
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveBinaryPath } from '@socketsecurity/lib-stable/dlx/binary-resolution'

import { sleepSync, spawnOxlintOnce } from './rule-tester.mts'

import type { OxlintDiagnostic, ValidTestCase } from './rule-tester.mts'

const PLUGIN_INDEX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.mts',
)

/**
 * Build the minimal .oxlintrc.json that enables ONE socket plugin rule plus the
 * plugin's JS entry point.
 */
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
export function buildConfig(
  ruleName: string,
  ruleOptions?: unknown | undefined,
): string {
  return JSON.stringify(
    {
      jsPlugins: [PLUGIN_INDEX],
      rules: {
        [`socket/${ruleName}`]:
          ruleOptions === undefined ? 'error' : ['error', ruleOptions],
      },
    },
    null,
    2,
  )
}

/**
 * Compare a single error spec against an emitted diagnostic.
 *
 * Two acceptance paths: 1. `messageId` — strict match against `diag.messageId`
 * when the oxlint version emits that field (older builds). Recent builds drop
 * `messageId` from the JSON output entirely, so a `messageId`-only spec falls
 * through to (2): once the runner has already filtered diagnostics down to this
 * rule via `matchesRule`, "the diagnostic is from this rule" is the same claim
 * "messageId matches" was making. 2. `message` — substring match against
 * `diag.message`. Use this when the spec wants to assert specific copy text.
 *
 * If the spec has neither, accept the diagnostic (the runner has already
 * filtered to this rule, so the presence of a diagnostic is itself the
 * assertion). This is how a bare `{ messageId: 'foo' }` spec keeps working
 * under oxlint builds that no longer emit `messageId` in JSON.
 */
export function errorMatches(
  spec: { messageId?: string | undefined; message?: string | undefined },
  diag: OxlintDiagnostic,
): boolean {
  if (spec.messageId && diag.messageId) {
    return spec.messageId === diag.messageId
  }
  if (spec.message && diag.message?.includes(spec.message)) {
    return true
  }
  // messageId spec but no messageId field on diag: accept (rule
  // already matched via matchesRule upstream).
  if (spec.messageId && !diag.messageId) {
    return true
  }
  return false
}

/**
 * Default fixture filename derived from the test case's `filename` override or
 * `'fixture.ts'`. ESLint's RuleTester uses `'<input>.js'`; we default to `.ts`
 * since the fleet rules are TS-aware.
 */
export function fixtureFilename(testCase: ValidTestCase): string {
  return testCase.filename ?? 'fixture.ts'
}

/**
 * Find the `oxlint` binary. Resolves the LOCALLY-installed `oxlint` package
 * that `pnpm install` linked — never a global `which oxlint`. A global lookup
 * is wrong on two counts: it skips the whole rule-test suite on any normal
 * checkout (oxlint isn't installed globally), turning these tests into silent
 * no-ops; and if a global oxlint of a different version happens to exist, the
 * tests would run against the wrong engine. Resolve `oxlint`'s package.json via
 * the module system, read its `bin` entry, then hand the path to the
 * fleet-canonical `resolveBinaryPath` from
 * `@socketsecurity/lib-stable/dlx/binary-resolution` for the platform wrapper
 * (`.cmd`/`.ps1` on Windows; pass-through on Unix). Returns undefined only when
 * `oxlint` can't be resolved yet (pre-install), so the harness skips gracefully
 * rather than false-failing a fresh checkout.
 */
export function resolveOxlintBinary(): string | undefined {
  const require = createRequire(import.meta.url)
  let packageJsonPath: string
  try {
    packageJsonPath = require.resolve('oxlint/package.json')
  } catch {
    return undefined
  }
  try {
    const pkgDir = path.dirname(packageJsonPath)
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      bin?: string | Record<string, string> | undefined
    }
    // `bin` is either a string (single bin named after the package) or a
    // map of bin-name → relative path. Pick the `oxlint` entry, falling
    // back to the string form.
    const binRel =
      typeof pkg.bin === 'string'
        ? pkg.bin
        : (pkg.bin?.['oxlint'] ?? Object.values(pkg.bin ?? {})[0])
    if (!binRel) {
      return undefined
    }
    return resolveBinaryPath(path.join(pkgDir, binRel))
  } catch {
    return undefined
  }
}

/**
 * Run oxlint against one or more fixture files with a one-rule config; return
 * the parsed list of findings for THIS rule.
 */
export function runOxlintFiles(args: {
  oxlintBin: string
  fixturePaths: readonly string[]
  configPath: string
  ruleName: string
  fix: boolean
}): OxlintDiagnostic[] {
  const cliArgs = ['--config', args.configPath, '-f', 'json']
  if (args.fix) {
    cliArgs.push('--fix')
  }
  cliArgs.push(...args.fixturePaths)
  // Starved-spawn retry: on 2-core CI runners, vitest concurrency × oxlint
  // children can starve spawns (windows: spawnSync error; linux/macos: the
  // child sits queued until a timeout kills it). Both reds reproduced across
  // whole runs on every OS while passing locally, so a starved child gets a
  // short backoff and two more attempts before the loud throw below.
  let r = spawnOxlintOnce(args.oxlintBin, cliArgs)
  for (const backoffMs of [250, 1000]) {
    if (!r.error && !r.signal && String(r.stdout || '').trim() !== '') {
      break
    }
    sleepSync(backoffMs)
    r = spawnOxlintOnce(args.oxlintBin, cliArgs)
  }
  // oxlint's JSON reporter has changed shape across versions:
  //   - Older: line-delimited diagnostic objects, one per line.
  //   - Mid:   top-level array `[ { diagnostics: [...] }, ... ]`.
  //   - Current: top-level object `{ diagnostics: [...], number_of_files, ... }`
  //              (single multi-line JSON with the diagnostics inline).
  // Parse defensively in that order: try whole-buffer parse first
  // (handles the array AND object shapes), then fall back to
  // line-by-line. Filter every result by rule id so unrelated
  // findings (autofix from other socket rules in the same config)
  // don't inflate the count.
  const stdout = String(r.stdout || '')
  const trimmed = stdout.trim()
  // A dead child must never read as "0 findings" — under heavy load a
  // starved/killed oxlint (spawn error, timeout signal, or empty JSON
  // stream) previously parsed to an empty diagnostics array, making a
  // broken spawn indistinguishable from a clean file (coverage run 10:
  // 29 false "expected 1 finding(s), got 0" assertions). The JSON
  // reporter always emits at least one object on a real run, even with
  // zero findings.
  if (r.error || r.signal || trimmed === '') {
    throw new Error(
      `oxlint child failed for rule '${args.ruleName}'.\n` +
        `  Where: RuleTester runOxlint (${args.oxlintBin})\n` +
        `  Saw: ${r.error ? `spawn error ${String(r.error)}` : r.signal ? `killed with ${r.signal} (timeout or external kill)` : 'empty stdout'}; wanted: a JSON diagnostics stream\n` +
        `  Fix: rerun without concurrent load; if it persists, check the oxlint binary and config at ${args.configPath}.\n` +
        `  stderr: ${String(r.stderr || '')
          .trim()
          .slice(0, 400)}`,
    )
  }
  const diagnostics: OxlintDiagnostic[] = []
  const matchesRule = (d: OxlintDiagnostic): boolean => {
    // Current oxlint emits `code` like `socket(no-cached-for-on-iterable)`
    // instead of (or in addition to) `ruleId`. Accept either form.
    const code = (d as OxlintDiagnostic & { code?: string | undefined }).code
    return (
      d.ruleId?.endsWith(`/${args.ruleName}`) === true ||
      d.ruleId === `socket/${args.ruleName}` ||
      d.ruleId === args.ruleName ||
      code === `socket(${args.ruleName})` ||
      (typeof code === 'string' && code.endsWith(`(${args.ruleName})`))
    )
  }
  let parsedWhole = false
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const fileBlocks: Array<{
        diagnostics?: OxlintDiagnostic[] | undefined
      }> = Array.isArray(parsed)
        ? (parsed as Array<{ diagnostics?: OxlintDiagnostic[] | undefined }>)
        : [parsed as { diagnostics?: OxlintDiagnostic[] | undefined }]
      for (let i = 0, { length } = fileBlocks; i < length; i += 1) {
        const file = fileBlocks[i]!
        for (const d of file.diagnostics ?? []) {
          if (matchesRule(d)) {
            diagnostics.push(d)
          }
        }
      }
      parsedWhole = true
    } catch {
      // Fall through to line-by-line parse.
    }
  }
  if (!parsedWhole) {
    const lines = stdout.split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]!
      if (!line.trim() || !line.trim().startsWith('{')) {
        continue
      }
      try {
        const d = JSON.parse(line) as OxlintDiagnostic
        if (matchesRule(d)) {
          diagnostics.push(d)
        }
      } catch {
        // Skip non-JSON lines (oxlint sometimes emits human text).
      }
    }
  }
  return diagnostics
}
