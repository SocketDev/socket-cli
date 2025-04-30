import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import shadowBin from '../../shadow/npm/bin.mts'

const { NPM, NPX, PACKAGE_LOCK_JSON, PNPM, YARN, YARN_LOCK } = constants

const nodejsPlatformTypes = new Set([
  'javascript',
  'js',
  'nodejs',
  NPM,
  PNPM,
  'ts',
  'tsx',
  'typescript'
])

export async function runCycloneDX(yargvWithYes: any) {
  let cleanupPackageLock = false
  const { yes, ...yargv } = { __proto__: null, ...yargvWithYes } as any
  const yesArgs = yes ? ['--yes'] : []
  if (
    yargv.type !== YARN &&
    nodejsPlatformTypes.has(yargv.type) &&
    existsSync(`./${YARN_LOCK}`)
  ) {
    if (existsSync(`./${PACKAGE_LOCK_JSON}`)) {
      yargv.type = NPM
    } else {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        await shadowBin(NPX, [
          ...yesArgs,
          // Lazily access constants.ENV.INLINED_SYNP_VERSION.
          `synp@${constants.ENV.INLINED_SYNP_VERSION}`,
          '--source-file',
          `./${YARN_LOCK}`
        ])
        yargv.type = NPM
        cleanupPackageLock = true
      } catch {}
    }
  }
  await shadowBin(NPX, [
    ...yesArgs,
    // Lazily access constants.ENV.INLINED_CYCLONEDX_CDXGEN_VERSION.
    `@cyclonedx/cdxgen@${constants.ENV.INLINED_CYCLONEDX_CDXGEN_VERSION}`,
    ...argvToArray(yargv)
  ])
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
  if (argv['--']) {
    result.push('--', ...(argv as any)['--'])
  }
  return result
}
