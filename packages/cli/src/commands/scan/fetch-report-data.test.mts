import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createErrorResult } from '../../../test/helpers/mocks.mts'

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  debugFn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

vi.mock('@socketsecurity/lib/constants/process', () => ({
  getSpinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}))

vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCallNoSpinner: vi.fn(),
  queryApiSafeText: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mjs', () => ({
  setupSdk: vi.fn(),
}))

vi.mock('../../utils/error/errors.mjs', () => ({
  formatErrorWithDetail: vi.fn(),
}))

describe('fetchScanData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles SDK setup failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mjs')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = createErrorResult('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result).toEqual(error)
  })
})
