import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { NPM, PNPM } from '../../constants.mts'
import shadowBin from '../../shadow/npm/bin.mts'
import { findUp } from '../../utils/fs.mts'
import { isYarnBerry } from '../../utils/yarn-version.mts'

const require = createRequire(import.meta.url)

import type {
  ShadowBinOptions,
  ShadowBinResult,
} from '../../shadow/npm/bin.mts'

const { PACKAGE_LOCK_JSON, PNPM_LOCK_YAML, YARN, YARN_LOCK } = constants

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

function argvToArray(argvObj: ArgvObject): string[] {
  if (argvObj['help']) {
    return ['--help']
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

  const shadowOpts: ShadowBinOptions = {
    ipc: {
      [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
        constants.SOCKET_PUBLIC_API_TOKEN,
      [constants.SOCKET_CLI_SHADOW_SILENT]: true,
    },
    stdio: 'inherit',
  }

  // Detect package manager based on lockfiles
  const pnpmLockPath = await findUp(PNPM_LOCK_YAML, { onlyFiles: true })
  const npmLockPath = pnpmLockPath
    ? undefined
    : await findUp(PACKAGE_LOCK_JSON, { onlyFiles: true })
  const yarnLockPath =
    pnpmLockPath || npmLockPath
      ? undefined
      : await findUp(YARN_LOCK, { onlyFiles: true })

  let cleanupPackageLock = false
  if (
    argvMutable['type'] !== YARN &&
    nodejsPlatformTypes.has(argvMutable['type'] as string) &&
    yarnLockPath
  ) {
    if (npmLockPath) {
      argvMutable['type'] = NPM
    } else {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        const useYarnBerry = isYarnBerry()
        let args: string[]
        let synpPromise

        if (pnpmLockPath) {
          args = [
            'dlx',
            `synp@${constants.ENV.INLINED_SOCKET_CLI_SYNP_VERSION}`,
            '--source-file',
            `./${YARN_LOCK}`,
          ]
          const shadowPnpmBin = /*@__PURE__*/ require(
            constants.shadowPnpmBinPath,
          )
          synpPromise = (await shadowPnpmBin(args, shadowOpts)).spawnPromise
        } else if (useYarnBerry) {
          args = [
            'dlx',
            `synp@${constants.ENV.INLINED_SOCKET_CLI_SYNP_VERSION}`,
            '--source-file',
            `./${YARN_LOCK}`,
          ]
          const shadowYarnBin = /*@__PURE__*/ require(
            constants.shadowYarnBinPath,
          )
          synpPromise = (await shadowYarnBin(args, shadowOpts)).spawnPromise
        } else {
          args = [
            'exec',
            '--yes',
            `synp@${constants.ENV.INLINED_SOCKET_CLI_SYNP_VERSION}`,
            '--source-file',
            `./${YARN_LOCK}`,
          ]
          synpPromise = (await shadowBin('npm', args, shadowOpts)).spawnPromise
        }

        await synpPromise
        argvMutable['type'] = NPM
        cleanupPackageLock = true
      } catch {}
    }
  }

  // Use appropriate package manager for cdxgen
  let shadowResult
  if (pnpmLockPath) {
    const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)
    shadowResult = await shadowPnpmBin(
      [
        'dlx',
        `@cyclonedx/cdxgen@${constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION}`,
        ...argvToArray(argvMutable),
      ],
      shadowOpts,
    )
  } else if (yarnLockPath && isYarnBerry()) {
    const shadowYarnBin = /*@__PURE__*/ require(constants.shadowYarnBinPath)
    shadowResult = await shadowYarnBin(
      [
        'dlx',
        `@cyclonedx/cdxgen@${constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION}`,
        ...argvToArray(argvMutable),
      ],
      shadowOpts,
    )
  } else {
    shadowResult = await shadowBin(
      'npm',
      [
        'exec',
        '--yes',
        `@cyclonedx/cdxgen@${constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION}`,
        '--',
        ...argvToArray(argvMutable),
      ],
      shadowOpts,
    )
  }

  shadowResult.spawnPromise.process.on('exit', () => {
    if (cleanupPackageLock) {
      try {
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
