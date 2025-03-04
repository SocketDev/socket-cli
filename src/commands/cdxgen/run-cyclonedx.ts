import { promises as fs } from 'fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import shadowBin from '../../shadow/shadow-bin'

const { NPM, NPX, PNPM } = constants

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

export async function runCycloneDX(yargv: any) {
  let cleanupPackageLock = false
  if (
    yargv.type !== 'yarn' &&
    nodejsPlatformTypes.has(yargv.type) &&
    existsSync('./yarn.lock')
  ) {
    if (existsSync('./package-lock.json')) {
      yargv.type = NPM
    } else {
      // Use synp to create a package-lock.json from the yarn.lock,
      // based on the node_modules folder, for a more accurate SBOM.
      try {
        await shadowBin(
          NPX,
          ['synp@1.9.14', '--', '--source-file', './yarn.lock'],
          2
        )
        yargv.type = NPM
        cleanupPackageLock = true
      } catch {}
    }
  }
  await shadowBin(
    NPX,
    ['@cyclonedx/cdxgen@11.2.0', '--', ...argvToArray(yargv)],
    2
  )
  if (cleanupPackageLock) {
    try {
      await fs.rm('./package-lock.json')
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
  if (argv['help']) return ['--help']
  const result = []
  for (const { 0: key, 1: value } of Object.entries(argv)) {
    if (key === '_' || key === '--') continue
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
