/*
 * Narrow constants facade adapted from @socketsecurity/registry 1.1.17
 * (lib/constants/index.js and the getters used by Socket CLI).
 * Copyright (c) 2024 Socket Inc. Licensed under the MIT License.
 *
 * Keep this as a root-level, builtin-only leaf. The distribution Rollup config
 * emits it separately because constants.js must not import the shared utils.js
 * chunk during startup.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type RuntimeAbortSignal = globalThis.AbortSignal
type RuntimeAbortController = {
  signal: RuntimeAbortSignal
  abort(reason?: unknown): void
}

const sourceProps = {
  AT_LATEST: '@latest',
  BIOME_JSON: 'biome.json',
  BUN: 'bun',
  BUN_LOCK: 'bun.lock',
  BUN_LOCKB: 'bun.lockb',
  CI: 'CI',
  COLUMN_LIMIT: 80,
  DOT_GIT_DIR: '.git',
  DOT_PACKAGE_LOCK_JSON: '.package-lock.json',
  DOT_SOCKET_DIR: '.socket',
  EMPTY_FILE: '/* empty */\n',
  EMPTY_VALUE: '<value>',
  ESLINT_CONFIG_JS: 'eslint.config.js',
  ESNEXT: 'esnext',
  EXT_CJS: '.cjs',
  EXT_CMD: '.cmd',
  EXT_CTS: '.cts',
  EXT_DTS: '.d.ts',
  EXT_JS: '.js',
  EXT_JSON: '.json',
  EXT_LOCK: '.lock',
  EXT_LOCKB: '.lockb',
  EXT_MD: '.md',
  EXT_MJS: '.mjs',
  EXT_MTS: '.mts',
  EXT_PS1: '.ps1',
  EXT_YAML: '.yaml',
  EXT_YML: '.yml',
  EXTENSIONS: 'extensions',
  EXTENSIONS_JSON: 'extensions.json',
  GITIGNORE: '.gitignore',
  LATEST: 'latest',
  LICENSE: 'LICENSE',
  LICENSE_GLOB: 'LICEN[CS]E{[.-]*,}',
  LICENSE_GLOB_RECURSIVE: '**/LICEN[CS]E{[.-]*,}',
  LICENSE_ORIGINAL: 'LICENSE.original',
  LICENSE_ORIGINAL_GLOB: '*.original{.*,}',
  LICENSE_ORIGINAL_GLOB_RECURSIVE: '**/*.original{.*,}',
  LOOP_SENTINEL: 1_000_000,
  MANIFEST_JSON: 'manifest.json',
  MIT: 'MIT',
  NODE_AUTH_TOKEN: 'NODE_AUTH_TOKEN',
  NODE_ENV: 'NODE_ENV',
  NODE_MODULES: 'node_modules',
  NODE_MODULES_GLOB_RECURSIVE: '**/node_modules',
  NPM: 'npm',
  NPM_SHRINKWRAP_JSON: 'npm-shrinkwrap.json',
  NPX: 'npx',
  OVERRIDES: 'overrides',
  PACKAGE_DEFAULT_VERSION: '1.0.0',
  PACKAGE_JSON: 'package.json',
  PACKAGE_LOCK_JSON: 'package-lock.json',
  PNPM: 'pnpm',
  PNPM_LOCK_YAML: 'pnpm-lock.yaml',
  PRE_COMMIT: 'PRE_COMMIT',
  README_GLOB: 'README{.*,}',
  README_GLOB_RECURSIVE: '**/README{.*,}',
  README_MD: 'README.md',
  REGISTRY: 'registry',
  REGISTRY_SCOPE_DELIMITER: '__',
  RESOLUTIONS: 'resolutions',
  SOCKET_GITHUB_ORG: 'SocketDev',
  SOCKET_IPC_HANDSHAKE: 'SOCKET_IPC_HANDSHAKE',
  SOCKET_OVERRIDE_SCOPE: '@socketoverride',
  SOCKET_PUBLIC_API_TOKEN:
    'sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api',
  SOCKET_REGISTRY_NPM_ORG: 'socketregistry',
  SOCKET_REGISTRY_PACKAGE_NAME: '@socketsecurity/registry',
  SOCKET_REGISTRY_REPO_NAME: 'socket-registry',
  SOCKET_REGISTRY_SCOPE: '@socketregistry',
  SOCKET_SECURITY_SCOPE: '@socketsecurity',
  TSCONFIG_JSON: 'tsconfig.json',
  UNKNOWN_ERROR: 'Unknown error',
  UNKNOWN_VALUE: '<unknown>',
  UNLICENCED: 'UNLICENCED',
  UNLICENSED: 'UNLICENSED',
  UTF8: 'utf8',
  VITEST: 'VITEST',
  VLT: 'vlt',
  VLT_LOCK_JSON: 'vlt-lock.json',
  YARN: 'yarn',
  YARN_BERRY: 'yarn/berry',
  YARN_CLASSIC: 'yarn/classic',
  YARN_LOCK: 'yarn.lock',
} as const

