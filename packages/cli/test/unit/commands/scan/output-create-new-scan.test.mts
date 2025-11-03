import open from 'open'
import terminalLink from 'terminal-link'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { confirm } from '@socketsecurity/lib/stdio/prompts'

import { outputCreateNewScan } from '../../../../../src/commands/scan/output-create-new-scan.mts'
import { failMsgWithBadge } from '../../../../../src/utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../../../../src/utils/output/result-json.mjs'

import type { CResult } from '../../../../../src/commands/scan/types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

// Helper references to mockLogger methods.
const mockLog = mockLogger.log
const mockFail = mockLogger.fail
const mockSuccess = mockLogger.success

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

vi.mock('../../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

vi.mock('open', () => ({
  default: vi.fn(),
}))

vi.mock('terminal-link', () => ({
  default: vi.fn((url, text) => `[${text}](${url})`),
}))

vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  confirm: vi.fn(),
}))

describe('outputCreateNewScan', () => {
  const mockSpinner = {
    isSpinning: false,
    start: vi.fn(),
    stop: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockSpinner.isSpinning = false
    mockSpinner.start.mockClear()
    mockSpinner.stop.mockClear()
  })

  it('outputs JSON format for successful result', async () => {
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: 'https://socket.dev/report/123',
          id: 'scan-123',
        },
      }

    await outputCreateNewScan(result, { outputKind: 'json' })

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: false,
        code: 2,
        message: 'Unauthorized',
        cause: 'Invalid API token',
      }

    await outputCreateNewScan(result, { outputKind: 'json' })

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message with report URL in text format', async () => {
    const mockTerminalLink = vi.mocked(terminalLink)

    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: 'https://socket.dev/report/456',
          id: 'scan-456',
        },
      }

    await outputCreateNewScan(result, { outputKind: 'text' })

    expect(mockSuccess).toHaveBeenCalledWith('Scan completed successfully!')
    expect(mockTerminalLink).toHaveBeenCalledWith(
      'https://socket.dev/report/456',
      'https://socket.dev/report/456',
    )
    expect(mockLog).toHaveBeenCalledWith(
      'View report at: [https://socket.dev/report/456](https://socket.dev/report/456)',
    )
  })

  it('outputs markdown format with scan ID', async () => {
    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: 'https://socket.dev/report/789',
          id: 'scan-789',
        },
      }

    await outputCreateNewScan(result, { outputKind: 'markdown' })

    expect(mockLog).toHaveBeenCalledWith('# Create New Scan')
    expect(mockLog).toHaveBeenCalledWith('')
    expect(mockLog).toHaveBeenCalledWith(
      'A [new Scan](https://socket.dev/report/789) was created with ID: scan-789',
    )
    expect(mockLog).toHaveBeenCalledWith('')
  })

  it('handles missing scan ID properly', async () => {
    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: 'https://socket.dev/report/no-id',
          id: undefined as any,
        },
      }

    await outputCreateNewScan(result, { outputKind: 'text' })

    expect(mockFail).toHaveBeenCalledWith(
      'Did not receive a scan ID from the API.',
    )
    expect(process.exitCode).toBe(1)
  })

  it('outputs error in text format', async () => {
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: false,
        code: 1,
        message: 'Failed to create scan',
        cause: 'Network error',
      }

    await outputCreateNewScan(result, { outputKind: 'text' })

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to create scan',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('opens browser when interactive and user confirms', async () => {
    const mockConfirm = vi.mocked(confirm)
    const mockOpen = vi.mocked(open)

    mockConfirm.mockResolvedValue(true)

    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: 'https://socket.dev/report/browser-test',
          id: 'scan-browser-test',
        },
      }

    await outputCreateNewScan(result, {
      interactive: true,
      outputKind: 'text',
    })

    expect(mockConfirm).toHaveBeenCalledWith({
      default: false,
      message: 'Would you like to open it in your browser?',
    })
    expect(mockOpen).toHaveBeenCalledWith(
      'https://socket.dev/report/browser-test',
    )
  })

  it('does not open browser when user declines', async () => {
    const mockConfirm = vi.mocked(confirm)
    const mockOpen = vi.mocked(open)

    mockConfirm.mockResolvedValue(false)

    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: 'https://socket.dev/report/no-browser',
          id: 'scan-no-browser',
        },
      }

    await outputCreateNewScan(result, {
      interactive: true,
      outputKind: 'text',
    })

    expect(mockConfirm).toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('handles spinner lifecycle correctly', async () => {
    mockSpinner.isSpinning = true

    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: 'https://socket.dev/report/spinner',
          id: 'scan-spinner',
        },
      }

    await outputCreateNewScan(result, {
      outputKind: 'text',
      spinner: mockSpinner,
    })

    expect(mockSpinner.stop).toHaveBeenCalled()
    expect(mockSpinner.start).toHaveBeenCalled()
  })

  it('handles missing report URL', async () => {
    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: true,
        data: {
          html_report_url: undefined as any,
          id: 'scan-no-url',
        },
      }

    await outputCreateNewScan(result, { outputKind: 'text' })

    expect(mockLog).toHaveBeenCalledWith('No report available.')
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']> =
      {
        ok: false,
        message: 'Error without code',
      }

    await outputCreateNewScan(result, { outputKind: 'json' })

    expect(process.exitCode).toBe(1)
  })
})
