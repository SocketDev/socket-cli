import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the output module to avoid logger dependencies.
vi.mock('./output-view-repo.mts', () => ({
  outputViewRepo: vi.fn(),
}))

const { outputViewRepo } = await import('./output-view-repo.mts')

describe('outputViewRepo', () => {
  it('should be callable with valid repository result', async () => {
    const mockOutput = vi.mocked(outputViewRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createSuccessResult({
        archived: false,
        created_at: '2024-01-01T00:00:00Z',
        default_branch: 'main',
        homepage: 'https://example.com',
        id: 123,
        name: 'test-repo',
        visibility: 'public',
      })

    await outputViewRepo(result, 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should handle error results', async () => {
    const mockOutput = vi.mocked(outputViewRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputViewRepo(result, 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should support different output formats', async () => {
    const mockOutput = vi.mocked(outputViewRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createSuccessResult({
        archived: true,
        created_at: '2023-05-15T10:30:00Z',
        default_branch: 'develop',
        homepage: 'https://my-project.com',
        id: 456,
        name: 'awesome-repo',
        visibility: 'private',
      })

    for (const format of ['json', 'text', 'markdown'] as const) {
      await outputViewRepo(result, format)
      expect(mockOutput).toHaveBeenCalledWith(result, format)
    }
  })

  it('should handle repository with null homepage', async () => {
    const mockOutput = vi.mocked(outputViewRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createSuccessResult({
        archived: false,
        created_at: '2024-02-20T14:45:30Z',
        default_branch: 'main',
        homepage: null,
        id: 789,
        name: 'no-homepage-repo',
        visibility: 'public',
      })

    await outputViewRepo(result, 'text')

    expect(mockOutput).toHaveBeenCalledWith(result, 'text')
  })
})