const kInternalsSymbol = Symbol('@socketregistry.constants.internals')
const UNDEFINED_TOKEN = Symbol('registry-constants.undefined')
const ipcTarget: Record<string, unknown> = Object.create(null)
let ipcReady: Promise<Record<string, unknown>> | undefined

function getIpc<K extends string | undefined>(key?: K): Promise<unknown> {
  ipcReady ??= new Promise(resolve => {
    const finish = () => {
      process.removeListener('message', onMessage)
      abortController.signal.removeEventListener('abort', finish)
      resolve(Object.freeze(ipcTarget))
    }
    const onMessage = (message: unknown) => {
      if (message && typeof message === 'object') {
        const handshake = (message as Record<string, unknown>)[
          'SOCKET_IPC_HANDSHAKE'
        ]
        if (handshake && typeof handshake === 'object') {
          Object.assign(ipcTarget, handshake)
        }
      }
      finish()
    }
    if (typeof process.send !== 'function') {
      finish()
      return
    }
    abortController.signal.addEventListener('abort', finish, { once: true })
    process.once('message', onMessage)
    setTimeout(finish, 1_000).unref?.()
  })
  return ipcReady.then(data => (key === undefined ? data : data[key]))
}

function sortedObject<T extends Record<PropertyKey, unknown>>(value: T): T {
  const entries = Reflect.ownKeys(value).map(key => [key, value[key]] as const)
  entries.sort(([a], [b]) => String(a).localeCompare(String(b)))
  return Object.fromEntries(entries) as T
}

type ConstantAttributes<
  P extends Record<string, unknown>,
  G extends Record<string, () => unknown>,
  I extends Record<string, unknown>,
> = {
  props: Readonly<P>
  getters: Readonly<G>
  internals: Readonly<I>
}

type ConstantInternals<
  P extends Record<string, unknown>,
  G extends Record<string, () => unknown>,
  I extends Record<string, unknown>,
> = I & {
  readonly attributes: ConstantAttributes<P, G, I>
  readonly lazyGetterStats: Readonly<{ initialized: Set<string | symbol> }>
  readonly createConstantsObject: typeof createConstantsObject
  readonly getIpc: typeof getIpc
}

function createConstantsObject<
  P extends Record<string, unknown>,
  G extends Record<string, () => unknown>,
  I extends Record<string, unknown>,
