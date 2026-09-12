import crypto from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
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
import { ensureFirewallCertificateAuthority } from '../../../../src/core/firewall/certificates.mts'
import {
  formatFirewallTrustCommand,
  getFirewallTrustStore,
  installFirewallCaTrust,
  isFirewallCaTrusted,
  runFirewallTrustCommand,
} from '../../../../src/core/firewall/ca-trust.mts'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  find: vi.fn(),
  env: { PATH: '/trusted' } as Record<string, string>,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawnSync: mocks.spawn,
}))
vi.mock(import('../../../../src/util/spawn/system-tool.mts'), () => ({
  findSystemTool: mocks.find,
  buildSystemToolEnv: () => ({ ...mocks.env }),
}))
let directory: string
let certificatePath: string
let certificate: string
let fingerprint: string
const verifyCertificatePath = '/example/localhost-leaf.pem'
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'firewall-trust-test-'))
  const paths = await ensureFirewallCertificateAuthority({ directory })
  certificatePath = paths.certificatePath
  certificate = await readFile(certificatePath, 'utf8')
  fingerprint = new crypto.X509Certificate(certificate).fingerprint.replaceAll(
    ':',
    '',
  )
})
afterAll(async () => {
  await safeDelete(directory, { maxRetries: 0 })
})
afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.resetAllMocks()
  mocks.env = { PATH: '/trusted' }
  mocks.find.mockImplementation(async executable => ({
    executable,
    searchPath: '/trusted',
  }))
  mocks.spawn.mockReturnValue({ status: 1, stdout: '' })
})

