import { describe, expect, it } from 'vitest'

import { promoteChangelog } from '../scripts/release/changelog.mts'
import {
  COMMIT_FIELD_SEP,
  COMMIT_RECORD_SEP,
  bumpLevelFor,
  deriveNextVersion,
  maxReleaseVersion,
  parseConventionalCommit,
  parseConventionalCommits,
  resolveBumpBase,
} from '../scripts/release/version.mts'

import type { ConventionalCommit } from '../scripts/release/version.mts'

function commit(
  type: string,
  description: string,
  options?: { breaking?: boolean; scope?: string } | undefined,
): ConventionalCommit {
  return {
    breaking: options?.breaking ?? false,
    description,
    hash: 'abc1234',
    scope: options?.scope,
    type,
  }
}

function logStream(records: ReadonlyArray<[string, string, string]>): string {
  return records
    .map(([hash, subject, body]) =>
      [hash, subject, body].join(COMMIT_FIELD_SEP),
    )
    .join(COMMIT_RECORD_SEP)
}

describe('parseConventionalCommit', () => {
  it('parses type, scope, and description', () => {
    expect(
      parseConventionalCommit('a1', 'fix(deps): declare form-data', ''),
    ).toEqual({
      breaking: false,
      description: 'declare form-data',
      hash: 'a1',
      scope: 'deps',
      type: 'fix',
    })
  })

  it('treats a bang as breaking', () => {
    expect(
      parseConventionalCommit('a1', 'feat!: drop node 20', '')?.breaking,
    ).toBe(true)
  })

  it('treats a BREAKING CHANGE body as breaking', () => {
    expect(
      parseConventionalCommit(
        'a1',
        'refactor: rework flags',
        'BREAKING CHANGE: --json is gone',
      )?.breaking,
    ).toBe(true)
  })

  it('skips a non-conventional subject', () => {
    expect(
      parseConventionalCommit('a1', 'Merge branch v1.x', ''),
    ).toBeUndefined()
  })
})

describe('parseConventionalCommits', () => {
  it('parses a git log stream and drops non-conventional subjects', () => {
    const raw = logStream([
      ['a1', 'fix(scan): retry a finalizing scan', ''],
      ['a2', 'Merge pull request #1 from fork', ''],
      ['a3', 'feat(cli): add socket audit', ''],
    ])
    expect(parseConventionalCommits(raw).map(c => c.type)).toEqual([
      'fix',
      'feat',
    ])
  })

  it('returns nothing for an empty stream', () => {
    expect(parseConventionalCommits('')).toEqual([])
  })
})

describe('bumpLevelFor', () => {
  it('returns major for a breaking commit', () => {
    expect(
      bumpLevelFor([
        commit('fix', 'a'),
        commit('feat', 'b', { breaking: true }),
      ]),
    ).toBe('major')
  })

  it('returns minor for a feature', () => {
    expect(bumpLevelFor([commit('fix', 'a'), commit('feat', 'b')])).toBe(
      'minor',
    )
  })

  it('returns patch for a fix, perf, or revert', () => {
    expect(bumpLevelFor([commit('fix', 'a')])).toBe('patch')
    expect(bumpLevelFor([commit('perf', 'a')])).toBe('patch')
    expect(bumpLevelFor([commit('revert', 'a')])).toBe('patch')
  })

  it('returns undefined when only internal churn landed', () => {
    expect(
      bumpLevelFor([
        commit('chore', 'a'),
        commit('ci', 'b'),
        commit('docs', 'c'),
      ]),
    ).toBeUndefined()
  })
})

describe('maxReleaseVersion', () => {
  it('takes the highest, tolerating a leading v', () => {
    expect(maxReleaseVersion(['v1.1.9', '1.1.10', 'v1.0.99'])).toBe('1.1.10')
  })

  it('ignores prereleases and junk', () => {
    expect(maxReleaseVersion(['v1.1.153', 'v2.0.0-alpha.1', 'not-a-tag'])).toBe(
      '1.1.153',
    )
  })

  it('returns undefined when nothing parses', () => {
    expect(maxReleaseVersion(['nightly', ''])).toBeUndefined()
  })
})

describe('resolveBumpBase', () => {
  it('prefers the highest consumed version over the manifest', () => {
    expect(
      resolveBumpBase({
        manifestVersion: '1.1.153',
        publishedVersion: '1.1.153',
        tagVersions: ['v1.1.152', 'v1.1.153'],
      }),
    ).toBe('1.1.153')
  })

  it('never lets an ahead manifest inflate the base', () => {
    expect(
      resolveBumpBase({
        manifestVersion: '1.2.0',
        publishedVersion: '1.1.153',
        tagVersions: ['v1.1.153'],
      }),
    ).toBe('1.1.153')
  })

  it('falls back to the manifest for a first release', () => {
    expect(resolveBumpBase({ manifestVersion: '0.1.0' })).toBe('0.1.0')
  })

  // socket-cli keeps the 1.x and 2.x lines in one repository. The caller passes
  // only the tags reachable from HEAD, and a registry `latest` from the other
  // major must not drag a maintenance release onto the wrong line.
  it('ignores a published version from another major line', () => {
    expect(
      resolveBumpBase({
        manifestVersion: '1.1.153',
        publishedVersion: '2.1.0',
        tagVersions: ['v1.1.153', 'v1.1.154'],
      }),
    ).toBe('1.1.154')
  })

  it('still uses the published version when the tag for it went missing', () => {
    expect(
      resolveBumpBase({
        manifestVersion: '1.1.153',
        publishedVersion: '1.1.156',
        tagVersions: ['v1.1.153', 'v1.1.154'],
      }),
    ).toBe('1.1.156')
  })
})