>(props: P, options: { getters?: G; internals?: I } = {}) {
  const attributes: ConstantAttributes<P, G, I> = Object.freeze({
    props: Object.freeze(sortedObject({ ...props })),
    getters: Object.freeze(sortedObject({ ...options.getters } as G)),
    internals: Object.freeze(sortedObject({ ...options.internals } as I)),
  })
  const initialized = new Set<string | symbol>()
  const internal: ConstantInternals<P, G, I> = Object.freeze({
    get attributes() {
      return attributes
    },
    get lazyGetterStats() {
      return Object.freeze({ initialized })
    },
    ...attributes.internals,
    createConstantsObject,
    getIpc,
  }) as ConstantInternals<P, G, I>
  const value: Record<PropertyKey, unknown> = Object.create(null)
  Object.defineProperty(value, kInternalsSymbol, {
    enumerable: false,
    value: internal,
  })
  Object.defineProperty(value, 'kInternalsSymbol', {
    enumerable: false,
    value: kInternalsSymbol,
  })
  Object.assign(value, attributes.props)
  for (const [name, getter] of Object.entries(attributes.getters)) {
    let result: unknown = UNDEFINED_TOKEN
    Object.defineProperty(value, name, {
      enumerable: true,
      get() {
        if (result === UNDEFINED_TOKEN) {
          initialized.add(name)
          result = getter()
        }
        return result
      },
    })
  }
  return Object.freeze(value) as P & {
    readonly kInternalsSymbol: typeof kInternalsSymbol
    readonly [kInternalsSymbol]: ConstantInternals<P, G, I>
  } & {
    readonly [K in keyof G]: ReturnType<G[K]>
  }
}

const capturedEnv = process.env
const envString = (value: unknown): string =>
  typeof value === 'string' ? value : ''
const envBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string') {
    return false
  }
  return /^(?:1|true|yes|on)$/i.test(value)
}
const home = envString(capturedEnv['HOME'])
const win32 = process.platform === 'win32'
const baseEnv = Object.freeze(
  Object.assign(Object.create(null) as Record<string, unknown>, {
    APPDATA: envString(capturedEnv['APPDATA']),
    CI: Object.hasOwn(capturedEnv, 'CI'),
    DEBUG: envString(capturedEnv['DEBUG']),
    HOME: home,
    LOCALAPPDATA: envString(capturedEnv['LOCALAPPDATA']),
    LOG_LEVEL: envString(capturedEnv['LOG_LEVEL']),
    NODE_AUTH_TOKEN: envString(capturedEnv['NODE_AUTH_TOKEN']),
    NODE_ENV:
      envString(capturedEnv['NODE_ENV']).toLowerCase() === 'production'
        ? 'production'
        : 'development',
    NODE_OPTIONS: envString(capturedEnv['NODE_OPTIONS']),
    PRE_COMMIT: envBoolean(capturedEnv['PRE_COMMIT']),
    SOCKET_CLI_DEBUG:
      !!envString(capturedEnv['DEBUG']) ||
      envBoolean(capturedEnv['SOCKET_CLI_DEBUG']),
    VITEST: envBoolean(capturedEnv['VITEST']),
    XDG_DATA_HOME: win32
      ? ''
      : envString(capturedEnv['XDG_DATA_HOME']) ||
        (home ? path.join(home, '.local/share') : ''),
  }),
) as Readonly<{
  APPDATA: string
  CI: boolean
  DEBUG: string
  HOME: string
  LOCALAPPDATA: string
  LOG_LEVEL: string
  NODE_AUTH_TOKEN: string
  NODE_ENV: string
  NODE_OPTIONS: string
  PRE_COMMIT: boolean
  SOCKET_CLI_DEBUG: boolean
  VITEST: boolean
  XDG_DATA_HOME: string
}>

const abortController = new AbortController()
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
  try {
    process.once(signal, () => abortController.abort())
  } catch {
    /* unsupported signal */
  }
}
process.once('exit', () => abortController.abort())

