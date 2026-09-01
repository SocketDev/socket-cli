import { describe, expect, it } from 'vitest'

import { parseArgs } from '../scripts/release/add-unreleased.mts'
import {
  addUnreleasedEntry,
  changelogHeading,
  promoteChangelog,
} from '../scripts/release/changelog.mts'

const PREAMBLE = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).',
  '',
].join('\n')

const RELEASED = [
  '## [1.1.162](https://github.com/SocketDev/socket-cli/releases/tag/v1.1.162) - 2026-08-28',
  '',
  '### Changed',
  '- Updated the Coana CLI to v `15.10.26`.',
  '',
].join('\n')

const COANA = /^Updated the Coana CLI to v /u

function build(...blocks: readonly string[]): string {
  return [PREAMBLE, ...blocks].join('\n')
}

describe('addUnreleasedEntry', () => {
  it('adds the entry under an existing Changed section', () => {
    const changelog = build(
      ['## [Unreleased]', '', '### Changed', '- Something else.', ''].join(
        '\n',
      ),
      RELEASED,
    )
    expect(addUnreleasedEntry({ changelog, entry: 'Bumped a thing.' })).toBe(
      build(
        [
          '## [Unreleased]',
          '',
          '### Changed',
          '- Something else.',
          '- Bumped a thing.',
          '',
        ].join('\n'),
        RELEASED,
      ),
    )
  })

  // The previous release consumed the block. Having nowhere to put a note is
  // what drove callers to invent `## [<version>]` headings in the first place.
  it('recreates the block when the previous release consumed it', () => {
    const changelog = build(RELEASED)
    expect(
      addUnreleasedEntry({
        changelog,
        entry: 'Updated the Coana CLI to v `15.10.28`.',
      }),
    ).toBe(
      build(
        [
          '## [Unreleased]',
          '',
          '### Changed',
          '- Updated the Coana CLI to v `15.10.28`.',
          '',
        ].join('\n'),
        RELEASED,
      ),
    )
  })

  it('creates the section when the block has none', () => {
    const changelog = build(['## [Unreleased]', ''].join('\n'), RELEASED)
    expect(addUnreleasedEntry({ changelog, entry: 'A note.' })).toBe(
      build(
        ['## [Unreleased]', '', '### Changed', '- A note.', ''].join('\n'),
        RELEASED,
      ),
    )
  })

  it('creates the section in SECTION_ORDER position', () => {
    const changelog = build(
      [
        '## [Unreleased]',
        '',
        '### Added',
        '- A flag.',
        '',
        '### Fixed',
        '- A bug.',
        '',
      ].join('\n'),
      RELEASED,
    )
    expect(addUnreleasedEntry({ changelog, entry: 'A note.' })).toBe(
      build(
        [
          '## [Unreleased]',
          '',
          '### Added',
          '- A flag.',
          '',
          '### Changed',
          '- A note.',
          '',
          '### Fixed',
          '- A bug.',
          '',
        ].join('\n'),
        RELEASED,
      ),
    )
  })

  // A bump reruns on every upstream release. Without `replace` the block would
  // accumulate one stale bullet per run.
  it('rewrites a matching bullet in place instead of stacking', () => {
    const changelog = build(
      [
        '## [Unreleased]',
        '',
        '### Changed',
        '- Updated the Coana CLI to v `15.10.26`.',
        '',
        '### Fixed',
        '- A bug.',
        '',
      ].join('\n'),
      RELEASED,
    )
    const updated = addUnreleasedEntry({
      changelog,
      entry: 'Updated the Coana CLI to v `15.10.28`.',
      replace: COANA,
    })
    expect(updated).not.toContain('15.10.26.')
    expect(
      updated.match(/- Updated the Coana CLI to v `15\.10\.28`\./gu),
    ).toHaveLength(1)
    expect(updated).toContain('### Fixed\n- A bug.')
  })

  it('only replaces within the named section', () => {
    const changelog = build(
      [
        '## [Unreleased]',
        '',
        '### Fixed',
        '- Updated the Coana CLI to v `15.10.26`.',
        '',
      ].join('\n'),
      RELEASED,
    )
    const updated = addUnreleasedEntry({
      changelog,
      entry: 'Updated the Coana CLI to v `15.10.28`.',
      replace: COANA,
    })
    expect(updated).toContain(
      '### Fixed\n- Updated the Coana CLI to v `15.10.26`.',
    )
    expect(updated).toContain(
      '### Changed\n- Updated the Coana CLI to v `15.10.28`.',
    )
  })

  // `unreleasedRange` matches the heading for equality, so a dated one is
  // invisible to the release: its notes strand under a heading no release will
  // pick up. This is exactly how v1.1.161 shipped with the wrong notes.
  it('repairs a decorated Unreleased heading rather than adding a second block', () => {
    const changelog = build(
      ['## [Unreleased] - 2026-08-27', '', '### Changed', '- A note.', ''].join(
        '\n',
      ),
      RELEASED,
    )
    const updated = addUnreleasedEntry({ changelog, entry: 'Another note.' })
    expect(updated).not.toContain('## [Unreleased] - 2026-08-27')
    expect(updated.match(/^## \[Unreleased\]$/gmu)).toHaveLength(1)
    expect(updated).toContain('### Changed\n- A note.\n- Another note.')
  })

  it('matches a lower-cased heading', () => {
    const changelog = build(
      ['## [unreleased]', '', '### Changed', '- A note.', ''].join('\n'),
      RELEASED,
    )
    const updated = addUnreleasedEntry({ changelog, entry: 'Another note.' })
    expect(updated.match(/^## \[[Uu]nreleased\]$/gmu)).toHaveLength(1)
    expect(updated).toContain('- A note.\n- Another note.')
  })

  // Structure comes from the parser, so markdown inside a fence is content.
  it('ignores a heading lookalike inside a code fence', () => {
    const changelog = build(
      [
        '## [Unreleased]',
        '',
        '### Changed',
        '- Documented the shape:',
        '',
        '  ```markdown',
        '  ### Fixed',
        '  ## [1.0.0] - 2020-01-01',
        '  ```',
        '',
      ].join('\n'),
      RELEASED,
    )
    const updated = addUnreleasedEntry({ changelog, entry: 'A note.' })
    expect(updated).toContain('  ### Fixed\n  ## [1.0.0] - 2020-01-01')
    expect(updated).toContain('- Documented the shape:')
    expect(updated.indexOf('- A note.')).toBeGreaterThan(
      updated.indexOf('```markdown'),
    )
    expect(updated.indexOf('- A note.')).toBeLessThan(
      updated.indexOf('## [1.1.162]'),
    )
  })

  it('leaves the released blocks byte-for-byte', () => {
    const changelog = build(RELEASED)
    const updated = addUnreleasedEntry({ changelog, entry: 'A note.' })
    expect(updated.slice(updated.indexOf('## [1.1.162]'))).toBe(
      changelog.slice(changelog.indexOf('## [1.1.162]')),
    )
  })

  it('is idempotent for a rerun at the same version', () => {
    const once = addUnreleasedEntry({
      changelog: build(RELEASED),
      entry: 'Updated the Coana CLI to v `15.10.28`.',
      replace: COANA,
    })
    expect(
      addUnreleasedEntry({
        changelog: once,
        entry: 'Updated the Coana CLI to v `15.10.28`.',
        replace: COANA,
      }),
    ).toBe(once)
  })

  // The whole point of accruing here: the release must be able to promote it.
  it('writes a block that promoteChangelog then promotes', () => {
    const changelog = addUnreleasedEntry({
      changelog: build(RELEASED),
      entry: 'Updated the Coana CLI to v `15.10.28`.',
      replace: COANA,
    })
    const heading = changelogHeading(
      '1.1.163',
      '2026-09-01',
      'https://github.com/SocketDev/socket-cli',
    )
    const promoted = promoteChangelog({
      changelog,
      derivedSection: `${heading}\n\n### Fixed\n- derived`,
      heading,
    })
    expect(promoted.source).toBe('unreleased')
    expect(promoted.section).toBe(
      `${heading}\n\n### Changed\n- Updated the Coana CLI to v \`15.10.28\`.`,
    )
    expect(promoted.changelog).not.toContain('[Unreleased]')
  })
})

describe('parseArgs', () => {
  it('defaults the file and section', () => {
    expect(parseArgs(['A note.'])).toEqual({
      entry: 'A note.',
      file: 'CHANGELOG.md',
      replace: undefined,
      section: 'Changed',
    })
  })

  it('reads every flag', () => {
    const args = parseArgs([
      '--section',
      'Fixed',
      '--file',
      'docs/CHANGELOG.md',
      '--replace',
      '^Updated ',
      'A note.',
    ])
    expect(args.section).toBe('Fixed')
    expect(args.file).toBe('docs/CHANGELOG.md')
    expect(args.replace?.source).toBe('^Updated ')
    // Global would carry lastIndex between bullets and skip every other one.
    expect(args.replace?.global).toBe(false)
  })

  it('tolerates a leading bullet marker on the entry', () => {
    expect(parseArgs(['- A note.']).entry).toBe('A note.')
  })

  it('refuses an unknown flag', () => {
    expect(() => parseArgs(['--nope', 'x', 'A note.'])).toThrow(/unknown flag/u)
  })

  it('refuses a flag with no value', () => {
    expect(() => parseArgs(['A note.', '--section'])).toThrow(/needs a value/u)
  })

  it('refuses anything but exactly one entry', () => {
    expect(() => parseArgs([])).toThrow(/exactly one entry/u)
    expect(() => parseArgs(['one', 'two'])).toThrow(/exactly one entry/u)
  })

  it('refuses an empty entry', () => {
    expect(() => parseArgs(['   '])).toThrow(/entry is empty/u)
  })
})
