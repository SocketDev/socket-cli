import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createErrorResult } from '../../../../../test/helpers/mocks.mts'

const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())
const mockDebugFn = vi.hoisted(() => vi.fn())
const mockHandleApiCallNoSpinner = vi.hoisted(() => vi.fn())
const mockQueryApiSafeText = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockFormatErrorWithDetail = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
  debugFn: mockDebugFn,
}))

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

const mockSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('@socketsecurity/lib/spinner', () => ({
  getDefaultSpinner: () => mockSpinner,
}))

vi.mock('../../../../../src/utils/socket/api.mts', () => ({
  handleApiCallNoSpinner: mockHandleApiCallNoSpinner,
  queryApiSafeText: mockQueryApiSafeText,
}))

vi.mock('../../../../../src/utils/socket/sdk.mjs', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock('../../../../../src/utils/error/errors.mjs', () => ({
  formatErrorWithDetail: mockFormatErrorWithDetail,
}))

describe('fetchScanData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles SDK setup failure', async () => {
    const { fetchScanData } = await import('../../../../../src/commands/scan/fetch-report-data.mts')
    const { setupSdk } = await vi.importMock('../../../../../src/utils/socket/sdk.mjs')
    const mockSetupSdk = mockSetupSdk

    const error = createErrorResult('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result).toEqual(error)
  })
})
