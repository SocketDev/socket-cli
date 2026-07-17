/**
 * Shared run/timestamp/header helpers for history-rewriting skill runners
 * (refreshing-history, and any sibling that wraps git in a worktree). These
 * were declared inline in refreshing-history/run.mts; squashing-history wanted
 * the same trio, so they live in one owner rather than a second copy.
 *
 * `run` is a thin spawn wrapper returning trimmed stdout/stderr, with an
 * allowFailure escape hatch that surfaces a SpawnError's partial output instead
 * of throwing. `header` prints an aligned label line. `timestamp` is a
 * filesystem-safe `YYYYMMDD-HHMMSS` stamp for worktree/branch names.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { errorMessage } from '@socketsecurity/lib/errors/message'
import { isSpawnError } from '@socketsecurity/lib/process/spawn/errors'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

const logger = getDefaultLogger()

export function header(label: string, value: string): void {
  logger.info(`  ${label}: ${value}`)
}

export interface SpawnOutcome {
  // Child exit code: 0 on success, the child's real code (fallback 1) on an
  // allowFailure'd failure. Callers gate on `.code === 0` — before this field
  // existed that comparison was silently `undefined === 0`, which misread
  // every probe (e.g. `merge-base --is-ancestor`) as a failure.
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export async function run(
  cmd: string,
  args: readonly string[],
  cwd: string,
  options: {
    readonly allowFailure?: boolean | undefined
    readonly env?: Readonly<Record<string, string>> | undefined
  } = {},
): Promise<SpawnOutcome> {
  const opts = { __proto__: null, ...options } as {
    allowFailure?: boolean | undefined
    env?: Readonly<Record<string, string>> | undefined
  }
  // Merge any extra env (e.g. the SQUASH_HISTORY=1 hook-bypass sentinel) onto
  // the inherited environment; an undefined env leaves the child's inherited.
  const childEnv = opts.env ? { ...process.env, ...opts.env } : undefined
  try {
    const result = await spawn(cmd, args, {
      cwd,
      stdioString: true,
      ...(childEnv ? { env: childEnv } : {}),
    })
    return {
      code: result.code ?? 0,
      stderr: String(result.stderr ?? ''),
      stdout: String(result.stdout ?? '').trim(),
    }
  } catch (e) {
    if (opts.allowFailure) {
      // Spawn failures still carry stdout/stderr on the SpawnError shape;
      // surface them so callers can inspect the partial output.
      if (isSpawnError(e)) {
        return {
          code: e.code ?? 1,
          stderr: String(e.stderr ?? ''),
          stdout: String(e.stdout ?? ''),
        }
      }
      return { code: 1, stderr: errorMessage(e), stdout: '' }
    }
    if (isSpawnError(e)) {
      const stderrText = String(e.stderr ?? '').trim()
      throw new Error(
        `${cmd} ${args.join(' ')} failed (exit ${String(e.code ?? '?')})${stderrText ? `: ${stderrText}` : ''}`,
      )
    }
    throw e
  }
}

export function timestamp(): string {
  const now = new Date()
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}
