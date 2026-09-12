import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runFirewallCaCommand } from '../../../../src/util/firewall/ca-command.mts'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  ensure: vi.fn(),
  rotate: vi.fn(),
  load: vi.fn(),
  trust: vi.fn(),
  store: vi.fn(),
}))
vi.mock(import('../../../../src/util/firewall/config.mts'), () => ({
  readFirewallConfig: mocks.config,
}))
vi.mock(import('../../../../src/util/firewall/certificates.mts'), () => ({
  ensureFirewallCertificateAuthority: mocks.ensure,
  rotateFirewallCertificateAuthority: mocks.rotate,
  loadFirewallCertificateAuthority: mocks.load,
  getFirewallCertificatePaths: () => ({
    certificatePath: '/example/ca.crt',
    keyPath: '/example/ca.key',
  }),
}))
vi.mock(import('../../../../src/util/firewall/ca-trust.mts'), () => ({
  getFirewallTrustStore: mocks.store,
  installFirewallCaTrust: mocks.trust,
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  mocks.config.mockResolvedValue({ caDirectory: '/example' })
  mocks.ensure.mockResolvedValue({
    certificatePath: '/example/ca.crt',
    keyPath: '/example/ca.key',
  })
  mocks.rotate.mockResolvedValue({
    certificatePath: '/example/ca.crt',
    keyPath: '/example/ca.key',
    backupDirectory: '/example/backup',
  })
  mocks.load.mockResolvedValue({
    certificate: 'EXAMPLE CERTIFICATE',
    issue: () => ({
      cert: 'EXAMPLE LEAF CERTIFICATE',
      key: 'EXAMPLE PRIVATE KEY',
    }),
  })
  mocks.store.mockReturnValue({ label: 'example store' })
})
describe('firewall CA command', () => {
  it('creates a persistent pair and emits machine-readable paths', async () => {
    await runFirewallCaCommand(['init', '--json'])
    expect(mocks.ensure).toHaveBeenCalledWith({ directory: '/example' })
    expect(mocks.rotate).not.toHaveBeenCalled()
    expect(
      JSON.parse(vi.mocked(process.stdout.write).mock.calls[0]![0] as string),
    ).toEqual({ command: 'init', certificatePath: '/example/ca.crt' })
  })
  it('rotates only on explicit force and reports the backup', async () => {
    await runFirewallCaCommand(['init', '--force'])
    expect(mocks.rotate).toHaveBeenCalledWith({ directory: '/example' })
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('/example/backup'),
    )
  })
  it('prints a validated existing path without creating a CA', async () => {
    await runFirewallCaCommand(['path'])
    expect(mocks.load).toHaveBeenCalledWith({
      certificatePath: '/example/ca.crt',
      keyPath: '/example/ca.key',
    })
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(process.stdout.write).toHaveBeenCalledWith('/example/ca.crt\n')
  })
  it('uses externally configured paths and refuses their rotation', async () => {
    mocks.config.mockResolvedValue({
      caDirectory: '/example',
      certificatePath: '/external/ca.crt',
      keyPath: '/external/ca.key',
    })
    await runFirewallCaCommand(['init'])
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.load).toHaveBeenCalledWith({
      certificatePath: '/external/ca.crt',
      keyPath: '/external/ca.key',
    })
    await expect(
      runFirewallCaCommand(['init', '--force']),
    ).rejects.toBeInstanceOf(Error)
    expect(mocks.rotate).not.toHaveBeenCalled()
  })
  it('validates the CA before invoking the system trust installer', async () => {
    await runFirewallCaCommand(['trust', '--json'])
    expect(mocks.trust).toHaveBeenCalledWith({ label: 'example store' })
    const trustConfig = mocks.store.mock.calls[0]![0] as {
      verifyCertificatePath: string
    }
    await expect(
      readFile(trustConfig.verifyCertificatePath),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    mocks.trust.mockClear()
    mocks.load.mockRejectedValueOnce(new Error('EXAMPLE INVALID CA'))
    await expect(runFirewallCaCommand(['trust'])).rejects.toBeInstanceOf(Error)
    expect(mocks.trust).not.toHaveBeenCalled()
  })
  it.each(
    [
      [],
      ['unknown'],
      ['path', '--force'],
      ['trust', 'extra'],
      ['init', '--unknown'],
    ].map(args => ({ args })),
  )('rejects invalid arguments $args', async ({ args }) => {
    await expect(runFirewallCaCommand(args)).rejects.toBeInstanceOf(Error)
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.trust).not.toHaveBeenCalled()
  })
  it.each([['--help'], ['--describe', '--json']].map(args => ({ args })))(
    'describes commands without accessing certificates $args',
    async ({ args }) => {
      await runFirewallCaCommand(args)
      expect(mocks.config).not.toHaveBeenCalled()
      expect(process.stdout.write).toHaveBeenCalled()
    },
  )
})
