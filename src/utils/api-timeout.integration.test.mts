import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'

type RequestObservation = {
  authorization: string | undefined
  body: string
  closed: Promise<void>
  method: string | undefined
  path: string | undefined
  resolveClosed: () => void
}

const certificatePath = new URL(
  '../../test/fixtures/certs/direct-api-timeout-cert.pem',
  import.meta.url,
)
const keyPath = new URL(
  '../../test/fixtures/certs/direct-api-timeout-key.pem',
  import.meta.url,
)
const certificate = readFileSync(certificatePath)
const key = readFileSync(keyPath)
const requestWaiters = new Map<
  string,
  (observation: RequestObservation) => void
>()
const responseTimers = new Set<ReturnType<typeof setTimeout>>()
const observations: RequestObservation[] = []
const server: HttpsServer = createServer(
  { cert: certificate, key },
  handleRequest,
)
let apiFetch: typeof import('./api.mts').apiFetch
let queryApi: typeof import('./api.mts').queryApiSafeTextWithStatus
let sendApiRequest: typeof import('./api.mts').sendApiRequest
let baseUrl = ''
let isolatedHome = ''

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const pathname = new URL(request.url ?? '/', 'https://127.0.0.1').pathname
  const closeHandler: { resolve?: () => void } = {}
  const observation: RequestObservation = {
    authorization: request.headers['authorization'],
    body: '',
    closed: new Promise(resolve => {
      closeHandler.resolve = resolve
    }),
    method: request.method,
    path: pathname,
    resolveClosed: () => {
      closeHandler.resolve?.()
    },
  }
  observations.push(observation)
  requestWaiters.get(pathname)?.(observation)
  requestWaiters.delete(pathname)

  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  })
  request.on('end', () => {
    observation.body = Buffer.concat(chunks).toString('utf8')
    if (pathname === '/redirect-302' || pathname === '/redirect-307') {
      response.writeHead(pathname === '/redirect-302' ? 302 : 307, {
        location: '/delay-headers',
      })
      response.end()
      return
    }
    const complete = () => {
      responseTimers.delete(timer)
      if (!response.destroyed) {
        response.end(pathname === '/gap' ? 'firstsecond' : '{"ok":true}')
      }
    }
    let delay = 0
    if (pathname === '/delay-headers') {
      delay = 220
    } else if (pathname === '/idle-body') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.flushHeaders()
      response.write('{"ok":')
      delay = 220
    } else if (
      pathname === '/explicit' ||
      pathname === '/gap' ||
      pathname === '/unset-gap'
    ) {
      delay = 180
    }
    const timer = setTimeout(complete, delay)
    responseTimers.add(timer)
  })
  response.on('close', () => {
    observation.resolveClosed()
  })
}

function waitForRequest(pathname: string): Promise<RequestObservation> {
  return new Promise(resolve => {
    requestWaiters.set(pathname, resolve)
  })
}

async function listen(): Promise<void> {
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Loopback fixture did not receive a TCP address')
  }
  baseUrl = `https://127.0.0.1:${address.port}`
}

function runUnsetTimeoutChild(): Promise<string> {
  const source = [
    "const { queryApiSafeTextWithStatus } = await import('./src/utils/api.mts')",
    "const result = await queryApiSafeTextWithStatus('unset-gap')",
    'process.stdout.write(JSON.stringify({ ok: result.ok }))',
  ].join('; ')
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', source],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: isolatedHome,
          XDG_CONFIG_HOME: join(isolatedHome, 'config'),
          XDG_DATA_HOME: join(isolatedHome, 'data'),
          SOCKET_CLI_CONFIG: '{}',
          SOCKET_CLI_API_BASE_URL: baseUrl,
          SOCKET_CLI_API_TOKEN: 'sktsec_abc123abc123abc123abc123',
          SOCKET_CLI_API_PROXY: '',
          HTTPS_PROXY: '',
          https_proxy: '',
          HTTP_PROXY: '',
          http_proxy: '',
          SSL_CERT_FILE: certificatePath.pathname,
          NODE_EXTRA_CA_CERTS: '',
        },
      },
    )
    let stdout = ''
    let stderr = ''
    const watchdog = setTimeout(() => {
      child.kill()
      reject(new Error('Unset-timeout child exceeded its watchdog'))
    }, 3_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', error => {
      clearTimeout(watchdog)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(watchdog)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`Unset-timeout child exited ${code}: ${stderr}`))
      }
    })
  })
}

