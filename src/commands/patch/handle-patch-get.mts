import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { UTF8 } from '@socketsecurity/lib/constants/encoding'
import {
  DOT_SOCKET_DIR,
  MANIFEST_JSON,
} from '@socketsecurity/lib/constants/paths'
import { logger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/path'
import type { Spinner } from '@socketsecurity/lib/spinner'
import { pluralize } from '@socketsecurity/lib/words'
import type { OutputKind } from '../../types.mts'
import { getErrorCause, InputError } from '../../utils/error/errors.mjs'
import { normalizePurl } from '../../utils/purl/parse.mjs'
import { PatchManifestSchema } from './manifest-schema.mts'
import { outputPatchGetResult } from './output-patch-get-result.mts'

export interface PatchGetData {
  files: string[]
  outputDir: string
  purl: string
}

export interface HandlePatchGetConfig {
  cwd: string
  outputDir: string | undefined
  outputKind: OutputKind
  purl: string
  spinner: Spinner
}

export async function handlePatchGet({
  cwd,
  outputDir,
  outputKind,
  purl,
  spinner,
}: HandlePatchGetConfig): Promise<void> {
  try {
    spinner.start('Reading patch manifest')

    const dotSocketDirPath = normalizePath(path.join(cwd, DOT_SOCKET_DIR))
    const manifestPath = normalizePath(
      path.join(dotSocketDirPath, MANIFEST_JSON),
    )
    const manifestContent = await fs.readFile(manifestPath, UTF8)
    const manifestData = JSON.parse(manifestContent)
    const validated = PatchManifestSchema.parse(manifestData)

    const normalizedPurl = normalizePurl(purl)
    const patch = validated.patches[normalizedPurl]

    if (!patch) {
      spinner.stop()
      throw new InputError(`Patch not found for PURL: ${purl}`)
    }

    const targetDir = outputDir
      ? path.resolve(process.cwd(), outputDir)
      : path.join(cwd, 'patches', normalizedPurl.replace(/[/:@]/g, '_'))

    // Create output directory if it doesn't exist.
    if (!existsSync(targetDir)) {
      await fs.mkdir(targetDir, { recursive: true })
    }

    spinner.text('Copying patch files')

    const copiedFiles: string[] = []
    const blobsDir = normalizePath(path.join(dotSocketDirPath, 'blobs'))

    for (const { 0: fileName, 1: fileInfo } of Object.entries(patch.files)) {
      const blobPath = normalizePath(path.join(blobsDir, fileInfo.afterHash))
      if (!existsSync(blobPath)) {
        spinner.stop()
        throw new InputError(
          `Patch file not found: ${fileInfo.afterHash} for ${fileName}`,
        )
      }

      const targetFilePath = normalizePath(path.join(targetDir, fileName))
      const targetFileDir = path.dirname(targetFilePath)

      // Create subdirectories if needed.
      if (!existsSync(targetFileDir)) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(targetFileDir, { recursive: true })
      }

      // eslint-disable-next-line no-await-in-loop
      await fs.copyFile(blobPath, targetFilePath)
      copiedFiles.push(fileName)
    }

    spinner.stop()

    logger.log(
      `Copied ${copiedFiles.length} patch ${pluralize('file', { count: copiedFiles.length })} to ${targetDir}`,
    )

    await outputPatchGetResult(
      {
        ok: true,
        data: {
          files: copiedFiles,
          outputDir: targetDir,
          purl: normalizedPurl,
        },
      },
      outputKind,
    )
  } catch (e) {
    spinner.stop()

    if (e instanceof InputError) {
      throw e
    }

    let message = 'Failed to get patch files'
    let cause = getErrorCause(e)

    if (e instanceof SyntaxError) {
      message = `Invalid JSON in ${MANIFEST_JSON}`
      cause = e.message
    } else if (e instanceof Error && 'issues' in e) {
      message = 'Schema validation failed'
      cause = String(e)
    }

    await outputPatchGetResult(
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
