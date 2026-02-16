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
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { processTemplate } from './utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const generatePath = path.join(__dirname, '..')
const logger = getDefaultLogger()

const PLATFORM_DESCRIPTIONS = {
  __proto__: null,
  'darwin-arm64': 'macOS ARM64 (Apple Silicon)',
  'darwin-x64': 'macOS x64 (Intel)',
  'linux-arm64': 'Linux ARM64',
  'linux-x64': 'Linux x64',
  'win32-arm64': 'Windows ARM64',
  'win32-x64': 'Windows x64',
}

const PACKAGES = [
  { arch: 'arm64', binExt: '', cpu: 'arm64', os: 'darwin', platform: 'darwin' },
  { arch: 'x64', binExt: '', cpu: 'x64', os: 'darwin', platform: 'darwin' },
  { arch: 'arm64', binExt: '', cpu: 'arm64', os: 'linux', platform: 'linux' },
  { arch: 'x64', binExt: '', cpu: 'x64', os: 'linux', platform: 'linux' },
  { arch: 'arm64', binExt: '.exe', cpu: 'arm64', os: 'win32', platform: 'win32' },
  { arch: 'x64', binExt: '.exe', cpu: 'x64', os: 'win32', platform: 'win32' },
]

/**
 * Generate a single socketbin package.
 */
async function generatePackage(config) {
  const { arch, binExt, cpu, os, platform } = config
  const packageName = `socketbin-cli-${platform}-${arch}`
  const packagePath = path.join(generatePath, 'build', packageName)
  const templatePath = path.join(generatePath, 'templates/socketbin-package')

  const description = PLATFORM_DESCRIPTIONS[`${platform}-${arch}`] || `${platform} ${arch}`

  // Template context for Handlebars.
  const context = {
    ARCH: arch,
    BIN_EXT: binExt,
    CPU: cpu,
    DESCRIPTION: description,
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
  const templatePath = path.join(generatePath, 'templates/socketbin-package')
  if (!existsSync(templatePath)) {
    logger.error(`Template directory not found: ${templatePath}`)
    process.exitCode = 1
    return
  }

  // Generate all packages.
  for (const config of PACKAGES) {
    await generatePackage(config)
  }

  logger.log('')
  logger.success(`Generated ${PACKAGES.length} socketbin packages`)
  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exitCode = 1
})
