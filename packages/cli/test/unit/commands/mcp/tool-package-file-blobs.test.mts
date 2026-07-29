/**
 * Unit tests for the two blob-reading MCP tools: package_file_contents and
 * package_file_grep.
 *
 * Both take a caller-supplied hash, and grep additionally takes a
 * caller-supplied regular expression that runs over up to 1 MB of
 * caller-chosen content. The bounds on that scan — pattern length, per-line
 * slice, and wall-clock budget — are the reason these tests exist.
 *
 * Related Files: - src/commands/mcp/tool-package-file-contents.mts -
 * src/commands/mcp/tool-package-file-grep.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { definePackageFileContentsTool } from '../../../../src/commands/mcp/tool-package-file-contents.mts'
import {
  definePackageFileGrepTool,
  MAX_GREP_PATTERN_LENGTH,
  renderGrepMatches,
  scanLinesForPattern,
} from '../../../../src/commands/mcp/tool-package-file-grep.mts'

const { mockGetOrFetchSocketBlob } = vi.hoisted(() => ({
  mockGetOrFetchSocketBlob: vi.fn(),
}))

vi.mock(import('../../../../src/commands/mcp/lib/blob-cache.mts'), () => ({
  getOrFetchSocketBlob: mockGetOrFetchSocketBlob,
}))

const localContext = {
  getApiToken: () => 'local_user_token',
  sharedApiToken: false,
}

const validHash = `Q${'a'.repeat(20)}`

function textBlob(text: string, overrides = {}) {
  return {
    binary: false,
    bytes: text.length,
    contentType: 'text/plain',
    text,
    truncated: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOrFetchSocketBlob.mockResolvedValue(
    textBlob('const a = 1\nconst b = 2\nmodule.exports = { a, b }\n'),
  )
})

describe('package_file_contents tool', () => {
  const tool = definePackageFileContentsTool()

  it('returns the file text with a size header', async () => {
    const result = await tool.handler({ hash: validHash }, {}, localContext)
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('const a = 1')
  })

  it('uses the display path in the header when given', async () => {
    const result = await tool.handler(
      { hash: validHash, path: 'lib/index.js' },
      {},
      localContext,
    )
    expect(result.content[0]!.text).toContain('lib/index.js')
  })

  it.each([
    ['an empty hash', ''],
    ['a traversal attempt', `Q${'a'.repeat(15)}/../../etc/passwd`],
    ['a bare word', 'not-a-hash'],
    ['a wrong prefix', `Z${'a'.repeat(20)}`],
  ])('rejects %s without fetching', async (_label, hash) => {
    const result = await tool.handler({ hash }, {}, localContext)
    expect(mockGetOrFetchSocketBlob).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('`hash`')
  })

  it('refuses to return binary contents', async () => {
    mockGetOrFetchSocketBlob.mockResolvedValue(
      textBlob('', { binary: true, bytes: 4096, contentType: 'image/png' }),
    )
    const result = await tool.handler({ hash: validHash }, {}, localContext)
    expect(result.content[0]!.text).toContain('binary')
    expect(result.content[0]!.text).toContain('Refusing')
  })

  it('flags a truncated read', async () => {
    mockGetOrFetchSocketBlob.mockResolvedValue(
      textBlob('partial', { bytes: 5_000_000, truncated: true }),
    )
    const result = await tool.handler({ hash: validHash }, {}, localContext)
    expect(result.content[0]!.text).toContain('truncated')
  })

  it('surfaces a fetch failure as an error result', async () => {
    mockGetOrFetchSocketBlob.mockRejectedValue(new Error('HTTP 404'))
    const result = await tool.handler({ hash: validHash }, {}, localContext)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('HTTP 404')
  })
})

describe('package_file_grep tool', () => {
  const tool = definePackageFileGrepTool()

  it('returns matching lines with line numbers', async () => {
    const result = await tool.handler(
      { hash: validHash, pattern: 'const' },
      {},
      localContext,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('2 matches')
    expect(result.content[0]!.text).toContain('1: const a = 1')
  })

  it('reports no matches without erroring', async () => {
    const result = await tool.handler(
      { hash: validHash, pattern: 'zzzz' },
      {},
      localContext,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('no matches')
  })

  it('honors caseInsensitive', async () => {
    const result = await tool.handler(
      { caseInsensitive: true, hash: validHash, pattern: 'CONST' },
      {},
      localContext,
    )
    expect(result.content[0]!.text).toContain('2 matches')
  })

  it('rejects an invalid regular expression with a usable message', async () => {
    const result = await tool.handler(
      { hash: validHash, pattern: '([' },
      {},
      localContext,
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('`pattern`')
  })

  it('rejects a pattern past the length cap before compiling it', async () => {
    const result = await tool.handler(
      { hash: validHash, pattern: 'a'.repeat(MAX_GREP_PATTERN_LENGTH + 1) },
      {},
      localContext,
    )
    expect(mockGetOrFetchSocketBlob).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('rejects a bad hash before compiling the pattern', async () => {
    const result = await tool.handler(
      { hash: 'nope', pattern: 'const' },
      {},
      localContext,
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('`hash`')
  })

  it('refuses to grep binary content', async () => {
    mockGetOrFetchSocketBlob.mockResolvedValue(
      textBlob('', { binary: true, bytes: 900 }),
    )
    const result = await tool.handler(
      { hash: validHash, pattern: 'const' },
      {},
      localContext,
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('binary')
  })

  it('notes when the match cap stopped the scan', async () => {
    mockGetOrFetchSocketBlob.mockResolvedValue(
      textBlob(Array.from({ length: 50 }, () => 'hit').join('\n')),
    )
    const result = await tool.handler(
      { hash: validHash, maxMatches: 3, pattern: 'hit' },
      {},
      localContext,
    )
    expect(result.content[0]!.text).toContain('maxMatches=3')
  })
})

describe('scanLinesForPattern', () => {
  const lines = ['alpha', 'beta', 'gamma', 'beta']

  it('collects every matching index', () => {
    expect(scanLinesForPattern(lines, /beta/, 100).matchIndexes).toEqual([1, 3])
  })

  it('stops at the match cap', () => {
    expect(scanLinesForPattern(lines, /beta/, 1).matchIndexes).toEqual([1])
  })

  it('reports no budget overrun on a normal scan', () => {
    expect(scanLinesForPattern(lines, /beta/, 100).budgetExceeded).toBe(false)
  })

  it('stops and flags the overrun when the budget is spent', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `line ${i}`)
    const result = scanLinesForPattern(many, /line/, 10_000, -1)
    expect(result.budgetExceeded).toBe(true)
    expect(result.matchIndexes.length).toBeLessThan(many.length)
  })

  it('only matches within the per-line slice, bounding backtracking work', () => {
    const long = `${'x'.repeat(5000)}needle`
    expect(scanLinesForPattern([long], /needle/, 10).matchIndexes).toEqual([])
  })
})

describe('renderGrepMatches', () => {
  const lines = ['one', 'two', 'three', 'four', 'five']

  it('renders matches with a colon separator', () => {
    expect(renderGrepMatches(lines, [1], 0)).toBe('2: two')
  })

  it('renders context lines with a dash separator', () => {
    expect(renderGrepMatches(lines, [2], 1)).toBe('2- two\n3: three\n4- four')
  })

  it('separates non-adjacent context windows', () => {
    expect(renderGrepMatches(lines, [0, 4], 1)).toContain('--')
  })

  it('does not repeat a line shared by two windows', () => {
    const rendered = renderGrepMatches(lines, [1, 2], 1)
    expect(rendered.split('\n').filter(l => l.includes('three'))).toHaveLength(
      1,
    )
  })
})