describe('v1 direct Socket API timeout configuration', () => {
  beforeAll(async () => {
    isolatedHome = mkdtempSync(join(tmpdir(), 'socket-api-timeout-'))
    vi.stubEnv('HOME', isolatedHome)
    vi.stubEnv('XDG_CONFIG_HOME', join(isolatedHome, 'config'))
    vi.stubEnv('XDG_DATA_HOME', join(isolatedHome, 'data'))
    vi.stubEnv('SOCKET_CLI_CONFIG', '{}')
    vi.stubEnv('SOCKET_CLI_API_TIMEOUT', '70')
    vi.stubEnv('SOCKET_CLI_API_TOKEN', 'sktsec_abc123abc123abc123abc123')
    vi.stubEnv('SOCKET_CLI_API_PROXY', '')
    vi.stubEnv('HTTPS_PROXY', '')
    vi.stubEnv('https_proxy', '')
    vi.stubEnv('HTTP_PROXY', '')
    vi.stubEnv('http_proxy', '')
    vi.stubEnv('SSL_CERT_FILE', certificatePath.pathname)
    vi.stubEnv('NODE_EXTRA_CA_CERTS', '')
    await listen()
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', baseUrl)
    const api = await import('./api.mts')
    apiFetch = api.apiFetch
    queryApi = api.queryApiSafeTextWithStatus
    sendApiRequest = api.sendApiRequest
  })

  afterAll(async () => {
    for (const timer of responseTimers) {
      clearTimeout(timer)
    }
    server.closeAllConnections()
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
    vi.unstubAllEnvs()
    rmSync(isolatedHome, { force: true, recursive: true })
  })

  it('applies configured timeout to direct GET and POST requests', async () => {
    const observedGet = waitForRequest('/delay-headers')
    const getResult = await queryApi('delay-headers')
    expect(getResult.ok).toBe(false)
    if (!getResult.ok) {
      expect(getResult.message).toBe('API request failed')
      expect(getResult.cause).toContain('timed out after 70 ms')
    }
    const getRequest = await observedGet
    await getRequest.closed
    expect(getRequest.method).toBe('GET')

    const observedPost = waitForRequest('/delay-headers')
    const postResult = await sendApiRequest('delay-headers', {
      method: 'POST',
      body: { source: 'synthetic' },
    })
    expect(postResult.ok).toBe(false)
    if (!postResult.ok) {
      expect(postResult.message).toBe('API request failed')
      expect(postResult.cause).toContain('timed out after 70 ms')
    }
    const postRequest = await observedPost
    await postRequest.closed
    expect(postRequest.method).toBe('POST')
    expect(postRequest.body).toBe('{"source":"synthetic"}')
    expect(postRequest.authorization).toBeTruthy()
  })

  it('destroys an idle response body with a typed timeout error', async () => {
    const observedRequest = waitForRequest('/idle-body')
    const response = await apiFetch(`${baseUrl}/idle-body`, { timeout: 70 })
    await expect(response.text()).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    const observed = await observedRequest
    await observed.closed
  })

  it('allows normal completion within the configured timeout', async () => {
    const observedGet = waitForRequest('/quick')
    const getResult = await queryApi('quick')
    expect(getResult.ok).toBe(true)
    await observedGet

    const observedPost = waitForRequest('/quick')
    const postResult = await sendApiRequest('quick', {
      method: 'POST',
      body: { source: 'synthetic' },
    })
    expect(postResult).toEqual({ ok: true, data: { ok: true } })
    const postRequest = await observedPost
    expect(postRequest.body).toBe('{"source":"synthetic"}')
  })

  it('keeps raw API requests without a timeout when the setting is unset', async () => {
    const observedRequest = waitForRequest('/unset-gap')
    const childResult = await runUnsetTimeoutChild()
    expect(childResult).toBe('{"ok":true}')
    const observed = await observedRequest
    await observed.closed
  })

  it('does not apply the API setting to raw fetches and preserves explicit timeout overrides', async () => {
    const observedGap = waitForRequest('/gap')
    const gapResponse = await apiFetch(`${baseUrl}/gap`)
    expect(await gapResponse.text()).toBe('firstsecond')
    await observedGap

    const observedExplicit = waitForRequest('/explicit')
    const explicitResponse = await apiFetch(`${baseUrl}/explicit`, {
      timeout: 300,
    })
    expect(await explicitResponse.text()).toBe('{"ok":true}')
    await observedExplicit
  })

  it.each(['/redirect-302', '/redirect-307'] as const)(
    'propagates timeout through %s redirects',
    async path => {
      const observedRedirect = waitForRequest(path)
      const observedTarget = waitForRequest('/delay-headers')
      const options =
        path === '/redirect-307'
          ? { method: 'POST', body: '{"source":"synthetic"}', timeout: 70 }
          : { timeout: 70 }
      await expect(
        apiFetch(`${baseUrl}${path}`, options),
      ).rejects.toMatchObject({ code: 'ETIMEDOUT' })
      const redirectRequest = await observedRedirect
      const targetRequest = await observedTarget
      await targetRequest.closed
      expect(redirectRequest.method).toBe(
        path === '/redirect-307' ? 'POST' : 'GET',
      )
      expect(targetRequest.method).toBe(
        path === '/redirect-307' ? 'POST' : 'GET',
      )
      expect(targetRequest.body).toBe(
        path === '/redirect-307' ? '{"source":"synthetic"}' : '',
      )
    },
  )
})
