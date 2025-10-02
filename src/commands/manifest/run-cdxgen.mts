import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { FLAG_HELP, YARN } from '../../constants.mts'
import { findUp } from '../../utils/fs.mts'
import { runShadowCommand } from '../../utils/shadow-runner.mts'
import { isYarnBerry } from '../../utils/yarn-version.mts'

import type { ShadowBinResult } from '../../shadow/npm/bin.mts'
import type { ChildProcess } from 'node:child_process'

const { PACKAGE_LOCK_JSON, PNPM_LOCK_YAML, YARN_LOCK } = constants

const nodejsPlatformTypes = new Set([
  'javascript',
  'js',
  'nodejs',
  'npm',
  'pnpm',
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
  const argvMutable = { __proto__: null, ...argvObj } as ArgvObject

  // Detect package manager based on lockfiles.
  const pnpmLockPath = await findUp(PNPM_LOCK_YAML, { onlyFiles: true })

  const npmLockPath = pnpmLockPath
    ? undefined
    : await findUp(PACKAGE_LOCK_JSON, { onlyFiles: true })

  const yarnLockPath =
    pnpmLockPath || npmLockPath
      ? undefined
      : await findUp(YARN_LOCK, { onlyFiles: true })

  const agent = pnpmLockPath
    ? 'pnpm'
    : yarnLockPath && isYarnBerry()
      ? 'yarn'
      : 'npm'

  let cleanupPackageLock = false
  if (
    yarnLockPath &&
    argvMutable['type'] !== YARN &&
    nodejsPlatformTypes.has(argvMutable['type'] as string)
  ) {
    if (npmLockPath) {
      argvMutable['type'] = 'npm'
    } else {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        const synpVersion = constants.ENV['INLINED_SOCKET_CLI_SYNP_VERSION']
        const synpPackageSpec = `synp@${synpVersion}`

        await runShadowCommand(
          synpPackageSpec,
          ['--source-file', `./${YARN_LOCK}`],
          {
            agent,
            ipc: {
              [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
              [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
                constants.SOCKET_PUBLIC_API_TOKEN,
              [constants.SOCKET_CLI_SHADOW_SILENT]: true,
            },
            stdio: 'inherit',
          },
        )

        argvMutable['type'] = 'npm'
        cleanupPackageLock = true
      } catch {}
    }
  }

  // Use appropriate package manager for cdxgen via shadow-runner.
  const cdxgenVersion =
    constants.ENV['INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION']
  const cdxgenPackageSpec = `@cyclonedx/cdxgen@${cdxgenVersion}`
  const cdxgenArgs = argvObjectToArray(argvMutable)

  // Check if this is a help/version request.
  const isHelpRequest = argvMutable['help'] || argvMutable['version']

  const result = await runShadowCommand(cdxgenPackageSpec, cdxgenArgs, {
    agent,
    ipc: {
      [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
        constants.SOCKET_PUBLIC_API_TOKEN,
      [constants.SOCKET_CLI_SHADOW_SILENT]: true,
    },
    stdio: 'inherit',
  })

  // Create fake ShadowBinResult for backward compatibility.
  // Note: Help/version requests should always exit with code 0.
  const exitCode = result.ok || isHelpRequest ? 0 : (result.code ?? 1)
  const stdioResult = {
    cmd: 'cdxgen',
    args: [] as const,
    code: exitCode,
    signal: null,
    stderr: Buffer.from(''),
    stdout: Buffer.from(result.ok ? result.data : ''),
  }

  // Create a mock ChildProcess with event emitter methods for backward compatibility.
  // The ShadowBinResult interface expects a ChildProcess, but runShadowCommand doesn't
  // return one. This mock provides the minimum EventEmitter interface needed by callers
  // while maintaining API compatibility. Each method returns 'this' to support chaining.
  const mockProcess = {
    on: () => mockProcess,
    once: () => mockProcess,
    off: () => mockProcess,
    removeListener: () => mockProcess,
  } as unknown as ChildProcess

  const shadowResult: ShadowBinResult = {
    spawnPromise: Object.assign(Promise.resolve(stdioResult), {
      process: mockProcess,
      stdin: null,
    }),
  }

  // Handle cleanup on process exit.
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

  return shadowResult
}
