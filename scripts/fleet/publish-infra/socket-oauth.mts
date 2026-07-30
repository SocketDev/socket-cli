/*
 * @file Client-side OAuth for acquiring a Socket API token without hand-
 *   copying a key: RFC 8414 issuer discovery → authorization-code + PKCE
 *   (RFC 7636) → loopback redirect (RFC 8252) → token exchange. The browser
 *   opens on the operator's screen, they approve, and the access token comes
 *   back over 127.0.0.1 — no dashboard scavenger hunt, no paste.
 *
 *   ACTIVATION. The flow needs two facts only the deployment knows: the
 *   issuer (`SOCKET_OAUTH_ISSUER`, same variable socket-mcp's resource server
 *   reads) and a registered public CLI client id
 *   (`SOCKET_OAUTH_CLI_CLIENT_ID`) whose registration permits loopback
 *   redirect URIs. With either unset, `socketOAuthConfigured()` is false and
 *   callers keep their existing acquisition path — a disabled seam, never a
 *   silent failure.
 *
 *   SECURITY. PKCE S256 binds the code to this process; a random `state`
 *   binds the loopback callback to this request; the listener binds to
 *   127.0.0.1 on an ephemeral port and accepts exactly one callback; the
 *   issuer must be https, and a loopback issuer is refused; the token is
 *   returned to the caller and never written to disk or stdout.
 */

import crypto from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { logger } from './shared.mts'

export const SOCKET_OAUTH_ISSUER_ENV_VAR = 'SOCKET_OAUTH_ISSUER'
export const SOCKET_OAUTH_CLI_CLIENT_ID_ENV_VAR = 'SOCKET_OAUTH_CLI_CLIENT_ID'

// The scopes the publish scan gate needs on the resulting token.
export const SOCKET_SCAN_SCOPES: readonly string[] = ['full-scans', 'report']

// How long the loopback listener waits for the operator to approve in the
// browser before the flow fails loud.
export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export interface SocketOAuthSettings {
  clientId: string
  issuer: string
}

export interface AuthServerMetadata {
  authorizationEndpoint: string
  tokenEndpoint: string
}

export interface PkcePair {
  challenge: string
  verifier: string
}

/**
 * The issuer + client id from the environment, or undefined when the flow is
 * not configured for this deployment.
 */
export function resolveSocketOAuthSettings(
  env: NodeJS.ProcessEnv = process.env,
): SocketOAuthSettings | undefined {
  const issuer = env[SOCKET_OAUTH_ISSUER_ENV_VAR]
  const clientId = env[SOCKET_OAUTH_CLI_CLIENT_ID_ENV_VAR]
  if (!issuer || !clientId) {
    return undefined
  }
  return { clientId, issuer }
}

/**
 * True when the environment carries everything the OAuth flow needs.
 */
export function socketOAuthConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveSocketOAuthSettings(env) !== undefined
}

/**
 * A fresh PKCE verifier/challenge pair (S256, RFC 7636 §4).
 */
export function generatePkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url')
  return { challenge, verifier }
}

/**
 * The RFC 8414 well-known URL for an issuer, honoring a path component
 * (path-inserted form, same probe order socket-mcp's discovery uses first).
 */
export function buildDiscoveryUrl(issuer: string): string {
  const url = new URL(issuer)
  const path = url.pathname.replace(/\/$/, '')
  return `${url.origin}/.well-known/oauth-authorization-server${path}`
}

/**
 * Fetch and validate the issuer's authorization-server metadata. The issuer
 * must be https on a non-loopback host — this flow exists to talk to a real
 * authorization server, and refusing loopback keeps a poisoned env variable
 * from redirecting the browser to a local listener.
 */
export async function discoverAuthServer(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthServerMetadata> {
  const url = new URL(issuer)
  if (
    url.protocol !== 'https:' ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1'
  ) {
    throw new Error(
      'socket-oauth: refusing a non-https or loopback issuer.\n' +
        `  Where: ${SOCKET_OAUTH_ISSUER_ENV_VAR}\n` +
        `  Saw: ${issuer}; wanted an https URL on a public host.\n` +
        '  Fix: point the variable at the real Socket authorization server.',
    )
  }
  const discoveryUrl = buildDiscoveryUrl(issuer)
  const response = await fetchImpl(discoveryUrl)
  if (!response.ok) {
    throw new Error(
      'socket-oauth: issuer metadata fetch failed.\n' +
        `  Where: GET ${discoveryUrl}\n` +
        `  Saw: HTTP ${response.status}; wanted 200 with RFC 8414 metadata.\n` +
        '  Fix: verify the issuer URL and that the server publishes ' +
        '/.well-known/oauth-authorization-server.',
    )
  }
  const metadata = (await response.json()) as {
    authorization_endpoint?: string | undefined
    issuer?: string | undefined
    token_endpoint?: string | undefined
  }
  if (metadata.issuer !== issuer) {
    throw new Error(
      'socket-oauth: issuer mismatch in metadata.\n' +
        `  Where: ${discoveryUrl}\n` +
        `  Saw: issuer ${String(metadata.issuer)}; wanted ${issuer} byte for byte (RFC 8414 §3.3).\n` +
        '  Fix: set the variable to the exact issuer the server publishes.',
    )
  }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(
      'socket-oauth: metadata is missing required endpoints.\n' +
        `  Where: ${discoveryUrl}\n` +
        '  Saw: no authorization_endpoint or token_endpoint; wanted both.\n' +
        '  Fix: the authorization server must publish both (RFC 8414 §2).',
    )
  }
  return {
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
  }
}

/**
 * The full authorization URL the browser opens.
 */