describe('deriveNextVersion', () => {
  // The state this port was written against: 1.1.154 was tagged and staged but
  // never approved, so npm still serves 1.1.153 while the tag is spent. The tag
  // has to count as consumed or the next release would re-publish a burned
  // number.
  it('treats a burned tag as consumed and lands on the next patch', () => {
    const derived = deriveNextVersion({
      commits: [commit('fix', 'declare form-data', { scope: 'deps' })],
      manifestVersion: '1.1.153',
      publishedVersion: '1.1.153',
      tagVersions: ['v1.1.152', 'v1.1.153', 'v1.1.154'],
    })
    expect(derived.base).toBe('1.1.154')
    expect(derived.level).toBe('patch')
    expect(derived.version).toBe('1.1.155')
  })

  it('patches by default when only internal churn landed', () => {
    const derived = deriveNextVersion({
      commits: [commit('chore', 'bump deps')],
      manifestVersion: '1.1.153',
      publishedVersion: '1.1.153',
      tagVersions: ['v1.1.154'],
    })
    expect(derived.version).toBe('1.1.155')
    expect(derived.reason).toContain('patch by default')
  })

  it('minors a feature', () => {
    expect(
      deriveNextVersion({
        commits: [commit('feat', 'add socket audit')],
        manifestVersion: '1.1.153',
        publishedVersion: '1.1.153',
        tagVersions: ['v1.1.154'],
      }).version,
    ).toBe('1.2.0')
  })

  it('reports major so the caller can refuse to derive one', () => {
    expect(
      deriveNextVersion({
        commits: [commit('feat', 'drop node 20', { breaking: true })],
        manifestVersion: '1.1.153',
        publishedVersion: '1.1.153',
        tagVersions: ['v1.1.154'],
      }).level,
    ).toBe('major')
  })

  it('lets release-as force the level', () => {
    const derived = deriveNextVersion({
      commits: [commit('chore', 'bump deps')],
      manifestVersion: '1.1.153',
      publishedVersion: '1.1.153',
      releaseAs: 'minor',
      tagVersions: ['v1.1.154'],
    })
    expect(derived.version).toBe('1.2.0')
    expect(derived.reason).toContain('forced to minor')
  })

  it('refuses an unknown release-as level', () => {
    expect(() =>
      deriveNextVersion({
        commits: [],
        manifestVersion: '1.1.153',
        releaseAs: 'prerelease',
      }),
    ).toThrow(/release-as must be major, minor, or patch/)
  })
})

describe('promoteChangelog', () => {
  const preamble = [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
  ].join('\n')
  const heading =
    '## [1.1.155](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.155) - 2026-08-05'
  const derivedSection = `${heading}\n\n### Fixed\n- **\`deps\`** — declare form-data`

  it('promotes the accrued Unreleased block verbatim', () => {
    const changelog = [
      preamble,
      '## [Unreleased]',
      '',
      '### Fixed',
      '- Declared `form-data` as a dependency.',
      '',
      '## [1.1.153](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.153) - 2026-08-04',
      '',
      '### Changed',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    const promoted = promoteChangelog({ changelog, derivedSection, heading })
    expect(promoted.source).toBe('unreleased')
    expect(promoted.section).toBe(
      `${heading}\n\n### Fixed\n- Declared \`form-data\` as a dependency.`,
    )
    expect(promoted.changelog).not.toContain('[Unreleased]')
    expect(promoted.changelog.indexOf(heading)).toBeLessThan(
      promoted.changelog.indexOf('## [1.1.153]'),
    )
  })

  it('falls back to the derived section when nothing accrued', () => {
    const changelog = [
      preamble,
      '## [1.1.153](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.153) - 2026-08-04',
      '',
      '### Changed',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    const promoted = promoteChangelog({ changelog, derivedSection, heading })
    expect(promoted.source).toBe('derived')
    expect(promoted.section).toBe(derivedSection)
    expect(promoted.changelog).toContain('- Updated the Coana CLI.')
  })

  it('drops an empty Unreleased block and uses the derived section', () => {
    const changelog = [
      preamble,
      '## [Unreleased]',
      '',
      '## [1.1.153](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.153) - 2026-08-04',
      '',
      '### Changed',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    const promoted = promoteChangelog({ changelog, derivedSection, heading })
    expect(promoted.source).toBe('derived')
    expect(promoted.changelog).not.toContain('[Unreleased]')
  })

  it('promotes a block whose code fence contains a ## line intact', () => {
    const changelog = [
      preamble,
      '## [Unreleased]',
      '',
      '### Changed',
      '- The changelog format now looks like:',
      '',
      '```md',
      '## [9.9.9](https://example.com) - 2020-01-01',
      '```',
      '',
      '## [1.1.153](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.153) - 2026-08-04',
      '',
      '### Changed',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    const promoted = promoteChangelog({ changelog, derivedSection, heading })
    expect(promoted.source).toBe('unreleased')
    expect(promoted.section).toContain(
      '```md\n## [9.9.9](https://example.com) - 2020-01-01\n```',
    )
    expect(promoted.changelog).not.toContain('[Unreleased]')
    expect(promoted.changelog).toContain('- Updated the Coana CLI.')
  })

  it('treats a bullet lookalike inside a code fence as no entries', () => {
    const changelog = [
      preamble,
      '## [Unreleased]',
      '',
      '```sh',
      '- not a bullet, just shell output',
      '```',
      '',
      '## [1.1.153](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.153) - 2026-08-04',
      '',
      '### Changed',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    const promoted = promoteChangelog({ changelog, derivedSection, heading })
    expect(promoted.source).toBe('derived')
    expect(promoted.section).toBe(derivedSection)
    expect(promoted.changelog).not.toContain('[Unreleased]')
  })
})