describe('firewall CA system trust', () => {
  it('checks macOS SSL trust using a leaf and the system keychain', async () => {
    const store = getFirewallTrustStore({
      certificatePath: "/example/operator's ca.crt",
      certificate,
      verifyCertificatePath,
      platform: 'darwin',
    })
    expect(store.commands[0]?.args).toContain("/example/operator's ca.crt")
    expect(store.verify.args).toEqual([
      'verify-cert',
      '-L',
      '-k',
      '/Library/Keychains/System.keychain',
      '-p',
      'ssl',
      '-n',
      'localhost',
      '-c',
      verifyCertificatePath,
    ])
    mocks.spawn
      .mockReturnValueOnce({ status: 0, stdout: store.fingerprint })
      .mockReturnValueOnce({ status: 1, stdout: '' })
    expect(await isFirewallCaTrusted(store)).toBe(false)
    mocks.spawn
      .mockReturnValueOnce({ status: 0, stdout: store.fingerprint })
      .mockReturnValueOnce({ status: 0, stdout: '' })
    expect(await isFirewallCaTrusted(store)).toBe(true)
  })
  it.each([
    [
      '/etc/pki/ca-trust/source/anchors',
      '/usr/bin/update-ca-trust',
      '/etc/pki/tls/certs/ca-bundle.crt',
    ],
    [
      '/usr/local/share/ca-certificates',
      '/usr/sbin/update-ca-certificates',
      '/etc/ssl/certs/ca-certificates.crt',
    ],
  ])('verifies the compiled Linux store for %s', (anchor, update, bundle) => {
    const store = getFirewallTrustStore({
      certificatePath,
      certificate,
      verifyCertificatePath,
      platform: 'linux',
      exists: filename => filename === anchor,
    })
    expect(store.commands[1]?.executable).toBe(update)
    expect(store.anchor).toBe(path.join(anchor!, 'socket-firewall.crt'))
    expect(store.verify.args).toEqual([
      'verify',
      '-trusted',
      bundle,
      '-purpose',
      'sslserver',
      '-verify_hostname',
      'localhost',
      verifyCertificatePath,
    ])
    expect(store.verify.args).not.toContain(certificatePath)
  })
  it('refuses unsupported stores', () => {
    expect(() =>
      getFirewallTrustStore({
        certificatePath,
        certificate,
        verifyCertificatePath,
        platform: 'freebsd',
      }),
    ).toThrow()
    expect(() =>
      getFirewallTrustStore({
        certificatePath,
        certificate,
        verifyCertificatePath,
        platform: 'linux',
        exists: () => false,
      }),
    ).toThrow()
  })
  it('quotes displayed commands literally', () => {
    const command = {
      executable: 'certutil.exe',
      args: ["/example/operator's cert.crt"],
    }
    expect(formatFirewallTrustCommand(command, 'win32')).toBe(
      "'certutil.exe' '/example/operator''s cert.crt'",
    )
    expect(formatFirewallTrustCommand(command, 'linux')).toBe(
      "'certutil.exe' '/example/operator'\\''s cert.crt'",
    )
  })
  it('does not confuse a copied Linux anchor with active system trust', async () => {
    const store = getFirewallTrustStore({
      certificatePath,
      certificate,
      verifyCertificatePath,
      platform: 'linux',
      exists: () => true,
    })
    store.anchor = path.join(directory, 'installed.crt')
    expect(await isFirewallCaTrusted(store)).toBe(false)
    await writeFile(store.anchor, certificate)
    expect(await isFirewallCaTrusted(store)).toBe(false)
    mocks.spawn.mockReturnValue({ status: 0 })
    expect(await isFirewallCaTrusted(store)).toBe(true)
    await writeFile(store.anchor, 'EXAMPLE INVALID CERTIFICATE')
    expect(await isFirewallCaTrusted(store)).toBe(false)
  })
  it('requires Windows SSL verification in addition to Root membership', async () => {
    const store = getFirewallTrustStore({
      certificatePath,
      certificate,
      verifyCertificatePath,
      platform: 'win32',
    })
    mocks.spawn
      .mockReturnValueOnce({ status: 0, stdout: fingerprint })
      .mockReturnValueOnce({ status: 0, stdout: '' })
    await installFirewallCaTrust(store, 'win32')
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.spawn.mock.calls[1]?.[1]).toEqual([
      '-verify',
      '-sslpolicy',
      'localhost',
      verifyCertificatePath,
    ])
    mocks.spawn
      .mockReturnValueOnce({ status: 0, stdout: fingerprint })
      .mockReturnValueOnce({ status: 1, stdout: '' })
    expect(await isFirewallCaTrusted(store)).toBe(false)
  })
  it('does not install without administrator privileges', async () => {
    const store = getFirewallTrustStore({
      certificatePath,
      certificate,
      verifyCertificatePath,
      platform: 'win32',
    })
    await expect(installFirewallCaTrust(store, 'win32')).rejects.toBeInstanceOf(
      Error,
    )
    expect(mocks.spawn.mock.calls.map(call => call[1][0])).toEqual([
      '-store',
      '-NoLogo',
    ])
  })
  it('verifies SSL trust after installing the certificate', async () => {
    const store = getFirewallTrustStore({
      certificatePath,
      certificate,
      verifyCertificatePath,
      platform: 'win32',
    })
    mocks.spawn
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0, stdout: fingerprint })
      .mockReturnValueOnce({ status: 0 })
    await installFirewallCaTrust(store, 'win32')
    expect(mocks.spawn).toHaveBeenCalledTimes(5)
    expect(mocks.find).toHaveBeenCalledWith('powershell.exe')
    expect(mocks.spawn.mock.calls[1]?.[1].slice(0, 4)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
    ])
    expect(mocks.spawn.mock.calls[1]?.[2].shell).toBe(false)
  })
  it('installs the validated certificate from private staging after the original changes', async () => {
    const original = path.join(directory, 'swapped.crt')
    await writeFile(original, 'EXAMPLE CHANGED CERTIFICATE')
    const store = getFirewallTrustStore({
      certificatePath: original,
      certificate,
      verifyCertificatePath,
      platform: 'win32',
    })
    let stagedPath = ''
    mocks.spawn.mockImplementation((executable, args) => {
      expect(executable).toMatch(/(?:certutil|powershell)\.exe$/)
      if (args[0] === '-NoLogo') {
        return { status: 0 }
      }
      if (args[0] === '-addstore') {
        stagedPath = args[2]
        expect(stagedPath).not.toBe(original)
        expect(readFileSync(stagedPath, 'utf8')).toBe(certificate)
        if (process.platform !== 'win32') {
          expect(statSync(path.dirname(stagedPath)).mode & 0o777).toBe(0o700)
          expect(statSync(stagedPath).mode & 0o777).toBe(0o600)
        }
        return { status: 1 }
      }
      return { status: 1 }
    })
    await expect(installFirewallCaTrust(store, 'win32')).rejects.toThrow()
    expect(stagedPath).not.toBe('')
    expect(existsSync(stagedPath)).toBe(false)
    expect(readFileSync(original, 'utf8')).toBe('EXAMPLE CHANGED CERTIFICATE')
  })
  it.skipIf(process.platform === 'win32')(
    'retries a failed Linux updater even when the source anchor exists',
    async () => {
      vi.spyOn(process, 'getuid').mockReturnValue(0)
      const store = getFirewallTrustStore({
        certificatePath,
        certificate,
        verifyCertificatePath,
        platform: 'linux',
        exists: () => true,
      })
      store.anchor = path.join(directory, 'repair.crt')
      await writeFile(store.anchor, certificate)
      mocks.spawn
        .mockReturnValueOnce({ status: 1 })
        .mockReturnValueOnce({ status: 0 })
        .mockReturnValueOnce({ status: 1 })
      await expect(installFirewallCaTrust(store, 'linux')).rejects.toThrow()
      mocks.spawn
        .mockReturnValueOnce({ status: 1 })
        .mockReturnValueOnce({ status: 0 })
        .mockReturnValueOnce({ status: 0 })
        .mockReturnValueOnce({ status: 0 })
      await installFirewallCaTrust(store, 'linux')
      expect(
        mocks.spawn.mock.calls.filter(
          call => call[0] === '/usr/bin/update-ca-trust',
        ),
      ).toHaveLength(2)
    },
  )
  it('fails if installed membership still fails chain verification', async () => {
    const store = getFirewallTrustStore({
      certificatePath,
      certificate,
      verifyCertificatePath,
      platform: 'win32',
    })
    mocks.spawn
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0, stdout: fingerprint })
      .mockReturnValueOnce({ status: 1 })
    await expect(installFirewallCaTrust(store, 'win32')).rejects.toThrow()
  })
  it('excludes inherited certificate and OpenSSL configuration overrides', async () => {
    mocks.env = {
      PATH: '/trusted',
      SSL_CERT_FILE: '/example/untrusted.pem',
      ssl_cert_dir: '/example/untrusted',
      OPENSSL_CONF: '/example/injected.cnf',
      OPENSSL_MODULES: '/example/providers',
      NODE_EXTRA_CA_CERTS: '/example/extra.pem',
    }
    await runFirewallTrustCommand({
      executable: '/usr/bin/openssl',
      args: ['version'],
    })
    expect(mocks.spawn.mock.calls[0]?.[2].env).toEqual({ PATH: '/trusted' })
    expect(mocks.env).toHaveProperty('SSL_CERT_FILE')
  })
  it('rejects untrusted command resolution', async () => {
    mocks.find.mockResolvedValue(undefined)
    await expect(
      runFirewallTrustCommand({ executable: 'certutil.exe', args: [] }),
    ).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
