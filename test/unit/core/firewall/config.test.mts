import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  readFirewallConfig,
  validateFirewallCommand,
} from '../../../../src/core/firewall/config.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const directories: string[] = []
afterEach(async () => {
  await Promise.allSettled(
    directories
      .splice(0)
      .map(directory => safeDelete(directory, { maxRetries: 0 })),
  )
})
async function createHome(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'firewall-config-test-'),
  )
  directories.push(directory)
  return directory
}

describe('firewall wrapper configuration', () => {
  it('permits unknown hosts in free mode and fails closed for policy errors', async () => {
    const config = await readFirewallConfig({
      home: await createHome(),
      env: {},
    })
    expect(config.apiToken).toBeUndefined()
    expect(config.unknownHostAction).toBe('ignore')
    expect(config.failAction).toBe('block')
    expect(config.customRegistries).toEqual([])
    expect(config.localRegistryAliases).toEqual([])
  })
  it('blocks unknown hosts with credentials and honors explicit actions', async () => {
    const home = await createHome()
    expect(
      (
        await readFirewallConfig({
          home,
          env: {},
          apiToken: 'example-api-token',
        })
      ).unknownHostAction,
    ).toBe('block')
    expect(
      (
        await readFirewallConfig({
          home,
          env: { SFW_UNKNOWN_HOST_ACTION: 'warn', SFW_FAIL_ACTION: 'allow' },
        })
      ).failAction,
    ).toBe('ignore')
  })
  it('uses environment settings ahead of the home configuration', async () => {
    const home = await createHome()
    await writeFile(
      path.join(home, '.sfw.config'),
      'SFW_UNKNOWN_HOST_ACTION=block\nSFW_CUSTOM_REGISTRIES="npm:https://packages.example/npm, pypi:https://packages.example/python"\n',
    )
    const config = await readFirewallConfig({
      home,
      env: {
        SFW_UNKNOWN_HOST_ACTION: 'ignore',
        SFW_LOCAL_REGISTRY_ALIASES: 'registry.npmjs.org, pypi.org',
      },
    })
    expect(config.unknownHostAction).toBe('ignore')
    expect(config.customRegistries).toHaveLength(2)
    expect(config.localRegistryAliases).toEqual([
      'registry.npmjs.org',
      'pypi.org',
    ])
  })
  it.each([
    { SFW_CA_CERT_PATH: '/example/ca.crt' },
    { SFW_FAIL_ACTION: 'typo' },
    { SFW_UNKNOWN_HOST_ACTION: 'typo' },
    { SFW_UPSTREAM_PROXY: 'file:///example' },
    { SFW_UPSTREAM_PROXY: 'https://proxy.example/path' },
  ])('rejects invalid configuration %j', async env => {
    await expect(
      readFirewallConfig({ home: await createHome(), env }),
    ).rejects.toBeInstanceOf(Error)
  })
  it.each(
    [
      [],
      ['--service'],
      ['--service-mode'],
      ['--registry'],
      ['--registry=example'],
    ].map(args => ({ args })),
  )('rejects non-wrapper invocations $args', ({ args }) => {
    expect(() => validateFirewallCommand(args)).toThrow()
  })
  it('preserves child flags after its executable', () => {
    expect(() =>
      validateFirewallCommand([
        'npm',
        '--help',
        '--registry=https://registry.example',
      ]),
    ).not.toThrow()
  })
})
