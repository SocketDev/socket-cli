import { constants, existsSync, fstatSync } from 'node:fs'
import { open } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { FirewallEnvironment } from './environment.mts'

export function addFirewallRegistryArgument(
  args: readonly string[],
  registry: string,
): string[] {
  const separator = args.indexOf('--')
  const index = separator < 0 ? args.length : separator
  return [...args.slice(0, index), '--registry', registry, ...args.slice(index)]
}

export function firewallVltConfigHome(
  env: FirewallEnvironment,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env['XDG_CONFIG_HOME']) {
    return env['XDG_CONFIG_HOME']
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Preferences')
  }
  if (platform === 'win32') {
    return path.join(
      env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'),
      'xdg.config',
    )
  }
  return path.join(home, '.config')
}

export function hasFirewallRegistrySetting(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  const config = (value as Record<string, unknown>)['config']
  if (!config || typeof config !== 'object') {
    return false
  }
  const record = config as Record<string, unknown>
  if ('registry' in record || 'registries' in record) {
    return true
  }
  const commands = record['command']
  if (!commands || typeof commands !== 'object') {
    return false
  }
  return Object.values(commands).some(
    selected =>
      !!selected &&
      typeof selected === 'object' &&
      ('registry' in selected || 'registries' in selected),
  )
}

export function isFirewallRebindCommand(command: string): boolean {
  return (
    path.win32
      .basename(command)
      .toLowerCase()
      .replace(/\.(?:bat|cmd|exe|ps1)$/, '') === 'vlt'
  )
}

export async function readFirewallVltConfig(
  filename: string,
): Promise<unknown> {
  try {
    const file = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      const metadata = fstatSync(file.fd)
      if (!metadata.isFile()) {
        throw new Error('vlt configuration must be a regular file')
      }
      const buffer = Buffer.alloc(1_048_577)
      const { bytesRead } = await file.read(buffer)
      if (bytesRead > 1_048_576) {
        throw new Error('vlt configuration exceeds the supported size')
      }
      return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
    } finally {
      await file.close()
    }
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }
    throw error
  }
}

export async function validateFirewallRebindConfig(config: {
  args: readonly string[]
  cwd?: string | undefined
  env: FirewallEnvironment
}): Promise<void> {
  const opts = { __proto__: null, ...config } as typeof config
  const separator = opts.args.indexOf('--')
  const args = separator < 0 ? opts.args : opts.args.slice(0, separator)
  if (
    args.some(arg =>
      ['--registry', '--registries'].includes(arg.split('=')[0]!),
    ) ||
    opts.env['VLT_REGISTRY'] ||
    opts.env['VLT_REGISTRIES']
  ) {
    throw new Error(
      'Socket Firewall cannot protect vlt with a registry override. Remove the override or use a proxy-aware package manager.',
    )
  }
  const home = opts.env['HOME'] ?? os.homedir()
  let directory = path.resolve(opts.cwd ?? process.cwd())
  for (;;) {
    if (directory === home) {
      break
    }
    const loadedConfig = await readFirewallVltConfig(
      path.join(directory, 'vlt.json'),
    )
    if (loadedConfig !== undefined) {
      if (hasFirewallRegistrySetting(loadedConfig)) {
        throw new Error(
          'Socket Firewall cannot override the project vlt registry. Use a proxy-aware package manager for this configuration.',
        )
      }
      break
    }
    if (existsSync(path.join(directory, '.git'))) {
      break
    }
    const parent = path.dirname(directory)
    if (parent === directory) {
      break
    }
    directory = parent
  }
  const configHome = firewallVltConfigHome(opts.env, home)
  const loadedConfig = await readFirewallVltConfig(
    path.join(configHome, 'vlt', 'vlt.json'),
  )
  if (hasFirewallRegistrySetting(loadedConfig)) {
    throw new Error(
      'Socket Firewall cannot override the user vlt registry. Use a proxy-aware package manager for this configuration.',
    )
  }
}
