/*
 * @file Worktree + git plumbing for run-migration.mts's per-file migration
 *   engine — the low-level `run()` process wrapper, the git worktree
 *   create/remove pair, the build/check/test gate, and the deterministic
 *   commit/push/PR land phase. run-migration.mts owns the AI attempt loop and
 *   the orchestration; this module is the plain code it calls out to.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type { MigrationResult } from './run-migration.mts'

interface RunOutcome {
  code: number
  stderr: string
  stdout: string
}

export async function run(
  cmd: string,
  args: readonly string[],
  config: {
    readonly cwd: string
    readonly env?: Readonly<Record<string, string>> | undefined
  },
): Promise<RunOutcome> {
  const cfg = { __proto__: null, ...config } as {
    cwd: string
    env?: Readonly<Record<string, string>> | undefined
  }
  try {
    const result = await spawn(cmd, args, {
      cwd: cfg.cwd,
      stdioString: true,
      ...(cfg.env ? { env: { ...process.env, ...cfg.env } } : {}),
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

export async function gitSilent(
  cwd: string,
  args: readonly string[],
): Promise<void> {
  await run('git', args, { cwd })
}

// The deterministic gate: build → check → test. Returns the first failing
// stage's combined output (for the agent's next-attempt context), or undefined
// when all three pass. Plain code owns the VERDICT — the agent's self-report is
// never trusted as the pass signal.
export async function runGate(cwd: string): Promise<string | undefined> {
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

// Reset and recreate the per-file worktree off origin/<base> on its migration
// branch. Returns the exception result on failure, undefined on success.
export async function prepareWorktree(config: {
  readonly base: string
  readonly branch: string
  readonly file: string
  readonly target: string
  readonly wt: string
}): Promise<MigrationResult | undefined> {
  const cfg = { __proto__: null, ...config } as {
    base: string
    branch: string
    file: string
    target: string
    wt: string
  }
  const { base, branch, file, target, wt } = cfg

  await gitSilent(target, ['worktree', 'remove', '--force', wt])
  await gitSilent(target, ['branch', '-D', branch])
  await gitSilent(target, ['fetch', 'origin', base, '--quiet'])

  const wtAdd = await run(
    'git',
    ['worktree', 'add', '-b', branch, wt, `origin/${base}`],
    { cwd: target },
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
  return undefined
}

// Deterministic land: stage exactly the migrated file, commit, push, and open
// the PR when `repo` is set. The agent never runs git add/commit/push — this
// is the runner's exclusive job.
export async function landMigratedFile(config: {
  readonly base: string
  readonly branch: string
  readonly file: string
  readonly name: string
  readonly repo: string | undefined
  readonly usedAttempts: number
  readonly wt: string
}): Promise<MigrationResult> {
  const cfg = { __proto__: null, ...config } as {
    base: string
    branch: string
    file: string
    name: string
    repo: string | undefined
    usedAttempts: number
    wt: string
  }
  const { base, branch, file, name, repo, usedAttempts, wt } = cfg

  await run('git', ['add', file], { cwd: wt })
  const commit = await run(
    'git',
    ['commit', '-m', `refactor(${name}): migrate ${file}`],
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
  if (repo) {
    const prCreate = await run(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        repo,
        '--base',
        base,
        '--head',
        branch,
        '--title',
        `refactor(${name}): migrate ${file}`,
        '--body',
        `Rule-pack migration \`${name}\` applied to \`${file}\`.`,
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

  return {
    attempts: usedAttempts,
    failureMode: undefined,
    file,
    prUrl,
    status: 'landed',
  }
}
