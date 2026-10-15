import { createServer } from 'node:http'
import type { queryApi as QueryApi } from '../../../src/util/socket/api-query.mts'
import type { socketHttpRequest as SocketHttpRequest } from '../../../src/util/socket/api-http.mts'
import type { sendApiRequest as SendApiRequest } from '../../../src/util/socket/api-send.mts'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { IncomingMessage, ServerResponse } from 'node:http'

type RequestObservation = {
  authorization: string | undefined
  body: string
  closed: Promise<void>
  method: string | undefined
  path: string | undefined
  resolveClosed: () => void
}

const observations: RequestObservation[] = []
const requestWaiters = new Map<
  string,
  (observation: RequestObservation) => void
>()
const responseTimers = new Set<ReturnType<typeof setTimeout>>()
const server = createServer(handleRequest)
let apiQuery: typeof QueryApi
let apiSend: typeof SendApiRequest
let socketHttpRequest: typeof SocketHttpRequest
let baseUrl = ''

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const closeHandler: { resolve?: (() => void) | undefined } = {}
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
    const delay = pathname.includes('timeout')
      ? 400
      : pathname === '/explicit' || pathname === '/non-api'
        ? 180
        : 0
    const timer = setTimeout(() => {
      responseTimers.delete(timer)
      if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      }
    }, delay)
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
  baseUrl = `http://127.0.0.1:${address.port}`
}

describe('direct Socket API timeout configuration', () => {
  beforeAll(async () => {
    vi.stubEnv('SOCKET_CLI_CONFIG', '{}')
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', '127.0.0.1')
    vi.stubEnv('SOCKET_CLI_API_TIMEOUT', '80')
    vi.stubEnv('SOCKET_CLI_API_TOKEN', 'sktsec_abc123abc123abc123abc123')
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'http://127.0.0.1')
    vi.stubEnv('SOCKET_CLI_API_PROXY', '')
    vi.stubEnv('HTTPS_PROXY', '')
    vi.stubEnv('https_proxy', '')
    vi.stubEnv('HTTP_PROXY', '')
    vi.stubEnv('http_proxy', '')
    vi.stubEnv('SSL_CERT_FILE', '')
    vi.stubEnv('NODE_EXTRA_CA_CERTS', '')
    await listen()
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', baseUrl)
    const {
      0: queryModule,
      1: sendModule,
      2: httpModule,
    } = await Promise.all([
      import('../../../src/util/socket/api-query.mts'),
      import('../../../src/util/socket/api-send.mts'),
      import('../../../src/util/socket/api-http.mts'),
    ])
    apiQuery = queryModule.queryApi
    apiSend = sendModule.sendApiRequest
    socketHttpRequest = httpModule.socketHttpRequest
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
  })

  it('times out direct GET query requests using configured timeout', async () => {
    const observedRequest = waitForRequest('/get-timeout')
    const request = apiQuery('get-timeout', 'sktsec_abc123abc123abc123abc123')
    await expect(request).rejects.toThrow('GET request timed out after 80ms')
    const observed = await observedRequest
    await observed.closed
    expect(observed.method).toBe('GET')
    expect(observed.authorization).toBe(
      `Basic ${Buffer.from('sktsec_abc123abc123abc123abc123:').toString('base64')}`,
    )
  })

  it.each(['POST', 'PUT'] as const)(
    'returns its normal error result when %s times out',
    async method => {
      const pathname = `/${method.toLowerCase()}-timeout`
      const observedRequest = waitForRequest(pathname)
      const result = await apiSend(pathname.slice(1), method, {
        body: { source: 'synthetic' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('timed out after 80ms')
      }
      const observed = await observedRequest
      await observed.closed
      expect(observed.method).toBe(method)
      expect(observed.body).toBe('{"source":"synthetic"}')
      expect(observed.authorization).toBeTruthy()
    },
  )

  it('completes GET and POST requests inside the configured timeout', async () => {
    const observedGetRequest = waitForRequest('/quick-get')
    const getResponse = await apiQuery(
      'quick-get',
      'sktsec_abc123abc123abc123abc123',
    )
    expect(getResponse.ok).toBe(true)
    await observedGetRequest

    const observedPostRequest = waitForRequest('/quick-post')
    const postResult = await apiSend('quick-post', 'POST', {
      body: { source: 'synthetic' },
    })
    expect(postResult).toEqual({ ok: true, data: { ok: true } })
    const observedPost = await observedPostRequest
    expect(observedPost.body).toBe('{"source":"synthetic"}')
  })

  it('preserves an explicit low-level timeout longer than the API setting', async () => {
    const observedRequest = waitForRequest('/explicit')
    const response = await socketHttpRequest(`${baseUrl}/explicit`, {
      timeout: 300,
    })
    expect(response.ok).toBe(true)
    const observed = await observedRequest
    expect(observed.method).toBe('GET')
  })

  it('leaves defaulted low-level non-API requests outside API timeout configuration', async () => {
    const observedRequest = waitForRequest('/non-api')
    const response = await socketHttpRequest(`${baseUrl}/non-api`)
    expect(response.ok).toBe(true)
    await observedRequest
  })
})
