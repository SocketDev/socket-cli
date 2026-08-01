#!/usr/bin/env node
/*
 * @file Get-green — the deterministic executor behind the gh-aw `get-green`
 *   workflow. A weekly dependency update landed on a branch and its build or
 *   tests went red; this decides, without judgment, whether the branch is
 *   shippable and whether the changes stayed inside the allowlist.
 *
 *   The split follows `.claude/rules/fleet/code-first-then-ai.md`: everything
 *   MEASURABLE lives here — run the setup + test commands, capture the tail of
 *   each log, diff the branch against its base, sort the changed paths into
 *   allowed vs out-of-allowlist, and answer "may this open a PR?". The one
 *   genuinely non-deterministic step, diagnosing WHY the update broke and
 *   editing code to fix it, is what the workflow's agentic step does. The
 *   agent never decides whether the branch is green; it asks this script.
 *
 *   Running the verification here rather than inline in the workflow means the
 *   same answer locally and in CI, and it means a red branch can never ship on
 *   an agent's say-so: `--verify` exits non-zero and the workflow's PR step is
 *   gated on it.
 *
 *   Modes:
 *     --verify   run setup + tests; exit 0 green, 1 red. Prints the log tails.
 *     --report   verify, then also print the changed-path classification.
 *     (default)  --report
 *
 *   Usage: node scripts/fleet/get-green.mts [--verify | --report]
 *            [--base <ref>] [--setup <cmd>] [--test <cmd>] [--patterns <globs>]
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

const logger = getDefaultLogger()

// The workflow hands the agent 100 lines of each log; match it so a local run
// and a CI run show the operator the same window.
const LOG_TAIL_LINES = 100

// The manifest paths a dependency update is expected to touch, mirroring the
// `validate-file-patterns` input in `.github/workflows/get-green.md`. Held as
// one entry per line so a reader can see the whole surface at a glance, and so
// widening it is a visible one-line diff rather than an edit buried inside a
// pipe-separated string.
export const DEFAULT_VALIDATE_FILE_PATTERN_LIST: readonly string[] = [
  '.gitmodules',
  '.npmrc',
  '.config/repo/lockstep.json',
  'package.json',
  '*/package.json',
  'pnpm-lock.yaml',
  '*/pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]

// The pipe-separated spelling the workflow input uses.
export const DEFAULT_VALIDATE_FILE_PATTERNS =
  DEFAULT_VALIDATE_FILE_PATTERN_LIST.join('|')

const DEFAULT_SETUP_COMMAND = 'pnpm run build'
const DEFAULT_TEST_COMMAND = 'pnpm test'
const DEFAULT_BASE_REF = 'main'

/**
 * One command's outcome: whether it exited 0 and the tail of its combined
 * output, which is what the workflow forwards to the agent.
 */
export interface CommandOutcome {
  readonly command: string
  readonly logTail: string
  readonly ok: boolean
}

/**
 * The verification verdict: the setup and test outcomes, plus the single
 * `green` bit the workflow gates its PR step on.
 */
export interface VerifyResult {
  readonly green: boolean
  readonly setup: CommandOutcome
  readonly test: CommandOutcome
}

/**
 * Changed paths sorted against the allowlist. `outside` is not a failure on
 * its own — a real fix usually touches source — but the workflow is required
 * to name those paths in the PR body, so the split has to be computed, not
 * eyeballed.
 */
export interface ChangedPathReport {
  readonly allowed: string[]
  readonly outside: string[]
}

/**
 * The last `lines` lines of `text`, trailing blank lines dropped. Pure. A
 * short log is returned whole rather than padded.
 */
export function logTail(text: string, lines: number = LOG_TAIL_LINES): string {
  const all = text.replace(/\s+$/, '').split('\n')
  return all.length <= lines ? all.join('\n') : all.slice(-lines).join('\n')
}

/**
 * Compile one allowlist glob into an anchored RegExp.
 *
 * `*` crosses directory separators here, matching the case-glob semantics the
 * workflow input documents: its `*​/package.json` entry is described as
 * "workspace member manifests at ANY depth", so a nested
 * `packages/cli/package.json` has to match. A segment-scoped `*` would silently
 * exclude every nested member manifest and push routine lockfile churn into the
 * out-of-allowlist column.
 *
 * The vocabulary stays deliberately small rather than delegating to a general
 * glob engine, which would accept patterns the workflow never documents and
 * quietly widen the allowlist. Every other metacharacter is escaped, and the
 * result is anchored, so a bare `package.json` still matches only the root one.
 */
