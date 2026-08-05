import { describe, expect, it } from 'vitest'

import {
  computeForwardedArgs,
  isForwardedArg,
  renderCheckSummary,
  treeMutationDelta,
} from '../scripts/check.mts'
import {
  escalatesForScope,
  fixScopeReminder,
  isScopeFlag,
  resolveExplicitFiles,
  resolveScopeMode,
  touchesEscalationPath,
  zeroScopeNotice,
} from '../scripts/lib/scope.mts'
import { renderLintSummary } from '../scripts/lint.mts'

describe('resolveScopeMode', () => {
  it('defaults to the modified scope', () => {
    expect(resolveScopeMode([])).toBe('modified')
    expect(resolveScopeMode(['--modified'])).toBe('modified')
    expect(resolveScopeMode(['--changed'])).toBe('modified')
  })

  it('lets --all win over every other flag', () => {
    expect(resolveScopeMode(['--staged', '--all'])).toBe('all')
  })

  it('lets --staged win over the default', () => {
    expect(resolveScopeMode(['--staged', '--modified'])).toBe('staged')
  })
})

describe('isScopeFlag', () => {
  it('recognizes every scope flag', () => {
    for (const flag of ['--all', '--changed', '--modified', '--staged']) {
      expect(isScopeFlag(flag)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isScopeFlag('--fix')).toBe(false)
  })
})

describe('resolveExplicitFiles', () => {
  it('keeps positional paths and drops flags', () => {
    expect(
      resolveExplicitFiles(['--fix', 'src/a.mts', '--all', 'src/b.mts']),
    ).toEqual(['src/a.mts', 'src/b.mts'])
  })

  it('is empty for a flags-only argv', () => {
    expect(resolveExplicitFiles(['--all', '--quiet'])).toEqual([])
  })
})

describe('touchesEscalationPath', () => {
  it('escalates on a config, a tsconfig, the lockfile, or a script', () => {
    expect(touchesEscalationPath(['.config/rollup.base.config.mjs'])).toBe(true)
    expect(touchesEscalationPath(['tsconfig.json'])).toBe(true)
    expect(touchesEscalationPath(['pnpm-lock.yaml'])).toBe(true)
    expect(touchesEscalationPath(['scripts/lint.mts'])).toBe(true)
    expect(touchesEscalationPath(['package.json'])).toBe(true)
    expect(touchesEscalationPath(['biome.json'])).toBe(true)
  })

  it('leaves an ordinary source edit alone', () => {
    expect(touchesEscalationPath(['src/cli.mts', 'test/utils.mts'])).toBe(false)
  })

  it('normalizes Windows separators before matching', () => {
    expect(touchesEscalationPath(['scripts\\lint.mts'])).toBe(true)
  })
})

describe('escalatesForScope', () => {
  it('escalates a modified-scope run that touches a config', () => {
    expect(escalatesForScope('modified', ['tsconfig.json'])).toBe(true)
  })

  it('never escalates the staged scope, so pre-commit stays fast', () => {
    expect(escalatesForScope('staged', ['tsconfig.json'])).toBe(false)
  })
})

describe('zeroScopeNotice', () => {
  it('says the run is not a pass and names the whole-tree command', () => {
    const notice = zeroScopeNotice('modified', 'lint')
    expect(notice).toContain('0 files checked — this is NOT a pass.')
    expect(notice).toContain('Scope MODIFIED')
    expect(notice).toContain('pnpm run lint --all')
  })
})

describe('fixScopeReminder', () => {
  it('warns that the repo-wide backlog is untouched', () => {
    const reminder = fixScopeReminder('staged')
    expect(reminder).toContain('STAGED files only')
    expect(reminder).toContain('pnpm run fix --all')
  })
})

describe('renderLintSummary', () => {
  it('is empty when every lane passed', () => {
    expect(
      renderLintSummary([{ code: 0, name: 'oxlint', skipped: false }]),
    ).toBe('')
  })

  it('ignores a skipped lane', () => {
    expect(renderLintSummary([{ code: 1, name: 'biome', skipped: true }])).toBe(
      '',
    )
  })

  it('names each failing lane on its own line', () => {
    const summary = renderLintSummary([
      { code: 0, name: 'oxlint', skipped: false },
      { code: 1, name: 'biome', skipped: false },
      { code: 2, name: 'eslint', skipped: false },
    ])
    expect(summary.split('\n')).toEqual([
      '[lint] 2 of 3 lane(s) failed:',
      '  biome exited 1',
      '  eslint exited 2',
    ])
  })
})

describe('isForwardedArg', () => {
  it('forwards the scope flags, --fix, and --quiet', () => {
    expect(isForwardedArg('--all')).toBe(true)
    expect(isForwardedArg('--fix')).toBe(true)
    expect(isForwardedArg('--quiet')).toBe(true)
  })

  it('keeps everything else out of the lint step', () => {
    expect(isForwardedArg('--describe')).toBe(false)
    expect(isForwardedArg('src/a.mts')).toBe(false)
  })
})

describe('computeForwardedArgs', () => {
  it('keeps only the forwarded flags, in order', () => {
    expect(
      computeForwardedArgs(['--all', '--release', '--fix', 'src/a.mts']),
    ).toEqual(['--all', '--fix'])
  })
})

describe('treeMutationDelta', () => {
  it('is empty when nothing changed', () => {
    expect(treeMutationDelta(' M a.mts\n', ' M a.mts\n')).toEqual([])
  })

  it('excludes pre-existing dirt and reports only new lines', () => {
    expect(treeMutationDelta(' M a.mts\n', ' M a.mts\n M b.mts\n')).toEqual([
      ' M b.mts',
    ])
  })
})

describe('renderCheckSummary', () => {
  it('is empty when every step passed', () => {
    expect(renderCheckSummary([{ label: 'lint', ok: true, output: '' }])).toBe(
      '',
    )
  })

  it('names each failing step on its own line', () => {
    const summary = renderCheckSummary([
      { label: 'lint', ok: false, output: '' },
      { label: 'tsc:src', ok: true, output: '' },
      { label: 'tsc:scripts', ok: false, output: '' },
    ])
    expect(summary.split('\n')).toEqual([
      '[check] 2 of 3 step(s) failed:',
      '  lint',
      '  tsc:scripts',
    ])
  })
})
