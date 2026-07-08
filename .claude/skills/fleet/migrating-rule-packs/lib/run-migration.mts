#!/usr/bin/env node
/*
 * @file Rule-pack migration runner — the operational engine SKILL.md describes.
 *   Streams a set of target files through a worktree-isolated transform →
 *   build/fix/check/test loop, one PR per file, capped concurrency. The
 *   per-file TRANSFORM that needs intelligence runs through `spawnAiAgent` +
 *   an `AI_PROFILE` tier (locked down — four flags, permissionMode acceptEdits,
 *   no raw `claude` CLI). Everything deterministic (worktree create, survey,
 *   the build/check/test gate verdict, the git add/commit/push/PR, cleanup) is
 *   plain code so the AI's only job is "apply the rule pack to this one file".
 *
 *   Pipeline (mirrors cascade-template.mts's per-target worktree shape, with
 *   the inner loop swapped for a rule-pack transform):
 *
 *   1. Resolve target set (no agents): load the rule-pack markdown, survey the
 *      before-pattern across the migration scope, resolve the default branch.
 *   2. Per file, bounded-concurrency: a fresh worktree off origin/<base> on a
 *      `migration/<name>-<slug>` branch; spawn the locked-down agent to apply
 *      the rules + iterate the build/check/test gate up to N attempts; on a
 *      green gate, deterministically commit + push + open the PR; on failure,
 *      record an `exception` and leave the worktree for the human.
 *   3. Barrier → report `{ landed, exceptions, prUrls }`.
 *
 *   Usage: node .claude/skills/fleet/migrating-rule-packs/lib/run-migration.mts \
 *     --name zod-to-typebox \
 *     --rules <repo>/.claude/migrations/zod-to-typebox/rules \
 *     --survey 'z\.(object|union|literal|enum|tuple|array)' \
 *     --scope packages \
 *     [--target <repo-root>] [--repo SocketDev/<repo>] \
 *     [--concurrency 5] [--attempts 3] [--model claude-sonnet-4-6] \
 *     [--effort medium] [--dry-run]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type { AiEffort } from '@socketsecurity/lib-stable/ai/types'

const logger = getDefaultLogger()

// Mechanical edits over a stable rule pack — sonnet/medium is the right tier
// (the CLAUDE.md token-spend rule: match model + effort to the job). Override
// per migration with --model / --effort.
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_EFFORT: AiEffort = 'medium'
// Default 5 in-flight worktree agents — higher risks lock-stepped pnpm runs
// hammering shared caches; lower under-utilizes. Tune per migration.
const DEFAULT_CONCURRENCY = 5
// The build/check/test gate retries the agent this many times, appending the
// failing stderr to its context each round (the gate is ground truth — if
// `check` doesn't catch the regression, the rule needs a tighter assertion).
const DEFAULT_ATTEMPTS = 3
// One agent attempt's wall-clock ceiling.
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000

export interface MigrationArgs {
  attempts: number
  concurrency: number
  dryRun: boolean
  effort: AiEffort
  model: string
  name: string
  repo: string | undefined
  rulesDir: string
  scope: string
  survey: string
  target: string
}

// One file's terminal outcome. `landed` files opened a PR; `exception` files
// failed the gate (or had no agent) and are left for the human — those are the
// rule pack's tells about coverage gaps, per SKILL.md "What NOT to do".
export interface MigrationResult {
  attempts: number
  failureMode: string | undefined
  file: string
  prUrl: string | undefined
  status: 'exception' | 'landed'
}

export interface MigrationReport {
  exceptions: readonly MigrationResult[]
  landed: readonly MigrationResult[]
  prUrls: readonly string[]
}

interface RunOutcome {
  code: number
  stderr: string
  stdout: string
}

function usage(): never {
  logger.error(
    [
      'usage: run-migration.mts --name <migration> --rules <dir> --survey <regex> --scope <subpath>',
      '  [--target <repo-root>] [--repo <owner/repo>] [--concurrency N] [--attempts N]',
      '  [--model <id>] [--effort <level>] [--dry-run]',
    ].join('\n'),
  )
  process.exit(2)
}

export function parseArgs(argv: readonly string[]): MigrationArgs {
  let attempts = DEFAULT_ATTEMPTS
  let concurrency = DEFAULT_CONCURRENCY
  let dryRun = false
  let effort: AiEffort = DEFAULT_EFFORT
  let model = DEFAULT_MODEL
  let name: string | undefined
  let repo: string | undefined
  let rulesDir: string | undefined
  let scope = '.'
  let survey: string | undefined
  let target = process.cwd()
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--attempts') {
      attempts = Math.max(
        1,
        Number.parseInt(argv[++i] ?? '', 10) || DEFAULT_ATTEMPTS,
      )
    } else if (arg === '--concurrency') {
      concurrency = Math.max(
        1,
        Number.parseInt(argv[++i] ?? '', 10) || DEFAULT_CONCURRENCY,
      )
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--effort') {
      effort = (argv[++i] ?? DEFAULT_EFFORT) as AiEffort
    } else if (arg === '--model') {
      model = argv[++i] ?? DEFAULT_MODEL
    } else if (arg === '--name') {
      name = argv[++i]
    } else if (arg === '--repo') {
      repo = argv[++i]
    } else if (arg === '--rules') {
      rulesDir = argv[++i]
    } else if (arg === '--scope') {
      scope = argv[++i] ?? '.'
    } else if (arg === '--survey') {
      survey = argv[++i]
    } else if (arg === '--target') {
      target = path.resolve(argv[++i] ?? process.cwd())
    }
  }
  if (!name || !rulesDir || !survey) {
    usage()
  }
  if (!existsSync(rulesDir)) {
    logger.fail(`--rules dir does not exist: ${rulesDir}`)
    process.exit(2)
  }
  return {
    attempts,
    concurrency,
    dryRun,
    effort,
    model,
    name,
    repo,
    rulesDir,
    scope,
    survey,
    target,
  }
}

async function run(
  cmd: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env?: Readonly<Record<string, string>> | undefined
  },
): Promise<RunOutcome> {
  const opts = { __proto__: null, ...options } as {
    cwd: string
    env?: Readonly<Record<string, string>> | undefined
  }
  try {
    const result = await spawn(cmd, args, {
      cwd: opts.cwd,
      stdioString: true,
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    })
    return {
      code: 0,
      stderr: String(result.stderr ?? ''),
      stdout: String(result.stdout ?? ''),
    }
  } catch (e) {
    // lib spawn rejects on non-zero/spawn-error carrying { code, stdout, stderr }.
    // A spawn ENOENT carries the STRING "ENOENT" as code → map non-numeric to -1.
    const err = e as {
      code?: unknown | undefined
      stderr?: unknown | undefined
      stdout?: unknown | undefined
    }
    const rawCode = err?.code
    return {
      code: typeof rawCode === 'number' ? rawCode : -1,
      stderr: String(err?.stderr ?? errorMessage(e)),
      stdout: String(err?.stdout ?? ''),
    }
  }
}

// Resolve the remote's default branch — prefer main, fall back to master.
// Never hard-code one (CLAUDE.md default-branch rule).
export async function resolveBase(cwd: string): Promise<string> {
  const sym = await run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd,
  })
  if (sym.code === 0 && sym.stdout.trim()) {
    return sym.stdout.trim().replace(/^refs\/remotes\/origin\//, '')
  }
  for (const candidate of ['main', 'master']) {
    const probe = await run(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${candidate}`],
      { cwd },
    )
    if (probe.code === 0) {
      return candidate
    }
  }
  return 'main'
}

// Load every `*.md` rule file in the pack, concatenated as the agent's context.
export function loadRulePack(rulesDir: string): string {
  const files = readdirSync(rulesDir)
    .filter(name => name.endsWith('.md'))
    .toSorted()
  if (files.length === 0) {
    logger.fail(`Rule pack is empty (no *.md files): ${rulesDir}`)
    process.exit(2)
  }
  return files
    .map(name => {
      const body = readFileSync(path.join(rulesDir, name), 'utf8').trim()
      return `===== RULE FILE: ${name} =====\n${body}`
    })
    .join('\n\n')
}

// Survey the target set: rg the before-pattern across the migration scope,
// return repo-relative file paths (deterministic, no agent). Falls back to a
// quiet empty set when rg finds nothing (its exit 1).
export async function surveyTargets(args: MigrationArgs): Promise<string[]> {
  const scopeDir = path.join(args.target, args.scope)
  const result = await run(
    'rg',
    ['--files-with-matches', '--no-messages', args.survey, scopeDir],
    { cwd: args.target },
  )
  const lines = result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(abs => path.relative(args.target, abs))
    .filter(rel => rel && !rel.startsWith('..'))
    .toSorted()
  return [...new Set(lines)]
}

// A filesystem-safe per-file branch/worktree slug.
export function slugForFile(file: string): string {
  // Non-alphanumeric runs → hyphen; trim leading/trailing hyphens.
  return file.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function buildPrompt(options: {
  readonly attemptFeedback: string | undefined
  readonly file: string
  readonly rulePack: string
}): string {
  const opts = { __proto__: null, ...options } as {
    attemptFeedback: string | undefined
    file: string
    rulePack: string
  }
  return [
    'You are applying a rule-pack migration to ONE target file. The RULE PACK below is your source of truth — it lists each before→after transformation, when it applies, when it does NOT, and a reference implementation.',
    '',
    `TARGET FILE (relative to the repo root, which is your cwd): ${opts.file}`,
    '',
    'Do exactly this:',
    `1. Read ${opts.file}.`,
    '2. Apply EVERY rule in the pack that matches, producing the after-shape. Where a rule explicitly says it does NOT apply (or defers to a hand-edit), leave that construct unchanged.',
    '3. After editing, run the validation gate yourself: `pnpm run build`, then `pnpm run check`, then `pnpm run test`. If any fails, read the error, fix YOUR edit (never weaken a config or a test to pass), and re-run the gate. Keep the build green.',
    '4. Edit ONLY the target file (and, if a rule explicitly requires it, the one import site the rule names). Do not touch unrelated files, do not commit, do not push — the runner lands the change.',
    '',
    opts.attemptFeedback
      ? `PREVIOUS ATTEMPT FAILED THE GATE. The failing output was:\n${opts.attemptFeedback}\nFix the cause in the target file and re-run the gate.`
      : '',
    '',
    '===== RULE PACK =====',
    opts.rulePack,
    '===== END RULE PACK =====',
    '',
    'When the gate is green, stop. Report which rules you applied and any construct you left for a hand-edit.',
  ]
    .filter(line => line !== '')
    .join('\n')
}

// The deterministic gate: build → check → test. Returns the first failing
// stage's combined output (for the agent's next-attempt context), or undefined
// when all three pass. Plain code owns the VERDICT — the agent's self-report is
// never trusted as the pass signal.
async function runGate(cwd: string): Promise<string | undefined> {
  for (const script of ['build', 'check', 'test']) {
    const result = await run('pnpm', ['run', script], {
      cwd,
      env: { CI: 'true' },
    })
    if (result.code !== 0) {
      const combined = `${result.stdout}\n${result.stderr}`.trim()
      return `[pnpm run ${script} exit ${result.code}]\n${combined.slice(-4000)}`
    }
  }
  return undefined
}

async function gitSilent(cwd: string, args: readonly string[]): Promise<void> {
  await run('git', args, { cwd })
}

// Migrate one file end-to-end in its own worktree. The AI transform + gate loop
// is the intelligent core; the commit/push/PR is deterministic.
export async function migrateFile(options: {
  readonly args: MigrationArgs
  readonly base: string
  readonly file: string
  readonly rulePack: string
}): Promise<MigrationResult> {
  const opts = { __proto__: null, ...options } as {
    args: MigrationArgs
    base: string
    file: string
    rulePack: string
  }
  const { args, base, file, rulePack } = opts
  const slug = slugForFile(file)
  const branch = `migration/${args.name}-${slug}`
  const wt = path.join(args.target, '.claude', 'worktrees', args.name, slug)

  await gitSilent(args.target, ['worktree', 'remove', '--force', wt])
  await gitSilent(args.target, ['branch', '-D', branch])
  await gitSilent(args.target, ['fetch', 'origin', base, '--quiet'])

  const wtAdd = await run(
    'git',
    ['worktree', 'add', '-b', branch, wt, `origin/${base}`],
    { cwd: args.target },
  )
  if (wtAdd.code !== 0) {
    return {
      attempts: 0,
      failureMode: `worktree: ${wtAdd.stderr.trim().slice(0, 300)}`,
      file,
      prUrl: undefined,
      status: 'exception',
    }
  }

  let attemptFeedback: string | undefined
  let gateFailure: string | undefined
  let usedAttempts = 0
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    usedAttempts = attempt
    const prompt = buildPrompt({ attemptFeedback, file, rulePack })
    // AI_PROFILE.verify: Edit + Write + a READ-ONLY Bash allowlist (node / pnpm
    // run·test / git status·diff·log). The agent can author the change AND run
    // its own build/check/test, but CANNOT land — no git add/commit/push. The
    // runner lands deterministically. Four-flag lockdown, permissionMode
    // acceptEdits — never the raw `claude` CLI.
    const spawned = await spawnAiAgent({
      ...AI_PROFILE.verify,
      cwd: wt,
      effort: args.effort,
      model: args.model,
      prompt,
      timeoutMs: ATTEMPT_TIMEOUT_MS,
    })
    if (spawned.exitCode !== 0) {
      attemptFeedback = `agent exited ${spawned.exitCode}: ${spawned.stderr.slice(-2000)}`
      gateFailure = attemptFeedback
      continue
    }
    // Re-assert the gate in plain code — the agent's self-report is a lead, not
    // the verdict.
    gateFailure = await runGate(wt)
    if (!gateFailure) {
      break
    }
    attemptFeedback = gateFailure
  }

  if (gateFailure) {
    // Leave the worktree in place — it's a coverage-gap tell for the human.
    return {
      attempts: usedAttempts,
      failureMode: gateFailure.slice(0, 400),
      file,
      prUrl: undefined,
      status: 'exception',
    }
  }

  if (args.dryRun) {
    await gitSilent(args.target, ['worktree', 'remove', '--force', wt])
    await gitSilent(args.target, ['branch', '-D', branch])
    return {
      attempts: usedAttempts,
      failureMode: undefined,
      file,
      prUrl: '(dry-run: gate green, not landed)',
      status: 'landed',
    }
  }

  // Deterministic land: stage exactly the migrated file, commit, push, PR.
  await run('git', ['add', file], { cwd: wt })
  const commit = await run(
    'git',
    ['commit', '-m', `refactor(${args.name}): migrate ${file}`],
    { cwd: wt },
  )
  if (commit.code !== 0) {
    return {
      attempts: usedAttempts,
      failureMode: `commit: ${commit.stderr.trim().slice(0, 300)}`,
      file,
      prUrl: undefined,
      status: 'exception',
    }
  }

  const push = await run('git', ['push', '-u', 'origin', branch], { cwd: wt })
  if (push.code !== 0) {
    return {
      attempts: usedAttempts,
      failureMode: `push: ${push.stderr.trim().slice(0, 300)}`,
      file,
      prUrl: undefined,
      status: 'exception',
    }
  }

  let prUrl: string | undefined
  if (args.repo) {
    const prCreate = await run(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        args.repo,
        '--base',
        base,
        '--head',
        branch,
        '--title',
        `refactor(${args.name}): migrate ${file}`,
        '--body',
        `Rule-pack migration \`${args.name}\` applied to \`${file}\`.`,
      ],
      { cwd: wt },
    )
    prUrl =
      (prCreate.stdout + prCreate.stderr)
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-1)[0] ?? undefined
  }

  // Worktree stays until the PR lands (re-survey / rebase against rule updates
  // needs it); cleaning-ci's sibling cleanup hook reaps it after merge.
  return {
    attempts: usedAttempts,
    failureMode: undefined,
    file,
    prUrl,
    status: 'landed',
  }
}

// Bounded-concurrency map — the pipeline cap. A simple worker pool over the
// target files; each worker pulls the next index and migrates it.
export async function runPool<I, O>(
  items: readonly I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const results: O[] = Array.from({ length: items.length })
  let next = 0
  const lanes = Math.min(Math.max(1, concurrency), items.length || 1)
  async function lane(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) {
        return
      }
      results[index] = await worker(items[index]!, index)
    }
  }
  const runners: Array<Promise<void>> = []
  for (let i = 0; i < lanes; i += 1) {
    runners.push(lane())
  }
  await Promise.all(runners)
  return results
}

export async function runMigration(
  args: MigrationArgs,
): Promise<MigrationReport> {
  const rulePack = loadRulePack(args.rulesDir)
  const base = await resolveBase(args.target)
  const targets = await surveyTargets(args)

  logger.log(
    `migrating-rule-packs: ${args.name} — ${targets.length} target file(s), base=${base}, concurrency=${args.concurrency}${args.dryRun ? ' (DRY RUN)' : ''}`,
  )
  logger.group()
  for (let i = 0, { length } = targets; i < length; i += 1) {
    logger.log(targets[i]!)
  }
  logger.groupEnd()
  if (targets.length === 0) {
    return { exceptions: [], landed: [], prUrls: [] }
  }

  const results = await runPool(targets, args.concurrency, async file =>
    migrateFile({ args, base, file, rulePack }),
  )

  const landed = results.filter(r => r.status === 'landed')
  const exceptions = results.filter(r => r.status === 'exception')
  const prUrls = landed.map(r => r.prUrl).filter((u): u is string => Boolean(u))

  logger.log('MIGRATION RESULTS')
  logger.success(`landed: ${landed.length}`)
  logger.group()
  for (let i = 0, { length } = landed; i < length; i += 1) {
    const r = landed[i]!
    logger.log(`${r.file}${r.prUrl ? ` -> ${r.prUrl}` : ''}`)
  }
  logger.groupEnd()
  if (exceptions.length > 0) {
    logger.warn(`exceptions (human handles): ${exceptions.length}`)
    logger.group()
    for (let i = 0, { length } = exceptions; i < length; i += 1) {
      const r = exceptions[i]!
      logger.log(`${r.file} — ${r.failureMode ?? 'unknown'}`)
    }
    logger.groupEnd()
  }

  return { exceptions, landed, prUrls }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!args.dryRun) {
    const discovered = await discoverAiAgents({ repoRoot: args.target })
    if (!('claude' in discovered)) {
      logger.fail(
        'No claude CLI on PATH — the per-file transform needs it. Install it or run --dry-run.',
      )
      process.exitCode = 1
      return
    }
  }

  const report = await runMigration(args)
  if (report.exceptions.length > 0) {
    // Per SKILL.md: a migration is not "done" while any file is in exception
    // status — exit non-zero so the operator handles the coverage gaps.
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
