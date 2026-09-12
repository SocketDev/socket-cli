import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addFirewallRegistryArgument,
  firewallVltConfigHome,
  hasFirewallRegistrySetting,
  isFirewallRebindCommand,
  validateFirewallRebindConfig,
} from '../../../../src/core/firewall/rebind-config.mts'
import {
  firewallRebindTarget,
  rewriteFirewallRegistryMetadata,
} from '../../../../src/core/firewall/rebind-metadata.mts'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'firewall-rebind-'))
})
afterEach(async () => {
  await safeDelete(directory)
})

describe('vlt registry configuration', () => {
  it.each([
    'vlt',
    '/usr/local/bin/vlt',
    'C:\\tools\\VLT.EXE',
    'vlt.cmd',
    'vlt.ps1',
  ])('recognizes %s', command => {
    expect(isFirewallRebindCommand(command)).toBe(true)
  })
  it.each(['vlt-helper', 'npx', 'svlt', 'vlt.js'])(
    'does not rebind %s',
    command => {
      expect(isFirewallRebindCommand(command)).toBe(false)
    },
  )
  it('inserts registry before child arguments', () => {
    expect(
      addFirewallRegistryArgument(
        ['run', 'build', '--', '--watch'],
        'http://localhost/',
      ),
    ).toEqual([
      'run',
      'build',
      '--registry',
      'http://localhost/',
      '--',
      '--watch',
    ])
  })
  it.each([
    ['install', '--registry', 'https://private.example'],
    ['--registry=https://private.example'],
    ['--registries={}'],
  ])('rejects registry override %j', async args => {
    await expect(
      validateFirewallRebindConfig({
        args,
        cwd: directory,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).rejects.toThrow()
  })
  it('preserves registry flags passed to scripts', async () => {
    await expect(
      validateFirewallRebindConfig({
        args: ['run', 'build', '--', '--registry', 'private'],
        cwd: directory,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).resolves.toBeUndefined()
  })
  it('rejects the registry environment setting', async () => {
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: directory,
        env: { VLT_REGISTRY: 'https://private.example' },
      }),
    ).rejects.toThrow()
  })
  it.each([
    { registry: 'https://private.example' },
    { command: { install: { registry: 'https://private.example' } } },
    { registries: { '@example': 'https://private.example' } },
  ])('rejects project registry settings', async config => {
    await writeFile(
      path.join(directory, 'vlt.json'),
      JSON.stringify({ config }),
    )
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: directory,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).rejects.toThrow()
  })
  it('rejects inherited project registry settings', async () => {
    await writeFile(
      path.join(directory, 'vlt.json'),
      JSON.stringify({ config: { registry: 'https://private.example' } }),
    )
    const child = path.join(directory, 'child')
    await mkdir(child)
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: child,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).rejects.toThrow()
  })
  it('stops project discovery at a repository boundary', async () => {
    await writeFile(
      path.join(directory, 'vlt.json'),
      JSON.stringify({ config: { registry: 'https://private.example' } }),
    )
    const child = path.join(directory, 'child')
    await mkdir(child)
    await mkdir(path.join(child, '.git'))
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: child,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).resolves.toBeUndefined()
  })
  it('rejects user registry settings', async () => {
    await mkdir(path.join(directory, 'vlt'))
    await writeFile(
      path.join(directory, 'vlt', 'vlt.json'),
      JSON.stringify({ config: { registry: 'https://private.example' } }),
    )
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: directory,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).rejects.toThrow()
  })
  it('fails closed on malformed configuration', async () => {
    await writeFile(path.join(directory, 'vlt.json'), '{invalid')
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: directory,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).rejects.toThrow()
  })
  it('rejects an oversized configuration file', async () => {
    await writeFile(path.join(directory, 'vlt.json'), ' '.repeat(1_048_577))
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: directory,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).rejects.toThrow()
  })
  it('rejects a non-regular configuration file', async () => {
    await mkdir(path.join(directory, 'vlt.json'))
    await expect(
      validateFirewallRebindConfig({
        args: ['install'],
        cwd: directory,
        env: { XDG_CONFIG_HOME: directory },
      }),
    ).rejects.toThrow()
  })
  it('ignores unrelated configuration fields', () => {
    expect(
      hasFirewallRegistrySetting({
        config: { command: { install: { save: true } } },
      }),
    ).toBe(false)
  })
  it('follows platform user configuration conventions', () => {
    expect(firewallVltConfigHome({}, '/example-home', 'darwin')).toBe(
      '/example-home/Library/Preferences',
    )
    expect(firewallVltConfigHome({}, '/example-home', 'linux')).toBe(
      '/example-home/.config',
    )
    expect(
      firewallVltConfigHome(
        { APPDATA: '/example-roaming' },
        '/example-home',
        'win32',
      ),
    ).toBe('/example-roaming/xdg.config')
    expect(
      firewallVltConfigHome(
        { XDG_CONFIG_HOME: '/example-xdg' },
        '/example-home',
        'darwin',
      ),
    ).toBe('/example-xdg')
  })
})

describe('vlt metadata boundaries', () => {
  it('rewrites every version tarball and preserves integrity', () => {
    const metadata = {
      versions: {
        '1.0.0': {
          dist: {
            tarball: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
            integrity: 'example-integrity',
          },
        },
      },
    }
    rewriteFirewallRegistryMetadata(
      metadata,
      target => `http://127.0.0.1/artifact${target.pathname}`,
    )
    expect(metadata.versions['1.0.0'].dist).toEqual({
      tarball: 'http://127.0.0.1/artifact/example/-/example-1.0.0.tgz',
      integrity: 'example-integrity',
    })
  })
  it.each([
    'https://private.example/example.tgz',
    'http://registry.npmjs.org/example.tgz',
    'https://registry.npmjs.org:444/example.tgz',
    'https://user@registry.npmjs.org/example.tgz',
    '//evil.example/example.tgz',
  ])('rejects external tarball %s', url => {
    expect(() => firewallRebindTarget(url)).toThrow()
  })
  it('rejects unsupported distribution URLs', () => {
    expect(() =>
      rewriteFirewallRegistryMetadata(
        { dist: { tarball: 'https://registry.npmjs.org/example.zip' } },
        String,
      ),
    ).toThrow()
  })
})
