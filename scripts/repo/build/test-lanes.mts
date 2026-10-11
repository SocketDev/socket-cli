import { readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  configuredFastBudgetMs,
  coverBudgetMs,
  laneBudgetMs,
} from '../../fleet/constants/test-budget.mts'
import type { TestLane } from '../../fleet/constants/test-budget.mts'
import { extractLane } from '../../fleet/test-runner/cli-args.mts'

export function resolveCliTestScope(args: readonly string[], repoRoot: string) {
  const parsed = extractLane(args)
  const all = parsed.rest.includes('--all')
  const rest = parsed.rest.filter(arg => arg !== '--all')
  const requested =
    parsed.lane ?? (!all && rest.length === 0 ? 'fast' : undefined)
  const lane =
    requested === 'fast' || requested === 'mid' || requested === 'slow'
      ? requested
      : undefined
  return {
    __proto__: null,
    args: rest,
    lane,
    timeout: lane
      ? laneBudgetMs(lane, { configuredFast: configuredFastBudgetMs(repoRoot) })
      : coverBudgetMs(),
  }
}

export function normalizeCliTestGlobs(globs: readonly string[]): string[] {
  return globs.map(glob => normalizePath(glob))
}

export function readCliTestLanes(repoRoot: string) {
  const settings: {
    vitest?:
      | { lanes?: Partial<Record<TestLane, string[]>> | undefined }
      | undefined
  } = JSON.parse(
    readFileSync(
      path.join(repoRoot, '.config/repo/socket-wheelhouse.json'),
      'utf8',
    ),
  )
  return {
    __proto__: null,
    mid: normalizeCliTestGlobs(settings.vitest?.lanes?.mid ?? []),
    slow: normalizeCliTestGlobs(settings.vitest?.lanes?.slow ?? []),
  }
}

export function selectCliTestGlobs(
  lane: string | undefined,
  lanes: { mid: string[]; slow: string[] },
) {
  const selected =
    lane === 'mid' ? lanes.mid : lane === 'slow' ? lanes.slow : undefined
  return {
    __proto__: null,
    include: selected?.map(glob =>
      glob.endsWith('/**') ? `${glob}/*.test.{mts,ts}` : glob,
    ) ?? ['test/**/*.test.{mts,ts}'],
    exclude: lane === 'fast' ? [...lanes.mid, ...lanes.slow] : [],
  }
}
