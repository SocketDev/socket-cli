import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import os from 'node:os'
import path from 'node:path'

export interface TuiApiFixture {
  readonly baseUrl: string
  readonly caFile: string
  close(): Promise<void>
}

const analytics = Array.from({ length: 3 }, (_, index) => ({
  id: index + 1,
  created_at: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
  repository_id: 'fixture-repo',
  organization_id: 'fixture-org',
  repository_name: 'fixture-repo',
  total_critical_alerts: index + 1,
  total_high_alerts: index + 3,
  total_medium_alerts: index + 6,
  total_low_alerts: index + 9,
  total_critical_added: index + 1,
  total_high_added: index + 2,
  total_medium_added: index + 3,
  total_low_added: index + 4,
  total_critical_prevented: index + 2,
  total_high_prevented: index + 3,
  total_medium_prevented: index + 4,
  total_low_prevented: index + 5,
  top_five_alert_types: { malware: index + 7, vuln: index + 4 },
}))

const audit = {
  results: [
    {
      event_id: 'fixture-event-1',
      created_at: '2024-01-02T03:04:05Z',
      updated_at: '2024-01-02T03:04:05Z',
      country_code: '',
      organization_id: 'fixture-org',
      ip_address: '192.0.2.1',
      payload: { settingKey: 'fixtureSetting' },
      type: 'updateOrganizationSetting',
      user_agent: 'native-tui-fixture',
      user_email: 'fixture@example.invalid',
    },
  ],
  nextPage: '',
}

const threatFeed = {
  results: [
    {
      createdAt: '1990-01-01T00:00:00Z',
      description: 'Local native TUI fixture threat',
      id: 1,
      locationHtmlUrl: 'https://example.invalid/advisory',
      packageHtmlUrl: 'https://example.invalid/package',
      purl: 'pkg:npm/tui-fixture-package@1.2.3',
      removedAt: null,
      threatType: 'mal',
    },
  ],
  nextPage: '',
}

export async function createTuiApiFixture(): Promise<TuiApiFixture> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'socket-tui-api-'))
  const keyPath = path.join(tempDir, 'key.pem')
  const certPath = path.join(tempDir, 'cert.pem')
  let server: ReturnType<typeof createServer> | undefined
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore', timeout: 30_000 },
    )
    server = createServer(
      { key: await readFile(keyPath), cert: await readFile(certPath) },
      (request, response) => {
        const route = request.url ?? ''
        const body = route.startsWith('/orgs/fixture-org/threat-feed')
          ? threatFeed
          : route.startsWith('/analytics/org/')
            ? analytics
            : route.startsWith('/orgs/fixture-org/audit-log')
              ? audit
              : {}
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      },
    )
    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server?.off('error', onError)
        resolve()
      }
      const onError = (error: Error) => {
        server?.off('listening', onListening)
        reject(error)
      }
      server!.once('listening', onListening)
      server!.once('error', onError)
      server!.listen(0, '127.0.0.1')
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Could not start the local TUI fixture API')
    }
    const activeServer = server
    return {
      baseUrl: `https://127.0.0.1:${address.port}`,
      caFile: certPath,
      async close() {
        try {
          await new Promise<void>((resolve, reject) =>
            activeServer.close(error => (error ? reject(error) : resolve())),
          )
        } finally {
          await rm(tempDir, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    if (server?.listening) {
      await new Promise<void>(resolve => server!.close(() => resolve()))
    }
    await rm(tempDir, { recursive: true, force: true })
    throw error
  }
}
