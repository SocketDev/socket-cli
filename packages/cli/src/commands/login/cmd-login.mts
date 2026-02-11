import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { attemptLogin } from './attempt-login.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { InputError } from '../../utils/error/errors.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

export const CMD_NAME = 'login'

const description = 'Authenticate Socket CLI and store credentials'

const hidden = false

export const cmdLogin = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
      method: {
        type: 'string',
        default: 'oauth',
        description: 'Login method: oauth (default) or token (legacy)',
      },
      apiBaseUrl: {
        type: 'string',
        default: '',
        description: 'API server to connect to for login',
      },
      apiProxy: {
        type: 'string',
        default: '',
        description: 'Proxy to use when making connection to API server',
      },
      authBaseUrl: {
        type: 'string',
        default: '',
        description:
          'OAuth authorization server base URL (defaults to derived from apiBaseUrl)',
      },
      oauthClientId: {
        type: 'string',
        default: '',
        description: 'OAuth client_id (defaults to socket-cli)',
      },
      oauthRedirectUri: {
        type: 'string',
        default: '',
        description:
          'OAuth redirect URI (must match registered redirect URIs for client)',
      },
      oauthScopes: {
        type: 'string',
        default: '',
        description:
          'OAuth scopes to request (space or comma separated; defaults to CLI-required scopes)',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Logs into the Socket API using a browser-based OAuth flow (default).
    Use --method=token to enter an API token manually (legacy).

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --method=token
      $ ${command} --auth-base-url=https://api.socket.dev --oauth-client-id=socket-cli
      $ ${command} --api-proxy=http://localhost:1234
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  if (!isInteractive()) {
    throw new InputError(
      'Cannot complete interactive login in a non-interactive shell. Use SOCKET_CLI_API_TOKEN environment variable instead',
    )
  }

  const {
    apiBaseUrl,
    apiProxy,
    authBaseUrl,
    method,
    oauthClientId,
    oauthRedirectUri,
    oauthScopes,
  } = cli.flags as unknown as {
    apiBaseUrl?: string | undefined
    apiProxy?: string | undefined
    authBaseUrl?: string | undefined
    method?: string | undefined
    oauthClientId?: string | undefined
    oauthRedirectUri?: string | undefined
    oauthScopes?: string | undefined
  }

  let normalizedMethod: 'oauth' | 'token' | undefined
  if (method === 'oauth' || method === 'token') {
    normalizedMethod = method
  } else if (!method) {
    normalizedMethod = undefined
  } else {
    normalizedMethod = undefined
  }
  if (method && !normalizedMethod) {
    throw new InputError(
      `Invalid --method value: ${method}. Expected "oauth" or "token".`,
    )
  }

  await attemptLogin(apiBaseUrl, apiProxy, {
    method: normalizedMethod,
    authBaseUrl: authBaseUrl || undefined,
    oauthClientId: oauthClientId || undefined,
    oauthRedirectUri: oauthRedirectUri || undefined,
    oauthScopes: oauthScopes || undefined,
  })
}
