/*
 * @file RuleTester for the fleet's oxlint plugin rules. Oxlint doesn't yet ship
 *   its own RuleTester (oxc-project/oxc#16018 tracks the planned
 *   `@oxlint/plugin-dev` package). This module is a placeholder stand-in
 *   modeled on ESLint's RuleTester API — same `valid` / `invalid` array shape,
 *   same per-case fields (`code`, `errors`, `output`, `filename`). How it
 *   works:
 *
 *   1. Write every test case to an isolated fixture dir under one OS-temp dir.
 *   2. Write a tiny `.oxlintrc.json` that enables ONLY the rule under test, plus
 *      `jsPlugins: [<plugin-path>]`.
 *   3. Spawn oxlint once for all fixtures, then once more for every autofix
 *      fixture. Group JSON diagnostics back to their source fixture.
 *   4. Compare each fixture's findings against its test case's `errors` array.
 *   5. Clean up via `safeDeleteSync` (fleet rule: never `fs.rm` / `fs.unlink` /
 *      `rm -rf` directly). Cleanup runs in a try/finally so a failing assertion
 *      doesn't leak tmp dirs.
 *
 * @example
 *   import { RuleTester } from '../lib/rule-tester.mts'
 *   import rule from '../rules/no-default-export.mts'
 *
 *   new RuleTester().run('no-default-export', rule, {
 *     valid: [
 *       { code: 'export const foo = 1;' },
 *       { code: 'export function foo() {}' },
 *     ],
 *     invalid: [
 *       {
 *         code: 'export default function foo() {}',
 *         errors: [{ messageId: 'noDefaultExport' }],
 *         output: 'export function foo() {}',
 *       },
 *     ],
 *   })
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveBinaryPath } from '@socketsecurity/lib-stable/dlx/binary-resolution'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

const PLUGIN_INDEX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.mts',
)

/**
 * Build the minimal .oxlintrc.json that enables ONE socket plugin rule plus the
 * plugin's JS entry point.
 */
