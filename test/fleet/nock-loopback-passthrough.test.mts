/**
 * @file Characterization guard for the fleet nock pin: a `fetch` POST with a
 *   body to an enableNetConnect-allowed loopback host must pass through to
 *   the local server. nock 15.0.0 shipped @mswjs/interceptors 0.39.8, whose
 *   fetch bypass path clones the request AFTER its body has been consumed
 *   for interceptor matching and throws `TypeError: unusable` — every suite
 *   that POSTs to a local fixture server under the fleet fail-closed setup
 *   went red, including the odai and socket-mcp Test jobs.
 *   The catalog pinned back to 14.0.16 on 2026-07-27; this test red-drives
 *   the next nock bump against the same break. The fail-closed net state —
 *   disableNetConnect plus the loopback allowlist — comes from the fleet
 *   vitest setup in test/fleet/scripts/setup.mts, exactly the state member
 *   suites run under.
 */
import { createServer } from 'node:http'

import { afterAll, beforeAll, expect, it } from 'vitest'

import type { Server } from 'node:http'

let server: Server
let baseUrl: string
const seen: Array<{ body: string; method: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      seen.push({
        body: Buffer.concat(chunks).toString('utf8'),
        method: req.method ?? '',
      })
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('loopback fixture server did not report a port')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

it('passes a fetch POST with a body through to an allowed loopback host', async () => {
  // The regression under guard lives in the.
  // interceptors fetch bypass path; httpRequest goes over node:http and would
  // never exercise it.
  // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- the
  const res = await fetch(`${baseUrl}/echo`, {
    body: 'hello from the fleet',
    method: 'POST',
  })
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('ok')
  expect(seen).toContainEqual({
    body: 'hello from the fleet',
    method: 'POST',
  })
})
