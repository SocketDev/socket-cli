import { describe, expect, it } from 'vitest'

import {
  SOCKET_SCOPES,
  buildTazeArgs,
  diffDependencyVersions,
  dryRunMutationMessage,
  isDryRun,
  readDependencyPins,
  renderVersionMoves,
} from '../scripts/update.mts'

function manifest(sections: Record<string, Record<string, string>>): string {
  return JSON.stringify({ name: 'socket', version: '1.0.0', ...sections })
}

describe('isDryRun', () => {
  it('is true only when --dry-run is present', () => {
    expect(isDryRun(['--dry-run'])).toBe(true)
    expect(isDryRun([])).toBe(false)
    expect(isDryRun(['--dryrun'])).toBe(false)
  })
})

describe('buildTazeArgs', () => {
  it('spells a preview as --no-write so the config cannot re-enable writing', () => {
    expect(buildTazeArgs({ write: false })).toEqual(['--no-write'])
  })

  it('spells a live run as --write', () => {
    expect(buildTazeArgs({ write: true })).toEqual(['--write'])
  })

  it('joins the include globs into one comma-separated value', () => {
    expect(buildTazeArgs({ include: SOCKET_SCOPES, write: false })).toEqual([
      '--no-write',
      '--include',
      '@socketregistry/*,@socketsecurity/*',
    ])
  })

  it('passes a zero maturity period through as a string', () => {
    expect(buildTazeArgs({ maturityPeriod: 0, write: false })).toEqual([
      '--no-write',
      '--maturity-period',
      '0',
    ])
  })

  it('omits the maturity period when it is not set', () => {
    expect(buildTazeArgs({ write: true })).not.toContain('--maturity-period')
  })
})

describe('readDependencyPins', () => {
  it('reads every dependency section', () => {
    expect(
      readDependencyPins(
        manifest({
          dependencies: { 'form-data': '4.0.6' },
          devDependencies: { vitest: '3.2.4' },
          optionalDependencies: { fsevents: '2.3.3' },
          peerDependencies: { typescript: '5.9.0' },
        }),
      ),
    ).toEqual([
      { name: 'form-data', section: 'dependencies', spec: '4.0.6' },
      { name: 'vitest', section: 'devDependencies', spec: '3.2.4' },
      { name: 'fsevents', section: 'optionalDependencies', spec: '2.3.3' },
      { name: 'typescript', section: 'peerDependencies', spec: '5.9.0' },
    ])
  })

  it('keeps the same package in two sections distinct', () => {
    expect(
      readDependencyPins(
        manifest({
          dependencies: { semver: '7.7.2' },
          devDependencies: { semver: '7.6.0' },
        }),
      ),
    ).toEqual([
      { name: 'semver', section: 'dependencies', spec: '7.7.2' },
      { name: 'semver', section: 'devDependencies', spec: '7.6.0' },
    ])
  })

  it('ignores a non-string spec', () => {
    expect(
      readDependencyPins('{"dependencies":{"weird":{"nested":true}}}'),
    ).toEqual([])
  })
})

describe('diffDependencyVersions', () => {
  it('reports a version that moved, sorted by name', () => {
    const before = manifest({
      devDependencies: { oxlint: '1.15.0', vitest: '3.2.4' },
    })
    const after = manifest({
      devDependencies: { oxlint: '1.16.0', vitest: '3.3.0' },
    })
    expect(diffDependencyVersions(before, after)).toEqual([
      {
        from: '1.15.0',
        name: 'oxlint',
        section: 'devDependencies',
        to: '1.16.0',
      },
      {
        from: '3.2.4',
        name: 'vitest',
        section: 'devDependencies',
        to: '3.3.0',
      },
    ])
  })

  it('reports nothing when nothing moved', () => {
    const raw = manifest({ dependencies: { 'form-data': '4.0.6' } })
    expect(diffDependencyVersions(raw, raw)).toEqual([])
  })

  it('ignores a removed dependency, which is not a move', () => {
    const before = manifest({ dependencies: { gone: '1.0.0' } })
    const after = manifest({ dependencies: {} })
    expect(diffDependencyVersions(before, after)).toEqual([])
  })

  it('ignores an added dependency, which is not a move', () => {
    const before = manifest({ dependencies: {} })
    const after = manifest({ dependencies: { fresh: '1.0.0' } })
    expect(diffDependencyVersions(before, after)).toEqual([])
  })
})

describe('renderVersionMoves', () => {
  it('says so when nothing moved', () => {
    expect(renderVersionMoves([])).toBe(
      '[update] no dependency versions moved.',
    )
  })

  it('prints one aligned line per move', () => {
    const rendered = renderVersionMoves([
      { from: '1.0.0', name: 'a', section: 'dependencies', to: '1.1.0' },
      {
        from: '2.0.0',
        name: 'longer',
        section: 'devDependencies',
        to: '2.1.0',
      },
    ])
    expect(rendered.split('\n')).toEqual([
      '[update] 2 dependency version(s) moved:',
      '  a       1.0.0 -> 1.1.0  (dependencies)',
      '  longer  2.0.0 -> 2.1.0  (devDependencies)',
    ])
  })
})

describe('dryRunMutationMessage', () => {
  it('reports what it saw and how to recover', () => {
    const message = dryRunMutationMessage([
      { from: '1.0.0', name: 'a', section: 'dependencies', to: '1.1.0' },
    ])
    expect(message).toContain('a --dry-run update changed package.json')
    expect(message).toContain('Saw: 1 version(s) rewritten')
    expect(message).toContain('git checkout -- package.json')
  })
})
