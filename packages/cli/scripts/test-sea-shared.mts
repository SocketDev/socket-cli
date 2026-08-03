/**
 * Shared helpers for the SEA test script: SEA blob/config generation, tool
 * path loading, and CLI argument parsing used by every test mode.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = getDefaultLogger()

/**
 * Build SEA blob.
 */
export async function buildBlob(configPath) {
  logger.log('Generating SEA blob…')
  const result = await spawn(
    process.execPath,
    ['--experimental-sea-config', configPath],
    {
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    throw new Error(`Failed to generate SEA blob: exit code ${result.code}`)
  }
}

/**
 * Display tool information.
 */
export async function displayToolInfo(toolPaths) {
  logger.log('External tools to bundle:')
  let totalToolSize = 0
  for (const [toolName, toolPath] of Object.entries(toolPaths)) {
    if (existsSync(toolPath)) {
      // oxlint-disable-next-line socket/prefer-exists-sync -- reads .size for size reporting, not an existence check.
      const stats = await fs.stat(toolPath)
      const sizeMB = stats.size / 1024 / 1024
      totalToolSize += stats.size
      logger.log(`  ${toolName}: ${sizeMB.toFixed(2)} MB`)
    }
  }
  logger.log(`  Total: ${(totalToolSize / 1024 / 1024).toFixed(2)} MB`)
  logger.log('')
  return totalToolSize
}

/**
 * Generate SEA configuration.
 */
export async function generateSeaConfig(
  entryPoint,
  outputPath,
  toolPaths,
  mode,
) {
  const outputName = path.basename(outputPath, path.extname(outputPath))
  const configPath = path.join(
    path.dirname(outputPath),
    `sea-config-${mode}-${outputName}.json`,
  )
  const blobPath = path.join(
    path.dirname(outputPath),
    `sea-blob-${mode}-${outputName}.blob`,
  )

  // For VFS mode, no assets in config (they come via external tar.gz).
  // For other modes, include assets in config.
  const assets =
    mode === 'vfs'
      ? undefined
      : Object.fromEntries(
          Object.entries(toolPaths)
            .filter(([, toolPath]) => existsSync(toolPath))
            .map(([toolName, toolPath]) => [
              `external-tools/${toolName}`,
              toolPath,
            ]),
        )

  const config = {
    ...(assets ? { assets } : {}),
    disableExperimentalSEAWarning: true,
    main: entryPoint,
    output: blobPath,
    useCodeCache: true,
    useSnapshot: false,
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return { blobPath, configPath }
}

/**
 * Load tool paths from previous download.
 */
export async function loadToolPaths() {
  const platform = `${process.platform}-${process.arch}`
  const toolPathsFile = path.join(
    __dirname,
    '../../build-infra/build/external-tools-test',
    platform,
    'tool-paths.json',
  )

  if (!existsSync(toolPathsFile)) {
    logger.fail(`Tool paths not found: ${toolPathsFile}`)
    logger.fail('Run: node scripts/test-download-external-tools.mts')
    throw new Error('Tool paths not found')
  }

  let toolPathsData
  try {
    toolPathsData = JSON.parse(await fs.readFile(toolPathsFile, 'utf8'))
  } catch (e) {
    const msg = errorMessage(e)
    logger.fail(`Failed to parse tool paths from ${toolPathsFile}: ${msg}`)
    logger.fail('Run: node scripts/test-download-external-tools.mts')
    throw new Error('Invalid tool paths JSON')
  }
  return { platform, toolPaths: toolPathsData.tools }
}

/**
 * Parse command line arguments.
 */
export function parseArgs() {
  const args = process.argv.slice(2)
  const mode =
    args
      .find(a => a.startsWith('--mode='))
      ?.split('=')[1]
      ?.toLowerCase() || 'with-tools'

  if (!['standalone', 'vfs', 'with-tools'].includes(mode)) {
    logger.fail('Invalid mode. Use: standalone, vfs, or with-tools')
    throw new Error('Invalid mode')
  }

  return { mode }
}
