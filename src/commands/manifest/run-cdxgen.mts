import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import shadowBin from '../../shadow/npm/bin.mts'

const { PACKAGE_LOCK_JSON, YARN, YARN_LOCK } = constants

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

export async function runCdxgen(argvObj: ArgvObject) {
  let cleanupPackageLock = false
  const argvMutable = { __proto__: null, ...argvObj } as ArgvObject
  if (
    argvMutable['type'] !== YARN &&
    nodejsPlatformTypes.has(argvMutable['type'] as string) &&
    existsSync(`./${YARN_LOCK}`)
  ) {
    if (existsSync(`./${PACKAGE_LOCK_JSON}`)) {
      argvMutable['type'] = 'npm'
    } else {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        await shadowBin(
          'npx',
          [
            '--yes',
            `synp@${constants.ENV.INLINED_SOCKET_CLI_SYNP_VERSION}`,
            '--source-file',
            `./${YARN_LOCK}`,
          ],
          {
            apiToken: constants.SOCKET_PUBLIC_API_TOKEN,
            stdio: 'inherit',
          },
        )
        argvMutable['type'] = 'npm'
        cleanupPackageLock = true
      } catch {}
    }
  }
  await shadowBin(
    'npx',
    [
      '--yes',
      `@cyclonedx/cdxgen@${constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION}`,
      ...argvToArray(argvMutable),
    ],
    {
      apiToken: constants.SOCKET_PUBLIC_API_TOKEN,
      stdio: 'inherit',
    },
  )
  if (cleanupPackageLock) {
    try {
      await fs.rm(`./${PACKAGE_LOCK_JSON}`)
    } catch {}
  }
  const fullOutputPath = path.join(
    process.cwd(),
    argvMutable['output'] as string,
  )
  if (existsSync(fullOutputPath)) {
    logger.log(colors.cyanBright(`${argvMutable['output']} created!`))
  }
}