export function buildAuthorizationUrl(config: {
  authorizationEndpoint: string
  challenge: string
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  state: string
}): string {
  const url = new URL(config.authorizationEndpoint)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('code_challenge', config.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scopes.join(' '))
  url.searchParams.set('state', config.state)
  return url.href
}

/**
 * Parse the loopback callback request: the authorization code when state
 * matches, or an error describing what came back instead.
 */
export function parseCallbackRequest(
  requestUrl: string,
  expectedState: string,
): { code: string } | { error: string } {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const err = url.searchParams.get('error')
  if (err) {
    const description = url.searchParams.get('error_description')
    return { error: description ? `${err}: ${description}` : err }
  }
  if (url.searchParams.get('state') !== expectedState) {
    return { error: 'state mismatch — callback not initiated by this run' }
  }
  const code = url.searchParams.get('code')
  if (!code) {
    return { error: 'callback carried no authorization code' }
  }
  return { code }
}

/**
 * Run the full flow: discover, listen, open the browser, exchange the code.
 * Resolves with the access token; throws loud on every failure path.
 */
export async function acquireSocketTokenViaOAuth(
  options?:
    | {
        env?: NodeJS.ProcessEnv | undefined
        fetchImpl?: typeof fetch | undefined
        openUrl?: ((url: string) => void) | undefined
        scopes?: readonly string[] | undefined
      }
    | undefined,
): Promise<string> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const env = opts.env ?? process.env
  const fetchImpl = opts.fetchImpl ?? fetch
  const scopes = opts.scopes ?? SOCKET_SCAN_SCOPES
  const settings = resolveSocketOAuthSettings(env)
  if (!settings) {
    throw new Error(
      'socket-oauth: flow is not configured.\n' +
        `  Where: env\n` +
        `  Saw: ${SOCKET_OAUTH_ISSUER_ENV_VAR} or ${SOCKET_OAUTH_CLI_CLIENT_ID_ENV_VAR} unset; wanted both.\n` +
        '  Fix: export both, or use the token-paste path.',
    )
  }
  const metadata = await discoverAuthServer(settings.issuer, fetchImpl)
  const pkce = generatePkcePair()
  const state = crypto.randomBytes(16).toString('base64url')

  const { code, redirectUri } = await new Promise<{
    code: string
    redirectUri: string
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(
        new Error(
          'socket-oauth: timed out waiting for the browser approval.\n' +
            '  Where: loopback callback listener\n' +
            `  Saw: no callback within ${CALLBACK_TIMEOUT_MS / 60_000} minutes; wanted one redirect.\n` +
            '  Fix: re-run and complete the approval in the opened browser tab.',
        ),
      )
    }, CALLBACK_TIMEOUT_MS)
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const parsed = parseCallbackRequest(req.url ?? '/', state)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        'error' in parsed
          ? '<p>Authentication failed — return to the terminal.</p>'
          : '<p>Authenticated — you can close this tab.</p>',
      )
      clearTimeout(timer)
      server.close()
      if ('error' in parsed) {
        reject(
          new Error(
            'socket-oauth: authorization callback failed.\n' +
              '  Where: loopback redirect\n' +
              `  Saw: ${parsed.error}; wanted an authorization code.\n` +
              '  Fix: re-run and approve the request in the browser.',
          ),
        )
        return
      }
      resolve({ code: parsed.code, redirectUri: boundRedirectUri })
    })
    let boundRedirectUri = ''
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        clearTimeout(timer)
        server.close()
        reject(new Error('socket-oauth: loopback listener failed to bind.'))
        return
      }
      boundRedirectUri = `http://127.0.0.1:${address.port}/callback`
      const authUrl = buildAuthorizationUrl({
        authorizationEndpoint: metadata.authorizationEndpoint,
        challenge: pkce.challenge,
        clientId: settings.clientId,
        redirectUri: boundRedirectUri,
        scopes,
        state,
      })
      logger.log(
        'Socket OAuth: opening the browser to authorize the scan-gate token…',
      )
      const openUrl = opts.openUrl ?? defaultOpenUrl
      openUrl(authUrl)
    })
  })

  const tokenResponse = await fetchImpl(metadata.tokenEndpoint, {
    body: new URLSearchParams({
      client_id: settings.clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })
  if (!tokenResponse.ok) {
    throw new Error(
      'socket-oauth: token exchange failed.\n' +
        `  Where: POST ${metadata.tokenEndpoint}\n` +
        `  Saw: HTTP ${tokenResponse.status}; wanted 200 with an access_token.\n` +
        '  Fix: verify the client registration allows loopback redirects and the authorization-code grant.',
    )
  }
  const body = (await tokenResponse.json()) as {
    access_token?: string | undefined
  }
  if (!body.access_token) {
    throw new Error(
      'socket-oauth: token response carried no access_token.\n' +
        `  Where: POST ${metadata.tokenEndpoint}\n` +
        '  Saw: a 200 without access_token; wanted one.\n' +
        '  Fix: verify the authorization server issues bearer access tokens on this grant.',
    )
  }
  return body.access_token
}

// Fire-and-forget platform browser opener; a failure is non-fatal because the
// flow's failure mode is the callback timeout, which names the fix.
function defaultOpenUrl(url: string): void {
  const win32 = process.platform === 'win32'
  const opener =
    process.platform === 'darwin' ? 'open' : win32 ? 'start' : 'xdg-open'
  try {
    const child = spawn(opener, [url], {
      detached: true,
      shell: win32,
      stdio: 'ignore',
    })
    child.catch(() => {
      // Non-fatal: the callback timeout names the fix.
    })
  } catch {
    // Non-fatal: the callback timeout names the fix.
  }
}
