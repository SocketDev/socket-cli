import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import shadowBin from '../../shadow/npm/bin.mts'

const { PACKAGE_LOCK_JSON, PNPM, YARN, YARN_LOCK } = constants

const nodejsPlatformTypes = new Set([
  'javascript',
  'js',
  'nodejs',
  'npm',
  PNPM,
  'ts',
  'tsx',
  'typescript',
])

function argvToArray(argv: {
  [key: string]: boolean | null | number | string | Array<string | number>
}): string[] {
  if (argv['help']) {
    return ['--help']
  }
  const result = []
  for (const { 0: key, 1: value } of Object.entries(argv)) {
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
  const pathArgs = argv['_'] as string[]
  if (Array.isArray(pathArgs)) {
    result.push(...pathArgs)
  }
  const argsAfterDoubleHyphen = argv['--'] as string[]
  if (Array.isArray(argsAfterDoubleHyphen)) {
    result.push('--', ...argsAfterDoubleHyphen)
  }
  return result
}

export async function runCdxgen(yargvWithYes: any) {
  let cleanupPackageLock = false
  const { yes, ...yargv } = { __proto__: null, ...yargvWithYes } as any
  const yesArgs = yes ? ['--yes'] : []
  if (
    yargv.type !== YARN &&
    nodejsPlatformTypes.has(yargv.type) &&
    existsSync(`./${YARN_LOCK}`)
  ) {
    if (existsSync(`./${PACKAGE_LOCK_JSON}`)) {
      yargv.type = 'npm'
    } else {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        await shadowBin(
          'npx',
          [
            ...yesArgs,
            // Lazily access constants.ENV.INLINED_SOCKET_CLI_SYNP_VERSION.
            `synp@${constants.ENV.INLINED_SOCKET_CLI_SYNP_VERSION}`,
            '--source-file',
            `./${YARN_LOCK}`,
          ],
          {
            stdio: 'inherit',
          },
        )
        yargv.type = 'npm'
        cleanupPackageLock = true
      } catch {}
    }
  }
  await shadowBin(
    'npx',
    [
      ...yesArgs,
      // Lazily access constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION.
      `@cyclonedx/cdxgen@${constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION}`,
      ...argvToArray(yargv),
    ],
    {
      stdio: 'inherit',
    },
  )
  if (cleanupPackageLock) {
    try {
      await fs.rm(`./${PACKAGE_LOCK_JSON}`)
    } catch {}
  }
  const fullOutputPath = path.join(process.cwd(), yargv.output)
  if (existsSync(fullOutputPath)) {
    logger.log(colors.cyanBright(`${yargv.output} created!`))
  }
}