export function validatePatternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map(seg => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

/**
 * Sort `changedPaths` into allowed vs outside, against a pipe-separated
 * pattern list. Paths are normalized first so a win32 checkout classifies the
 * same as posix. Pure.
 */
export function classifyChangedPaths(
  changedPaths: readonly string[],
  patterns: string = DEFAULT_VALIDATE_FILE_PATTERNS,
): ChangedPathReport {
  const matchers = patterns
    .split('|')
    .map(p => p.trim())
    .filter(Boolean)
    .map(validatePatternToRegExp)
  const allowed: string[] = []
  const outside: string[] = []
  for (let i = 0, { length } = changedPaths; i < length; i += 1) {
    // Test the RAW string for emptiness: normalizePath('') resolves to '.',
    // which would then be classified as an out-of-allowlist path.
    const raw = changedPaths[i]!.trim()
    if (raw === '') {
      continue
    }
    const changedPath = normalizePath(raw)
    let matched = false
    for (let j = 0, { length: jlen } = matchers; j < jlen; j += 1) {
      if (matchers[j]!.test(changedPath)) {
        matched = true
        break
      }
    }
    if (matched) {
      allowed.push(changedPath)
    } else {
      outside.push(changedPath)
    }
  }
  return { allowed: allowed.toSorted(), outside: outside.toSorted() }
}

/**
 * True when the branch may open a pull request: the workflow's contract is
 * that a red branch is left for a human, never PR'd. Pure, so the rule is
 * testable without running a build.
 */
export function mayOpenPullRequest(result: VerifyResult): boolean {
  return result.green
}

/**
 * Run one shell command, capturing combined output. A non-zero exit is data,
 * not an exception — the caller reports it.
 */
async function runCommand(command: string): Promise<CommandOutcome> {
  try {
    // prefer-shell-win32: intentional — `test-setup-script` / `test-script`
    // arrive from the workflow as free-form command STRINGS ('pnpm run build',
    // 'pnpm test'), not an argv pair. A shell wrap on every platform is the
    // only way to honor an operator-supplied command line; WIN32-only would
    // leave the Unix runner unable to execute the input it was given.
    const result = await spawn(command, [], { shell: true })
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return { command, logTail: logTail(combined), ok: result.code === 0 }
  } catch (e) {
    // A spawn that never started is as red as one that exited non-zero; keep
    // the reason in the tail so the operator sees it.
    const reason =
      typeof e === 'object' && e !== null && 'message' in e
        ? String((e as Record<'message', unknown>)['message'])
        : String(e)
    return { command, logTail: reason, ok: false }
  }
}

/**
 * Run the setup command then the test command. The test never runs when setup
 * fails: a build failure makes the test result meaningless, and reporting both
 * as red would send the agent chasing two symptoms of one cause.
 */
export async function verifyBranch(
  options?:
    | {
        setupCommand?: string | undefined
        testCommand?: string | undefined
      }
    | undefined,
): Promise<VerifyResult> {
  const { setupCommand, testCommand } = {
    __proto__: null,
    ...options,
  } as { setupCommand?: string | undefined; testCommand?: string | undefined }
  const setup = await runCommand(setupCommand ?? DEFAULT_SETUP_COMMAND)
  if (!setup.ok) {
    return {
      green: false,
      setup,
      test: {
        command: testCommand ?? DEFAULT_TEST_COMMAND,
        logTail: 'not run — the setup command failed first.',
        ok: false,
      },
    }
  }
  const test = await runCommand(testCommand ?? DEFAULT_TEST_COMMAND)
  return { green: test.ok, setup, test }
}

/**
 * The paths this branch changed relative to `baseRef`.
 */
export async function changedPathsAgainst(baseRef: string): Promise<string[]> {
  const result = await spawn('git', [
    'diff',
    '--name-only',
    `${baseRef}...HEAD`,
  ])
  if (result.code !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      patterns: { type: 'string' },
      report: { default: false, type: 'boolean' },
      setup: { type: 'string' },
      test: { type: 'string' },
      verify: { default: false, type: 'boolean' },
    },
    allowPositionals: false,
    strict: false,
  })

  const result = await verifyBranch({
    ...(typeof values['setup'] === 'string'
      ? { setupCommand: values['setup'] }
      : {}),
    ...(typeof values['test'] === 'string'
      ? { testCommand: values['test'] }
      : {}),
  })

  logger.log(
    `setup: ${result.setup.ok ? 'green' : 'RED'} — ${result.setup.command}`,
  )
  if (!result.setup.ok) {
    logger.log(result.setup.logTail)
  }
  logger.log(
    `test:  ${result.test.ok ? 'green' : 'RED'} — ${result.test.command}`,
  )
  if (!result.test.ok) {
    logger.log(result.test.logTail)
  }

  // --verify is the gate the workflow calls; the default adds the path split
  // an operator reads at a terminal.
  if (!values['verify']) {
    const baseRef =
      typeof values['base'] === 'string' ? values['base'] : DEFAULT_BASE_REF
    const patterns =
      typeof values['patterns'] === 'string'
        ? values['patterns']
        : DEFAULT_VALIDATE_FILE_PATTERNS
    const changed = await changedPathsAgainst(baseRef)
    const { allowed, outside } = classifyChangedPaths(changed, patterns)
    logger.log(
      `changed vs ${baseRef}: ${allowed.length} allowed, ${outside.length} outside the allowlist`,
    )
    for (let i = 0, { length } = outside; i < length; i += 1) {
      logger.warn(`  outside: ${outside[i]!}`)
    }
  }

  if (!mayOpenPullRequest(result)) {
    logger.fail(
      '[get-green] the branch is RED — no pull request.\n' +
        '  Where: the update branch under verification.\n' +
        '  Saw:   a failing setup or test command, above.\n' +
        '  Wanted: both green before anything opens a PR.\n' +
        '  Fix:   fix the code that broke against the new versions — never revert\n' +
        '         the dependency update itself. If it still fails, leave the branch\n' +
        '         for a human rather than opening a PR.',
    )
    process.exitCode = 1
    return
  }
  logger.success(
    '[get-green] setup + tests are green; the branch may open a pull request.',
  )
}

if (isMainModule(import.meta.url)) {
  runMain(main)
}
