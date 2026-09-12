import http from 'node:http'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import nock from 'nock'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { ensureFirewallCertificateAuthority } from '../../../../src/util/firewall/certificates.mts'
import { runFirewallCommand } from '../../../../src/util/firewall/run.mts'
import {
  closeFirewallFixture,
  listenFirewallFixture,
} from './proxy-fixture.mts'

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: () => undefined,
}))
vi.hoisted(() => {
  vi.stubEnv('LOG_LEVEL', 'error')
})
afterAll(() => {
  vi.unstubAllEnvs()
})
beforeEach(() => {
  nock.disableNetConnect()
  nock.enableNetConnect(/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/)
})
afterEach(() => {
  nock.cleanAll()
  nock.enableNetConnect()
})

const shimSource = `#!/bin/bash
if [ -n "\${SOCKET_SHIM_ACTIVE_NPM:-}" ]; then
  exec "$EXAMPLE_REAL_NODE" "$EXAMPLE_REAL_SCRIPT"
fi
printf obsolete > "$EXAMPLE_OBSOLETE_MARKER"
exit 97
`
const realSource = `
const http = require('node:http')
const fs = require('node:fs')
const target = new URL(process.env.EXAMPLE_ARTIFACT_URL)
const request = http.get(process.env.HTTP_PROXY, {
  path: target.href, headers: { host: target.host },
}, response => {
  response.resume()
  response.on('end', () => {
    fs.writeFileSync(process.env.EXAMPLE_OBSERVATION_PATH, JSON.stringify({
      status: response.statusCode,
      proxy: process.env.HTTP_PROXY,
      sentinel: process.env.SOCKET_SHIM_ACTIVE_NPM,
    }))
    process.exitCode = response.statusCode === 403 ? 23 : 99
  })
})
request.on('error', () => { process.exitCode = 98 })
request.setTimeout(5000, () => request.destroy())
`

describe.skipIf(process.platform === 'win32')(
  'managed shim inside embedded firewall',
  () => {
    it.each(['', '1'])(
      'keeps policy active with inherited sentinel %j',
      async sentinel => {
        const directory = await mkdtemp(
          path.join(os.tmpdir(), 'firewall-managed-shim-'),
        )
        let originHits = 0
        const registry = http.createServer((request, response) => {
          originHits += 1
          response.end('unexpected artifact')
        })
        try {
          const port = await listenFirewallFixture(registry)
          const ca = await ensureFirewallCertificateAuthority({ directory })
          const shim = path.join(directory, 'example-npm-shim')
          const realScript = path.join(directory, 'example-real-client.cjs')
          const obsoleteMarker = path.join(directory, 'obsolete-wrapper.txt')
          const observationPath = path.join(directory, 'observation.json')
          await writeFile(shim, shimSource, { mode: 0o700 })
          await writeFile(realScript, realSource)
          const purl = 'pkg:npm/example-module@1.2.3'
          const api = nock('https://api.socket.dev')
            .post('/v0/purl', { components: [{ purl }] })
            .query({ alerts: 'true' })
            .reply(
              200,
              JSON.stringify({
                type: 'npm',
                name: 'example-module',
                version: '1.2.3',
                alerts: [{ type: 'malware', action: 'error' }],
              }),
            )
          const result = await runFirewallCommand([shim], {
            cwd: directory,
            stdio: 'ignore',
            signal: AbortSignal.timeout(10_000),
            env: {
              PATH: path.dirname(process.execPath),
              SFW_CA_CERT_PATH: ca.certificatePath,
              SFW_CA_KEY_PATH: ca.keyPath,
              SFW_CUSTOM_REGISTRIES: `npm:http://127.0.0.1:${port}`,
              SFW_UNKNOWN_HOST_ACTION: 'block',
              SFW_FAIL_ACTION: 'block',
              SFW_UPSTREAM_PROXY: '',
              SFW_JSON_REPORT_PATH: '',
              SFW_REPORT_MESSAGE: '',
              SOCKET_API_TOKEN: 'example-placeholder-token',
              SOCKET_SHIM_ACTIVE_NPM: sentinel,
              EXAMPLE_REAL_NODE: process.execPath,
              EXAMPLE_REAL_SCRIPT: realScript,
              EXAMPLE_OBSOLETE_MARKER: obsoleteMarker,
              EXAMPLE_ARTIFACT_URL: `http://127.0.0.1:${port}/example-module/-/example-module-1.2.3.tgz`,
              EXAMPLE_OBSERVATION_PATH: observationPath,
            },
          })
          expect(result.code).toBe(23)
          expect(api.isDone()).toBe(true)
          expect(originHits).toBe(0)
          expect(
            JSON.parse(await readFile(observationPath, 'utf8')),
          ).toMatchObject({
            status: 403,
            sentinel: '1',
            proxy: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
          })
          await expect(access(obsoleteMarker)).rejects.toMatchObject({
            code: 'ENOENT',
          })
        } finally {
          await closeFirewallFixture(registry)
          await safeDelete(directory)
        }
      },
    )
  },
)
