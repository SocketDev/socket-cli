import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import path from 'node:path'

import { HttpsProxyAgent } from 'hpagent'
import open from 'open'

import { isObjectObject as isRecord } from '@socketsecurity/registry/lib/objects'

import { getExtraCaCerts } from './api-transport.mts'

import type { IncomingMessage, ServerResponse } from 'node:http'

export const OAUTH_ISSUER = 'https://api.socket.dev'
export const OAUTH_RESOURCE = 'https://mcp.socket.dev/'
const RESOURCE_METADATA = `${OAUTH_RESOURCE}.well-known/oauth-protected-resource`
const ISSUER_METADATA = `${OAUTH_ISSUER}/.well-known/oauth-authorization-server`
const REQUIRED_SCOPES = ['packages:list', 'alerts:list', 'threat-feed:list']
const FLOW_TIMEOUT = 5 * 60_000
const REQUEST_TIMEOUT = 20_000
const MAX_RESPONSE = 256 * 1024
const LOCK_TIMEOUT = 60_000
const FILE = 'oauth.json'

export type OAuthCredentials = {
  version: 1
  issuer: string
  resource: string
  apiOrigin: string
  clientId: string
  accessToken: string
  refreshToken?: string | undefined
  expiresAt: number
  scopes: string[]
  tokenEndpoint: string
  revocationEndpoint?: string | undefined
}
export type OAuthRequestOptions = {
  signal?: AbortSignal | undefined
  apiProxy?: string | undefined
  requestTimeoutMs?: number | undefined
}
const error = (message: string) =>
  new Error(`Socket browser sign-in: ${message}`)
const random = (n = 32) => randomBytes(n).toString('base64url')
const form = (data: Record<string, string>) =>
  new URLSearchParams(data).toString()

