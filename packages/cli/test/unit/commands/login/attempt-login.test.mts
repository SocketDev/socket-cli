/**
 * Unit tests for attemptLogin handler.
 *
 * Drives the interactive login flow: prompts for API token, verifies it against
 * the SDK, prompts for enforced org / tab-completion, and persists via
 * applyLogin. All prompts and SDK calls are mocked.
 *
 * Related Files: - src/commands/login/attempt-login.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/logger'), () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockPassword = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockConfirm = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/stdio/prompts'), () => ({
  password: mockPassword,
  select: mockSelect,
  confirm: mockConfirm,
}))

const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn())
const mockUpdateConfigValue = vi.hoisted(() => vi.fn())
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn().mockReturnValue(false))
vi.mock(import('../../../../src/util/config.mts'), () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
  isConfigFromFlag: mockIsConfigFromFlag,
  updateConfigValue: mockUpdateConfigValue,
}))

const mockSetupSdk = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/socket/sdk.mjs'), () => ({
  setupSdk: mockSetupSdk,
}))

const mockFetchOrganization = vi.hoisted(() => vi.fn())
vi.mock(
  import('../../../../src/commands/organization/fetch-organization-list.mts'),
  () => ({
    fetchOrganization: mockFetchOrganization,
  }),
)

const mockGetEnterpriseOrgs = vi.hoisted(() => vi.fn())
const mockGetOrgSlugs = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/organization.mts'), () => ({
  getEnterpriseOrgs: mockGetEnterpriseOrgs,
  getOrgSlugs: mockGetOrgSlugs,
}))

const mockApplyLogin = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/commands/login/apply-login.mts'), () => ({
  applyLogin: mockApplyLogin,
}))

const mockSetupTabCompletion = vi.hoisted(() => vi.fn())
vi.mock(
  import('../../../../src/commands/install/setup-tab-completion.mts'),
  () => ({
    setupTabCompletion: mockSetupTabCompletion,
  }),
)

const mockSocketDocsLink = vi.hoisted(() => vi.fn(() => 'docs-link'))
vi.mock(import('../../../../src/util/terminal/link.mts'), () => ({
  socketDocsLink: mockSocketDocsLink,
}))

const mockFailMsgWithBadge = vi.hoisted(() =>
  vi.fn((msg, cause) => `[fail] ${msg}: ${cause}`),
)
vi.mock(import('../../../../src/util/error/fail-msg-with-badge.mts'), () => ({
  failMsgWithBadge: mockFailMsgWithBadge,
}))

import { attemptLogin } from '../../../../src/commands/login/attempt-login.mts'

describe('attemptLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockGetConfigValueOrUndef.mockReturnValue(undefined)
    mockGetOrgSlugs.mockReturnValue(['my-org'])
    mockGetEnterpriseOrgs.mockReturnValue([])
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: [{ id: 'org-id', name: 'my-org' }] },
    })
    mockSetupSdk.mockResolvedValue({ ok: true, data: {} })
    mockSelect.mockResolvedValue(false)
    mockConfirm.mockResolvedValue(true)
    mockSetupTabCompletion.mockResolvedValue({ ok: true })
  })

  it('returns canceled when user dismisses the password prompt', async () => {
    mockPassword.mockResolvedValueOnce(undefined)

    const result = await attemptLogin(undefined, undefined)

    expect(result).toEqual({
      ok: false,
      message: 'Canceled',
      cause: 'Canceled by user',
    })
    expect(mockLogger.fail).toHaveBeenCalledWith('Canceled by user')
  })

  it('falls back to public API token when password is empty string', async () => {
    mockPassword.mockResolvedValueOnce('')

    await attemptLogin('https://api.socket.dev', undefined)

    expect(mockSetupSdk).toHaveBeenCalledWith(
      expect.objectContaining({
        apiToken: expect.any(String),
        apiBaseUrl: 'https://api.socket.dev',
      }),
    )
  })

  it('fails when SDK setup returns error', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockSetupSdk.mockResolvedValueOnce({
      ok: false,
      message: 'SDK error',
      cause: 'bad token',
    })

    await attemptLogin(undefined, undefined)

    expect(process.exitCode).toBe(1)
    expect(mockLogger.fail).toHaveBeenCalled()
  })

  it('fails when fetchOrganization returns error', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockFetchOrganization.mockResolvedValueOnce({
      ok: false,
      message: 'fetch failed',
      cause: 'no auth',
    })

    await attemptLogin(undefined, undefined)

    expect(process.exitCode).toBe(1)
    expect(mockLogger.fail).toHaveBeenCalled()
  })

  it('fails when account has no organizations', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockGetOrgSlugs.mockReturnValueOnce([])

    const result = await attemptLogin(undefined, undefined)

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('No organizations'),
    })
  })

  it('happy path with no enterprise orgs persists default org and applies login', async () => {
    mockPassword.mockResolvedValueOnce('user-token')

    await attemptLogin(undefined, undefined)

    expect(mockUpdateConfigValue).toHaveBeenCalledWith(
      expect.any(String),
      'my-org',
    )
    expect(mockApplyLogin).toHaveBeenCalled()
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('API credentials'),
    )
  })

  it('prompts to enforce when there are multiple enterprise orgs', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockGetEnterpriseOrgs.mockReturnValueOnce([
      { id: 'a', name: 'Acme' },
      { id: 'b', name: 'Beta' },
    ])
    // First select for enforced org, second for tab completion.
    mockSelect.mockResolvedValueOnce('a').mockResolvedValueOnce(false)

    await attemptLogin(undefined, undefined)

    expect(mockApplyLogin).toHaveBeenCalledWith(
      expect.any(String),
      ['a'],
      undefined,
      undefined,
    )
  })

  it('returns canceled when enforced-org select is dismissed', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockGetEnterpriseOrgs.mockReturnValueOnce([
      { id: 'a', name: 'Acme' },
      { id: 'b', name: 'Beta' },
    ])
    mockSelect.mockResolvedValueOnce(undefined)

    const result = await attemptLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: false, message: 'Canceled' })
  })

  it('confirms enforcement for a single enterprise org', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockGetEnterpriseOrgs.mockReturnValueOnce([{ id: 'a', name: 'Acme' }])
    mockConfirm.mockResolvedValueOnce(true)

    await attemptLogin(undefined, undefined)

    expect(mockApplyLogin).toHaveBeenCalledWith(
      expect.any(String),
      ['a'],
      undefined,
      undefined,
    )
  })

  it('returns canceled when single-org confirm is dismissed', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockGetEnterpriseOrgs.mockReturnValueOnce([{ id: 'a', name: 'Acme' }])
    mockConfirm.mockResolvedValueOnce(undefined)

    const result = await attemptLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: false, message: 'Canceled' })
  })

  it('returns canceled when tab-completion select is dismissed', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockSelect.mockResolvedValueOnce(undefined)

    const result = await attemptLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: false, message: 'Canceled' })
  })

  it('runs tab completion installer when user accepts', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockSelect.mockResolvedValueOnce(true)

    await attemptLogin(undefined, undefined)

    expect(mockSetupTabCompletion).toHaveBeenCalledWith('socket')
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('Tab completion'),
    )
  })

  it('logs failure when tab completion installer fails', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockSelect.mockResolvedValueOnce(true)
    mockSetupTabCompletion.mockResolvedValueOnce({ ok: false })

    await attemptLogin(undefined, undefined)

    expect(mockLogger.fail).toHaveBeenCalledWith(
      expect.stringContaining('Failed to install tab completion'),
    )
  })

  it('warns when config is in read-only mode (flag override)', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockIsConfigFromFlag.mockReturnValueOnce(true)

    await attemptLogin(undefined, undefined)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('read-only'),
    )
  })

  it('reports failure when applyLogin throws', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockApplyLogin.mockImplementationOnce(() => {
      throw new Error('apply failed')
    })

    await attemptLogin(undefined, undefined)

    expect(process.exitCode).toBe(1)
    expect(mockLogger.fail).toHaveBeenCalledWith('API login failed')
  })

  it('reports refreshed when token matches the previously persisted one', async () => {
    mockPassword.mockResolvedValueOnce('same-token')
    mockGetConfigValueOrUndef.mockImplementation(key => {
      if (key === 'apiToken') {
        return 'same-token'
      }
      return undefined
    })

    await attemptLogin(undefined, undefined)

    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('refreshed'),
    )
  })

  it('reports updated when a different token was previously persisted', async () => {
    mockPassword.mockResolvedValueOnce('new-token')
    mockGetConfigValueOrUndef.mockImplementation(key => {
      if (key === 'apiToken') {
        return 'old-token'
      }
      return undefined
    })

    await attemptLogin(undefined, undefined)

    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('updated'),
    )
  })

  it('handles enterprise org with no name (fallback to undefined label)', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    // First org missing name → label coerces to 'undefined'.
    mockGetEnterpriseOrgs.mockReturnValueOnce([
      { id: 'a' },
      { id: 'b', name: 'Beta' },
    ])
    mockSelect.mockResolvedValueOnce('').mockResolvedValueOnce(false)

    await attemptLogin(undefined, undefined)

    // Empty enforced selection means no enforced orgs.
    expect(mockApplyLogin).toHaveBeenCalledWith(
      expect.any(String),
      [],
      undefined,
      undefined,
    )
  })

  it('handles single enterprise org with missing name (label fallback)', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    // Missing name → label fallback to 'undefined' string keeps confirm path.
    mockGetEnterpriseOrgs.mockReturnValueOnce([{ id: 'a' }])
    mockConfirm.mockResolvedValueOnce(true)

    await attemptLogin(undefined, undefined)

    expect(mockApplyLogin).toHaveBeenCalledWith(
      expect.any(String),
      ['a'],
      undefined,
      undefined,
    )
  })

  it('does not enforce when single-org confirm is declined', async () => {
    mockPassword.mockResolvedValueOnce('user-token')
    mockGetEnterpriseOrgs.mockReturnValueOnce([{ id: 'a', name: 'Acme' }])
    mockConfirm.mockResolvedValueOnce(false)

    await attemptLogin(undefined, undefined)

    expect(mockApplyLogin).toHaveBeenCalledWith(
      expect.any(String),
      [],
      undefined,
      undefined,
    )
  })
})
