import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runFirewallCommand } from '../../../../src/util/firewall/run.mts'
import type { FirewallPolicyOptions } from '../../../../src/util/firewall/policy/index.mts'
import type { FirewallChildResult } from '../../../../src/util/firewall/child.mts'

const logger = getDefaultLogger()

const noChildSignal: NodeJS.Signals | null = null
const childResult: FirewallChildResult = { code: 17, signal: noChildSignal }

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  spawn: vi.fn(),
  trustClose: vi.fn(),
  proxyClose: vi.fn(),
  policyClose: vi.fn(),
  policy: vi.fn(),
  proxy: vi.fn(),
  config: vi.fn(),
  resolve: vi.fn(),
  loadCa: vi.fn(),
  ensureCa: vi.fn(),
  rebind: vi.fn(),
  rebindClose: vi.fn(),
}))
vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: () => undefined,
}))
vi.mock(import('../../../../src/util/spawn/apply-machine-mode.mts'), () => ({
  applyMachineModeIfActive: ({ args }: { args: string[] }) => ({
    args,
    env: { EXAMPLE_MODE: 'retained' },
  }),
  inferSubcommand: () => 'install',
}))
vi.mock(import('../../../../src/util/spawn/system-tool.mts'), () => ({
  buildSystemToolEnv: (env: object, searchPath: string) => ({
    ...env,
    PATH: searchPath,
  }),
  describeSystemToolFailure: () => 'Executable unavailable',
}))
vi.mock(import('../../../../src/util/firewall/executable.mts'), () => ({
  resolveFirewallExecutable: mocks.resolve,
}))
vi.mock(import('../../../../src/util/firewall/certificates.mts'), () => ({
  ensureFirewallCertificateAuthority: mocks.ensureCa,
  loadFirewallCertificateAuthority: mocks.loadCa,
}))
vi.mock(import('../../../../src/util/firewall/child.mts'), () => ({
  spawnFirewallChild: mocks.spawn,
}))
vi.mock(
  import('../../../../src/util/firewall/config.mts'),
  async importOriginal => ({
    ...(await importOriginal<object>()),
    readFirewallConfig: mocks.config,
  }),
)
vi.mock(
  import('../../../../src/util/firewall/environment.mts'),
  async importOriginal => ({
    ...(await importOriginal<object>()),
    createFirewallTrustBundle: async () => ({
      certificatePath: '/example/trust.pem',
      certificates: [],
      close: mocks.trustClose,
    }),
  }),
)
vi.mock(import('../../../../src/util/firewall/policy/index.mts'), () => ({
  createFirewallPolicy: mocks.policy,
}))
vi.mock(import('../../../../src/util/firewall/proxy.mts'), () => ({
  startFirewallProxy: mocks.proxy,
}))
vi.mock(import('../../../../src/util/firewall/rebind.mts'), () => ({
  startFirewallRegistryRebind: mocks.rebind,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rebind.mockResolvedValue(undefined)
  mocks.rebindClose.mockResolvedValue(undefined)
  mocks.order.length = 0
  mocks.policy.mockImplementation(() => ({
    checkRequest: vi.fn(),
    resolveDestination: vi.fn(),
    close: mocks.policyClose,
    getTunneledEcosystems: () => [],
  }))
  mocks.config.mockResolvedValue({
    env: {},
    caDirectory: '/example/ca',
    customRegistries: [],
    failAction: 'block',
    unknownHostAction: 'ignore',
  })
  mocks.resolve.mockResolvedValue({
    executable: '/example/node',
    prefixArgs: ['/example/npm-cli.js'],
    searchPath: '/trusted/bin',
  })
  mocks.ensureCa.mockResolvedValue({
    certificatePath: '/example/ca.crt',
    keyPath: '/example/ca.key',
  })
  mocks.loadCa.mockResolvedValue({
    certificate: 'EXAMPLE CERTIFICATE',
    issue: vi.fn(),
  })
  mocks.proxy.mockImplementation(async () => {
    mocks.order.push('proxy')
    return { url: 'http://127.0.0.1:1234', close: mocks.proxyClose }
  })
  mocks.spawn.mockImplementation(async () => {
    mocks.order.push('spawn')
    return childResult
  })
  mocks.policyClose.mockImplementation(() => mocks.order.push('policy-close'))
  mocks.proxyClose.mockImplementation(async () => {
    mocks.order.push('proxy-close')
  })
  mocks.trustClose.mockImplementation(async () => {
    mocks.order.push('trust-close')
  })
})

describe('firewall command orchestration', () => {
  it('passes the vlt adapter arguments and closes it before the proxy', async () => {
    mocks.rebind.mockResolvedValue({
      args: ['install', '--registry', 'http://127.0.0.1:1235/private/'],
      close: mocks.rebindClose,
    })
    mocks.rebindClose.mockImplementation(async () => {
      mocks.order.push('rebind-close')
    })
    await runFirewallCommand(['vlt', 'install'])
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          '/example/npm-cli.js',
          'install',
          '--registry',
          'http://127.0.0.1:1235/private/',
        ],
      }),
    )
    expect(mocks.order).toEqual([
      'proxy',
      'spawn',
      'policy-close',
      'rebind-close',
      'proxy-close',
      'trust-close',
    ])
  })
  it('closes proxy and trust resources if reporting policy shutdown throws', async () => {
    mocks.policyClose.mockImplementation(() => {
      throw new Error('EXAMPLE CLOSED STDERR')
    })
    await expect(runFirewallCommand(['npm'])).rejects.toBeInstanceOf(Error)
    expect(mocks.proxyClose).toHaveBeenCalled()
    expect(mocks.trustClose).toHaveBeenCalled()
  })
  it('reports failed requests without terminating the wrapped child', async () => {
    const stderr = vi.spyOn(logger, 'error').mockReturnValue(logger)
    const original = mocks.proxy.getMockImplementation()!
    mocks.proxy.mockImplementationOnce(async config => {
      config.onRequestError('ECONNREFUSED 192.0.2.1:443')
      return original(config)
    })
    expect(await runFirewallCommand(['npm'])).toEqual(childResult)
    expect(stderr).toHaveBeenCalledWith(
      'Socket Firewall request failed: ECONNREFUSED 192.0.2.1:443',
    )
  })
  it('starts protection before spawning and tears it down before returning child status', async () => {
    const result = await runFirewallCommand([
      'npm',
      'install',
      'example-package',
    ])
    expect(result).toEqual(childResult)
    expect(mocks.order).toEqual([
      'proxy',
      'spawn',
      'policy-close',
      'proxy-close',
      'trust-close',
    ])
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: '/example/node',
        args: ['/example/npm-cli.js', 'install', 'example-package'],
        env: expect.objectContaining({
          PATH: '/trusted/bin',
          HTTP_PROXY: 'http://127.0.0.1:1234',
          NODE_EXTRA_CA_CERTS: '/example/trust.pem',
          EXAMPLE_MODE: 'retained',
        }),
      }),
    )
  })
  it('cleans protection up when spawning fails', async () => {
    mocks.spawn.mockRejectedValue(
      Object.assign(new Error('example spawn failure'), { code: 'ENOENT' }),
    )
    await expect(runFirewallCommand(['example-command'])).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    expect(mocks.order).toEqual([
      'proxy',
      'policy-close',
      'proxy-close',
      'trust-close',
    ])
  })
  it('removes trust material when the proxy cannot start', async () => {
    mocks.proxy.mockRejectedValue(new Error('example listener failure'))
    await expect(runFirewallCommand(['npm'])).rejects.toBeInstanceOf(Error)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.trustClose).toHaveBeenCalledOnce()
    expect(mocks.policyClose).toHaveBeenCalledOnce()
  })
  it('does not access configuration for excluded modes', async () => {
    await expect(runFirewallCommand(['--service-mode'])).rejects.toBeInstanceOf(
      Error,
    )
    expect(mocks.config).not.toHaveBeenCalled()
  })
  it('does not start protection when resolution fails', async () => {
    mocks.resolve.mockResolvedValue(undefined)
    await expect(
      runFirewallCommand(['missing-example-tool']),
    ).rejects.toBeInstanceOf(Error)
    expect(mocks.proxy).not.toHaveBeenCalled()
  })
  it('loads configured CA paths without generating a replacement', async () => {
    mocks.config.mockResolvedValue({
      env: {},
      certificatePath: '/example/custom.crt',
      keyPath: '/example/custom.key',
      customRegistries: [],
    })
    await runFirewallCommand(['npm'])
    expect(mocks.ensureCa).not.toHaveBeenCalled()
    expect(mocks.loadCa).toHaveBeenCalledWith({
      certificatePath: '/example/custom.crt',
      keyPath: '/example/custom.key',
    })
  })
})