function trustedEndpoint(value: unknown): string {
  if (typeof value !== 'string') {
    throw error('OAuth metadata is invalid.')
  }
  let u: URL
  try {
    u = new URL(value)
  } catch {
    throw error('OAuth metadata is invalid.')
  }
  if (
    u.protocol !== 'https:' ||
    u.origin !== OAUTH_ISSUER ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  ) {
    throw error('OAuth metadata contains an untrusted endpoint.')
  }
  return u.href
}
function agent(
  proxy?: string,
  timeoutMs = REQUEST_TIMEOUT,
): HttpsAgent | undefined {
  const ca = getExtraCaCerts()
  return proxy
    ? (new HttpsProxyAgent({
        proxy,
        timeout: timeoutMs,
        ...(ca ? { ca, proxyRequestOptions: { ca } } : {}),
      }) as unknown as HttpsAgent)
    : ca
      ? new HttpsAgent({ ca })
      : undefined
}
type HttpResult = { status: number; body: unknown }
export function oauthCancellationError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : error('Sign-in was cancelled.')
}
function http(
  url: string,
  opts: {
    method?: string | undefined
    body?: string | undefined
    headers?: Record<string, string> | undefined
    signal?: AbortSignal | undefined
    proxy?: string | undefined
    allowEmpty?: boolean | undefined
    timeoutMs?: number | undefined
  } = {},
): Promise<HttpResult> {
  const target = new URL(url)
  if (
    target.protocol !== 'https:' ||
    (target.origin !== OAUTH_ISSUER &&
      target.origin !== new URL(OAUTH_RESOURCE).origin)
  ) {
    throw error('Refusing to contact an untrusted OAuth endpoint.')
  }
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(opts.signal.reason ?? error('Sign-in was cancelled.'))
      return
    }
    let done = false
    const finish = (fn: () => void) => {
      if (!done) {
        done = true
        clearTimeout(deadline)
        opts.signal?.removeEventListener('abort', abort)
        requestAgent?.destroy()
        fn()
      }
    }
    const timeoutMs = Math.min(
      opts.timeoutMs ?? REQUEST_TIMEOUT,
      REQUEST_TIMEOUT,
    )
    const requestAgent = agent(opts.proxy, timeoutMs)
    const req = httpsRequest(
      target,
      {
        method: opts.method ?? 'GET',
        timeout: timeoutMs,
        ...(requestAgent ? { agent: requestAgent } : {}),
        headers: {
          accept: 'application/json',
          ...opts.headers,
          ...(opts.body
            ? { 'content-length': String(Buffer.byteLength(opts.body)) }
            : {}),
        },
      },
      res => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE) {
            req.destroy(error('OAuth response was too large.'))
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        res.on('error', () =>
          finish(() => reject(error('OAuth response could not be read.'))),
        )
        res.on('aborted', () =>
          finish(() => reject(error('OAuth response ended unexpectedly.'))),
        )
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (!text && opts.allowEmpty) {
            finish(() => resolve({ status: res.statusCode ?? 0, body: {} }))
            return
          }
          try {
            const body = JSON.parse(text) as unknown
            finish(() => resolve({ status: res.statusCode ?? 0, body }))
          } catch {
            finish(() =>
              reject(error('OAuth server returned an invalid response.')),
            )
          }
        })
      },
    )
    const abort = () => {
      finish(() => reject(error('Sign-in was cancelled.')))
      req.destroy()
    }
    const deadline = setTimeout(() => {
      finish(() => reject(error('OAuth request timed out.')))
      req.destroy()
    }, timeoutMs)
    opts.signal?.addEventListener('abort', abort, { once: true })
    req.on('error', () => finish(() => reject(error('OAuth request failed.'))))
    if (opts.body) {
      req.write(opts.body)
    }
    req.end()
  })
}
async function discover(opts: OAuthRequestOptions) {
  const r = await http(RESOURCE_METADATA, {
    signal: opts.signal,
    proxy: opts.apiProxy,
  })
  const rb = r.body
  if (
    r.status !== 200 ||
    !isRecord(rb) ||
    rb['resource'] !== OAUTH_RESOURCE ||
    !Array.isArray(rb['authorization_servers']) ||
    !rb['authorization_servers'].some(
      (server: unknown) => server === OAUTH_ISSUER,
    ) ||
    !Array.isArray(rb['scopes_supported']) ||
    rb['scopes_supported'].length !== REQUIRED_SCOPES.length ||
    REQUIRED_SCOPES.some(
      s => !(rb['scopes_supported'] as unknown[]).includes(s),
    )
  ) {
    throw error('Socket OAuth resource metadata could not be verified.')
  }
  const ir = await http(ISSUER_METADATA, {
    signal: opts.signal,
    proxy: opts.apiProxy,
  })
  const m = ir.body
  if (
    ir.status !== 200 ||
    !isRecord(m) ||
    m['issuer'] !== OAUTH_ISSUER ||
    !Array.isArray(m['grant_types_supported']) ||
    !m['grant_types_supported'].includes('authorization_code') ||
    !m['grant_types_supported'].includes('refresh_token') ||
    !Array.isArray(m['code_challenge_methods_supported']) ||
    !m['code_challenge_methods_supported'].includes('S256') ||
    !Array.isArray(m['token_endpoint_auth_methods_supported']) ||
    !m['token_endpoint_auth_methods_supported'].includes('none')
  ) {
    throw error('Socket OAuth issuer metadata is invalid.')
  }
  return {
    authorize: trustedEndpoint(m['authorization_endpoint']),
    register: trustedEndpoint(m['registration_endpoint']),
    token: trustedEndpoint(m['token_endpoint']),
    ...(m['revocation_endpoint']
      ? { revoke: trustedEndpoint(m['revocation_endpoint']) }
      : {}),
  }
}
function parseToken(
  r: HttpResult,
  fallback: string[],
  meta: {
    clientId: string
    tokenEndpoint: string
    revocationEndpoint?: string
  },
): OAuthCredentials {
  const b = r.body
  if (
    r.status < 200 ||
    r.status >= 300 ||
    !isRecord(b) ||
    typeof b['access_token'] !== 'string' ||
    !b['access_token'].trim() ||
    typeof b['token_type'] !== 'string' ||
    b['token_type'].toLowerCase() !== 'bearer' ||
    typeof b['expires_in'] !== 'number' ||
    !Number.isFinite(b['expires_in']) ||
    b['expires_in'] <= 0 ||
    !Number.isSafeInteger(Date.now() + b['expires_in'] * 1000) ||
    (b['refresh_token'] !== undefined &&
      (typeof b['refresh_token'] !== 'string' || !b['refresh_token']))
  ) {
    const code = isRecord(b) && b['error'] === 'invalid_grant'
    throw error(
      code
        ? 'The saved session expired or was revoked. Run `socket login` again.'
        : 'Token exchange failed. Run `socket login` again if the problem continues.',
    )
  }
  if (b['scope'] !== undefined && typeof b['scope'] !== 'string') {
    throw error('The authorization server returned invalid permissions.')
  }
  const scopes =
    typeof b['scope'] === 'string'
      ? b['scope'].split(/\s+/).filter(Boolean)
      : fallback
  if (scopes.some(s => !REQUIRED_SCOPES.includes(s))) {
    throw error('The authorization server returned unsupported permissions.')
  }
  if (REQUIRED_SCOPES.some(scope => !scopes.includes(scope))) {
    throw error(
      'The authorization server did not grant the required read-only permissions.',
    )
  }
  return {
    version: 1,
    issuer: OAUTH_ISSUER,
    resource: OAUTH_RESOURCE,
    apiOrigin: OAUTH_ISSUER,
    clientId: meta.clientId,
    accessToken: b['access_token'],
    ...(typeof b['refresh_token'] === 'string'
      ? { refreshToken: b['refresh_token'] }
      : {}),
    expiresAt: Date.now() + b['expires_in'] * 1000,
    scopes,
    tokenEndpoint: meta.tokenEndpoint,
    ...(meta.revocationEndpoint
      ? { revocationEndpoint: meta.revocationEndpoint }
      : {}),
  }
}
function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function beginOAuthLogin(
  options: OAuthRequestOptions & {
    openBrowser?: boolean
    onAuthorizationUrl: (url: string) => void
  },
): Promise<OAuthCredentials> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) {
    abort()
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () =>
      controller.abort(
        error('Sign-in timed out. Run `socket login` to try again.'),
      ),
    FLOW_TIMEOUT,
  )
  const signal = controller.signal
  let server: ReturnType<typeof createServer> | undefined
  try {
    const meta = await discover({ signal, apiProxy: options.apiProxy })
    const state = random()
    const verifier = random(48)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    let resolveCode!: (code: string) => void
    let rejectCode!: (reason: Error) => void
    let settled = false
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })
    // Attach a rejection observer immediately: an OAuth error callback can arrive while DCR is pending.
    void codePromise.catch(() => {})
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let u: URL
      try {
        u = new URL(req.url ?? '/', 'http://127.0.0.1')
      } catch {
        res.writeHead(400).end('Invalid callback request.')
        return
      }
      if (req.method !== 'GET' || u.pathname !== '/oauth/callback') {
        res.writeHead(404).end()
        return
      }
      if (settled) {
        res.writeHead(410).end()
        return
      }
      if (!same(u.searchParams.get('state') ?? '', state)) {
        res.writeHead(400).end('Sign-in state did not match.')
        return
      }
      if (u.searchParams.has('error') || !u.searchParams.get('code')) {
        settled = true
        res.writeHead(400).end('Sign-in was not completed.')
        rejectCode(error('Authorization was declined.'))
        return
      }
      settled = true
      res
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        .end(
          '<!doctype html><title>Socket CLI</title><p>Sign-in complete. Return to your terminal.</p>',
        )
      resolveCode(u.searchParams.get('code')!)
    })
    signal.addEventListener(
      'abort',
      () => {
        if (!settled) {
          settled = true
          rejectCode(oauthCancellationError(signal))
        }
      },
      { once: true },
    )
    if (signal.aborted && !settled) {
      settled = true
      rejectCode(oauthCancellationError(signal))
    }
    const redirectUri = await new Promise<string>((resolve, reject) => {
      server!.once('error', () =>
        reject(error('Could not start the local callback listener.')),
      )
      server!.listen(0, '127.0.0.1', () => {
        const a = server!.address()
        if (!a || typeof a === 'string') {
          reject(error('Could not start the local callback listener.'))
        } else {
          resolve(`http://127.0.0.1:${a.port}/oauth/callback`)
        }
      })
    })
    const registration = await http(meta.register, {
      method: 'POST',
      signal,
      proxy: options.apiProxy,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Socket CLI',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
    const reg = registration.body
    if (
      registration.status < 200 ||
      registration.status >= 300 ||
      !isRecord(reg) ||
      typeof reg['client_id'] !== 'string' ||
      !reg['client_id'].trim() ||
      (reg['token_endpoint_auth_method'] !== undefined &&
        reg['token_endpoint_auth_method'] !== 'none') ||
      (reg['redirect_uris'] !== undefined &&
        (!Array.isArray(reg['redirect_uris']) ||
          !reg['redirect_uris'].some(value => value === redirectUri))) ||
      (reg['grant_types'] !== undefined &&
        (!Array.isArray(reg['grant_types']) ||
          !['authorization_code', 'refresh_token'].every(grant =>
            (reg['grant_types'] as unknown[]).some(value => value === grant),
          ))) ||
      (reg['response_types'] !== undefined &&
        (!Array.isArray(reg['response_types']) ||
          !(reg['response_types'] as unknown[]).some(
            value => value === 'code',
          )))
    ) {
      throw error('The OAuth client could not be registered.')
    }
    const clientId = reg['client_id']
    const url = new URL(meta.authorize)
    url.search = form({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: REQUIRED_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: OAUTH_RESOURCE,
    })
    options.onAuthorizationUrl(url.href)
    if (options.openBrowser !== false) {
      try {
        await open(url.href)
      } catch {
        /* URL was printed; manual browser completion remains available. */
      }
    }
    const code = await codePromise
    const token = await http(meta.token, {
      method: 'POST',
      signal,
      proxy: options.apiProxy,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: OAUTH_RESOURCE,
      }),
    })
    return parseToken(token, REQUIRED_SCOPES, {
      clientId,
      tokenEndpoint: meta.token,
      ...(meta.revoke ? { revocationEndpoint: meta.revoke } : {}),
    })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
    server?.close()
    server?.closeAllConnections()
  }
}

