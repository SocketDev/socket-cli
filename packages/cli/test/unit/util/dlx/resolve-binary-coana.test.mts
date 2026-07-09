/**
 * Unit tests for Coana binary path resolution.
 *
 * Purpose: Tests the resolveCoana function's local-path override and dlx
 * fallback behavior.
 *
 * Related Files: - src/util/dlx/resolve-binary.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Coana local path env module.
const mockCoanaLocalPath = vi.hoisted(() => ({
  SOCKET_CLI_COANA_LOCAL_PATH: '',
}))

vi.mock(
  import('../../../../src/env/socket-cli-coana-local-path.mts'),
  () => mockCoanaLocalPath,
)

// Mock version getter.
vi.mock(import('../../../../src/env/coana-version.mts'), () => ({
  getCoanaVersion: () => '1.0.0',
}))

describe('binary resolution utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // Reset local path mock.
    mockCoanaLocalPath.SOCKET_CLI_COANA_LOCAL_PATH = ''
  })

  describe('resolveCoana', () => {
    it('returns dlx spec when no local path is set', async () => {
      const { resolveCoana } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'dlx',
        details: {
          name: '@coana-tech/cli',
          version: '1.0.0',
          binaryName: 'coana',
        },
      })
    })

    it('returns local path when SOCKET_CLI_COANA_LOCAL_PATH is set', async () => {
      mockCoanaLocalPath.SOCKET_CLI_COANA_LOCAL_PATH = '/custom/path/coana'

      const { resolveCoana } =
        await import('../../../../src/util/dlx/resolve-binary.mts')

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/coana',
      })
    })
  })
})
