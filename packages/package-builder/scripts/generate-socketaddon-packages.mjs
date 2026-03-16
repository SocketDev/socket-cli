/**
 * Generate socketaddon package directories from template.
 * Creates package directories for each platform/arch combination
 * that will be used for native addon distribution via npm.
 *
 * Usage:
 *   node scripts/generate-socketaddon-packages.mjs
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { PLATFORM_CONFIGS } from 'build-infra/lib/platform-targets'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  getBuildOutDir,
  getSocketaddonPackageDir,
  SOCKETADDON_MAIN_TEMPLATE_DIR,
  SOCKETADDON_TEMPLATE_DIR,
} from './paths.mjs'
import { processTemplate } from './utils.mjs'

const logger = getDefaultLogger()

/**
 * Generate a single socketaddon package.
 */
async function generatePackage(config) {
  const { arch, cpu, description, libc, os, releasePlatform } = config
  const muslSuffix = libc === 'musl' ? '-musl' : ''
  const packageName = `socketaddon-iocraft-${releasePlatform}-${arch}${muslSuffix}`
  const packagePath = getSocketaddonPackageDir(releasePlatform, arch, libc)
  const templatePath = SOCKETADDON_TEMPLATE_DIR

  // Template context for Handlebars.
  // Use releasePlatform for npm package naming (win, not win32).
  const context = {
    ARCH: arch,
    CPU: cpu,
    DESCRIPTION: description,
    LIBC_SUFFIX: muslSuffix,
    OS: os,
    PLATFORM: releasePlatform,
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

  // Copy LICENSE.
  const licenseContent = await fs.readFile(
    path.join(templatePath, 'LICENSE'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(packagePath, 'LICENSE'),
    licenseContent,
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
 * Generate the main wrapper package.
 */
async function generateMainPackage() {
  const packagePath = path.join(getBuildOutDir(), 'socketaddon-iocraft')
  const templatePath = SOCKETADDON_MAIN_TEMPLATE_DIR

  // Create package directory.
  await fs.mkdir(packagePath, { recursive: true })

  // Copy package.json.
  const packageJsonContent = await fs.readFile(
    path.join(templatePath, 'package.json'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(packagePath, 'package.json'),
    packageJsonContent,
    'utf-8',
  )

  // Copy index.mjs.
  const indexContent = await fs.readFile(
    path.join(templatePath, 'index.mjs'),
    'utf-8',
  )
  await fs.writeFile(path.join(packagePath, 'index.mjs'), indexContent, 'utf-8')

  // Copy index.d.ts.
  const indexDtsContent = await fs.readFile(
    path.join(templatePath, 'index.d.ts'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(packagePath, 'index.d.ts'),
    indexDtsContent,
    'utf-8',
  )

  // Copy LICENSE.
  const licenseContent = await fs.readFile(
    path.join(templatePath, 'LICENSE'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(packagePath, 'LICENSE'),
    licenseContent,
    'utf-8',
  )

  // Copy README.md.
  const readmeContent = await fs.readFile(
    path.join(templatePath, 'README.md'),
    'utf-8',
  )
  await fs.writeFile(
    path.join(packagePath, 'README.md'),
    readmeContent,
    'utf-8',
  )

  logger.info('Generated socketaddon-iocraft (main wrapper)')
}

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('Generating socketaddon packages from template...')
  logger.log('='.repeat(50))
  logger.log('')

  // Verify template directories exist.
  if (!existsSync(SOCKETADDON_TEMPLATE_DIR)) {
    logger.error(`Template directory not found: ${SOCKETADDON_TEMPLATE_DIR}`)
    process.exitCode = 1
    return
  }
  if (!existsSync(SOCKETADDON_MAIN_TEMPLATE_DIR)) {
    logger.error(
      `Template directory not found: ${SOCKETADDON_MAIN_TEMPLATE_DIR}`,
    )
    process.exitCode = 1
    return
  }

  // Generate main wrapper package.
  await generateMainPackage()

  // Generate all platform packages.
  for (const config of PLATFORM_CONFIGS) {
    await generatePackage(config)
  }

  logger.log('')
  logger.success(
    `Generated 1 main + ${PLATFORM_CONFIGS.length} platform socketaddon packages`,
  )
  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exitCode = 1
})
