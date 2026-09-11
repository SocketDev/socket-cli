import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildFirewallChildEnvironment,
  createFirewallTrustBundle,
} from '../../../../src/util/firewall/environment.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const directories: string[] = []
afterEach(async () => {
  await Promise.allSettled(
    directories
      .splice(0)
      .map(directory => safeDelete(directory, { maxRetries: 0 })),
  )
})

describe('firewall child environment', () => {
  it('sets ecosystem proxies and merges loopback exceptions without mutating input', () => {
    const env = {
      NO_PROXY: 'internal.example, localhost',
      NPM_CONFIG_PROXY: 'http://proxy.example',
      ALL_PROXY: 'http://proxy.example',
      SFW_CA_KEY_PATH: '/private/ca.key',
      EXAMPLE_VAR: 'retained',
      SSL_CERT_DIR: '/corporate/hashed-certs',
    }
    const child = buildFirewallChildEnvironment({
      env,
      proxyUrl: 'http://127.0.0.1:8123',
      certificatePath: '/trust/ca.pem',
    })
    expect(child['HTTP_PROXY']).toBe('http://127.0.0.1:8123')
    expect(child['NPM_CONFIG_PROXY']).toBeUndefined()
    expect(child['ALL_PROXY']).toBe(child['HTTP_PROXY'])
    expect(child['http_proxy']).toBe(child['HTTP_PROXY'])
    expect(child['HTTPS_PROXY']).toBe(child['HTTP_PROXY'])
    expect(child['NO_PROXY']).toBe('internal.example,localhost,127.0.0.1,::1')
    expect(child['no_proxy']).toBe(child['NO_PROXY'])
    expect(child['CARGO_HTTP_PROXY']).toBe(child['HTTP_PROXY'])
    for (const key of [
      'NODE_EXTRA_CA_CERTS',
      'SSL_CERT_FILE',
      'PIP_CERT',
      'CARGO_HTTP_CAINFO',
      'GIT_SSL_CAINFO',
      'YARN_HTTPS_CA_FILE_PATH',
      'npm_config_cafile',
      'BUNDLE_SSL_CA_CERT',
      'GEM_SSL_CA_CERT',
    ]) {
      expect(child[key]).toBe('/trust/ca.pem')
    }
    expect(child['SFW_CA_KEY_PATH']).toBeUndefined()
    expect(child['SFW_TELEMETRY_DISABLED']).toBe('true')
    expect(child['EXAMPLE_VAR']).toBe('retained')
    expect(child['SSL_CERT_DIR']).toBe('/corporate/hashed-certs')
    expect(env.SFW_CA_KEY_PATH).toBe('/private/ca.key')
  })

  it('does not invent a hashed certificate directory', () => {
    const child = buildFirewallChildEnvironment({
      env: {},
      proxyUrl: 'http://127.0.0.1:8123',
      certificatePath: '/trust/ca.pem',
    })
    expect(Object.hasOwn(child, 'SSL_CERT_DIR')).toBe(false)
  })

  it('includes configured corporate trust and removes its temporary bundle', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-env-test-'),
    )
    directories.push(directory)
    const extra = path.join(directory, 'corporate.pem')
    await writeFile(extra, 'EXAMPLE CORPORATE CERTIFICATE')
    const bundle = await createFirewallTrustBundle({
      certificate: 'EXAMPLE FIREWALL CERTIFICATE',
      env: { NODE_EXTRA_CA_CERTS: extra, SSL_CERT_FILE: extra },
    })
    const content = await readFile(bundle.certificatePath, 'utf8')
    expect(content).toContain('EXAMPLE CORPORATE CERTIFICATE')
    expect(content).toContain('EXAMPLE FIREWALL CERTIFICATE')
    expect(
      bundle.certificates.filter(
        cert => cert === 'EXAMPLE CORPORATE CERTIFICATE',
      ),
    ).toHaveLength(1)
    await bundle.close()
    await expect(readFile(bundle.certificatePath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses missing configured trust instead of dropping it', async () => {
    await expect(
      createFirewallTrustBundle({
        certificate: 'EXAMPLE CERTIFICATE',
        env: { SSL_CERT_FILE: '/nonexistent/example-ca.pem' },
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
