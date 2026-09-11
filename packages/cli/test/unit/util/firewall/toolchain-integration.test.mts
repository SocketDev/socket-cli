import crypto from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { access, mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buffer } from 'node:stream/consumers'
import { gzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'

import { envAsString } from '@socketsecurity/lib-stable/env/string'
import { safeProcessEnv } from '@socketsecurity/lib-stable/env/rewire'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import nock from 'nock'
import tar from 'tar-stream'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  ensureFirewallCertificateAuthority,
  loadFirewallCertificateAuthority,
} from '../../../../src/util/firewall/certificates.mts'
import { runFirewallCommand } from '../../../../src/util/firewall/run.mts'
import { closeFirewallFixture } from './proxy-fixture.mts'

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: () => undefined,
}))
vi.hoisted(() => {
  vi.stubEnv('LOG_LEVEL', 'error')
})

const clientExecutable = envAsString(
  safeProcessEnv()['SOCKET_FIREWALL_TEST_CLIENT'],
)

afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  nock.disableNetConnect()
  nock.enableNetConnect(/^(?:0\.0\.0\.0|127\.0\.0\.1)(?::\d+)?$/)
})
afterEach(() => {
  nock.cleanAll()
  nock.enableNetConnect()
})

describe('installed package-manager firewall transit', () => {
  it.skipIf(!clientExecutable).each([
    { protocol: 'http', action: 'error' },
    { protocol: 'http', action: 'ignore' },
    { protocol: 'https', action: 'error' },
    { protocol: 'https', action: 'ignore' },
  ])(
    'enforces $action verdict on a real $protocol artifact install',
    async ({ protocol, action }) => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), 'firewall-toolchain-'),
      )
      const pack = tar.pack()
      pack.entry(
        { name: 'package/package.json' },
        JSON.stringify({
          name: 'example-module',
          version: '1.2.3',
          main: 'index.js',
        }),
      )
      pack.entry(
        { name: 'package/index.js' },
        'module.exports = "verified example artifact"\n',
      )
      pack.finalize()
      const archive = gzipSync(await buffer(pack))
      const integrity = `sha512-${crypto.createHash('sha512').update(archive).digest('base64')}`
      let artifactHits = 0
      let registryUrl = ''
      const ca = await ensureFirewallCertificateAuthority({ directory })
      const authority = await loadFirewallCertificateAuthority(ca)
      const registry =
        protocol === 'https'
          ? https.createServer(authority.issue('0.0.0.0'))
          : http.createServer()
      registry.on('request', (request, response) => {
        if (request.url === '/example-module') {
          response.setHeader('content-type', 'application/json')
          response.end(
            JSON.stringify({
              name: 'example-module',
              'dist-tags': { latest: '1.2.3' },
              time: { '1.2.3': '2020-01-01T00:00:00.000Z' },
              versions: {
                '1.2.3': {
                  name: 'example-module',
                  version: '1.2.3',
                  dist: {
                    integrity,
                    tarball: `${registryUrl}/example-module/-/example-module-1.2.3.tgz`,
                  },
                },
              },
            }),
          )
        } else if (
          request.url === '/example-module/-/example-module-1.2.3.tgz'
        ) {
          artifactHits += 1
          response.setHeader('content-type', 'application/octet-stream')
          response.end(archive)
        } else {
          response.writeHead(404)
          response.end()
        }
      })
      const stdoutPath = path.join(directory, 'output.txt')
      const output = await open(stdoutPath, 'wx', 0o600)
      try {
        await new Promise<void>((resolve, reject) => {
          registry.once('error', reject)
          registry.listen(0, '127.0.0.1', resolve)
        })
        registryUrl = `${protocol}://0.0.0.0:${(registry.address() as AddressInfo).port}`
        const manifest = {
          name: 'local-example-consumer',
          version: '0.0.0',
          private: true,
          dependencies: { 'example-module': '1.2.3' },
        }
        await writeFile(
          path.join(directory, 'package.json'),
          JSON.stringify(manifest),
        )
        const userConfig = path.join(directory, 'user.npmrc')
        await writeFile(userConfig, '')
        await writeFile(
          path.join(directory, '.npmrc'),
          `registry=${registryUrl}\nfetch-retries=0\n`,
        )
        const purl = 'pkg:npm/example-module@1.2.3'
        const api = nock('https://api.socket.dev')
          .post('/v0/purl', { components: [{ purl }] })
          .query({ alerts: 'true' })
          .reply(
            200,
            JSON.stringify({
              name: 'example-module',
              type: 'npm',
              version: '1.2.3',
              inputPurl: purl,
              alerts: [{ type: 'malware', action }],
            }),
          )
        const result = await runFirewallCommand(
          [clientExecutable, 'install', '--ignore-scripts'],
          {
            cwd: directory,
            stdio: ['ignore', output.fd, output.fd],
            signal: AbortSignal.timeout(20_000),
            env: {
              PATH: path.dirname(process.execPath),
              SFW_CA_CERT_PATH: ca.certificatePath,
              SFW_CA_KEY_PATH: ca.keyPath,
              SFW_CUSTOM_REGISTRIES: `npm:${registryUrl}`,
              SFW_UNKNOWN_HOST_ACTION: 'block',
              SFW_FAIL_ACTION: 'block',
              SFW_UPSTREAM_PROXY: '',
              SFW_JSON_REPORT_PATH: '',
              SFW_REPORT_MESSAGE: '',
              SOCKET_API_TOKEN: 'example-placeholder-token',
              npm_config_registry: registryUrl,
              npm_config_userconfig: userConfig,
              npm_config_audit: 'false',
              npm_config_fund: 'false',
              npm_config_fetch_retries: '0',
              npm_config_manage_package_manager_versions: 'false',
              npm_config_store_dir: path.join(directory, 'store'),
              npm_config_cache: path.join(directory, 'cache'),
              AUBE_STORE_DIR: path.join(directory, 'aube-store'),
              AUBE_CACHE_DIR: path.join(directory, 'aube-cache'),
              NUB_STORE_DIR: path.join(directory, 'nub-store'),
              NUB_CACHE_DIR: path.join(directory, 'nub-cache'),
            },
          },
        )
        const transcript = await readFile(stdoutPath, 'utf8')
        expect(api.isDone(), transcript).toBe(true)
        expect(artifactHits, transcript).toBe(action === 'error' ? 0 : 1)
        if (action === 'error') {
          expect(result.code, transcript).not.toBe(0)
          await expect(
            access(
              path.join(
                directory,
                'node_modules',
                'example-module',
                'index.js',
              ),
            ),
          ).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          expect(result.code, transcript).toBe(0)
          expect(
            await readFile(
              path.join(
                directory,
                'node_modules',
                'example-module',
                'index.js',
              ),
              'utf8',
            ),
          ).toBe('module.exports = "verified example artifact"\n')
        }
      } finally {
        await output.close()
        await closeFirewallFixture(registry)
        await safeDelete(directory)
      }
    },
  )
})
