/**
 * Generate socketbin package directories from template.
 * Creates package directories for each platform/arch combination
 * that will be used for binary distribution via npm.
 *
 * Usage:
 *   node scripts/generate-socketbin-packages.mjs
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { PLATFORM_CONFIGS } from 'build-infra/lib/platform-targets'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getSocketbinPackageDir, SOCKETBIN_TEMPLATE_DIR } from './paths.mjs'
import { processTemplate } from './utils.mjs'

const logger = getDefaultLogger()

/**
 * Generate a single socketbin package.
 */
async function generatePackage(config) {
  const { arch, binExt, cpu, description, libc, os, platform } = config
  const muslSuffix = libc === 'musl' ? '-musl' : ''
  const packageName = `socketbin-cli-${platform}-${arch}${muslSuffix}`
  const packagePath = getSocketbinPackageDir(platform, arch, libc)
  const templatePath = SOCKETBIN_TEMPLATE_DIR

  // Template context for Handlebars.
  const context = {
    ARCH: arch,
    BIN_EXT: binExt,
    CPU: cpu,
    DESCRIPTION: description,
    LIBC_SUFFIX: muslSuffix,
    OS: os,
    PLATFORM: platform,
  }

  // Create package directory.
  await fs.mkdir(packagePath, { recursive: true })

  // Generate package.json.
  const packageJsonContent = await processTemplate(
    path.join(templatePath, 'package.json.template'),
    context,
  )
  await fs.writeFile(
    path.join(packagePath, 'package.json'),
    `${packageJsonContent}\n`,
    'utf-8',
  )

  // Generate README.md.
  const readmeContent = await processTemplate(
    path.join(templatePath, 'README.md.template'),
    context,
  )
  await fs.writeFile(
    path.join(packagePath, 'README.md'),
    readmeContent,
    'utf-8',
  )

  // Copy .gitignore.
  const gitignoreContent = await fs.readFile(
    path.join(templatePath, '.gitignore'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(packagePath, '.gitignore'),
    gitignoreContent,
    'utf-8',
  )

  logger.info(`Generated ${packageName}`)
}

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('Generating socketbin packages from template...')
  logger.log('='.repeat(50))
  logger.log('')

  // Verify template directory exists.
  if (!existsSync(SOCKETBIN_TEMPLATE_DIR)) {
    logger.error(`Template directory not found: ${SOCKETBIN_TEMPLATE_DIR}`)
    process.exitCode = 1
    return
  }

  // Generate all packages.
  for (const config of PLATFORM_CONFIGS) {
    await generatePackage(config)
  }

  logger.log('')
  logger.success(`Generated ${PLATFORM_CONFIGS.length} socketbin packages`)
  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exitCode = 1
})
