/**
 * @file Generate the `@socketsecurity/cli.exe.<triplet>` tail package
 *   directories — one per pack-app triplet — used for standalone-executable
 *   distribution via npm. Manifests are built programmatically from
 *   cli-exe-targets.mts so the conditional `libc` field stays typed; the
 *   README comes from templates/cli-exe-package/. Binaries are stamped into
 *   `bin/` afterwards by the SEA build.
 *   Usage: node scripts/generate-cli-exe-packages.mts.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  CLI_EXE_TRIPLETS,
  cliExeDescription,
  cliExeManifest,
  cliExePackageName,
} from './cli-exe-targets.mts'
import type { CliExeTriplet } from './cli-exe-targets.mts'
import { CLI_EXE_TEMPLATE_DIR, getCliExePackageDir } from './paths.mts'
import { processTemplate } from './utils.mts'

const logger = getDefaultLogger()

/**
 * Generate a single cli.exe tail package directory.
 */
export async function generatePackage(triplet: CliExeTriplet): Promise<void> {
  const packageName = cliExePackageName(triplet)
  const packagePath = getCliExePackageDir(triplet)

  await fs.mkdir(packagePath, { recursive: true })

  // package.json — programmatic, see cliExeManifest.
  await fs.writeFile(
    path.join(packagePath, 'package.json'),
    `${JSON.stringify(cliExeManifest(triplet), null, 2)}\n`,
    'utf-8',
  )

  // README.md from template.
  const readmeContent = await processTemplate(
    path.join(CLI_EXE_TEMPLATE_DIR, 'README.md.template'),
    {
      DESCRIPTION: cliExeDescription(triplet),
      NAME: packageName,
    },
  )
  await fs.writeFile(
    path.join(packagePath, 'README.md'),
    readmeContent,
    'utf-8',
  )

  // Copy .gitignore — template seed is stored dotless so it is not a tracked
  // nested .gitignore in this repo.
  const gitignoreContent = await fs.readFile(
    path.join(CLI_EXE_TEMPLATE_DIR, 'gitignore'),
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
async function main(): Promise<void> {
  logger.log('')
  logger.log('Generating cli.exe tail packages…')
  logger.log('='.repeat(50))
  logger.log('')

  if (!existsSync(CLI_EXE_TEMPLATE_DIR)) {
    logger.error(`Template directory not found: ${CLI_EXE_TEMPLATE_DIR}`)
    process.exitCode = 1
    return
  }

  for (let i = 0, { length } = CLI_EXE_TRIPLETS; i < length; i += 1) {
    await generatePackage(CLI_EXE_TRIPLETS[i])
  }

  logger.log('')
  logger.success(`Generated ${CLI_EXE_TRIPLETS.length} cli.exe tail packages`)
  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exitCode = 1
})
