import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import fastGlob from 'fast-glob'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { MANIFEST_JSON } from '@socketsecurity/registry/lib/constants'
import { debugDir } from '@socketsecurity/registry/lib/debug'
import { readDirNames } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchResult } from './output-patch-result.mts'
import {
  DOT_SOCKET,
  NODE_MODULES,
  NPM,
  UNKNOWN_ERROR,
} from '../../constants.mts'
import { findUp } from '../../utils/fs.mts'
import { getPurlObject, normalizePurl } from '../../utils/purl.mts'

import type { PatchRecord } from './manifest-schema.mts'
import type { OutputKind } from '../../types.mts'
import type { PackageURL } from '@socketregistry/packageurl-js'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

type PatchEntry = {
  key: string
  patch: PatchRecord
  purl: string
  purlObj: PackageURL
}

type PatchFileInfo = {
  beforeHash: string
  afterHash: string
}

type ApplyNpmPatchesOptions = {
  cwd?: string | undefined
  dryRun?: boolean | undefined
  purlObjs?: PackageURL[] | undefined
  spinner?: Spinner | undefined
}

type ApplyNpmPatchesResult = {
  passed: string[]
  failed: string[]
}

async function applyNpmPatches(
  socketDir: string,
  patches: PatchEntry[],
  options?: ApplyNpmPatchesOptions | undefined,
): Promise<ApplyNpmPatchesResult> {
  const {
    cwd = process.cwd(),
    dryRun = false,
    purlObjs,
    spinner,
  } = { __proto__: null, ...options } as ApplyNpmPatchesOptions

  const wasSpinning = !!spinner?.isSpinning

  spinner?.start()

  const patchLookup = new Map<string, PatchEntry>()
  for (const patchInfo of patches) {
    patchLookup.set(patchInfo.purl, patchInfo)
  }

  const nmPaths = await findNodeModulesPaths(cwd)

  spinner?.stop()

  logger.log(
    `Found ${nmPaths.length} ${NODE_MODULES} ${pluralize('folder', nmPaths.length)}`,
  )

  logger.group('')

  spinner?.start()

  const result: ApplyNpmPatchesResult = {
    passed: [],
    failed: [],
  }

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

        const purl = `pkg:npm/${pkgJson.name}@${pkgJson.version}`
        const purlObj = getPurlObject(purl, { throws: false })
        if (!purlObj) {
          continue
        }

        // Skip if specific packages requested and this isn't one of them
        if (
          purlObjs?.length &&
          purlObjs.findIndex(
            p =>
              p.type === NPM &&
              p.namespace === purlObj.namespace &&
              p.name === purlObj.name,
          ) === -1
        ) {
          continue
        }

        const patchInfo = patchLookup.get(purl)
        if (!patchInfo) {
          continue
        }

        spinner?.stop()

        logger.log(
          `Found match: ${pkgJson.name}@${pkgJson.version} at ${pkgPath}`,
        )
        logger.log(`Patch key: ${patchInfo.key}`)
        logger.group(`Processing files:`)

        spinner?.start()

        let passed = true

        for (const { 0: fileName, 1: fileInfo } of Object.entries(
          patchInfo.patch.files,
        )) {
          // eslint-disable-next-line no-await-in-loop
          const filePatchPassed = await processFilePatch(
            pkgPath,
            fileName,
            fileInfo,
            socketDir,
            {
              dryRun,
              spinner,
            },
          )
          if (!filePatchPassed) {
            passed = false
          }
        }

        logger.groupEnd()

        if (passed) {
          result.passed.push(purl)
        } else {
          result.failed.push(purl)
        }
      }
    }
  }

  spinner?.stop()

  logger.groupEnd()

  if (wasSpinning) {
    spinner.start()
  }
  return result
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
    dot: true,
    followSymbolicLinks: false,
    onlyDirectories: true,
  })
}

type ProcessFilePatchOptions = {
  dryRun?: boolean | undefined
  spinner?: Spinner | undefined
}

