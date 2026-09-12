import http from 'node:http'
import https from 'node:https'
import { connect } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ensureFirewallCertificateAuthority,
  loadFirewallCertificateAuthority,
} from '../../../../src/util/firewall/certificates.mts'
import { startFirewallRegistryRebind } from '../../../../src/util/firewall/rebind.mts'
import {
  closeFirewallFixture,
  listenFirewallFixture,
} from './proxy-fixture.mts'
import type { FirewallCertificateAuthority } from '../../../../src/util/firewall/certificates.mts'
import type { Socket } from 'node:net'

let directory: string
let authority: FirewallCertificateAuthority
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'firewall-rebind-proxy-'))
  authority = await loadFirewallCertificateAuthority(
    await ensureFirewallCertificateAuthority({ directory }),
  )
})
afterAll(async () => {
  await safeDelete(directory)
})

function requestAdapter(
  url: string,
  options: { method?: string | undefined; host?: string | undefined } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.host ? { host: options.host } : {},
      },
      response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('error', reject)
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        )
      },
    )
    request.setTimeout(2000, () =>
      request.destroy(new Error('Adapter fixture timeout')),
    )
    request.on('error', reject)
    request.end()
  })
}

async function withRebind(
  callback: (
    registry: string,
    seen: string[],
    close: () => Promise<void>,
  ) => Promise<void>,
  options: {
    blocked?: boolean | undefined
    external?: boolean | undefined
    metadataResponse?:
      | 'malformed'
      | 'oversized'
      | 'pending'
      | 'redirect'
      | undefined
  } = {},
): Promise<void> {
  const seen: string[] = []
  const pair = authority.issue('registry.npmjs.org')
  const upstream = https.createServer(pair, (request, response) => {
    seen.push(request.url ?? '')
    if (options.metadataResponse === 'redirect') {
      response
        .writeHead(302, { location: 'https://private.example/metadata' })
        .end()
      return
    }
    if (options.metadataResponse === 'malformed') {
      response.end('{invalid')
      return
    }
    if (options.metadataResponse === 'oversized') {
      response.end(' '.repeat(16_777_217))
      return
    }
    if (options.metadataResponse === 'pending') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{')
      return
    }
    if (request.url?.endsWith('.tgz')) {
      response.writeHead(options.blocked ? 403 : 200).end('example-artifact')
    } else {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          versions: {
            '1.0.0': {
              dist: {
                tarball: options.external
                  ? 'https://private.example/example.tgz'
                  : 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
              },
            },
          },
        }),
      )
    }
  })
  const upstreamPort = await listenFirewallFixture(upstream)
  const sockets = new Set<Socket>()
  const proxy = http.createServer()
  proxy.on('connect', (request, socket) => {
    if (request.url !== 'registry.npmjs.org:443') {
      socket.destroy()
      return
    }
    sockets.add(socket as Socket)
    const remote = connect(upstreamPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.pipe(remote).pipe(socket)
    })
    sockets.add(remote)
    remote.on('error', () => socket.destroy())
    socket.on('error', () => remote.destroy())
    socket.on('close', () => remote.destroy())
  })
  const proxyPort = await listenFirewallFixture(proxy)
  const adapter = await startFirewallRegistryRebind({
    command: 'vlt',
    args: ['install'],
    cwd: directory,
    env: { XDG_CONFIG_HOME: directory },
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    certificate: authority.certificate,
  })
  try {
    await callback(adapter!.args.at(-1)!, seen, adapter!.close)
  } finally {
    await adapter?.close()
    for (const socket of sockets) {
      socket.destroy()
    }
    await closeFirewallFixture(proxy)
    await closeFirewallFixture(upstream)
  }
}

describe('process-private vlt registry adapter', () => {
  it('routes metadata and rewritten artifacts through the proxy', async () => {
    await withRebind(async (registry, seen) => {
      const metadata = await requestAdapter(`${registry}example`)
      expect(metadata.status).toBe(200)
      const tarball = JSON.parse(metadata.body).versions['1.0.0'].dist.tarball
      expect(tarball.startsWith(registry)).toBe(true)
      expect(await requestAdapter(tarball)).toEqual({
        status: 200,
        body: 'example-artifact',
      })
      expect(seen).toEqual(['/example', '/example/-/example-1.0.0.tgz'])
    })
  })
  it('preserves firewall denial of an artifact', async () => {
    await withRebind(
      async registry => {
        const metadata = await requestAdapter(`${registry}example`)
        const tarball = JSON.parse(metadata.body).versions['1.0.0'].dist.tarball
        expect((await requestAdapter(tarball)).status).toBe(403)
      },
      { blocked: true },
    )
  })
  it('rejects external tarball metadata without fetching it', async () => {
    await withRebind(
      async (registry, seen) => {
        expect((await requestAdapter(`${registry}example`)).status).toBe(502)
        expect(seen).toEqual(['/example'])
      },
      { external: true },
    )
  })
  it('rejects mutations, unknown capabilities and forged host headers', async () => {
    await withRebind(async (registry, seen) => {
      expect(
        (await requestAdapter(`${registry}example`, { method: 'POST' })).status,
      ).toBe(403)
      expect(
        (await requestAdapter(`${registry}example`, { host: 'evil.example' }))
          .status,
      ).toBe(403)
      expect((await requestAdapter(`${registry}artifact/unknown`)).status).toBe(
        404,
      )
      expect(
        (await requestAdapter(new URL('/example', registry).href)).status,
      ).toBe(403)
      expect(seen).toEqual([])
    })
  })
  it('does not inspect unrelated tool configuration', async () => {
    expect(
      await startFirewallRegistryRebind({
        command: 'npm',
        args: [],
        env: { VLT_REGISTRY: 'https://private.example' },
        proxyUrl: 'invalid',
        certificate: 'invalid',
      }),
    ).toBeUndefined()
  })
  it.each(['malformed', 'oversized', 'redirect'] as const)(
    'rejects %s metadata',
    async metadataResponse => {
      await withRebind(
        async (registry, seen) => {
          expect((await requestAdapter(`${registry}example`)).status).toBe(502)
          expect(seen).toEqual(['/example'])
        },
        { metadataResponse },
      )
    },
  )
  it('handles HEAD without buffering metadata', async () => {
    await withRebind(async registry => {
      expect(
        await requestAdapter(`${registry}example`, { method: 'HEAD' }),
      ).toEqual({ status: 200, body: '' })
    })
  })
  it('cancels in-flight metadata and closes idempotently', async () => {
    await withRebind(
      async (registry, seen, close) => {
        const request = requestAdapter(`${registry}example`)
        const completion = request.catch(error => error)
        await vi.waitFor(() => expect(seen).toEqual(['/example']))
        await close()
        expect(await completion).toBeInstanceOf(Error)
        await close()
      },
      { metadataResponse: 'pending' },
    )
  })
  it('returns request failure when the configured proxy cannot connect', async () => {
    const unavailable = http.createServer()
    const port = await listenFirewallFixture(unavailable)
    await closeFirewallFixture(unavailable)
    const adapter = await startFirewallRegistryRebind({
      command: 'vlt',
      args: [],
      cwd: directory,
      env: { XDG_CONFIG_HOME: directory },
      proxyUrl: `http://127.0.0.1:${port}`,
      certificate: authority.certificate,
    })
    try {
      expect(
        (await requestAdapter(`${adapter!.args.at(-1)!}example`)).status,
      ).toBe(502)
    } finally {
      await adapter?.close()
    }
  })
})
