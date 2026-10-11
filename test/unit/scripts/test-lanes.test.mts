import { expect, it } from 'vitest'

import {
  coverBudgetMs,
  laneBudgetMs,
} from '../../../scripts/fleet/constants/test-budget.mts'
import {
  normalizeCliTestGlobs,
  resolveCliTestScope,
  selectCliTestGlobs,
} from '../../../scripts/repo/build/test-lanes.mts'

it('defaults bare CLI tests to the fast budget', () => {
  const scope = resolveCliTestScope([], '/example/repo')
  expect(scope).toEqual({
    args: [],
    lane: 'fast',
    timeout: laneBudgetMs('fast'),
  })
})

it('keeps explicit files and all-unit runs outside lane filtering', () => {
  for (const args of [
    ['--all'],
    ['test/unit/example.test.mts'],
    ['--coverage'],
  ]) {
    const scope = resolveCliTestScope(args, '/example/repo')
    expect(scope.lane).toBeUndefined()
    expect(scope.timeout).toBe(coverBudgetMs())
    expect(scope.args).toEqual(args.filter(arg => arg !== '--all'))
  }
})

it('consumes lane flags and preserves Vitest arguments', () => {
  expect(
    resolveCliTestScope(['--lane', 'mid', '--reporter=json'], '/example/repo'),
  ).toEqual({
    args: ['--reporter=json'],
    lane: 'mid',
    timeout: laneBudgetMs('mid'),
  })
  expect(
    resolveCliTestScope(
      ['--lane=slow', '--config', 'vitest.integration.config.mts'],
      '/example/repo',
    ),
  ).toEqual({
    args: ['--config', 'vitest.integration.config.mts'],
    lane: 'slow',
    timeout: laneBudgetMs('slow'),
  })
  expect(() =>
    resolveCliTestScope(['--lane=unknown'], '/example/repo'),
  ).toThrow()
})

it('normalizes root-relative test globs', () => {
  expect(
    normalizeCliTestGlobs(['test\\unit\\core\\**', 'test/integration/**']),
  ).toEqual(['test/unit/core/**', 'test/integration/**'])
})

it('partitions fast and mid while leaving unscoped coverage complete', () => {
  const lanes = {
    mid: ['test/unit/command/**'],
    slow: ['test/integration/**'],
  }
  expect(selectCliTestGlobs('fast', lanes)).toEqual({
    include: ['test/**/*.test.{mts,ts}'],
    exclude: [...lanes.mid, ...lanes.slow],
  })
  expect(selectCliTestGlobs('mid', lanes)).toEqual({
    include: ['test/unit/command/**/*.test.{mts,ts}'],
    exclude: [],
  })
  expect(selectCliTestGlobs(undefined, lanes)).toEqual({
    include: ['test/**/*.test.{mts,ts}'],
    exclude: [],
  })
})
