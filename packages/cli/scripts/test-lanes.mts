import { readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  configuredFastBudgetMs,
  coverBudgetMs,
  laneBudgetMs,
} from '../../../scripts/fleet/constants/test-budget.mts'
import type { TestLane } from '../../../scripts/fleet/constants/test-budget.mts'
import { extractLane } from '../../../scripts/fleet/test-runner/cli-args.mts'

export function resolvePackageTestScope(
  args: readonly string[],
  repoRoot: string,
) {
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

export function packageTestGlobs(
  globs: readonly string[],
  packagePath: string,
): string[] {
  const prefix = `${normalizePath(packagePath).replace(/\/$/u, '')}/`
  return globs
    .map(glob => normalizePath(glob))
    .filter(glob => glob.startsWith(prefix))
    .map(glob => glob.slice(prefix.length))
}

export function readPackageTestLanes(repoRoot: string, packagePath: string) {
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
    mid: packageTestGlobs(settings.vitest?.lanes?.mid ?? [], packagePath),
    slow: packageTestGlobs(settings.vitest?.lanes?.slow ?? [], packagePath),
  }
}

export function selectPackageTestGlobs(
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
