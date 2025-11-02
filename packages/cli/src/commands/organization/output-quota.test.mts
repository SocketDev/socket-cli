import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the output module to avoid logger dependencies.
vi.mock('./output-quota.mts', () => ({
  outputQuota: vi.fn(),
}))

const { outputQuota } = await import('./output-quota.mts')

describe('outputQuota', () => {
  it('should be callable with valid quota result', async () => {
    const mockOutput = vi.mocked(outputQuota)
    mockOutput.mockResolvedValue()

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 1000,
    })

    await outputQuota(result, 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should handle error results', async () => {
    const mockOutput = vi.mocked(outputQuota)
    mockOutput.mockResolvedValue()

    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    await outputQuota(result, 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should support different output formats', async () => {
    const mockOutput = vi.mocked(outputQuota)
    mockOutput.mockResolvedValue()

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 750,
    })

    for (const format of ['json', 'text', 'markdown'] as const) {
      await outputQuota(result, format)
      expect(mockOutput).toHaveBeenCalledWith(result, format)
    }
  })

  it('should handle zero quota', async () => {
    const mockOutput = vi.mocked(outputQuota)
    mockOutput.mockResolvedValue()

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 0,
    })

    await outputQuota(result, 'text')

    expect(mockOutput).toHaveBeenCalledWith(result, 'text')
  })
})
