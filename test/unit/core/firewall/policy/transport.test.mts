import http from 'node:http'
import https from 'node:https'
import { connect } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ensureFirewallCertificateAuthority,
  loadFirewallCertificateAuthority,
} from '../../../../../src/core/firewall/certificates.mts'
import type { FirewallCertificateAuthority } from '../../../../../src/core/firewall/certificates.mts'
import { fetchFirewallTransport } from '../../../../../src/core/firewall/policy/api.mts'
import {
  closeFirewallFixture,
  listenFirewallFixture,
} from '../proxy-fixture.mts'

let directory: string
let authority: FirewallCertificateAuthority
beforeAll(async () => {
  directory = await mkdtemp(
    path.join(os.tmpdir(), 'firewall-policy-transport-'),
  )
  authority = await loadFirewallCertificateAuthority(
    await ensureFirewallCertificateAuthority({ directory }),
  )
})
afterAll(async () => {
  await safeDelete(directory)
})

describe('firewall native policy transport', () => {
  it.each([401, 403])(
    'preserves authentication failure code for HTTP %s',
    async status => {
      const server = https.createServer(
        authority.issue('localhost'),
        (request, response) => {
          response.writeHead(status)
          response.end()
        },
      )
      const port = await listenFirewallFixture(server)
      try {
        await expect(
          fetchFirewallTransport(`https://localhost:${port}`, {}, undefined, [
            authority.certificate,
          ]),
        ).rejects.toMatchObject({ code: 'ERR_FIREWALL_API_AUTH' })
      } finally {
        await closeFirewallFixture(server)
      }
    },
  )

  it('trusts configured roots for direct requests and sends exact authentication headers', async () => {
    let headers: http.IncomingHttpHeaders | undefined
    const server = https.createServer(
      authority.issue('localhost'),
      (request, response) => {
        headers = request.headers
        response.end('policy-result')
      },
    )
    const port = await listenFirewallFixture(server)
    try {
      const result = await fetchFirewallTransport(
        `https://localhost:${port}`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer example-placeholder-token' },
          body: 'example-body',
        },
        undefined,
        [authority.certificate],
      )
      expect(await result.text()).toBe('policy-result')
      expect(headers?.authorization).toBe('Bearer example-placeholder-token')
      expect(headers?.['proxy-authorization']).toBeUndefined()
      await expect(
        fetchFirewallTransport(`https://localhost:${port}`, {}, undefined),
      ).rejects.toThrow()
    } finally {
      await closeFirewallFixture(server)
    }
  })

  it('rejects redirects without forwarding the credential', async () => {
    let redirected = 0
    const server = https.createServer(
      authority.issue('localhost'),
      (request, response) => {
        if (request.url === '/redirected') {
          redirected += 1
        }
        response.writeHead(302, { location: '/redirected' })
        response.end()
      },
    )
    const port = await listenFirewallFixture(server)
    try {
      await expect(
        fetchFirewallTransport(`https://localhost:${port}`, {}, undefined, [
          authority.certificate,
        ]),
      ).rejects.toThrow()
      expect(redirected).toBe(0)
    } finally {
      await closeFirewallFixture(server)
    }
  })

  it('trusts HTTPS proxy roots and keeps proxy credentials at the CONNECT hop', async () => {
    let proxyAuthorization: string | undefined
    let originProxyAuthorization: string | string[] | undefined
    const origin = https.createServer(
      authority.issue('localhost'),
      (request, response) => {
        originProxyAuthorization = request.headers['proxy-authorization']
        response.end('through-proxy')
      },
    )
    const originPort = await listenFirewallFixture(origin)
    const proxy = https.createServer(authority.issue('localhost'))
    proxy.on('connect', (request, socket, head) => {
      proxyAuthorization = request.headers['proxy-authorization']
      const remote = connect({ host: '127.0.0.1', port: originPort })
      remote.on('error', () => socket.destroy())
      socket.on('error', () => remote.destroy())
      socket.on('close', () => remote.destroy())
      remote.on('close', () => socket.destroy())
      remote.on('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) {
          remote.write(head)
        }
        socket.pipe(remote).pipe(socket)
      })
    })
    const proxyPort = await listenFirewallFixture(proxy)
    try {
      const result = await fetchFirewallTransport(
        `https://localhost:${originPort}`,
        {},
        `https://example-user:example-password@localhost:${proxyPort}`,
        [authority.certificate],
      )
      expect(await result.text()).toBe('through-proxy')
      expect(proxyAuthorization).toBe(
        `Basic ${Buffer.from('example-user:example-password').toString('base64')}`,
      )
      expect(originProxyAuthorization).toBeUndefined()
    } finally {
      await closeFirewallFixture(proxy)
      await closeFirewallFixture(origin)
    }
  })

  it('cancels a pending proxy CONNECT before a tunnel is established', async () => {
    const proxy = http.createServer()
    proxy.on('connect', (...args) => {
      const socket = args[1]
      socket.on('error', () => socket.destroy())
      socket.on('end', () => socket.destroy())
    })
    const port = await listenFirewallFixture(proxy)
    try {
      await expect(
        fetchFirewallTransport(
          'https://example.com',
          { signal: AbortSignal.timeout(20) },
          `http://127.0.0.1:${port}`,
        ),
      ).rejects.toThrow()
    } finally {
      await closeFirewallFixture(proxy)
    }
  })
})
