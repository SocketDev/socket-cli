import type { Server } from 'node:http'

import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { afterEach, expect, it, vi } from 'vitest'

import { runHttpTransport } from '../../../../src/core/mcp/transport-http.mts'

const { servers } = vi.hoisted(() => ({ servers: [] as Server[] }))

vi.mock(import('node:http'), async importOriginal => {
  const actual = await importOriginal()
  const createServer: typeof actual.createServer = (...args) => {
    const server = actual.createServer(...args)
    servers.push(server)
    return server
  }
  return { ...actual, createServer }
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    })
  }
})

it('validates localhost against the assigned port when port zero is requested', async () => {
  await runHttpTransport({
    getApiToken: () => undefined,
    oauthClientId: '',
    oauthClientSecret: '',
    oauthIssuer: '',
    oauthRequiredScopes: [],
    port: 0,
    serverName: 'socket',
    trustProxy: false,
    version: '0.0.0',
  })
  const address = servers[0]?.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('Expected a listening TCP server')
  }
  const url = `http://127.0.0.1:${address.port}/`
  const response = await httpRequest(url, { method: 'OPTIONS' })
  expect(response.status).toBe(200)
  const rejected = await httpRequest(url, {
    method: 'OPTIONS',
    headers: { host: '127.0.0.1:0' },
  })
  expect(rejected.status).toBe(403)
})
