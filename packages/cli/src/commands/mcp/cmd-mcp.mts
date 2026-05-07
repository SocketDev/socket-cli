import { handleMcp } from './handle-mcp.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

export const CMD_NAME = 'mcp'

const description = 'Run the Socket MCP server (Model Context Protocol)'

const hidden = false

export const cmdMcp = {
  description,
  hidden,
  run,
}

const DEFAULT_PORT = 3000

function parseRequiredScopes(raw: string): string[] {
  return raw
    .split(/\s+/u)
    .map(value => value.trim())
    .filter(Boolean)
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
      http: {
        type: 'boolean',
        default: false,
        description: 'Start the MCP server in Streamable HTTP mode (default: stdio)',
      },
      'oauth-client-id': {
        type: 'string',
        default: '',
        description:
          'OAuth introspection client ID (HTTP mode only; falls back to env SOCKET_OAUTH_INTROSPECTION_CLIENT_ID)',
      },
      'oauth-client-secret': {
        type: 'string',
        default: '',
        description:
          'OAuth introspection client secret (HTTP mode only; falls back to env SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET)',
      },
      'oauth-issuer': {
        type: 'string',
        default: '',
        description:
          'OAuth issuer URL (HTTP mode only; falls back to env SOCKET_OAUTH_ISSUER)',
      },
      'oauth-required-scopes': {
        type: 'string',
        default: '',
        description:
          'Whitespace-separated OAuth scopes required to access the server (default: packages:list; falls back to env SOCKET_OAUTH_REQUIRED_SCOPES)',
      },
      port: {
        type: 'number',
        default: DEFAULT_PORT,
        description:
          'Port to bind for HTTP mode (default: 3000; falls back to env MCP_PORT)',
      },
      'trust-proxy': {
        type: 'boolean',
        default: false,
        description:
          'Honor X-Forwarded-Proto / X-Forwarded-Host headers (HTTP mode only; falls back to env TRUST_PROXY=true)',
      },
    },
    help: command => `
    Usage
      $ ${command} [options]

    The Socket MCP server exposes the \`depscore\` tool: AI clients can ask
    for dependency security scores across npm, PyPI, RubyGems, Go modules,
    Maven, NuGet, and Cargo without leaving the chat.

    Modes
      stdio (default)  Speak JSON-RPC over stdin/stdout — suitable for
                       Claude Desktop, Cursor, etc. Auth is the local
                       Socket API token (run \`socket login\`).

      --http           Speak Streamable HTTP on --port. Auth can be
                       either the local Socket API token (single-user)
                       or OAuth introspection (multi-user). Configure
                       OAuth via the --oauth-* flags or matching
                       SOCKET_OAUTH_* env vars.

    Environment variables
      SOCKET_API_TOKEN                          Stdio + HTTP fallback auth
      MCP_HTTP_MODE=true                        Equivalent to --http
      MCP_PORT                                  Equivalent to --port
      SOCKET_OAUTH_ISSUER                       OAuth issuer URL (HTTP)
      SOCKET_OAUTH_INTROSPECTION_CLIENT_ID      OAuth introspection client ID
      SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET  OAuth introspection client secret
      SOCKET_OAUTH_REQUIRED_SCOPES              Whitespace-separated scopes
      TRUST_PROXY=true                          Honor X-Forwarded-* headers

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}                              # stdio mode (default)
      $ ${command} --http                       # HTTP mode on :3000
      $ ${command} --http --port 4000           # HTTP mode on :4000
      $ ${command} --http \\                     # HTTP mode with OAuth
        --oauth-issuer https://auth.example.com \\
        --oauth-client-id abc \\
        --oauth-client-secret xyz
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const envHttp = process.env['MCP_HTTP_MODE'] === 'true'
  const http = !!cli.flags['http'] || envHttp

  const portFlag = cli.flags['port']
  const portRaw =
    typeof portFlag === 'number' && portFlag > 0
      ? portFlag
      : Number.parseInt(process.env['MCP_PORT'] || `${DEFAULT_PORT}`, 10)
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : DEFAULT_PORT

  const oauthIssuer =
    String(cli.flags['oauth-issuer'] || '') ||
    process.env['SOCKET_OAUTH_ISSUER'] ||
    ''
  const oauthClientId =
    String(cli.flags['oauth-client-id'] || '') ||
    process.env['SOCKET_OAUTH_INTROSPECTION_CLIENT_ID'] ||
    ''
  const oauthClientSecret =
    String(cli.flags['oauth-client-secret'] || '') ||
    process.env['SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET'] ||
    ''
  const oauthRequiredScopesRaw =
    String(cli.flags['oauth-required-scopes'] || '') ||
    process.env['SOCKET_OAUTH_REQUIRED_SCOPES'] ||
    ''
  const oauthRequiredScopes = oauthRequiredScopesRaw
    ? parseRequiredScopes(oauthRequiredScopesRaw)
    : undefined

  const trustProxy =
    !!cli.flags['trust-proxy'] || process.env['TRUST_PROXY'] === 'true'

  await handleMcp({
    http,
    oauthClientId,
    oauthClientSecret,
    oauthIssuer,
    oauthRequiredScopes,
    port,
    trustProxy,
  })
}
