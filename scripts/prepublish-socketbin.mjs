/**
 * @fileoverview Prepares @socketbin/* binary packages for publishing.
 * Updates package.json with version and buildMethod, removes private field.
 * Binary is already in place from SEA build (following biome convention).
 */

import { existsSync } from 'node:fs'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  getSocketbinBinaryPath,
  getSocketbinPackageDir,
} from 'package-builder/scripts/paths.mjs'
import {
  generateDatetimeVersion,
  preparePackageForPublish,
  readBaseVersion,
} from 'package-builder/scripts/utils/prepare-package.mjs'

const logger = getDefaultLogger()

const { values } = parseArgs({
  options: {
    arch: { type: 'string' },
    dev: { type: 'boolean' },
    libc: { type: 'string' },
    method: { default: 'sea', type: 'string' },
    platform: { type: 'string' },
    prod: { type: 'boolean' },
    version: { type: 'string' },
  },
})

const {
  arch,
  libc,
  method: buildMethod,
  platform,
  version: providedVersion,
} = values

if (!platform || !arch) {
  logger.error(
    'Usage: prepublish-socketbin.mjs --platform=darwin --arch=arm64 [--version=0.0.0-20250122.143052] [--method=sea]',
  )
  process.exitCode = 1
} else {
  // Get package directory from centralized paths.
  const packageDir = getSocketbinPackageDir(platform, arch, libc)

  // Verify binary exists (should be built by SEA build).
  const binaryPath = getSocketbinBinaryPath(platform, arch, libc)
  if (!existsSync(binaryPath)) {
    logger.error(`Binary not found at ${binaryPath}`)
    logger.error('Run SEA build first: pnpm run build:sea')
    process.exitCode = 1
  } else {
    // Determine version: use provided, or generate datetime-based version.
    const version = providedVersion
      ? providedVersion.replace(/^v/, '')
      : generateDatetimeVersion(readBaseVersion(packageDir))

    // Prepare package for publishing.
    const { name } = preparePackageForPublish(packageDir, {
      buildMethod,
      version,
    })

    logger.log(`  Version: ${version}`)
    logger.log(`  Build method: ${buildMethod}`)
    logger.log(`  Binary: ${binaryPath}`)
    logger.log(`\nPackage ready for publishing at: ${packageDir}`)
    logger.log(
      `\nTo publish:\n  cd ${packageDir}\n  npm publish --provenance --access public`,
    )
  }
}
