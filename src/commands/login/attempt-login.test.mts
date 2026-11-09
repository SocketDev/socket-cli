import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => {
  const config: Record<string, unknown> = {}
  return {
    mocks: {
      config,
      beginOAuthLogin: vi.fn(),
      confirm: vi.fn(),
      fetchOrganization: vi.fn(),
      getEnterpriseOrgs: vi.fn(() => []),
      getOrgSlugs: vi.fn((orgs: Array<{ slug: string }>) =>
        orgs.map(org => org.slug),
      ),
      getDefaultProxyUrl: vi.fn(() => 'http://proxy.example.test:8080'),
      getDefaultApiBaseUrl: vi.fn(() => 'https://api.socket.dev/v0/'),
      isConfigFromFlag: vi.fn(() => false),
      logger: {
        fail: vi.fn(),
        log: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
      },
      logoutOAuth: vi.fn(),
      password: vi.fn(),
      saveOAuthCredentials: vi.fn(),
      select: vi.fn(),
      setupSdk: vi.fn(),
      setupTabCompletion: vi.fn(),
      updateConfigValue: vi.fn((key: string, value: unknown) => {
        config[key] = value
        return { ok: true }
      }),
      applyLogin: vi.fn(),
    },
  }
})

vi.mock('@socketsecurity/registry/lib/arrays', () => ({
  joinAnd: (values: string[]) => values.join(', '),
}))
vi.mock('@socketsecurity/registry/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  confirm: mocks.confirm,
  password: mocks.password,
  select: mocks.select,
}))
vi.mock('./apply-login.mts', () => ({ applyLogin: mocks.applyLogin }))
vi.mock('../../utils/oauth.mts', () => ({
  OAUTH_ISSUER: 'https://api.socket.dev',
  beginOAuthLogin: mocks.beginOAuthLogin,
  logoutOAuth: mocks.logoutOAuth,
  saveOAuthCredentials: mocks.saveOAuthCredentials,
}))
vi.mock('../../constants.mts', () => ({
  default: {
    ENV: {
      SOCKET_CLI_API_BASE_URL: 'https://api.socket.dev/v0/',
      SOCKET_CLI_API_TOKEN: '',
    },
    SOCKET_PUBLIC_API_TOKEN: 'public-token',
    socketAppDataPath: '/tmp/socket-oauth-login-test',
  },
  CONFIG_KEY_API_BASE_URL: 'apiBaseUrl',
  CONFIG_KEY_API_PROXY: 'apiProxy',
  CONFIG_KEY_API_TOKEN: 'apiToken',
  CONFIG_KEY_AUTH_TYPE: 'authType',
  CONFIG_KEY_DEFAULT_ORG: 'defaultOrg',
  CONFIG_KEY_ENFORCED_ORGS: 'enforcedOrgs',
}))
vi.mock('../../utils/config.mts', () => ({
  getConfigValueOrUndef: (key: string) => mocks.config[key],
  isConfigFromFlag: mocks.isConfigFromFlag,
  updateConfigValue: mocks.updateConfigValue,
}))
vi.mock('../../utils/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: (message: string, cause?: string) =>
    `${message} ${cause ?? ''}`,
}))
vi.mock('../../utils/organization.mts', () => ({
  getEnterpriseOrgs: mocks.getEnterpriseOrgs,
  getOrgSlugs: mocks.getOrgSlugs,
}))
vi.mock('../../utils/sdk.mts', () => ({
  getDefaultApiBaseUrl: mocks.getDefaultApiBaseUrl,
  getDefaultProxyUrl: mocks.getDefaultProxyUrl,
  setupSdk: mocks.setupSdk,
}))
vi.mock('../../utils/terminal-link.mts', () => ({
  socketDocsLink: (_path: string, label: string) => label,
}))
vi.mock('../install/setup-tab-completion.mts', () => ({
  setupTabCompletion: mocks.setupTabCompletion,
}))
vi.mock('../organization/fetch-organization-list.mts', () => ({
  fetchOrganization: mocks.fetchOrganization,
}))

import { attemptLogin } from './attempt-login.mts'

const credentials = {
  version: 1 as const,
  issuer: 'https://api.socket.dev',
  resource: 'https://mcp.socket.dev/',
  apiOrigin: 'https://api.socket.dev',
  clientId: 'public-client',
  accessToken: 'oauth-access-token',
  refreshToken: 'oauth-refresh-token',
  expiresAt: Date.now() + 60_000,
  scopes: ['packages:list', 'alerts:list', 'threat-feed:list'],
  tokenEndpoint: 'https://api.socket.dev/v1/oauth2/token',
}

