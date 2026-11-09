import { afterEach, describe, expect, it, vi } from 'vitest'

import { attemptLogout } from './attempt-logout.mts'

const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => true))
const mockLogoutOAuth = vi.hoisted(() => vi.fn())
const mockApplyLogout = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({ logger: mockLogger }))
vi.mock('../../constants.mts', () => ({
  default: {
    ENV: { SOCKET_CLI_API_TOKEN: '' },
    socketAppDataPath: '/tmp/socket-cli-logout-test',
  },
}))
vi.mock('../../utils/config.mts', () => ({
  isConfigFromFlag: mockIsConfigFromFlag,
}))
vi.mock('../../utils/errors.mts', () => ({
  getErrorCause: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
}))
vi.mock('../../utils/oauth.mts', () => ({ logoutOAuth: mockLogoutOAuth }))
vi.mock('./apply-logout.mts', () => ({ applyLogout: mockApplyLogout }))
vi.mock('../../utils/sdk.mts', () => ({ getDefaultProxyUrl: () => undefined }))

describe('attemptLogout', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mockIsConfigFromFlag.mockReturnValue(true)
  })

  it('does not revoke persisted OAuth credentials with a config override', async () => {
    await attemptLogout()

    expect(mockLogoutOAuth).not.toHaveBeenCalled()
    expect(mockApplyLogout).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!',
    )
  })

  it('clears config after a lock failure without claiming sign-out succeeded', async () => {
    mockIsConfigFromFlag.mockReturnValue(false)
    mockLogoutOAuth.mockRejectedValueOnce(new Error('sign-in lock is busy'))

    await attemptLogout()

    expect(mockApplyLogout).toHaveBeenCalledOnce()
    expect(mockLogger.fail).toHaveBeenCalledWith(
      'Failed to complete logout steps',
    )
    expect(mockLogger.warn).toHaveBeenCalledWith('sign-in lock is busy')
    expect(mockLogger.success).not.toHaveBeenCalled()
  })

  it('completes local logout when remote revocation returns a warning', async () => {
    mockIsConfigFromFlag.mockReturnValue(false)
    mockLogoutOAuth.mockResolvedValueOnce({
      revoked: false,
      warning: 'Remote session revocation was not confirmed.',
    })

    await attemptLogout()

    expect(mockApplyLogout).toHaveBeenCalledOnce()
    expect(mockLogger.success).toHaveBeenCalledWith('Successfully logged out')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Local sign-out completed. Remote session revocation was not confirmed.',
    )
    expect(mockLogger.fail).not.toHaveBeenCalled()
  })

  it('does not report success when local config cleanup throws', async () => {
    mockIsConfigFromFlag.mockReturnValue(false)
    mockLogoutOAuth.mockResolvedValueOnce({ revoked: true })
    mockApplyLogout.mockImplementationOnce(() => {
      throw new Error('config write failed')
    })

    await attemptLogout()

    expect(mockLogger.fail).toHaveBeenCalledWith(
      'Failed to complete logout steps',
    )
    expect(mockLogger.warn).toHaveBeenCalledWith('config write failed')
    expect(mockLogger.success).not.toHaveBeenCalled()
  })
})
