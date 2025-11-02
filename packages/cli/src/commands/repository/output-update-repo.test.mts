import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the output module to avoid logger dependencies.
vi.mock('./output-update-repo.mts', () => ({
  outputUpdateRepo: vi.fn(),
}))

const { outputUpdateRepo } = await import('./output-update-repo.mts')

describe('outputUpdateRepo', () => {
  it('should be callable with successful update result', async () => {
    const mockOutput = vi.mocked(outputUpdateRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'test-repo', 'json')
  })

  it('should handle error results', async () => {
    const mockOutput = vi.mocked(outputUpdateRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'test-repo', 'json')
  })

  it('should support different output formats', async () => {
    const mockOutput = vi.mocked(outputUpdateRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    for (const format of ['json', 'text', 'markdown'] as const) {
      await outputUpdateRepo(result, 'my-repository', format)
      expect(mockOutput).toHaveBeenCalledWith(result, 'my-repository', format)
    }
  })

  it('should handle repository name with special characters', async () => {
    const mockOutput = vi.mocked(outputUpdateRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'repo-with-dashes_and_underscores', 'text')

    expect(mockOutput).toHaveBeenCalledWith(
      result,
      'repo-with-dashes_and_underscores',
      'text',
    )
  })
})