describe('attemptLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mocks.config).forEach(key => delete mocks.config[key])
    mocks.isConfigFromFlag.mockReturnValue(false)
    mocks.getDefaultApiBaseUrl.mockReturnValue('https://api.socket.dev/v0/')
    mocks.beginOAuthLogin.mockResolvedValue(credentials)
    mocks.logoutOAuth.mockResolvedValue({ revoked: true })
    mocks.setupSdk.mockResolvedValue({ ok: true, data: { sdk: true } })
    mocks.fetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: [{ slug: 'acme', plan: 'free' }] },
    })
    mocks.select.mockResolvedValue(false)
    mocks.password.mockResolvedValue('legacy-api-token')
    mocks.setupTabCompletion.mockResolvedValue({ ok: true })
  })

  it('uses browser OAuth by default and saves only after organization validation', async () => {
    await attemptLogin(undefined, '')

    expect(mocks.beginOAuthLogin).toHaveBeenCalledWith(
      expect.objectContaining({ openBrowser: true }),
    )
    expect(mocks.setupSdk).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.socket.dev/v0/',
      apiProxy: 'http://proxy.example.test:8080',
      apiToken: 'oauth-access-token',
    })
    expect(mocks.beginOAuthLogin).toHaveBeenCalledWith(
      expect.objectContaining({ apiProxy: 'http://proxy.example.test:8080' }),
    )
    expect(mocks.fetchOrganization).toHaveBeenCalled()
    expect(mocks.saveOAuthCredentials).toHaveBeenCalledWith(
      '/tmp/socket-oauth-login-test',
      credentials,
    )
    expect(mocks.updateConfigValue).toHaveBeenCalledWith('apiToken', null)
    expect(mocks.updateConfigValue).toHaveBeenCalledWith('authType', 'oauth')
    expect(mocks.applyLogin).not.toHaveBeenCalled()
  })

  it('requires API-token login when the configured API URL is custom', async () => {
    mocks.getDefaultApiBaseUrl.mockReturnValue('https://custom.example/v0/')

    await expect(attemptLogin(undefined, undefined)).rejects.toThrow(
      'Use `socket login --api-token --api-base-url <url>` for a custom API URL.',
    )

    expect(mocks.beginOAuthLogin).not.toHaveBeenCalled()
  })

  it('keeps an existing API token unless the user explicitly switches modes', async () => {
    mocks.config['apiToken'] = 'existing-api-token'
    mocks.select.mockResolvedValueOnce('keep')

    await attemptLogin(undefined, undefined)

    expect(mocks.beginOAuthLogin).not.toHaveBeenCalled()
    expect(mocks.saveOAuthCredentials).not.toHaveBeenCalled()
    expect(mocks.config['apiToken']).toBe('existing-api-token')
  })

  it('clears the old API token after a successful OAuth switch', async () => {
    mocks.config['apiToken'] = 'existing-api-token'
    mocks.select.mockResolvedValueOnce('oauth')

    await attemptLogin(undefined, undefined)

    expect(mocks.saveOAuthCredentials).toHaveBeenCalled()
    expect(mocks.updateConfigValue).toHaveBeenCalledWith('apiToken', null)
    expect(mocks.updateConfigValue).toHaveBeenCalledWith('authType', 'oauth')
  })

  it('does not save or activate OAuth when organization validation returns no organizations', async () => {
    mocks.config['apiToken'] = 'existing-api-token'
    mocks.select.mockResolvedValueOnce('oauth')
    mocks.fetchOrganization.mockResolvedValueOnce({
      ok: true,
      data: { organizations: [] },
    })

    await attemptLogin(undefined, undefined)

    expect(mocks.saveOAuthCredentials).not.toHaveBeenCalled()
    expect(mocks.config['apiToken']).toBe('existing-api-token')
    expect(mocks.updateConfigValue).not.toHaveBeenCalledWith('apiToken', null)
    expect(mocks.updateConfigValue).not.toHaveBeenCalledWith(
      'authType',
      'oauth',
    )
    expect(mocks.logger.fail).toHaveBeenCalledWith(
      expect.stringContaining('no accessible organization'),
    )
  })

  it('uses the masked API-token path only when explicitly requested', async () => {
    mocks.config['authType'] = 'oauth'
    await attemptLogin(undefined, undefined, true)

    expect(mocks.password).toHaveBeenCalled()
    expect(mocks.beginOAuthLogin).not.toHaveBeenCalled()
    expect(mocks.setupSdk).toHaveBeenCalledWith({
      apiBaseUrl: undefined,
      apiProxy: 'http://proxy.example.test:8080',
      apiToken: 'legacy-api-token',
    })
    expect(mocks.applyLogin).toHaveBeenCalledWith(
      'legacy-api-token',
      [],
      undefined,
      'http://proxy.example.test:8080',
    )
    expect(mocks.logoutOAuth).toHaveBeenCalledWith(
      '/tmp/socket-oauth-login-test',
      { apiProxy: 'http://proxy.example.test:8080' },
    )
  })
})
