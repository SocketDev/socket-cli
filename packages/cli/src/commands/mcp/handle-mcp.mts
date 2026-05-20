import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getDefaultApiToken } from '../../util/socket/sdk.mts'
import { runHttpTransport } from './transport-http.mts'
import { runStdioTransport } from './transport-stdio.mts'
import { constants } from '../../constants.mts'

import type { ServerConfig } from './server.mts'

const logger = getDefaultLogger()

export interface HandleMcpOptions {
  http: boolean
  oauthClientId?: string | undefined
  oauthClientSecret?: string | undefined
  oauthIssuer?: string | undefined
  oauthRequiredScopes?: readonly string[] | undefined
  port: number
  trustProxy: boolean
}

const DEFAULT_OAUTH_REQUIRED_SCOPES = ['packages:list'] as const

export async function handleMcp(opts: HandleMcpOptions): Promise<void> {
  const ENV = constants['ENV'] as { INLINED_VERSION?: string | undefined }
  const version = ENV.INLINED_VERSION || '0.0.0'

  const baseConfig: ServerConfig = {
    getApiToken: () => getDefaultApiToken(),
    serverName: 'socket',
    version,
  }

  if (opts.http) {
    const issuer = opts.oauthIssuer ?? ''
    const clientId = opts.oauthClientId ?? ''
    const clientSecret = opts.oauthClientSecret ?? ''
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
      oauthClientId: clientId,
      oauthClientSecret: clientSecret,
      oauthIssuer: issuer,
      oauthRequiredScopes:
        opts.oauthRequiredScopes ?? DEFAULT_OAUTH_REQUIRED_SCOPES,
      port: opts.port,
      trustProxy: opts.trustProxy,
    })
    return
  }

  if (!baseConfig.getApiToken()) {
    logger.error(
      'No SOCKET_API_TOKEN configured. Run `socket login` or set SOCKET_API_TOKEN before starting stdio mode.',
    )
    process.exit(1)
  }
  await runStdioTransport(baseConfig)
}
