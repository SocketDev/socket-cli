import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import fastGlob from 'fast-glob'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { readDirNames } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchResult } from './output-patch-result.mts'
import constants, { NODE_MODULES, NPM } from '../../constants.mts'
import { findUp } from '../../utils/fs.mts'
import { getPurlObject } from '../../utils/purl.mts'

import type { PatchRecord } from './manifest-schema.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { PackageURL } from '@socketregistry/packageurl-js'

export type PatchEntry = {
  key: string
  patch: PatchRecord
  purlObj: PackageURL
}

async function applyNPMPatches(
  patches: PatchEntry[],
  purlObjs: PackageURL[],
  socketDir: string,
  dryRun: boolean,
) {
  const patchLookup = new Map<string, PatchEntry>()
  for (const patchInfo of patches) {
    const key = getLookupKey(patchInfo.purlObj)
    patchLookup.set(key, patchInfo)
  }

  const nmPaths = await findNodeModulesPaths(process.cwd())
  logger.log(
    `Found ${nmPaths.length} node_modules ${pluralize('folder', nmPaths.length)}`,
  )

  for (const nmPath of nmPaths) {
    // eslint-disable-next-line no-await-in-loop
    const dirNames = await readDirNames(nmPath)
    for (const dirName of dirNames) {
      const isScoped = dirName.startsWith('@')
      const pkgPath = path.join(nmPath, dirName)
      const pkgSubNames = isScoped
        ? // eslint-disable-next-line no-await-in-loop
          await readDirNames(pkgPath)
        : [dirName]

      try {
        for (const pkgSubName of pkgSubNames) {
          const dirFullName = isScoped ? `${dirName}/${pkgSubName}` : pkgSubName
          const pkgPath = path.join(nmPath, dirFullName)
          // eslint-disable-next-line no-await-in-loop
          const pkgJson = await readPackageJson(pkgPath, { throws: false })
          if (
            !isNonEmptyString(pkgJson?.name) ||
            !isNonEmptyString(pkgJson?.version)
          ) {
            continue
          }
          const pkgFullName = pkgJson.name
          const purlObj = getPurlObject(`pkg:npm/${pkgFullName}`)
          // Skip if specific packages requested and this isn't one of them
          if (
            purlObjs.findIndex(
              p =>
                p.type === 'npm' &&
                p.namespace === purlObj.namespace &&
                p.name === purlObj.name,
            ) === -1
          ) {
            continue
          }

          const patchInfo = patchLookup.get(getLookupKey(purlObj))
          if (!patchInfo) {
            continue
          }

          logger.log(
            `Found match: ${pkgFullName}@${pkgJson.version} at ${pkgPath}`,
          )
          logger.log(`Patch key: ${patchInfo.key}`)
          logger.group(`Processing files:`)

          for (const { 0: fileName, 1: fileInfo } of Object.entries(
            patchInfo.patch.files,
          )) {
            // eslint-disable-next-line no-await-in-loop
            await processFilePatch(
              pkgPath,
              fileName,
              fileInfo,
              dryRun,
              socketDir,
            )
          }
          logger.groupEnd()
        }
      } catch (error) {
        logger.error(`Error processing ${nmPath}:`, error)
      }
    }
  }
}

async function computeSHA256(filepath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filepath)
    const hash = crypto.createHash('sha256')
    hash.update(content)
    return hash.digest('hex')
  } catch {}
  return null
}

async function findNodeModulesPaths(cwd: string): Promise<string[]> {
  const rootNmPath = await findUp(NODE_MODULES, { cwd, onlyDirectories: true })
  if (!rootNmPath) {
    return []
  }
  return await fastGlob.glob([`**/${NODE_MODULES}`], {
    absolute: true,
    cwd: path.dirname(rootNmPath),
    onlyDirectories: true,
  })
}

function getLookupKey(purlObj: PackageURL): string {
  const fullName = purlObj.namespace
    ? `${purlObj.namespace}/${purlObj.name}`
    : purlObj.name
  return `${fullName}@${purlObj.version}`
}

async function processFilePatch(
  pkgPath: string,
  fileName: string,
  fileInfo: { beforeHash: string; afterHash: string },
  dryRun: boolean,
  socketDir: string,
): Promise<void> {
  const filepath = path.join(pkgPath, fileName)
  if (!existsSync(filepath)) {
    logger.log(`File not found: ${fileName}`)
    return
  }

  const currentHash = await computeSHA256(filepath)
  if (!currentHash) {
    logger.log(`Failed to compute hash for: ${fileName}`)
    return
  }

  if (currentHash === fileInfo.beforeHash) {
    logger.success(`File matches expected hash: ${fileName}`)
    logger.log(`Current hash: ${currentHash}`)
    logger.log(`Ready to patch to: ${fileInfo.afterHash}`)

    if (dryRun) {
      logger.log(`(dry run - no changes made)`)
    } else {
      const blobPath = path.join(socketDir, 'blobs', fileInfo.afterHash)
      if (!existsSync(blobPath)) {
        logger.fail(`Error: Patch file not found at ${blobPath}`)
        return
      }
      try {
        await fs.copyFile(blobPath, filepath)
        logger.success(`Patch applied successfully`)
      } catch (error) {
        logger.error('Error applying patch:', error)
      }
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

export interface HandlePatchConfig {
  cwd: string
  dryRun: boolean
  outputKind: OutputKind
  purlObjs: PackageURL[]
  spinner: typeof constants.spinner
}

export async function handlePatch({
  cwd,
  dryRun,
  outputKind,
  purlObjs,
  spinner,
}: HandlePatchConfig): Promise<void> {
  try {
    const dotSocketDirPath = path.join(cwd, '.socket')
    const manifestPath = path.join(dotSocketDirPath, 'manifest.json')
    const manifestContent = await fs.readFile(manifestPath, 'utf-8')
    const manifestData = JSON.parse(manifestContent)
    const purls = purlObjs.map(String)
    const validated = PatchManifestSchema.parse(manifestData)

    // Parse PURLs and group by ecosystem.
    const patchesByEcosystem = new Map<string, PatchEntry[]>()
    for (const { 0: key, 1: patch } of Object.entries(validated.patches)) {
      const purlObj = getPurlObject(key, { throws: false })
      if (!purlObj) {
        continue
      }
      let patches = patchesByEcosystem.get(purlObj.type)
      if (!Array.isArray(patches)) {
        patches = []
        patchesByEcosystem.set(purlObj.type, patches)
      }
      patches.push({
        key,
        patch,
        purlObj,
      })
    }

    spinner.stop()

    logger.log('')
    if (purlObjs.length) {
      logger.info(`Checking patches for: ${joinAnd(purls)}`)
    } else {
      logger.info('Scanning all dependencies for available patches')
    }
    logger.log('')

    const npmPatches = patchesByEcosystem.get(NPM)
    if (npmPatches) {
      await applyNPMPatches(npmPatches, purlObjs, dotSocketDirPath, dryRun)
    }
    const result: CResult<{ patched: string[] }> = {
      ok: true,
      data: {
        patched: purls.length ? purls : ['patched successfully'],
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