const reportDirectories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of reportDirectories.splice(0)) {
    await safeDelete(directory, { maxRetries: 0 })
  }
})

describe('firewall reports and failure cleanup', () => {
  it('writes package decisions after shutdown', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-report-test-'),
    )
    reportDirectories.push(directory)
    const reportPath = path.join(directory, 'report.json')
    const stderr = vi.spyOn(logger, 'error').mockReturnValue(logger)
    mocks.config.mockResolvedValue({
      env: {},
      caDirectory: '/example/ca',
      jsonReportPath: reportPath,
      reportMessage: 'example report',
    })
    mocks.policy.mockImplementation((options: FirewallPolicyOptions) => {
      options.onWarning?.('example policy warning')
      options.onDecision?.('pkg:npm/example-package@1.0.0', {
        blocked: true,
        reasons: ['error: malware'],
      })
      return {
        checkRequest: vi.fn(),
        resolveDestination: vi.fn(),
        close: mocks.policyClose,
        getTunneledEcosystems: () => ['Conda'],
      }
    })
    await runFirewallCommand(['npm'])
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
      command: 'npm',
      code: 17,
      message: 'example report',
      tunneledEcosystems: ['Conda'],
      packages: [
        { purl: 'pkg:npm/example-package@1.0.0', decision: { blocked: true } },
      ],
    })
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('example policy warning'),
    )
    expect(mocks.proxyClose).toHaveBeenCalledOnce()
  })
  it('writes report text to stderr without changing child status', async () => {
    const stderr = vi.spyOn(logger, 'error').mockReturnValue(logger)
    mocks.config.mockResolvedValue({
      env: {},
      caDirectory: '/example/ca',
      reportMessage: 'example report',
    })
    await expect(runFirewallCommand(['npm'])).resolves.toEqual(childResult)
    expect(stderr).toHaveBeenCalledWith('example report')
  })
  it('does not leave protection running when a report cannot be created', async () => {
    mocks.config.mockResolvedValue({
      env: {},
      caDirectory: '/example/ca',
      jsonReportPath: '/nonexistent/example-report.json',
    })
    await expect(runFirewallCommand(['npm'])).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(mocks.proxyClose).toHaveBeenCalledOnce()
    expect(mocks.trustClose).toHaveBeenCalledOnce()
  })
  it('removes trust material even if proxy cleanup fails', async () => {
    mocks.proxyClose.mockRejectedValue(new Error('example cleanup failure'))
    await expect(runFirewallCommand(['npm'])).rejects.toBeInstanceOf(Error)
    expect(mocks.trustClose).toHaveBeenCalledOnce()
  })
  it('cleans the trust bundle when policy configuration fails', async () => {
    mocks.policy.mockImplementation(() => {
      throw new TypeError('example policy configuration')
    })
    await expect(runFirewallCommand(['npm'])).rejects.toBeInstanceOf(TypeError)
    expect(mocks.trustClose).toHaveBeenCalledOnce()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('checks cancellation before configuration', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runFirewallCommand(['npm'], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.config).not.toHaveBeenCalled()
  })
})
