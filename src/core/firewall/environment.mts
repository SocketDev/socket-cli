import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getCACertificates } from 'node:tls'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

export type FirewallEnvironment = Record<string, string | undefined>

export function buildFirewallChildEnvironment(config: {
  env: FirewallEnvironment
  proxyUrl: string
  certificatePath: string
}): FirewallEnvironment {
  const { env, proxyUrl, certificatePath } = {
    __proto__: null,
    ...config,
  } as typeof config
  const noProxy = [
    ...new Set([
      ...(env['NO_PROXY'] ?? env['no_proxy'] ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
      'localhost',
      '127.0.0.1',
      '::1',
    ]),
  ].join(',')
  const result: FirewallEnvironment = {
    ...env,
    ALL_PROXY: proxyUrl,
    all_proxy: proxyUrl,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    SSL_CERT_FILE: certificatePath,
    NODE_EXTRA_CA_CERTS: certificatePath,
    npm_config_cafile: certificatePath,
    npm_config_proxy: proxyUrl,
    npm_config_https_proxy: proxyUrl,
    YARN_HTTP_PROXY: proxyUrl,
    YARN_HTTPS_PROXY: proxyUrl,
    YARN_HTTPS_CA_FILE_PATH: certificatePath,
    PIP_CERT: certificatePath,
    REQUESTS_CA_BUNDLE: certificatePath,
    CURL_CA_BUNDLE: certificatePath,
    CARGO_HTTP_CAINFO: certificatePath,
    CARGO_HTTP_PROXY: proxyUrl,
    GIT_SSL_CAINFO: certificatePath,
    GIT_PROXY_SSL_CAINFO: certificatePath,
    BUNDLE_SSL_CA_CERT: certificatePath,
    GEM_SSL_CA_CERT: certificatePath,
    SFW_TELEMETRY_DISABLED: 'true',
    SOCKET_SHIM_ACTIVE_NPM: '1',
    SOCKET_SHIM_ACTIVE_NPX: '1',
    SOCKET_SHIM_ACTIVE_PNPM: '1',
    SOCKET_SHIM_ACTIVE_YARN: '1',
    SOCKET_SHIM_ACTIVE_PIP: '1',
    SOCKET_SHIM_ACTIVE_PIP3: '1',
    SOCKET_SHIM_ACTIVE_UV: '1',
    SOCKET_SHIM_ACTIVE_CARGO: '1',
    SOCKET_SHIM_ACTIVE_GEM: '1',
    SOCKET_SHIM_ACTIVE_BUNDLER: '1',
    SOCKET_SHIM_ACTIVE_NUGET: '1',
    SOCKET_SHIM_ACTIVE_GO: '1',
  }
  const keys = Object.keys(result)
  for (let index = 0, length = keys.length; index < length; index += 1) {
    const key = keys[index]!
    if (
      [
        'npm_config_proxy',
        'npm_config_https_proxy',
        'npm_config_cafile',
      ].includes(key.toLowerCase()) &&
      key !== key.toLowerCase()
    ) {
      delete result[key]
    }
    if (key.toUpperCase() === 'SFW_CA_KEY_PATH') {
      delete result[key]
    }
  }
  return result
}

export async function createFirewallTrustBundle(config: {
  certificate: string
  env: FirewallEnvironment
}): Promise<{
  certificatePath: string
  certificates: string[]
  close(): Promise<void>
}> {
  const opts = { __proto__: null, ...config } as typeof config
  const certificates = new Set(getCACertificates('default'))
  const sources = new Set(
    [
      opts.env['NODE_EXTRA_CA_CERTS'],
      opts.env['SSL_CERT_FILE'],
      opts.env['CARGO_HTTP_CAINFO'],
      opts.env['PIP_CERT'],
      opts.env['REQUESTS_CA_BUNDLE'],
      opts.env['CURL_CA_BUNDLE'],
      opts.env['GIT_SSL_CAINFO'],
      opts.env['GIT_PROXY_SSL_CAINFO'],
      opts.env['BUNDLE_SSL_CA_CERT'],
      opts.env['GEM_SSL_CA_CERT'],
      opts.env['YARN_HTTPS_CA_FILE_PATH'],
      opts.env['npm_config_cafile'],
      opts.env['NPM_CONFIG_CAFILE'],
    ].filter((value): value is string => Boolean(value)),
  )
  for (const filename of sources) {
    certificates.add(await readFile(filename, 'utf8'))
  }
  certificates.add(opts.certificate)
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'socket-firewall-trust-'),
  )
  const certificatePath = path.join(directory, 'ca.pem')
  try {
    await writeFile(certificatePath, [...certificates].join('\n'), {
      mode: 0o600,
      flag: 'wx',
    })
  } catch (error) {
    await safeDelete(directory, { maxRetries: 0 })
    throw error
  }
  return {
    certificatePath,
    certificates: [...certificates],
    close: () => safeDelete(directory, { maxRetries: 0 }),
  }
}