function findOnPath(name: string): string {
  const pathExts = win32
    ? (envString(capturedEnv['PATHEXT']) || '.EXE;.CMD;.BAT').split(';')
    : ['']
  for (const directory of envString(capturedEnv['PATH']).split(
    path.delimiter,
  )) {
    if (!directory) {
      continue
    }
    for (const extension of pathExts) {
      const candidate = path.join(directory, `${name}${extension}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return name
}

function realNpm(): string {
  const nodeSibling = path.join(
    path.dirname(process.execPath),
    win32 ? 'npm.cmd' : 'npm',
  )
  if (existsSync(nodeSibling)) {
    return nodeSibling
  }
  for (const candidate of win32 ? [] : ['/usr/local/bin/npm', '/usr/bin/npm']) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return findOnPath('npm')
}

function realPnpm(): string {
  const candidates = win32
    ? [
        path.join(envString(capturedEnv['APPDATA']), 'npm/pnpm.cmd'),
        path.join(envString(capturedEnv['LOCALAPPDATA']), 'pnpm/pnpm.cmd'),
      ]
    : [
        '/usr/local/bin/pnpm',
        '/usr/bin/pnpm',
        path.join(baseEnv.XDG_DATA_HOME, 'pnpm/pnpm'),
        path.join(home, '.pnpm/pnpm'),
      ]
  return candidates.find(existsSync) ?? findOnPath('pnpm')
}

const nodeVersion = process.version
const versionParts = /^v?(\d+)\.(\d+)/.exec(nodeVersion)
const nodeMajor = Number(versionParts?.[1] ?? 0)
const nodeMinor = Number(versionParts?.[2] ?? 0)
const supportsPermissionFlag =
  nodeMajor >= 23 || (nodeMajor === 22 && nodeMinor >= 13)
const noWarningsFlags = process.allowedNodeEnvironmentFlags.has(
  '--disable-warning',
)
  ? [
      '--disable-warning',
      'DeprecationWarning',
      '--disable-warning',
      'ExperimentalWarning',
    ]
  : ['--no-warnings']
const runtimeRoot = () => {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}
const require = createRequire(import.meta.url)

const baseGetters = {
  abortSignal: (): RuntimeAbortSignal => abortController.signal,
  execPath: () => process.execPath,
  maintainedNodeVersions: () =>
    Object.freeze(
      Object.assign(['18.20.8', '20.19.1', '22.19.0', '24.8.0'], {
        last: '18.20.8',
        previous: '20.19.1',
        current: '22.19.0',
        next: '24.8.0',
      }),
    ),
  NODE_VERSION: () => nodeVersion,
  nodeNoWarningsFlags: () => Object.freeze(noWarningsFlags),
  npmExecPath: realNpm,
  npmRealExecPath: () => {
    const npmPath = realNpm()
    const nodeDirectory = path.dirname(process.execPath)
    const candidates = [
      path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
      path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
      path.resolve(
        path.dirname(npmPath),
        '../lib/node_modules/npm/bin/npm-cli.js',
      ),
    ]
    return candidates.find(existsSync) ?? npmPath
  },
  pnpmExecPath: realPnpm,
  spinner: () => {
    const spinnerModule = require(
      path.join(runtimeRoot(), 'dist/spinner.js'),
    ) as {
      default?: import('./utils/spinner.mts').Spinner
      defaultSpinner?: import('./utils/spinner.mts').Spinner
    }
    // Rollup's CommonJS output exposes this default export as `defaultSpinner`.
    // Keep `default` for runtimes that preserve native ESM interop.
    const spinner = spinnerModule.default ?? spinnerModule.defaultSpinner
    if (!spinner) {
      throw new Error('The built Socket CLI spinner export is missing')
    }
    return spinner
  },
  SUPPORTS_NODE_PERMISSION_FLAG: () => supportsPermissionFlag,
  SUPPORTS_NODE_COMPILE_CACHE_ENV_VAR: () =>
    nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 1),
  WIN32: () => win32,
  abortController: (): RuntimeAbortController => abortController,
  DARWIN: () => process.platform === 'darwin',
  ENV: () => baseEnv,
}

const registryConstants = createConstantsObject(sourceProps, {
  getters: baseGetters,
  internals: { createConstantsObject, getIpc },
})

const registryConstantsAttribs = registryConstants[kInternalsSymbol].attributes

export {
  createConstantsObject,
  getIpc,
  kInternalsSymbol,
  registryConstantsAttribs,
}
export type RegistryConstants = typeof registryConstants
export type RegistryEnv = typeof baseEnv
export type RegistryInternals =
  (typeof registryConstants)[typeof kInternalsSymbol]
export default registryConstants
