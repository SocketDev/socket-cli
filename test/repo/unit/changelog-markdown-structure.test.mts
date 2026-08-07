/**
 * @file Structure-vs-content coverage for the changelog flows
 *   (`scripts/fleet/lib/changelog.mts`). The `[Unreleased]` range, the
 *   insertion point, and the has-entries check read the parsed GFM mdast tree,
 *   so a `## ` or `- ` line inside a fenced code block is content — it can
 *   neither truncate a promoted block nor satisfy the empty-changelog guard.
 */
import { describe, expect, it } from 'vitest'

import {
  mergeUnreleased,
  promoteUnreleased,
  sectionHasEntries,
} from '../../../scripts/fleet/lib/changelog.mts'

const preamble = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
].join('\n')
const versionHeading =
  '## [1.2.3](https://github.com/SocketDev/socket-cli/releases/tag/v1.2.3) - 2026-08-06'

describe('promoteUnreleased', () => {
  it('promotes a block whose code fence contains a ## line intact', () => {
    const changelog = [
      preamble,
      '## [Unreleased]',
      '',
      '### Changed',
      '',
      '- The changelog format now looks like:',
      '',
      '```md',
      '## [9.9.9](https://example.com) - 2020-01-01',
      '```',
      '',
      '## [1.2.2](https://github.com/SocketDev/socket-cli/releases/tag/v1.2.2) - 2026-08-01',
      '',
      '### Changed',
      '',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    const promoted = promoteUnreleased(changelog, versionHeading)
    expect(promoted).toBeDefined()
    expect(promoted!.section).toContain(
      '```md\n## [9.9.9](https://example.com) - 2020-01-01\n```',
    )
    expect(promoted!.changelog).not.toContain('[Unreleased]')
    expect(promoted!.changelog).toContain('- Updated the Coana CLI.')
  })

  it('does not promote when the only bullet lookalike sits in a code fence', () => {
    const changelog = [
      preamble,
      '## [Unreleased]',
      '',
      '```sh',
      '- not a bullet, just shell output',
      '```',
      '',
      '## [1.2.2](https://github.com/SocketDev/socket-cli/releases/tag/v1.2.2) - 2026-08-01',
      '',
      '### Changed',
      '',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    expect(promoteUnreleased(changelog, versionHeading)).toBeUndefined()
  })
})

describe('sectionHasEntries', () => {
  it('counts a real bullet', () => {
    expect(sectionHasEntries('### Changed\n\n- a real entry')).toBe(true)
  })

  it('does not count a bullet lookalike inside a fence', () => {
    expect(sectionHasEntries('```sh\n- fenced output\n```')).toBe(false)
  })
})

describe('mergeUnreleased', () => {
  it('creates the block above the first real heading, not a fenced ## line', () => {
    const changelog = [
      preamble,
      'Usage example:',
      '',
      '```md',
      '## [0.0.0](https://example.com) - 2019-01-01',
      '```',
      '',
      '## [1.2.2](https://github.com/SocketDev/socket-cli/releases/tag/v1.2.2) - 2026-08-01',
      '',
      '### Changed',
      '',
      '- Updated the Coana CLI.',
      '',
    ].join('\n')
    const merged = mergeUnreleased(changelog, '### Fixed\n\n- a new fix')
    const unreleasedAt = merged.indexOf('## [Unreleased]')
    const fencedAt = merged.indexOf('## [0.0.0]')
    const firstVersionAt = merged.indexOf('## [1.2.2]')
    expect(unreleasedAt).toBeGreaterThan(-1)
    // The fenced ## line stays where it was, before the inserted block.
    expect(fencedAt).toBeLessThan(unreleasedAt)
    expect(unreleasedAt).toBeLessThan(firstVersionAt)
  })
})
