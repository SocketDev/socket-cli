import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, {
  FLAG_HELP,
  FLAG_SILENT,
  NPM,
  PNPM,
  YARN,
} from '../../constants.mts'
import { findUp } from '../../utils/fs.mts'
import { isYarnBerry } from '../../utils/yarn-version.mts'

import type { ShadowBinResult } from '../../shadow/npm/bin.mts'
import type { ShadowBinOptions } from '../../shadow/npm-base.mts'
import type { ChildProcess } from 'node:child_process'

const require = createRequire(import.meta.url)

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
        const synpVersion = constants.ENV['INLINED_SOCKET_CLI_SYNP_VERSION']
        const synpArgs = [
          FLAG_SILENT,
          `synp@${synpVersion}`,
          '--source-file',
          `./${YARN_LOCK}`,
        ]

        let synpResult: ShadowBinResult
        if (agent === PNPM) {
          const shadowPnpmBin = /*@__PURE__*/ require(
            constants.shadowPnpmBinPath,
          )
          synpResult = await shadowPnpmBin(['dlx', ...synpArgs], shadowOpts)
        } else if (agent === YARN) {
          const shadowYarnBin = /*@__PURE__*/ require(
            constants.shadowYarnBinPath,
          )
          synpResult = await shadowYarnBin(['dlx', ...synpArgs], shadowOpts)
        } else {
          const shadowNpxBin = /*@__PURE__*/ require(constants.shadowNpxBinPath)
          synpResult = await shadowNpxBin(
            ['--yes', ...synpArgs.slice(1)],
            shadowOpts,
          )
        }

        await synpResult.spawnPromise
        argvMutable['type'] = NPM
        cleanupPackageLock = true
      } catch {}
    }
  }

  // Use appropriate package manager for cdxgen.
  const cdxgenVersion =
    constants.ENV['INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION']
  const cdxgenArgs = [
    `@cyclonedx/cdxgen@${cdxgenVersion}`,
    ...argvObjectToArray(argvMutable),
  ]

  let shadowResult: ShadowBinResult
  if (agent === PNPM) {
    const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)
    shadowResult = await shadowPnpmBin(
      ['dlx', FLAG_SILENT, ...cdxgenArgs],
      shadowOpts,
    )
  } else if (agent === YARN) {
    const shadowYarnBin = /*@__PURE__*/ require(constants.shadowYarnBinPath)
    shadowResult = await shadowYarnBin(
      ['dlx', '--quiet', ...cdxgenArgs],
      shadowOpts,
    )
  } else {
    const shadowNpxBin = /*@__PURE__*/ require(constants.shadowNpxBinPath)
    shadowResult = await shadowNpxBin(
      ['--yes', FLAG_SILENT, ...cdxgenArgs],
      shadowOpts,
    )
  }

  ;(shadowResult.spawnPromise.process as ChildProcess).on('exit', () => {
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