function buildConfig(ruleName: string, ruleOptions?: unknown): string {
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
function errorMatches(
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
function fixtureFilename(testCase: ValidTestCase): string {
  return testCase.filename ?? 'fixture.ts'
}

export interface ValidTestCase {
  /**
   * Source to lint.
   */
  readonly code: string
  /**
   * Optional override for the fixture filename (e.g. `'.cts'` cases).
   */
  readonly filename?: string | undefined
  /**
   * Human-readable label shown in failure output.
   */
  readonly name?: string | undefined
  /**
   * Optional `package.json` written alongside the fixture in the tmp dir. Lets
   * package-name-aware rules (e.g. `prefer-stable-self-import`, which walks up
   * to the nearest package.json `name`) be exercised. Provide a partial object;
   * it's JSON-stringified verbatim.
   */
  readonly packageJson?: Record<string, unknown> | undefined
}

export interface InvalidTestCase extends ValidTestCase {
  /**
   * Expected error matches. Each entry must match by `messageId`, `message`, or
   * both. Order-sensitive — oxlint emits findings in source order.
   */
  readonly errors: ReadonlyArray<{
    readonly messageId?: string | undefined
    readonly message?: string | undefined
    /**
     * Template-substitution data for messageId-keyed message strings. Mirrors
     * ESLint's RuleTester `data` field — when the rule's messages dict has
     * placeholders like `{{name}}`, the test passes the substitution values
     * here.
     */
    readonly data?: Record<string, unknown> | undefined
  }>
  /**
   * Expected source after autofix. If provided, the tester reruns `oxlint
   * --fix` against a copy of the fixture and asserts the result. Omit when the
   * rule has no autofix.
   */
  readonly output?: string | undefined
}

export interface RunOpts {
  readonly valid: readonly ValidTestCase[]
  readonly invalid: readonly InvalidTestCase[]
  // Options object passed to the rule for EVERY case in this run, emitted into
  // the fixture config as `['error', ruleOptions]`. Rules with per-case option
  // needs should call run() once per option set.
  readonly ruleOptions?: unknown | undefined
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
function resolveOxlintBinary(): string | undefined {
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

export interface OxlintDiagnostic {
  readonly ruleId?: string | undefined
  readonly message?: string | undefined
  readonly messageId?: string | undefined
  readonly filename?: string | undefined
}

/**
 * One oxlint child invocation. Pipe (never inherit) the child's stdio: oxlint
 * detects a TTY and emits an OSC-52 clipboard escape when stdout/stderr is a
 * terminal, which trips the OS "terminal attempted to access the clipboard"
 * denial on every test run. Piping makes isatty() false so the escape is never
 * written, and the caller reads r.stdout anyway.
 */
export function spawnOxlintOnce(
  oxlintBin: string,
  cliArgs: string[],
): ReturnType<typeof spawnSync> {
  // The npm package's `bin/oxlint` is a node shim (`#!/usr/bin/env node`).
  // Unix executes it via the shebang; windows has no shebangs, so spawning the
  // shim directly fails ("oxlint child failed" on every windows CI run). Run
  // anything that isn't a real executable through the current node binary —
  // identical behavior on unix, the only working path on windows.
  const isNativeExe = oxlintBin.endsWith('.exe')
  const cmd = isNativeExe ? oxlintBin : process.execPath
  const args = isNativeExe ? cliArgs : [oxlintBin, ...cliArgs]
  return spawnSync(cmd, args, {
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Synchronous backoff between starved-spawn retries. RuleTester is a fully
 * synchronous pipeline (spawnSync per batch), so an async sleep has nothing to
 * yield to; Atomics.wait gives a real blocking pause without spinning.
 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run oxlint against one or more fixture files with a one-rule config; return
 * the parsed list of findings for THIS rule.
 */
function runOxlintFiles(args: {
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
    for (const line of stdout.split('\n')) {
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

/**
 * Group multi-file JSON diagnostics by the fixture path passed to oxlint.
 * Oxlint can normalize separators and may emit a relative filename, so both
 * sides resolve through the current platform before matching. Unknown or
 * filename-less diagnostics fail loudly rather than becoming false clean
 * fixtures.
 */
export function groupDiagnosticsByFixture(
  fixturePaths: readonly string[],
  diagnostics: readonly OxlintDiagnostic[],
): Map<string, OxlintDiagnostic[]> {
  const originalByKey = new Map<string, string>()
  const result = new Map<string, OxlintDiagnostic[]>()
  const toKey = (filename: string): string => {
    const normalized = path.normalize(path.resolve(filename))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  for (const fixturePath of fixturePaths) {
    originalByKey.set(toKey(fixturePath), fixturePath)
    result.set(fixturePath, [])
  }
  for (const diagnostic of diagnostics) {
    const { filename } = diagnostic
    if (!filename) {
      throw new Error(
        'oxlint emitted a multi-file diagnostic without a filename; cannot map it to a RuleTester case',
      )
    }
    const fixturePath = originalByKey.get(toKey(filename))
    if (!fixturePath) {
      throw new Error(
        `oxlint emitted a diagnostic for an unknown RuleTester fixture: ${filename}`,
      )
    }
    result.get(fixturePath)!.push(diagnostic)
  }
  return result
}

/**
 * Backward-compatible single-fixture entry point used by focused harness
 * tests and callers that need the post-fix source text.
 */
export function runOxlint(args: {
  oxlintBin: string
  fixturePath: string
  configPath: string
  ruleName: string
  fix: boolean
}): { diagnostics: OxlintDiagnostic[]; output?: string | undefined } {
  const diagnostics = runOxlintFiles({
    oxlintBin: args.oxlintBin,
    fixturePaths: [args.fixturePath],
    configPath: args.configPath,
    ruleName: args.ruleName,
    fix: args.fix,
  })
  const output = args.fix ? readFileSync(args.fixturePath, 'utf8') : undefined
  return { diagnostics, output }
}

interface RuleModule {
  readonly meta?: unknown | undefined
  readonly create?: ((context: unknown) => unknown) | undefined
}

export class RuleTester {
  /**
   * Execute the test suite. Throws on the first failure (matches node:test
   * expectations — a failing test bubbles up as a thrown assertion error). For
   * per-case isolation use describe() blocks in your test file and call .run()
   * inside each.
   */
  run(ruleName: string, _rule: RuleModule, options: RunOpts): void {
    const opts = { __proto__: null, ...options } as typeof options
    const oxlintBin = resolveOxlintBinary()
    if (!oxlintBin) {
      // Don't fail — let the harness skip gracefully. The audit-
      // coverage script enforces test FILES exist; running them is
      // contingent on the bin being installed (which `pnpm install`
      // wires up).
      logger.warn(
        `[rule-tester] oxlint binary not on PATH; skipping ${ruleName} cases.`,
      )
      return
    }

    const tmpdir = mkdtempSync(
      path.join(os.tmpdir(), `oxlint-test-${ruleName}-`),
    )
    // `filename:` overrides can put fixtures in subdirs (e.g.
    // `scripts/foo.mts`). Ensure the parent dir exists before each
    // write — fail-fast on a missing dir would manifest as a
    // confusing ENOENT in the test report.
    const writeFixture = (
      fixturePath: string,
      code: string,
      tc?: ValidTestCase,
    ): void => {
      mkdirSync(path.dirname(fixturePath), { recursive: true })
      writeFileSync(fixturePath, code)
      // Optional package.json fixture for package-name-aware rules. Written
      // next to the fixture file so a walk-up from the fixture finds it.
      if (tc?.packageJson) {
        writeFileSync(
          path.join(path.dirname(fixturePath), 'package.json'),
          `${JSON.stringify(tc.packageJson, null, 2)}\n`,
        )
      }
    }
    try {
      const configPath = path.join(tmpdir, '.oxlintrc.json')
      writeFileSync(configPath, buildConfig(ruleName, opts.ruleOptions))

      const prepareCases = <Case extends ValidTestCase>(
        kind: 'invalid' | 'valid',
        cases: readonly Case[],
      ): Array<{ fixturePath: string; testCase: Case }> =>
        cases.map((testCase, index) => {
          const fixturePath = path.join(
            tmpdir,
            'cases',
            `${kind}-${index}`,
            fixtureFilename(testCase),
          )
          writeFixture(fixturePath, testCase.code, testCase)
          return { fixturePath, testCase }
        })
      const validCases = prepareCases('valid', opts.valid)
      const invalidCases = prepareCases('invalid', opts.invalid)
      const fixturePaths = [...validCases, ...invalidCases].map(
        prepared => prepared.fixturePath,
      )
      const diagnosticsByFixture = groupDiagnosticsByFixture(
        fixturePaths,
        runOxlintFiles({
          oxlintBin,
          fixturePaths,
          configPath,
          ruleName,
          fix: false,
        }),
      )

      // Valid cases: no findings expected.
      for (const { fixturePath, testCase: tc } of validCases) {
        const diagnostics = diagnosticsByFixture.get(fixturePath)!
        if (diagnostics.length > 0) {
          throw new Error(
            `[${ruleName}] valid case ${tc.name ? `'${tc.name}'` : ''} ` +
              `unexpectedly produced ${diagnostics.length} ` +
              `finding(s): ${JSON.stringify(diagnostics)}`,
          )
        }
      }

      // Invalid cases: expected count + messageId / message match.
      for (const { fixturePath, testCase: tc } of invalidCases) {
        const diagnostics = diagnosticsByFixture.get(fixturePath)!
        if (diagnostics.length !== tc.errors.length) {
          throw new Error(
            `[${ruleName}] invalid case ${tc.name ? `'${tc.name}'` : ''} ` +
              `expected ${tc.errors.length} finding(s), got ` +
              `${diagnostics.length}: ${JSON.stringify(diagnostics)}`,
          )
        }
        for (let i = 0; i < tc.errors.length; i += 1) {
          const spec = tc.errors[i]!
          const diag = diagnostics[i]!
          if (!errorMatches(spec, diag)) {
            throw new Error(
              `[${ruleName}] invalid case ${tc.name ? `'${tc.name}'` : ''} ` +
                `error #${i} mismatch — expected ` +
                `${JSON.stringify(spec)}, got ${JSON.stringify(diag)}`,
            )
          }
        }
      }

      // Autofix assertions share one additional oxlint invocation. The first
      // pass did not mutate fixtures, so each file still contains its original
      // case source.
      const fixCases = invalidCases.filter(
        prepared => typeof prepared.testCase.output === 'string',
      )
      if (fixCases.length > 0) {
        runOxlintFiles({
          oxlintBin,
          fixturePaths: fixCases.map(prepared => prepared.fixturePath),
          configPath,
          ruleName,
          fix: true,
        })
        for (const { fixturePath, testCase: tc } of fixCases) {
          const output = readFileSync(fixturePath, 'utf8')
          if (output !== tc.output) {
            throw new Error(
              `[${ruleName}] autofix mismatch for ${tc.name ? `'${tc.name}'` : 'case'}:\n` +
                `  expected: ${JSON.stringify(tc.output)}\n` +
                `  got:      ${JSON.stringify(output)}`,
            )
          }
        }
      }
    } finally {
      // Fleet rule: safeDeleteSync from @socketsecurity/lib-stable/fs, never
      // fs.rm / fs.unlink / rm -rf. The Sync flavor matches the
      // tester's sync-style API + lets a thrown assertion still trigger
      // cleanup via the finally block.
      safeDeleteSync(tmpdir, { force: true, recursive: true })
    }
  }
}
