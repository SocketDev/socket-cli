/**
 * Unit tests for the package file-manifest helpers.
 *
 * The API response is untrusted input, so `extractSocketFileList` is tested for
 * what it drops as much as for what it keeps.
 *
 * Related Files: - src/command/mcp/lib/files.mts.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  buildFileTree,
  extractSocketFileList,
  fetchSocketFileList,
  formatFileSize,
  renderFileTree,
} from '../../../../../src/command/mcp/lib/files.mts'

const { mockFetchFileList } = vi.hoisted(() => ({
  mockFetchFileList: vi.fn(),
}))

vi.mock(import('../../../../../src/command/mcp/lib/socket-api.mts'), () => ({
  fetchSocketPackageFileList: mockFetchFileList,
}))

describe('fetchSocketFileList', () => {
  it('counts files, excludes directory sizes, and preserves hashes in the tree', async () => {
    const purl = 'pkg:npm/example-package@1.0.0'
    mockFetchFileList.mockResolvedValueOnce({
      files: [
        { path: 'lib', type: 'dir', size: 4096 },
        {
          path: 'lib/zebra.js',
          type: 'file',
          size: 1024,
          hash: 'example-hash',
        },
        { path: 'lib/alpha.js', type: 'file' },
      ],
    })
    const result = await fetchSocketFileList('test_fake_token', purl)
    expect(mockFetchFileList).toHaveBeenLastCalledWith('test_fake_token', purl)
    expect(result).toMatchObject({ fileCount: 2, purl, totalBytes: 1024 })
    expect(result.files.map(file => file.path)).toEqual([
      'lib',
      'lib/alpha.js',
      'lib/zebra.js',
    ])
    expect(result.tree).toBe(
      '└── lib/\n    ├── alpha.js\n    └── zebra.js  1.0K  example-hash',
    )
  })

  it('propagates a failed manifest request', async () => {
    const failure = new Error('Example manifest request failed')
    mockFetchFileList.mockRejectedValueOnce(failure)
    await expect(
      fetchSocketFileList('test_fake_token', 'pkg:npm/example-package@1.0.0'),
    ).rejects.toBe(failure)
  })
})

// The API can genuinely send a JSON null; parsing one models that faithfully
// and keeps a bare `null` literal out of the source.
const JSON_NULL: unknown = JSON.parse('null')

describe('extractSocketFileList', () => {
  it('normalizes a well-formed response', () => {
    expect(
      extractSocketFileList({
        files: [{ path: 'index.js', size: 10, type: 'file' }],
      }),
    ).toEqual([{ path: 'index.js', size: 10, type: 'file' }])
  })

  it('sorts entries by path', () => {
    const entries = extractSocketFileList({
      files: [{ path: 'utils.js' }, { path: 'index.js' }],
    })
    expect(entries.map(e => e.path)).toEqual(['index.js', 'utils.js'])
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
    ['a non-object entry', 'example.js'],
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
    const root = buildFileTree([{ path: '//lib//index.js', type: 'file' }])
    expect(root.children.get('lib')?.children.get('index.js')).toBeDefined()
  })
})

describe('renderFileTree', () => {
  it('sorts directories before files', () => {
    const rendered = renderFileTree([
      { path: 'index.js', type: 'file' },
      { path: 'lib/helper.js', type: 'file' },
    ])
    expect(rendered.indexOf('lib/')).toBeLessThan(rendered.indexOf('index.js'))
  })

  it('marks a directory with a trailing slash', () => {
    expect(renderFileTree([{ path: 'lib/helper.js', type: 'file' }])).toContain(
      'lib/',
    )
  })

  it('shows sizes by default', () => {
    expect(
      renderFileTree([{ path: 'index.js', size: 2048, type: 'file' }]),
    ).toContain('2.0K')
  })

  it('hides sizes when told to', () => {
    expect(
      renderFileTree([{ path: 'index.js', size: 2048, type: 'file' }], {
        showSize: false,
      }),
    ).not.toContain('2.0K')
  })

  it('shows hashes only when asked', () => {
    const entry = { hash: 'Qabc', path: 'index.js', type: 'file' as const }
    expect(renderFileTree([entry])).not.toContain('Qabc')
    expect(renderFileTree([entry], { showHash: true })).toContain('Qabc')
  })

  it('uses the last-child branch glyph for the final sibling', () => {
    expect(renderFileTree([{ path: 'index.js', type: 'file' }])).toContain(
      '└── ',
    )
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
