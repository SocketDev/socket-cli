/**
 * Unit tests for the package_files MCP tool.
 *
 * The tool derives its PURL from the individual coordinates rather than
 * accepting one from the caller, so the derivation and its bounds are the
 * interesting surface alongside the usual auth gating.
 *
 * Related Files: - src/commands/mcp/tool-package-files.mts -
 * src/commands/mcp/lib/files.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildPackageFilesPurl,
  definePackageFilesTool,
} from '../../../../src/commands/mcp/tool-package-files.mts'

const { mockFetchSocketFileList } = vi.hoisted(() => ({
  mockFetchSocketFileList: vi.fn(),
}))

vi.mock(import('../../../../src/commands/mcp/lib/files.mts'), () => ({
  fetchSocketFileList: mockFetchSocketFileList,
}))

const localContext = {
  getApiToken: () => 'local_user_token',
  sharedApiToken: false,
}

const sharedContext = {
  getApiToken: () => 'operator_token',
  sharedApiToken: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchSocketFileList.mockResolvedValue({
    fileCount: 2,
    files: [],
    purl: 'pkg:npm/lodash@4.17.21',
    totalBytes: 2048,
    tree: '└── index.js  1.0K  Qhash',
  })
})

describe('buildPackageFilesPurl', () => {
  it('builds a plain npm PURL', () => {
    expect(buildPackageFilesPurl('npm', 'lodash', '4.17.21')).toBe(
      'pkg:npm/lodash@4.17.21',
    )
  })

  it('splits an npm scope into the namespace', () => {
    expect(buildPackageFilesPurl('npm', '@babel/core', '7.0.0')).toBe(
      'pkg:npm/%40babel/core@7.0.0',
    )
  })

  it('adds the artifact_id qualifier when given', () => {
    expect(
      buildPackageFilesPurl('pypi', 'numpy', '1.26.0', 'numpy-1.26.0.tar.gz'),
    ).toContain('artifact_id=numpy-1.26.0.tar.gz')
  })

  it('adds the platform qualifier when given', () => {
    expect(
      buildPackageFilesPurl(
        'openvsx',
        'meta/pyrefly',
        '1.0.0',
        undefined,
        'linux-x64',
      ),
    ).toContain('platform=linux-x64')
  })

  it('emits no qualifier string when neither is given', () => {
    expect(buildPackageFilesPurl('npm', 'lodash', '4.17.21')).not.toContain('?')
  })
})

describe('package_files tool', () => {
  const tool = definePackageFilesTool()

  it('renders the header and tree on a hit', async () => {
    const result = await tool.handler(
      { depname: 'lodash', version: '4.17.21' },
      {},
      localContext,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain(
      'pkg:npm/lodash@4.17.21 — 2 files',
    )
    expect(result.content[0]!.text).toContain('index.js')
  })

  it('defaults the ecosystem to npm', async () => {
    await tool.handler(
      { depname: 'lodash', version: '4.17.21' },
      {},
      localContext,
    )
    expect(mockFetchSocketFileList).toHaveBeenCalledWith(
      'local_user_token',
      'pkg:npm/lodash@4.17.21',
    )
  })

  it('reports an empty listing without treating it as an error', async () => {
    mockFetchSocketFileList.mockResolvedValue({
      fileCount: 0,
      files: [],
      purl: 'pkg:npm/nothing@1.0.0',
      totalBytes: 0,
      tree: '',
    })
    const result = await tool.handler(
      { depname: 'nothing', version: '9.9.9' },
      {},
      localContext,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('No files found')
  })

  it('rejects a missing version before any request', async () => {
    const result = await tool.handler({ depname: 'lodash' }, {}, localContext)
    expect(mockFetchSocketFileList).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('rejects an over-long coordinate rather than putting it in a URL', async () => {
    const result = await tool.handler(
      { depname: 'a'.repeat(600), version: '1.0.0' },
      {},
      localContext,
    )
    expect(mockFetchSocketFileList).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('`depname`')
  })

  it('refuses a shared operator token', async () => {
    const result = await tool.handler(
      { depname: 'lodash', version: '4.17.21' },
      {},
      sharedContext,
    )
    expect(mockFetchSocketFileList).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('surfaces an API failure as an error result', async () => {
    mockFetchSocketFileList.mockRejectedValue(new Error('HTTP 404'))
    const result = await tool.handler(
      { depname: 'lodash', version: '4.17.21' },
      {},
      localContext,
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('HTTP 404')
  })
})
