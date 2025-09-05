import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { readJson } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'

import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchResult } from './output-patch-result.mts'
import constants from '../../constants.mts'

import type { PatchRecord } from './manifest-schema.mts'
import type { CResult, OutputKind } from '../../types.mts'

interface PURL {
  type: string
  namespace?: string
  name: string
  version: string
  qualifiers?: Record<string, string>
  subpath?: string
}

async function applyNPMPatches(
  patches: Array<{ key: string; purl: PURL; patch: PatchRecord }>,
  dryRun: boolean,
  socketDir: string,
  packages: string[],
) {
  const patchLookup = new Map<
    string,
    { key: string; purl: PURL; patch: PatchRecord }
  >()

  for (const patchInfo of patches) {
    const { purl } = patchInfo
    const fullName = purl.namespace
      ? `@${purl.namespace}/${purl.name}`
      : purl.name
    const lookupKey = `${fullName}@${purl.version}`
    patchLookup.set(lookupKey, patchInfo)
  }

  const nodeModulesFolders = await findNodeModulesFolders(process.cwd())
  logger.log(`Found ${nodeModulesFolders.length} node_modules folders`)

  for (const nodeModulesPath of nodeModulesFolders) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const entries = await fs.readdir(nodeModulesPath)

      for (const entry of entries) {
        const entryPath = path.join(nodeModulesPath, entry)

        if (entry.startsWith('@')) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const scopedEntries = await fs.readdir(entryPath)
            for (const scopedEntry of scopedEntries) {
              const packagePath = path.join(entryPath, scopedEntry)
              // eslint-disable-next-line no-await-in-loop
              const pkg = await readPackageJson(packagePath)

              if (pkg) {
                // Skip if specific packages requested and this isn't one of them
                if (packages.length > 0 && !packages.includes(pkg.name)) {
                  continue
                }

                const lookupKey = `${pkg.name}@${pkg.version}`
                const patchInfo = patchLookup.get(lookupKey)

                if (patchInfo) {
                  logger.log(
                    `Found match: ${pkg.name}@${pkg.version} at ${packagePath}`,
                  )
                  logger.log(`  Patch key: ${patchInfo.key}`)
                  logger.log(`  Processing files:`)

                  for (const [fileName, fileInfo] of Object.entries(
                    patchInfo.patch.files,
                  )) {
                    // eslint-disable-next-line no-await-in-loop
                    await processFilePatch(
                      packagePath,
                      fileName,
                      fileInfo,
                      dryRun,
                      socketDir,
                    )
                  }
                }
              }
            }
          } catch {
            // Ignore errors reading scoped packages
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          const pkg = await readPackageJson(entryPath)

          if (pkg) {
            // Skip if specific packages requested and this isn't one of them
            if (packages.length > 0 && !packages.includes(pkg.name)) {
              continue
            }

            const lookupKey = `${pkg.name}@${pkg.version}`
            const patchInfo = patchLookup.get(lookupKey)

            if (patchInfo) {
              logger.log(
                `Found match: ${pkg.name}@${pkg.version} at ${entryPath}`,
              )
              logger.log(`  Patch key: ${patchInfo.key}`)
              logger.log(`  Processing files:`)

              for (const [fileName, fileInfo] of Object.entries(
                patchInfo.patch.files,
              )) {
                // eslint-disable-next-line no-await-in-loop
                await processFilePatch(
                  entryPath,
                  fileName,
                  fileInfo,
                  dryRun,
                  socketDir,
                )
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing ${nodeModulesPath}:`, error)
    }
  }
}

async function computeSHA256(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath)
    const hash = crypto.createHash('sha256')
    hash.update(content)
    return hash.digest('hex')
  } catch {
    return null
  }
}

async function findNodeModulesFolders(rootDir: string): Promise<string[]> {
  const nodeModulesPaths: string[] = []

  async function searchDir(dir: string) {
    try {
      const entries = await fs.readdir(dir)

      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'dist' || entry === 'build') {
          continue
        }

        const fullPath = path.join(dir, entry)
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.stat(fullPath)

        if (stats.isDirectory()) {
          if (entry === 'node_modules') {
            nodeModulesPaths.push(fullPath)
          } else {
            // eslint-disable-next-line no-await-in-loop
            await searchDir(fullPath)
          }
        }
      }
    } catch (error) {
      // Ignore permission errors or missing directories
    }
  }

  await searchDir(rootDir)
  return nodeModulesPaths
}

function parsePURL(purlString: string): PURL {
  const [ecosystem, rest] = purlString.split(':', 2)
  const [nameAndNamespace, version] = (rest ?? '').split('@', 2)

  let namespace: string | undefined
  let name: string

  if (ecosystem === 'npm' && nameAndNamespace?.startsWith('@')) {
    const parts = nameAndNamespace.split('/')
    namespace = parts[0]?.substring(1)
    name = parts.slice(1).join('/')
  } else {
    name = nameAndNamespace ?? ''
  }

  return {
    type: ecosystem ?? 'unknown',
    namespace: namespace ?? '',
    name: name ?? '',
    version: version ?? '0.0.0',
  }
}

async function processFilePatch(
  packagePath: string,
  fileName: string,
  fileInfo: { beforeHash: string; afterHash: string },
  dryRun: boolean,
  socketDir: string,
): Promise<void> {
  const filePath = path.join(packagePath, fileName)

  if (!existsSync(filePath)) {
    logger.log(`File not found: ${fileName}`)
    return
  }

  const currentHash = await computeSHA256(filePath)

  if (!currentHash) {
    logger.log(`Failed to compute hash for: ${fileName}`)
    return
  }

  if (currentHash === fileInfo.beforeHash) {
    logger.success(`File matches expected hash: ${fileName}`)
    logger.log(`Current hash: ${currentHash}`)
    logger.log(`Ready to patch to: ${fileInfo.afterHash}`)

    if (!dryRun) {
      const blobPath = path.join(socketDir, 'blobs', fileInfo.afterHash)

      if (!existsSync(blobPath)) {
        logger.fail(`Error: Patch file not found at ${blobPath}`)
        return
      }

      try {
        await fs.copyFile(blobPath, filePath)
        logger.success(`Patch applied successfully`)
      } catch (error) {
        logger.log(`Error applying patch: ${error}`)
      }
    } else {
      logger.log(`(dry run - no changes made)`)
    }
  } else if (currentHash === fileInfo.afterHash) {
    logger.success(`File already patched: ${fileName}`)
    logger.log(`Current hash: ${currentHash}`)
  } else {
    logger.fail(`File hash mismatch: ${fileName}`)
    logger.log(`Expected: ${fileInfo.beforeHash}`)
    logger.log(`Current:  ${currentHash}`)
    logger.log(`Target:   ${fileInfo.afterHash}`)
  }
}

async function readPackageJson(
  packagePath: string,
): Promise<{ name: string; version: string } | null> {
  const pkgJsonPath = path.join(packagePath, 'package.json')
  const pkg = await readJson(pkgJsonPath, { throws: false })
  if (pkg) {
    return {
      name: pkg.name || '',
      version: pkg.version || '',
    }
  }
  return null
}

export interface HandlePatchConfig {
  cwd: string
  dryRun: boolean
  outputKind: OutputKind
  packages: string[]
  spinner: typeof constants.spinner
}

export async function handlePatch({
  cwd,
  dryRun,
  outputKind,
  packages,
  spinner,
}: HandlePatchConfig): Promise<void> {
  try {
    const dotSocketDirPath = path.join(cwd, '.socket')
    const manifestPath = path.join(dotSocketDirPath, 'manifest.json')

    // Read the manifest file.
    const manifestContent = await fs.readFile(manifestPath, 'utf-8')
    const manifestData = JSON.parse(manifestContent)

    // Validate the schema.
    const validated = PatchManifestSchema.parse(manifestData)

    // Parse PURLs and group by ecosystem.
    const patchesByEcosystem: Record<
      string,
      Array<{ key: string; purl: PURL; patch: PatchRecord }>
    > = {}
    for (const [key, patch] of Object.entries(validated.patches)) {
      const purl = parsePURL(key)
      if (!patchesByEcosystem[purl.type]) {
        patchesByEcosystem[purl.type] = []
      }
      patchesByEcosystem[purl.type]?.push({
        key,
        purl,
        patch,
      })
    }

    spinner.stop()

    logger.log('')
    if (packages.length > 0) {
      logger.info(`Checking patches for: ${packages.join(', ')}`)
    } else {
      logger.info('Scanning all dependencies for available patches')
    }
    logger.log('')

    if (patchesByEcosystem['npm']) {
      await applyNPMPatches(
        patchesByEcosystem['npm'],
        dryRun,
        dotSocketDirPath,
        packages,
      )
    }

    const result: CResult<{ patchedPackages: string[] }> = {
      ok: true,
      data: {
        patchedPackages:
          packages.length > 0 ? packages : ['patched successfully'],
      },
    }

    await outputPatchResult(result, outputKind)
  } catch (e) {
    spinner.stop()

    let message = 'Failed to apply patches'
    let cause = (e as Error)?.message || 'Unknown error'

    if (e instanceof SyntaxError) {
      message = 'Invalid JSON in manifest.json'
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    const result: CResult<never> = {
      ok: false,
      code: 1,
      message,
      cause,
    }

    await outputPatchResult(result, outputKind)
  }
}
