import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { findEmptySections } from '../index.mts'

describe('findEmptySections', () => {
  test('returns empty for a CHANGELOG with no sections', () => {
    const content = '# Changelog\n\nNothing yet.\n'
    assert.deepEqual(findEmptySections(content), [])
  })

  test('returns empty when every section has bullets', () => {
    const content = [
      '# Changelog',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '### Added',
      '',
      '- New thing',
      '',
      '### Fixed',
      '',
      '- Bug fix',
      '',
    ].join('\n')
    assert.deepEqual(findEmptySections(content), [])
  })

  test('flags an empty section between two headings', () => {
    const content = [
      '# Changelog',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '### Added',
      '',
      '- New thing',
      '',
      '### Changed',
      '',
      '### Fixed',
      '',
      '- Bug fix',
      '',
    ].join('\n')
    const result = findEmptySections(content)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.name, 'Changed')
  })

  test('flags an empty section at end of file', () => {
    const content = [
      '# Changelog',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '### Fixed',
      '',
    ].join('\n')
    const result = findEmptySections(content)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.name, 'Fixed')
  })

  test('flags an empty section before the next version heading', () => {
    const content = [
      '# Changelog',
      '',
      '## [2.0.0] - 2026-02-01',
      '',
      '### Changed',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '### Added',
      '',
      '- Initial release',
      '',
    ].join('\n')
    const result = findEmptySections(content)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.name, 'Changed')
  })

  test('ignores headings outside the Keep-a-Changelog set', () => {
    const content = [
      '# Changelog',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '### Internal',
      '',
      '### Added',
      '',
      '- New thing',
      '',
    ].join('\n')
    // `### Internal` is not in SECTION_NAMES so it's left alone.
    assert.deepEqual(findEmptySections(content), [])
  })

  test('flags multiple empty sections in a single release', () => {
    const content = [
      '# Changelog',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '### Added',
      '',
      '### Changed',
      '',
      '### Fixed',
      '',
      '- One real bullet',
      '',
    ].join('\n')
    const result = findEmptySections(content)
    assert.equal(result.length, 2)
    assert.equal(result[0]!.name, 'Added')
    assert.equal(result[1]!.name, 'Changed')
  })
})