const filePath = (dir: string) => path.join(dir, FILE)
function validCredentials(value: unknown): value is OAuthCredentials {
  if (
    !isRecord(value) ||
    value['version'] !== 1 ||
    value['issuer'] !== OAUTH_ISSUER ||
    value['resource'] !== OAUTH_RESOURCE ||
    value['apiOrigin'] !== OAUTH_ISSUER ||
    typeof value['clientId'] !== 'string' ||
    !value['clientId'] ||
    typeof value['accessToken'] !== 'string' ||
    !value['accessToken'] ||
    typeof value['expiresAt'] !== 'number' ||
    !Number.isFinite(value['expiresAt']) ||
    value['expiresAt'] <= 0 ||
    !Array.isArray(value['scopes']) ||
    value['scopes'].some(
      (s: unknown) => typeof s !== 'string' || !REQUIRED_SCOPES.includes(s),
    ) ||
    (value['refreshToken'] !== undefined &&
      (typeof value['refreshToken'] !== 'string' || !value['refreshToken']))
  ) {
    return false
  }
  try {
    trustedEndpoint(value['tokenEndpoint'])
    if (value['revocationEndpoint'] !== undefined) {
      trustedEndpoint(value['revocationEndpoint'])
    }
    return true
  } catch {
    return false
  }
}
export function readOAuthCredentials(
  directory: string,
): OAuthCredentials | undefined {
  try {
    const x: unknown = JSON.parse(readFileSync(filePath(directory), 'utf8'))
    if (!validCredentials(x)) {
      throw error(
        'Saved OAuth credentials are invalid. Run `socket login` again.',
      )
    }
    return x
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    if (e instanceof SyntaxError) {
      throw error(
        'Saved OAuth credentials are corrupt. Run `socket login` again.',
      )
    }
    throw e
  }
}
async function locked<T>(
  directory: string,
  action: () => Promise<T>,
  signal?: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) {
    throw oauthCancellationError(signal)
  }
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const lock = `${filePath(directory)}.lock`
  const until = Date.now() + LOCK_TIMEOUT
  while (true) {
    try {
      // This await performs the inter-process mutex acquisition.
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(lock, { mode: 0o700 })
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e
      }
      if (Date.now() >= until) {
        throw error(
          `Could not acquire sign-in lock ${lock}. After confirming no other Socket CLI process is running, remove this lock directory and retry.`,
        )
      }
      if (signal?.aborted) {
        throw oauthCancellationError(signal)
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, 100)
        const onAbort = () => {
          clearTimeout(timer)
          reject(oauthCancellationError(signal))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) {
          onAbort()
        }
      })
    }
  }
  try {
    return await action()
  } finally {
    await fs.rm(lock, { recursive: true, force: true })
  }
}
async function writeAtomic(directory: string, credentials: OAuthCredentials) {
  await fs.chmod(directory, 0o700).catch(() => {})
  const target = filePath(directory)
  const tmp = `${target}.${process.pid}.${random(6)}.tmp`
  try {
    await fs.writeFile(tmp, `${JSON.stringify(credentials, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    await fs.chmod(tmp, 0o600)
    await fs.rename(tmp, target)
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {})
  }
}
export async function saveOAuthCredentials(
  directory: string,
  credentials: OAuthCredentials,
): Promise<void> {
  if (!validCredentials(credentials)) {
    throw error('Refusing to save invalid OAuth credentials.')
  }
  await locked(directory, () => writeAtomic(directory, credentials))
}
export async function resolveOAuthAccessToken(
  directory: string,
  options: OAuthRequestOptions = {},
): Promise<string | undefined> {
  if (options.signal?.aborted) {
    throw oauthCancellationError(options.signal)
  }
  const current = readOAuthCredentials(directory)
  if (!current) {
    return undefined
  }
  if (current.expiresAt > Date.now() + 30_000) {
    return current.accessToken
  }
  return await locked(
    directory,
    async () => {
      if (options.signal?.aborted) {
        throw oauthCancellationError(options.signal)
      }
      const latest = readOAuthCredentials(directory)
      if (!latest) {
        throw error('The saved session was removed. Run `socket login` again.')
      }
      if (latest.expiresAt > Date.now() + 30_000) {
        return latest.accessToken
      }
      if (!latest.refreshToken) {
        throw error('The saved session expired. Run `socket login` again.')
      }
      if (options.signal?.aborted) {
        throw oauthCancellationError(options.signal)
      }
      // Durably discard the rotating token before sending it. A timeout/crash can
      // never cause another process to replay a token the server may have used.
      const refreshToken = latest.refreshToken
      await writeAtomic(directory, { ...latest, refreshToken: undefined })
      const result = await http(latest.tokenEndpoint, {
        method: 'POST',
        signal: options.signal,
        proxy: options.apiProxy,
        timeoutMs: options.requestTimeoutMs,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: 'refresh_token',
          client_id: latest.clientId,
          refresh_token: refreshToken,
          resource: OAUTH_RESOURCE,
        }),
      })
      const fresh = parseToken(result, latest.scopes, {
        clientId: latest.clientId,
        tokenEndpoint: latest.tokenEndpoint,
        ...(latest.revocationEndpoint
          ? { revocationEndpoint: latest.revocationEndpoint }
          : {}),
      })
      await writeAtomic(directory, fresh)
      return fresh.accessToken
    },
    options.signal,
  )
}
export async function logoutOAuth(
  directory: string,
  options: OAuthRequestOptions = {},
): Promise<{ revoked: boolean; warning?: string }> {
  return await locked(directory, async () => {
    let creds: OAuthCredentials | undefined
    let warning: string | undefined
    try {
      creds = readOAuthCredentials(directory)
    } catch {
      warning =
        'Saved credentials were invalid; local sign-in data was removed.'
    }
    let revoked = false
    if (creds) {
      if (!creds.revocationEndpoint) {
        warning = 'Remote session revocation was not confirmed.'
      } else {
        try {
          const token = creds.refreshToken ?? creds.accessToken
          const hint = creds.refreshToken ? 'refresh_token' : 'access_token'
          const r = await http(creds.revocationEndpoint, {
            method: 'POST',
            signal: options.signal,
            proxy: options.apiProxy,
            allowEmpty: true,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form({
              client_id: creds.clientId,
              token,
              token_type_hint: hint,
            }),
          })
          revoked = r.status >= 200 && r.status < 300
          if (!revoked) {
            warning = 'Remote session revocation was not confirmed.'
          }
        } catch {
          warning = 'Remote session revocation was not confirmed.'
        }
      }
    }
    await fs.rm(filePath(directory), { force: true })
    return { revoked, ...(warning ? { warning } : {}) }
  })
}
