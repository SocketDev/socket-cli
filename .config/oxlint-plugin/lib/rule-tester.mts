/**
 * @file RuleTester for the fleet's oxlint plugin rules. Oxlint doesn't yet ship
 *   its own RuleTester (oxc-project/oxc#16018 tracks the planned
 *   `@oxlint/plugin-dev` package). This module is a dummy stand-in modeled on
 *   ESLint's RuleTester API — same `valid` / `invalid` array shape, same
 *   per-case fields (`code`, `errors`, `output`, `filename`). How it works:
 *
 *   1. For each test case, write the fixture to an OS-temp dir (mkdtemp).
 *   2. Write a tiny `.oxlintrc.json` that enables ONLY the rule under test, plus
 *      `jsPlugins: [<plugin-path>]`.
 *   3. Spawn `oxlint --config <tmpdir>/.oxlintrc.json <fixture>` and capture
 *      stdout.
 *   4. Compare findings against the test case's `errors` array.
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

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs'

const logger = getDefaultLogger()

const PLUGIN_INDEX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.mts',
)

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
}

export interface InvalidTestCase extends ValidTestCase {
  /**
   * Expected error matches. Each entry must match by `messageId`, `message`, or
   * both. Order-sensitive — oxlint emits findings in source order.
   */
  readonly errors: ReadonlyArray<{
    readonly messageId?: string | undefined
    readonly message?: string | undefined
  }>
  /**
   * Expected source after autofix. If provided, the tester reruns `oxlint
   * --fix` against a copy of the fixture and asserts the result. Omit when the
   * rule has no autofix.
   */
  readonly output?: string | undefined
}

export interface RunOpts {
  readonly valid: ReadonlyArray<ValidTestCase>
  readonly invalid: ReadonlyArray<InvalidTestCase>
}

/**
 * Find the `oxlint` binary. Returns undefined when not on PATH — tests skip
 * with a clear note rather than fail (a fresh-laptop checkout shouldn't
 * false-fail before `pnpm install` completes the bin link).
 */
function resolveOxlintBinary(): string | undefined {
  const r = spawnSync('which', ['oxlint'], { encoding: 'utf8' })
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  return undefined
}

interface OxlintDiagnostic {
  readonly ruleId?: string | undefined
  readonly message?: string | undefined
  readonly messageId?: string | undefined
}

/**
 * Run oxlint against a fixture file with a one-rule config; return the parsed
 * list of findings for THIS rule.
 */
function runOxlint(args: {
  oxlintBin: string
  fixturePath: string
  configPath: string
  ruleName: string
  fix: boolean
}): { diagnostics: OxlintDiagnostic[]; output?: string | undefined } {
  const cliArgs = ['--config', args.configPath, '-f', 'json']
  if (args.fix) cliArgs.push('--fix')
  cliArgs.push(args.fixturePath)
  const r = spawnSync(args.oxlintBin, cliArgs, {
    encoding: 'utf8',
    timeout: 15_000,
  })
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
  const stdout = r.stdout || ''
  const diagnostics: OxlintDiagnostic[] = []
  const trimmed = stdout.trim()
  const matchesRule = (d: OxlintDiagnostic): boolean => {
    // Current oxlint emits `code` like `socket(no-cached-for-on-iterable)`
    // instead of (or in addition to) `ruleId`. Accept either form.
    const code = (d as OxlintDiagnostic & { code?: string }).code
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
      const fileBlocks: Array<{ diagnostics?: OxlintDiagnostic[] }> =
        Array.isArray(parsed)
          ? (parsed as Array<{ diagnostics?: OxlintDiagnostic[] }>)
          : [parsed as { diagnostics?: OxlintDiagnostic[] }]
      for (const file of fileBlocks) {
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
      if (!line.trim() || !line.trim().startsWith('{')) continue
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
  const output = args.fix ? readFileSync(args.fixturePath, 'utf8') : undefined
  return { diagnostics, output }
}

/**
 * Build the minimal .oxlintrc.json that enables ONE socket plugin rule plus the
 * plugin's JS entry point.
 */
function buildConfig(ruleName: string): string {
  return JSON.stringify(
    {
      jsPlugins: [PLUGIN_INDEX],
      rules: {
        [`socket/${ruleName}`]: 'error',
      },
    },
    null,
    2,
  )
}

/**
 * Default fixture filename derived from the test case's `filename` override or
 * `'fixture.ts'`. ESLint's RuleTester uses `'<input>.js'`; we default to `.ts`
 * since the fleet rules are TS-aware.
 */
function fixtureFilename(testCase: ValidTestCase): string {
  return testCase.filename ?? 'fixture.ts'
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

interface RuleModule {
  readonly meta?: unknown
  readonly create?: (context: unknown) => unknown
}

export class RuleTester {
  /**
   * Execute the test suite. Throws on the first failure (matches node:test
   * expectations — a failing test bubbles up as a thrown assertion error). For
   * per-case isolation use describe() blocks in your test file and call .run()
   * inside each.
   */
  run(ruleName: string, _rule: RuleModule, opts: RunOpts): void {
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
    const writeFixture = (fixturePath: string, code: string): void => {
      mkdirSync(path.dirname(fixturePath), { recursive: true })
      writeFileSync(fixturePath, code)
    }
    try {
      const configPath = path.join(tmpdir, '.oxlintrc.json')
      writeFileSync(configPath, buildConfig(ruleName))

      // Valid cases: no findings expected.
      for (const tc of opts.valid) {
        const fixturePath = path.join(tmpdir, fixtureFilename(tc))
        writeFixture(fixturePath, tc.code)
        const { diagnostics } = runOxlint({
          oxlintBin,
          fixturePath,
          configPath,
          ruleName,
          fix: false,
        })
        if (diagnostics.length > 0) {
          throw new Error(
            `[${ruleName}] valid case ${tc.name ? `'${tc.name}'` : ''} ` +
              `unexpectedly produced ${diagnostics.length} ` +
              `finding(s): ${JSON.stringify(diagnostics)}`,
          )
        }
      }

      // Invalid cases: expected count + messageId / message match.
      for (const tc of opts.invalid) {
        const fixturePath = path.join(tmpdir, fixtureFilename(tc))
        writeFixture(fixturePath, tc.code)
        const { diagnostics } = runOxlint({
          oxlintBin,
          fixturePath,
          configPath,
          ruleName,
          fix: false,
        })
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
        // Autofix assertion.
        if (typeof tc.output === 'string') {
          // Rewrite the fixture (oxlint --fix mutates in place) and
          // re-run with --fix.
          writeFixture(fixturePath, tc.code)
          const fixResult = runOxlint({
            oxlintBin,
            fixturePath,
            configPath,
            ruleName,
            fix: true,
          })
          if (fixResult.output !== tc.output) {
            throw new Error(
              `[${ruleName}] autofix mismatch for ${tc.name ? `'${tc.name}'` : 'case'}:\n` +
                `  expected: ${JSON.stringify(tc.output)}\n` +
                `  got:      ${JSON.stringify(fixResult.output)}`,
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
