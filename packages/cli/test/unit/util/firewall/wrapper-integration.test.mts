import http from 'node:http'
import { connect } from 'node:net'
import { access, mkdtemp, open, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import nock from 'nock'
import {
  afterAll,
  afterEach,
  beforeAll,
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

const childSource = `
  const http = require('node:http')
  const fs = require('node:fs')
  const target = new URL(process.env.EXAMPLE_ARTIFACT_URL)
  const request = http.get(process.env.HTTP_PROXY, {
    path: target.href,
    headers: { host: target.host },
  }, response => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', chunk => { body += chunk })
    response.on('end', () => {
      fs.writeFileSync(process.env.EXAMPLE_OBSERVATION_PATH, JSON.stringify({
        proxyUrl: process.env.HTTP_PROXY,
        certificatePath: process.env.NODE_EXTRA_CA_CERTS,
        status: response.statusCode,
      }))
      process.stdout.write(body)
      process.exitCode = response.statusCode === Number(process.env.EXAMPLE_STATUS)
        ? Number(process.env.EXAMPLE_EXIT_CODE) : 99
    })
  })
  request.on('error', () => { process.exitCode = 98 })
  request.setTimeout(5000, () => request.destroy())
`

let directory: string
let authorityPaths: { certificatePath: string; keyPath: string }
beforeAll(async () => {
  directory = await mkdtemp(
    path.join(os.tmpdir(), 'firewall-wrapper-integration-'),
  )
  authorityPaths = await ensureFirewallCertificateAuthority({ directory })
})
afterAll(async () => {
  await safeDelete(directory)
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

describe('embedded firewall wrapper integration', () => {
  it.each([
    {
      action: 'error',
      status: 403,
      code: 23,
      originHits: 0,
      output: 'Firewall request rejected.\n',
    },
    {
      action: 'ignore',
      status: 200,
      code: 0,
      originHits: 1,
      output: 'example verified artifact',
    },
  ])(
    'enforces $action policy through the real child and proxy',
    async scenario => {
      let originHits = 0
      const registry = http.createServer((request, response) => {
        originHits += 1
        response.end('example verified artifact')
      })
      const port = await listenFirewallFixture(registry)
      const artifactPurl = 'pkg:npm/example-module@1.2.3'
      const api = nock('https://api.socket.dev')
        .matchHeader('authorization', 'Bearer example-placeholder-token')
        .post('/v0/purl', { components: [{ purl: artifactPurl }] })
        .query({ alerts: 'true' })
        .reply(
          200,
          JSON.stringify({
            type: 'npm',
            name: 'example-module',
            version: '1.2.3',
            inputPurl: artifactPurl,
            alerts: [{ type: 'malware', action: scenario.action }],
          }),
        )
      const observationPath = path.join(
        directory,
        `${scenario.action}-observation.json`,
      )
      const stdoutPath = path.join(directory, `${scenario.action}-stdout.txt`)
      const stdout = await open(stdoutPath, 'wx', 0o600)
      try {
        const result = await runFirewallCommand(
          [process.execPath, '-e', childSource],
          {
            cwd: directory,
            stdio: ['ignore', stdout.fd, 'ignore'],
            env: {
              PATH: path.dirname(process.execPath),
              SFW_CA_CERT_PATH: authorityPaths.certificatePath,
              SFW_CA_KEY_PATH: authorityPaths.keyPath,
              SFW_CUSTOM_REGISTRIES: `npm:http://127.0.0.1:${port}`,
              SFW_UNKNOWN_HOST_ACTION: 'block',
              SFW_FAIL_ACTION: 'block',
              SFW_UPSTREAM_PROXY: '',
              SFW_JSON_REPORT_PATH: '',
              SFW_REPORT_MESSAGE: '',
              SOCKET_API_TOKEN: 'example-placeholder-token',
              EXAMPLE_ARTIFACT_URL: `http://127.0.0.1:${port}/example-module/-/example-module-1.2.3.tgz`,
              EXAMPLE_OBSERVATION_PATH: observationPath,
              EXAMPLE_STATUS: String(scenario.status),
              EXAMPLE_EXIT_CODE: String(scenario.code),
            },
          },
        )
        expect(result.code).toBe(scenario.code)
        expect(result.signal).toBeNull()
        expect(api.isDone()).toBe(true)
        expect(originHits).toBe(scenario.originHits)
        expect(await readFile(stdoutPath, 'utf8')).toBe(scenario.output)
        const observation = JSON.parse(
          await readFile(observationPath, 'utf8'),
        ) as {
          proxyUrl: string
          certificatePath: string
          status: number
        }
        expect(observation.status).toBe(scenario.status)
        await expect(access(observation.certificatePath)).rejects.toMatchObject(
          { code: 'ENOENT' },
        )
        await expect(
          access(authorityPaths.certificatePath),
        ).resolves.toBeUndefined()
        const proxyUrl = new URL(observation.proxyUrl)
        const proxyState = await new Promise<string>(resolve => {
          const socket = connect({
            host: proxyUrl.hostname,
            port: Number(proxyUrl.port),
          })
          socket.once('connect', () => {
            socket.destroy()
            resolve('connected')
          })
          socket.once('error', error =>
            resolve((error as NodeJS.ErrnoException).code ?? 'unknown'),
          )
        })
        expect(proxyState).toBe('ECONNREFUSED')
      } finally {
        await stdout.close()
        await closeFirewallFixture(registry)
      }
    },
  )
})
