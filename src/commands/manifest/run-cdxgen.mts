import { EventEmitter } from 'node:events'
import { existsSync, promises as fs, rmSync } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { FLAG_HELP, NPM, PNPM, YARN } from '../../constants.mts'
import { runCdxgen as runEmbeddedCdxgen } from '../../sea/adapters/cdxgen.mts'
import {
  convertYarnClassicToNpmLock,
  removeOwnedPackageLock,
} from '../../sea/adapters/synp.mts'
import {
  assertEmbeddedToolAvailable,
  isStandaloneSea,
} from '../../sea/runtime.mts'
import { spawnCdxgenDlx, spawnSynpDlx } from '../../utils/dlx.mts'
import { findUp } from '../../utils/fs.mts'
import { isYarnBerry } from '../../utils/yarn-version.mts'

import type { ShadowBinResult } from '../../shadow/npm/bin.mts'
import type { DlxOptions } from '../../utils/dlx.mts'

const { PACKAGE_LOCK_JSON, PNPM_LOCK_YAML, YARN_LOCK } = constants

const nodejsPlatformTypes = new Set([
  'javascript',
  'js',
  'nodejs',
  NPM,
  PNPM,
  'ts',
  'tsx',
  'typescript',
])

export type ArgvObject = {
  [key: string]: boolean | null | number | string | Array<string | number>
}

function argvObjectToArray(argvObj: ArgvObject): string[] {
  if (argvObj['help']) {
    return [FLAG_HELP]
  }
  const result = []
  for (const { 0: key, 1: value } of Object.entries(argvObj)) {
    if (key === '_' || key === '--') {
      continue
    }
    if (key === 'babel' || key === 'install-deps' || key === 'validate') {
      // cdxgen documents no-babel, no-install-deps, and no-validate flags so
      // use them when relevant.
      result.push(`--${value ? key : `no-${key}`}`)
    } else if (value === true) {
      result.push(`--${key}`)
    } else if (typeof value === 'string') {
      result.push(`--${key}`, String(value))
    } else if (Array.isArray(value)) {
      result.push(`--${key}`, ...value.map(String))
    }
  }
  const pathArgs = argvObj['_'] as string[]
  if (Array.isArray(pathArgs)) {
    result.push(...pathArgs)
  }
  const argsAfterDoubleHyphen = argvObj['--'] as string[]
  if (Array.isArray(argsAfterDoubleHyphen)) {
    result.push('--', ...argsAfterDoubleHyphen)
  }
  return result
}