async function processFilePatch(
  pkgPath: string,
  fileName: string,
  fileInfo: PatchFileInfo,
  socketDir: string,
  options?: ProcessFilePatchOptions | undefined,
): Promise<boolean> {
  const { dryRun, spinner } = {
    __proto__: null,
    ...options,
  } as ProcessFilePatchOptions

  const wasSpinning = !!spinner?.isSpinning

  spinner?.stop()

  const filepath = path.join(pkgPath, fileName)
  if (!existsSync(filepath)) {
    logger.log(`File not found: ${fileName}`)
    if (wasSpinning) {
      spinner?.start()
    }
    return false
  }

  const currentHash = await computeSHA256(filepath)
  if (!currentHash) {
    logger.log(`Failed to compute hash for: ${fileName}`)
    if (wasSpinning) {
      spinner?.start()
    }
    return false
  }

  if (currentHash === fileInfo.afterHash) {
    logger.success(`File already patched: ${fileName}`)
    logger.group()
    logger.log(`Current hash: ${currentHash}`)
    logger.groupEnd()
    if (wasSpinning) {
      spinner?.start()
    }
    return true
  }

  if (currentHash !== fileInfo.beforeHash) {
    logger.fail(`File hash mismatch: ${fileName}`)
    logger.group()
    logger.log(`Expected: ${fileInfo.beforeHash}`)
    logger.log(`Current:  ${currentHash}`)
    logger.log(`Target:   ${fileInfo.afterHash}`)
    logger.groupEnd()
    if (wasSpinning) {
      spinner?.start()
    }
    return false
  }

  logger.success(`File matches expected hash: ${fileName}`)
  logger.group()
  logger.log(`Current hash: ${currentHash}`)
  logger.log(`Ready to patch to: ${fileInfo.afterHash}`)
  logger.group()

  if (dryRun) {
    logger.log(`(dry run - no changes made)`)
    logger.groupEnd()
    logger.groupEnd()
    if (wasSpinning) {
      spinner?.start()
    }
    return false
  }

  const blobPath = path.join(socketDir, 'blobs', fileInfo.afterHash)
  if (!existsSync(blobPath)) {
    logger.fail(`Error: Patch file not found at ${blobPath}`)
    logger.groupEnd()
    logger.groupEnd()
    if (wasSpinning) {
      spinner?.start()
    }
    return false
  }

  spinner?.start()

  let result = true
  try {
    await fs.copyFile(blobPath, filepath)
    logger.success(`Patch applied successfully`)
  } catch (e) {
    logger.error('Error applying patch')
    debugDir('inspect', { error: e })
    result = false
  }
  logger.groupEnd()
  logger.groupEnd()

  spinner?.stop()

  if (wasSpinning) {
    spinner?.start()
  }
  return result
}

export interface HandlePatchConfig {
  cwd: string
  dryRun: boolean
  outputKind: OutputKind
  purlObjs: PackageURL[]
  spinner: Spinner
}

export async function handlePatch({
  cwd,
  dryRun,
  outputKind,
  purlObjs,
  spinner,
}: HandlePatchConfig): Promise<void> {
  try {
    const dotSocketDirPath = path.join(cwd, DOT_SOCKET)
    const manifestPath = path.join(dotSocketDirPath, 'manifest.json')
    const manifestContent = await fs.readFile(manifestPath, 'utf-8')
    const manifestData = JSON.parse(manifestContent)
    const purls = purlObjs.map(String)
    const validated = PatchManifestSchema.parse(manifestData)

    // Parse PURLs and group by ecosystem.
    const patchesByEcosystem = new Map<string, PatchEntry[]>()
    for (const { 0: key, 1: patch } of Object.entries(validated.patches)) {
      const purl = normalizePurl(key)
      if (purls.length && !purls.includes(purl)) {
        continue
      }
      const purlObj = getPurlObject(purl, { throws: false })
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
        purl,
        purlObj,
      })
    }

    if (purls.length) {
      spinner.start(`Checking patches for: ${joinAnd(purls)}`)
    } else {
      spinner.start('Scanning all dependencies for available patches')
    }

    const patched = []

    const npmPatches = patchesByEcosystem.get(NPM)
    if (npmPatches) {
      const patchingResults = await applyNpmPatches(
        dotSocketDirPath,
        npmPatches,
        {
          cwd,
          dryRun,
          purlObjs,
          spinner,
        },
      )
      patched.push(...patchingResults.passed)
    }

    spinner.stop()

    await outputPatchResult(
      {
        ok: true,
        data: {
          patched,
        },
      },
      outputKind,
    )
  } catch (e) {
    spinner.stop()

    let message = 'Failed to apply patches'
    let cause = (e as Error)?.message || UNKNOWN_ERROR

    if (e instanceof SyntaxError) {
      message = `Invalid JSON in ${MANIFEST_JSON}`
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    await outputPatchResult(
      {
        ok: false,
        code: 1,
        message,
        cause,
      },
      outputKind,
    )
  }
}
