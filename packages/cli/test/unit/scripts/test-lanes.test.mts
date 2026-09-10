import { expect, it } from 'vitest'

import {
  coverBudgetMs,
  laneBudgetMs,
} from '../../../../../scripts/fleet/constants/test-budget.mts'
import {
  packageTestGlobs,
  resolvePackageTestScope,
  selectPackageTestGlobs,
} from '../../../scripts/test-lanes.mts'

it('defaults bare package tests to the fast budget', () => {
  const scope = resolvePackageTestScope([], '/example/repo')
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
    const scope = resolvePackageTestScope(args, '/example/repo')
    expect(scope.lane).toBeUndefined()
    expect(scope.timeout).toBe(coverBudgetMs())
    expect(scope.args).toEqual(args.filter(arg => arg !== '--all'))
  }
})

it('consumes lane flags and preserves Vitest arguments', () => {
  expect(
    resolvePackageTestScope(
      ['--lane', 'mid', '--reporter=json'],
      '/example/repo',
    ),
  ).toEqual({
    args: ['--reporter=json'],
    lane: 'mid',
    timeout: laneBudgetMs('mid'),
  })
  expect(
    resolvePackageTestScope(
      ['--lane=slow', '--config', 'vitest.integration.config.mts'],
      '/example/repo',
    ),
  ).toEqual({
    args: ['--config', 'vitest.integration.config.mts'],
    lane: 'slow',
    timeout: laneBudgetMs('slow'),
  })
  expect(() =>
    resolvePackageTestScope(['--lane=unknown'], '/example/repo'),
  ).toThrow()
})

it('normalizes member globs and excludes other packages', () => {
  expect(
    packageTestGlobs(
      [
        'packages\\cli\\test\\unit\\commands\\**',
        'packages/cli/test/unit/meow.test.mts',
        'packages/other/test/unit/example.test.mts',
        'packages/cli-other/test/unit/example.test.mts',
      ],
      'packages\\cli',
    ),
  ).toEqual(['test/unit/commands/**', 'test/unit/meow.test.mts'])
})

it('partitions fast and mid while leaving unscoped coverage complete', () => {
  const lanes = {
    mid: ['test/unit/commands/**'],
    slow: ['test/integration/**'],
  }
  expect(selectPackageTestGlobs('fast', lanes)).toEqual({
    include: ['test/**/*.test.{mts,ts}'],
    exclude: [...lanes.mid, ...lanes.slow],
  })
  expect(selectPackageTestGlobs('mid', lanes)).toEqual({
    include: ['test/unit/commands/**/*.test.{mts,ts}'],
    exclude: [],
  })
  expect(selectPackageTestGlobs(undefined, lanes)).toEqual({
    include: ['test/**/*.test.{mts,ts}'],
    exclude: [],
  })
})