export async function runCdxgen(argvObj: ArgvObject): Promise<ShadowBinResult> {
  if (isStandaloneSea()) {
    const unsupported = new Set([
      'deep',
      'evidence',
      'include-formulation',
      'include-crypto',
      'install-deps',
      'multi-project',
      'recurse',
      'server',
      'export-proto',
      'proto-bin-file',
      'profile',
      'feature-flags',
      'filter',
      'only',
      'technique',
      'standard',
      'exclude-type',
      'babel',
      'validate',
    ])
    for (const key of Object.keys(argvObj)) {
      if (unsupported.has(key)) {
        const value = argvObj[key]
        if (value !== false && value !== undefined && value !== null) {
          throw new Error(
            `The standalone cdxgen build does not support --${key}.`,
          )
        }
      } else if (
        !['_', '--', 'output', 'type', 'lifecycle', 'help'].includes(key)
      ) {
        throw new Error(
          `The standalone cdxgen build does not support --${key}.`,
        )
      }
    }
    if (argvObj['help']) {
      throw new Error('Help output is handled before cdxgen execution.')
    }
    if (argvObj['lifecycle'] && argvObj['lifecycle'] !== 'pre-build') {
      throw new Error(
        'The standalone cdxgen build supports only the pre-build lifecycle.',
      )
    }
    if (
      argvObj['type'] &&
      ![
        'npm',
        'nodejs',
        'javascript',
        'js',
        'typescript',
        'ts',
        'tsx',
      ].includes(String(argvObj['type']).toLowerCase())
    ) {
      throw new Error('The standalone cdxgen build supports only npm projects.')
    }

    const positional = Array.isArray(argvObj['_']) ? argvObj['_'] : []
    if (
      positional.length > 1 ||
      (positional[0] && path.resolve(String(positional[0])) !== process.cwd())
    ) {
      throw new Error(
        'The standalone cdxgen build supports one project at the current working directory.',
      )
    }
    if (Array.isArray(argvObj['--']) && argvObj['--'].length) {
      throw new Error(
        'The standalone cdxgen build does not support arguments after --.',
      )
    }

    const root = process.cwd()
    const packageLockPath = path.join(root, PACKAGE_LOCK_JSON)
    const yarnLockPath = path.join(root, YARN_LOCK)
    if (
      existsSync(path.join(root, 'npm-shrinkwrap.json')) ||
      existsSync(path.join(root, 'rush.json')) ||
      existsSync(path.join(root, PNPM_LOCK_YAML))
    ) {
      throw new Error(
        'The standalone cdxgen build supports one npm or Yarn Classic project without shrinkwrap, pnpm, or Rush configuration.',
      )
    }
    let packageJson: {
      workspaces?: unknown
      workspace?: unknown
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
      optionalDependencies?: Record<string, unknown>
      peerDependencies?: Record<string, unknown>
    }
    try {
      packageJson = JSON.parse(
        await fs.readFile(path.join(root, 'package.json'), 'utf8'),
      ) as typeof packageJson
    } catch {
      throw new Error(
        'The standalone cdxgen build requires a valid root package.json.',
      )
    }
    if (
      !packageJson ||
      typeof packageJson !== 'object' ||
      Array.isArray(packageJson)
    ) {
      throw new Error(
        'The standalone cdxgen build requires a valid root package.json object.',
      )
    }
    if (packageJson.workspaces || packageJson.workspace) {
      throw new Error(
        'The standalone cdxgen build does not support workspaces.',
      )
    }
    const localDependency = (value: unknown): boolean =>
      typeof value === 'string' && /^(?:file:|link:|workspace:)/i.test(value)
    for (const group of [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.optionalDependencies,
      packageJson.peerDependencies,
    ]) {
      if (Object.values(group ?? {}).some(localDependency)) {
        throw new Error(
          'The standalone cdxgen build does not support local or workspace dependencies.',
        )
      }
    }

    const hasPackageLock = existsSync(packageLockPath)
    const hasYarnLock = existsSync(yarnLockPath)
    if (hasPackageLock && hasYarnLock) {
      throw new Error(
        'The standalone cdxgen build does not support projects with both npm and Yarn lockfiles.',
      )
    }
    let generatedLock:
      | Awaited<ReturnType<typeof convertYarnClassicToNpmLock>>
      | undefined
    const abortController = new AbortController()
    const onSigint = () =>
      abortController.abort(
        Object.assign(new Error('Interrupted'), { code: 'SIGINT' }),
      )
    const onSigterm = () =>
      abortController.abort(
        Object.assign(new Error('Terminated'), { code: 'SIGTERM' }),
      )
    const onSighup = () =>
      abortController.abort(
        Object.assign(new Error('Hangup'), { code: 'SIGHUP' }),
      )
    let signalHandlersInstalled = false
    const installSignalHandlers = () => {
      if (signalHandlersInstalled) {
        return
      }
      signalHandlersInstalled = true
      process.once('SIGINT', onSigint)
      process.once('SIGTERM', onSigterm)
      process.once('SIGHUP', onSighup)
    }
    const removeSignalHandlers = () => {
      if (!signalHandlersInstalled) {
        return
      }
      signalHandlersInstalled = false
      process.removeListener('SIGINT', onSigint)
      process.removeListener('SIGTERM', onSigterm)
      process.removeListener('SIGHUP', onSighup)
    }
    if (hasPackageLock) {
      let lock: { lockfileVersion?: number }
      try {
        lock = JSON.parse(await fs.readFile(packageLockPath, 'utf8')) as {
          lockfileVersion?: number
        }
      } catch {
        throw new Error(
          'The standalone cdxgen build requires a valid npm package-lock.json.',
        )
      }
      if (lock.lockfileVersion !== 3) {
        throw new Error(
          'The standalone cdxgen build requires npm package-lock v3; only Yarn Classic conversion uses v1.',
        )
      }
      assertEmbeddedToolAvailable('cdxgen', 'manifest-cdxgen-npm-lock-v3')
    } else if (hasYarnLock) {
      const yarnText = await fs.readFile(yarnLockPath, 'utf8')
      if (
        !/^# yarn lockfile v1(?:\r?\n|$)/m.test(yarnText) ||
        /^__metadata:\s*$/m.test(yarnText) ||
        existsSync(path.join(root, '.yarnrc.yml'))
      ) {
        throw new Error(
          'The standalone cdxgen build supports Yarn Classic lockfile v1 only; Yarn Berry is unavailable.',
        )
      }
      if (!existsSync(path.join(root, 'node_modules'))) {
        throw new Error(
          'Yarn Classic conversion requires an existing node_modules directory.',
        )
      }
      assertEmbeddedToolAvailable('cdxgen', 'manifest-cdxgen-yarn-classic')
      assertEmbeddedToolAvailable('synp')
      installSignalHandlers()
      try {
        generatedLock = await convertYarnClassicToNpmLock(
          root,
          abortController.signal,
        )
      } catch (error) {
        removeSignalHandlers()
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason as { code?: unknown }
          if (typeof reason?.code === 'string') {
            if (isStandaloneSea()) {
              await removeOwnedPackageLock(generatedLock)
              const canceled = Promise.resolve({
                code: null,
                signal: reason.code as NodeJS.Signals,
                cancelled: true,
              }) as unknown as ShadowBinResult['spawnPromise']
              Object.defineProperty(canceled, 'process', {
                value: new EventEmitter(),
              })
              return { spawnPromise: canceled }
            }
            process.kill(process.pid, reason.code as NodeJS.Signals)
          }
        }
        throw error
      }
    } else {
      throw new Error(
        'The standalone cdxgen build requires npm package-lock v3 or Yarn Classic lockfile v1 with node_modules.',
      )
    }

    const output =
      typeof argvObj['output'] === 'string'
        ? argvObj['output']
        : 'socket-cdx.json'
    const outputPath = output === '-' ? '-' : path.resolve(root, output)
    if (generatedLock && outputPath === packageLockPath) {
      await removeOwnedPackageLock(generatedLock)
      removeSignalHandlers()
      throw new Error(
        'The standalone cdxgen build cannot use package-lock.json as the SBOM output path.',
      )
    }
    installSignalHandlers()
    try {
      const embedded = await runEmbeddedCdxgen(
        root,
        outputPath,
        { stdio: 'inherit', signal: abortController.signal },
        async () => {
          removeSignalHandlers()
          await removeOwnedPackageLock(generatedLock)
        },
      )
      return embedded as ShadowBinResult
    } catch (error) {
      removeSignalHandlers()
      await removeOwnedPackageLock(generatedLock)
      throw error
    }
  }

  const argvMutable = { __proto__: null, ...argvObj } as ArgvObject

  const shadowOpts: DlxOptions = {
    ipc: {
      [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
        constants.SOCKET_PUBLIC_API_TOKEN,
      [constants.SOCKET_CLI_SHADOW_SILENT]: true,
    },
    stdio: 'inherit',
  }

  // Detect package manager based on lockfiles.
  const pnpmLockPath = await findUp(PNPM_LOCK_YAML, { onlyFiles: true })

  const npmLockPath = pnpmLockPath
    ? undefined
    : await findUp(PACKAGE_LOCK_JSON, { onlyFiles: true })

  const yarnLockPath =
    pnpmLockPath || npmLockPath
      ? undefined
      : await findUp(YARN_LOCK, { onlyFiles: true })

  const agent = pnpmLockPath ? PNPM : yarnLockPath && isYarnBerry() ? YARN : NPM

  let cleanupPackageLock = false
  if (
    yarnLockPath &&
    argvMutable['type'] !== YARN &&
    nodejsPlatformTypes.has(argvMutable['type'] as string)
  ) {
    if (npmLockPath) {
      argvMutable['type'] = NPM
    } else {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        const synpResult = await spawnSynpDlx(
          ['--source-file', `./${YARN_LOCK}`],
          {
            ...shadowOpts,
            agent,
          },
        )
        await synpResult.spawnPromise
        argvMutable['type'] = NPM
        cleanupPackageLock = true
      } catch {}
    }
  }

  // Use appropriate package manager for cdxgen.
  const shadowResult = await spawnCdxgenDlx(argvObjectToArray(argvMutable), {
    ...shadowOpts,
    agent,
  })

  shadowResult.spawnPromise.process.on('exit', () => {
    if (cleanupPackageLock) {
      try {
        // TODO: Consider using trash instead of rmSync for safer deletion.
        // This removes the temporary package-lock.json we created for cdxgen.
        rmSync(`./${PACKAGE_LOCK_JSON}`)
      } catch {}
    }

    const outputPath = argvMutable['output'] as string
    if (outputPath) {
      const fullOutputPath = path.join(process.cwd(), outputPath)
      if (existsSync(fullOutputPath)) {
        logger.log(colors.cyanBright(`${outputPath} created!`))
      }
    }
  })

  return shadowResult
}
