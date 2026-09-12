import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'

import {
  canonicalizePath,
  defaultProtectedRoot,
  findEnvPathValue,
  isPathWithinRoot,
  isRunnableFile,
  resolveTrustedExecutable,
} from '../../util/trusted-executable.mts'

export interface FirewallExecutableOptions {
  cwd?: string | undefined
  env?: Readonly<Record<string, string | undefined>> | undefined
  windows?: boolean | undefined
}

export interface FirewallExecutable {
  executable: string
  prefixArgs: string[]
  searchPath: string
}

const PACKAGE_MANAGER_ENTRIES: Readonly<Record<string, readonly string[]>> = {
  npm: ['npm', 'bin', 'npm-cli.js'],
  npx: ['npm', 'bin', 'npx-cli.js'],
  pnpm: ['pnpm', 'bin', 'pnpm.cjs'],
  yarn: ['yarn', 'bin', 'yarn.js'],
}

export async function readWindowsFirewallShim(
  shim: string,
  command: string,
): Promise<string | undefined> {
  try {
    const content = await readFile(shim, 'utf8')
    const expected = path.join(
      'node_modules',
      ...PACKAGE_MANAGER_ENTRIES[command]!,
    )
    const normalized = content.replaceAll('\\', '/')
    if (!normalized.includes(`%dp0%/${expected.split(path.sep).join('/')}`)) {
      return undefined
    }
    const entry = await canonicalizePath(
      path.join(path.dirname(shim), expected),
    )
    return entry && (await stat(entry)).isFile() ? entry : undefined
  } catch {
    return undefined
  }
}

export async function resolveExplicitFirewallExecutable(
  command: string,
  config: { cwd: string; windows: boolean; searchPath: string },
): Promise<FirewallExecutable | undefined> {
  const { cwd, windows, searchPath } = {
    __proto__: null,
    ...config,
  } as typeof config
  const executable = await canonicalizePath(path.resolve(cwd, command))
  if (!executable || !(await isRunnableFile(executable, { windows }))) {
    return undefined
  }
  if (windows && !/\.(?:com|exe)$/iu.test(executable)) {
    return undefined
  }
  return { executable, prefixArgs: [], searchPath }
}

export async function resolveFirewallExecutable(
  command: string,
  options: FirewallExecutableOptions = {},
): Promise<FirewallExecutable | undefined> {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const windows = options.windows ?? isWin32()
  const root = await defaultProtectedRoot(cwd)
  const trusted = await resolveTrustedExecutable(command, env, root, {
    windows,
  })
  const explicit = command.includes('/') || command.includes('\\')
  if (trusted && !explicit) {
    return {
      executable: trusted.executable,
      prefixArgs: [],
      searchPath: findEnvPathValue(trusted.environment) ?? '',
    }
  }
  const anchor = await resolveTrustedExecutable(process.execPath, env, root, {
    windows,
  })
  const searchPath = findEnvPathValue(anchor?.environment ?? {}) ?? ''
  if (explicit) {
    return resolveExplicitFirewallExecutable(command, {
      cwd,
      windows,
      searchPath,
    })
  }
  if (!windows || !Object.hasOwn(PACKAGE_MANAGER_ENTRIES, command)) {
    return undefined
  }
  return resolveWindowsFirewallPackageManager(command, {
    env,
    root,
    searchPath,
  })
}

export async function resolveWindowsFirewallPackageManager(
  command: string,
  config: {
    env: Readonly<Record<string, string | undefined>>
    root: string
    searchPath: string
  },
): Promise<FirewallExecutable | undefined> {
  const node = await resolveTrustedExecutable('node', config.env, config.root, {
    windows: true,
  })
  if (!node) {
    return undefined
  }
  const nodeSearchPath = findEnvPathValue(node.environment) ?? ''
  const directories = config.searchPath.split(path.delimiter).filter(Boolean)
  for (let i = 0, { length } = directories; i < length; i += 1) {
    const directory = directories[i]!
    const shim = await canonicalizePath(path.join(directory, `${command}.cmd`))
    if (
      !shim ||
      isPathWithinRoot(config.root, shim) ||
      !isPathWithinRoot(directory, shim)
    ) {
      continue
    }
    const entry = await readWindowsFirewallShim(shim, command)
    if (
      !entry ||
      isPathWithinRoot(config.root, entry) ||
      !isPathWithinRoot(directory, entry)
    ) {
      continue
    }
    return {
      executable: node.executable,
      prefixArgs: [entry],
      searchPath: nodeSearchPath,
    }
  }
  return undefined
}
