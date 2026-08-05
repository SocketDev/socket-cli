/**
 * @file CI-greening support: bounded polling of a PR's checks to conclusion.
 *   The script reports reds with enough context to hand off; FIXING a red is
 *   judgment work and stays with the operator or an AI pass.
 */

import { runGh } from './gh.mts'

import type { GhRunner } from './gh.mts'

export interface CheckState {
  readonly name: string
  readonly state: string
}

/**
 * Parse `gh pr checks` tab-separated output into name/state pairs.
 */
export function parseChecksOutput(stdout: string): readonly CheckState[] {
  const lines = stdout.split('\n')
  const out: CheckState[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const cells = lines[i]!.split('\t')
    if (cells.length >= 2 && cells[0]) {
      out.push({ name: cells[0], state: cells[1]! })
    }
  }
  return out
}

export interface ChecksVerdict {
  readonly failing: readonly string[]
  readonly pending: readonly string[]
  readonly settled: boolean
}

export function checksVerdict(checks: readonly CheckState[]): ChecksVerdict {
  const failing: string[] = []
  const pending: string[] = []
  for (let i = 0, { length } = checks; i < length; i += 1) {
    const c = checks[i]!
    if (c.state === 'fail') {
      failing.push(c.name)
    } else if (c.state === 'pending') {
      pending.push(c.name)
    }
  }
  return { failing, pending, settled: pending.length === 0 }
}

/**
 * Poll a PR's checks until settled or the poll budget runs out. Returns the
 * final verdict either way; an unsettled return says so via `settled`.
 */
export async function pollChecks(config: {
  readonly gh?: GhRunner | undefined
  readonly intervalMs?: number | undefined
  readonly maxPolls?: number | undefined
  readonly pr: number
  readonly repo: string
  readonly sleep?: ((ms: number) => Promise<void>) | undefined
}): Promise<ChecksVerdict> {
  const cfg = { __proto__: null, ...config } as typeof config
  const gh = cfg.gh ?? runGh
  const intervalMs = cfg.intervalMs ?? 60_000
  const maxPolls = cfg.maxPolls ?? 15
  const sleep =
    cfg.sleep ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let verdict: ChecksVerdict = { failing: [], pending: [], settled: false }
  for (let i = 0; i < maxPolls; i += 1) {
    const { stdout } = await gh([
      'pr',
      'checks',
      String(cfg.pr),
      '--repo',
      cfg.repo,
    ])
    verdict = checksVerdict(parseChecksOutput(stdout))
    if (verdict.settled) {
      return verdict
    }
    await sleep(intervalMs)
  }
  return verdict
}
