/**
 * Unit tests for the package file-manifest helpers.
 *
 * The API response is untrusted input, so `extractSocketFileList` is tested for
 * what it drops as much as for what it keeps.
 *
 * Related Files: - src/commands/mcp/lib/files.mts.
 */

import { describe, expect, it } from 'vitest'

import {
  buildFileTree,
  extractSocketFileList,
  formatFileSize,
  renderFileTree,
} from '../../../../../src/commands/mcp/lib/files.mts'

// The API can genuinely send a JSON null; parsing one models that faithfully
// and keeps a bare `null` literal out of the source.
const JSON_NULL: unknown = JSON.parse('null')

describe('extractSocketFileList', () => {
  it('normalizes a well-formed response', () => {
    expect(
      extractSocketFileList({
        files: [{ path: 'b.js', size: 10, type: 'file' }],
      }),
    ).toEqual([{ path: 'b.js', size: 10, type: 'file' }])
  })

  it('sorts entries by path', () => {
    const entries = extractSocketFileList({
      files: [{ path: 'z.js' }, { path: 'a.js' }],
    })
    expect(entries.map(e => e.path)).toEqual(['a.js', 'z.js'])
  })

  it('defaults an unknown type to file', () => {
    expect(extractSocketFileList({ files: [{ path: 'a' }] })[0]!.type).toBe(
      'file',
    )
  })

  it('keeps a dir type', () => {
    expect(
      extractSocketFileList({ files: [{ path: 'a', type: 'dir' }] })[0]!.type,
    ).toBe('dir')
  })

  it('omits hashes unless asked', () => {
    expect(
      extractSocketFileList({ files: [{ hash: 'Qabc', path: 'a' }] })[0]!.hash,
    ).toBeUndefined()
  })

  it('includes hashes when asked', () => {
    expect(
      extractSocketFileList(
        { files: [{ hash: 'Qabc', path: 'a' }] },
        { includeHashes: true },
      )[0]!.hash,
    ).toBe('Qabc')
  })

  it.each([
    ['a non-object response', 'nope'],
    ['a null response', JSON_NULL],
    ['a response with no files key', {}],
    ['a non-array files value', { files: 'nope' }],
  ])('returns an empty list for %s', (_label, response) => {
    expect(extractSocketFileList(response)).toEqual([])
  })

  it.each([
    ['a null entry', JSON_NULL],
    ['a non-object entry', 'a.js'],
    ['an entry with no path', { size: 1 }],
    ['an entry with a non-string path', { path: 42 }],
    ['an entry with an empty path', { path: '' }],
  ])('drops %s', (_label, entry) => {
    expect(extractSocketFileList({ files: [entry] })).toEqual([])
  })

  it('drops a non-numeric size rather than carrying it through', () => {
    expect(
      extractSocketFileList({ files: [{ path: 'a', size: 'big' }] })[0]!.size,
    ).toBeUndefined()
  })

  it('drops a non-string hash', () => {
    expect(
      extractSocketFileList(
        { files: [{ hash: 42, path: 'a' }] },
        { includeHashes: true },
      )[0]!.hash,
    ).toBeUndefined()
  })
})

describe('buildFileTree', () => {
  it('nests a path into directory nodes', () => {
    const root = buildFileTree([{ path: 'lib/deep/index.js', type: 'file' }])
    const lib = root.children.get('lib')
    expect(lib?.isFile).toBe(false)
    expect(lib?.children.get('deep')?.children.get('index.js')?.isFile).toBe(
      true,
    )
  })

  it('normalizes a backslash path before splitting', () => {
    const root = buildFileTree([{ path: 'lib\\index.js', type: 'file' }])
    expect(root.children.get('lib')?.children.get('index.js')).toBeDefined()
  })

  it('skips an entry that normalizes to nothing', () => {
    expect(buildFileTree([{ path: '/', type: 'file' }]).children.size).toBe(0)
  })

  it('collapses duplicate leading separators', () => {
    const root = buildFileTree([{ path: '//lib//a.js', type: 'file' }])
    expect(root.children.get('lib')?.children.get('a.js')).toBeDefined()
  })
})

describe('renderFileTree', () => {
  it('sorts directories before files', () => {
    const rendered = renderFileTree([
      { path: 'a.js', type: 'file' },
      { path: 'lib/b.js', type: 'file' },
    ])
    expect(rendered.indexOf('lib/')).toBeLessThan(rendered.indexOf('a.js'))
  })

  it('marks a directory with a trailing slash', () => {
    expect(renderFileTree([{ path: 'lib/b.js', type: 'file' }])).toContain(
      'lib/',
    )
  })

  it('shows sizes by default', () => {
    expect(
      renderFileTree([{ path: 'a.js', size: 2048, type: 'file' }]),
    ).toContain('2.0K')
  })

  it('hides sizes when told to', () => {
    expect(
      renderFileTree([{ path: 'a.js', size: 2048, type: 'file' }], {
        showSize: false,
      }),
    ).not.toContain('2.0K')
  })

  it('shows hashes only when asked', () => {
    const entry = { hash: 'Qabc', path: 'a.js', type: 'file' as const }
    expect(renderFileTree([entry])).not.toContain('Qabc')
    expect(renderFileTree([entry], { showHash: true })).toContain('Qabc')
  })

  it('uses the last-child branch glyph for the final sibling', () => {
    expect(renderFileTree([{ path: 'a.js', type: 'file' }])).toContain('└── ')
  })

  it('keeps children of a path that is both a file and a parent', () => {
    const rendered = renderFileTree([
      { path: 'a', type: 'file' },
      { path: 'a/b', type: 'file' },
    ])
    expect(rendered).toContain('b')
  })

  it('renders an empty list as an empty string', () => {
    expect(renderFileTree([])).toBe('')
  })
})

describe('formatFileSize', () => {
  it.each([
    [0, '0B'],
    [512, '512B'],
    [1024, '1.0K'],
    [1536, '1.5K'],
    [1024 * 1024, '1.0M'],
    [3 * 1024 * 1024, '3.0M'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected)
  })
})
