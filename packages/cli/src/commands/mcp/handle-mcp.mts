import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOCKET_CLI_DEBUG } from '../../env/socket-cli-debug.mts'
import { getSocketOauthRequireAudience } from '../../env/socket-oauth-require-audience.mts'
import { getDefaultApiToken } from '../../util/socket/sdk.mts'
import { runHttpTransport } from './transport-http.mts'
import { runStdioTransport } from './transport-stdio.mts'
import { constants } from '../../constants.mts'

import type { ServerConfig } from './server.mts'

const logger = getDefaultLogger()

export interface HandleMcpConfig {
  http: boolean
  oauthClientId?: string | undefined
  oauthClientSecret?: string | undefined
  oauthIssuer?: string | undefined
  oauthRequiredScopes?: readonly string[] | undefined
  port: number
  trustProxy: boolean
}

const DEFAULT_OAUTH_REQUIRED_SCOPES = ['packages:list'] as const

export async function handleMcp(config: HandleMcpConfig): Promise<void> {
  const cfg = { __proto__: null, ...config } as typeof config
  const ENV = constants['ENV'] as { INLINED_VERSION?: string | undefined }
  const version = ENV.INLINED_VERSION || '0.0.0'

  const baseConfig: ServerConfig = {
    getApiToken: () => getDefaultApiToken(),
    serverName: 'socket',
    version,
  }

  if (cfg.http) {
    const issuer = cfg.oauthIssuer ?? ''
    const clientId = cfg.oauthClientId ?? ''
    const clientSecret = cfg.oauthClientSecret ?? ''
    const partial =
      (clientId || clientSecret || issuer) &&
      !(clientId && clientSecret && issuer)
    if (partial) {
      logger.error(
        'Incomplete OAuth configuration for HTTP mode. Set SOCKET_OAUTH_ISSUER, SOCKET_OAUTH_INTROSPECTION_CLIENT_ID, and SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET together.',
      )
      process.exit(1)
    }
    const oauthEnabled = Boolean(clientId && clientSecret && issuer)
    if (!oauthEnabled && !baseConfig.getApiToken()) {
      logger.error(
        'No SOCKET_API_TOKEN configured and OAuth is not enabled. Run `socket login` or set OAuth env vars (SOCKET_OAUTH_ISSUER, SOCKET_OAUTH_INTROSPECTION_CLIENT_ID, SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET) before starting HTTP mode.',
      )
      process.exit(1)
    }
    await runHttpTransport({
      ...baseConfig,
      // With OAuth on, each request carries its own bearer and the server binds
      // every interface, so the configured token is the operator's rather than
      // the caller's. Marking it shared makes the org-scoped tools refuse to
      // fall back to it — one caller must never read another tenant's data
      // through the operator's credentials.
      sharedApiToken: oauthEnabled,
      // A local development stack runs its OAuth issuer on localhost, which
      // the SSRF guard refuses by default. SOCKET_CLI_DEBUG opens that gate.
      oauthAllowLocalIssuer: Boolean(SOCKET_CLI_DEBUG),
      oauthClientId: clientId,
      oauthClientSecret: clientSecret,
      oauthIssuer: issuer,
      // Socket's introspection endpoint does not emit `aud` yet, so requiring
      // it is opt-in. A token that DOES name another resource is refused
      // regardless.
      oauthRequireAudience: getSocketOauthRequireAudience(),
      oauthRequiredScopes:
        cfg.oauthRequiredScopes ?? DEFAULT_OAUTH_REQUIRED_SCOPES,
      port: cfg.port,
      trustProxy: cfg.trustProxy,
    })
    return
  }

  if (!baseConfig.getApiToken()) {
    logger.error(
      'No SOCKET_API_TOKEN configured. Run `socket login` or set SOCKET_API_TOKEN before starting stdio mode.',
    )
    process.exit(1)
  }
  runStdioTransport(baseConfig)
}
