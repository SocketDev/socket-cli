import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Replace an executable and its manifest as one rollback-safe publication. */
export async function publishArtifactPair({
  operations = {},
  outputBinary,
  outputManifest,
  stagedBinary,
  stagedManifest,
  transactionDirectory,
}: {
  stagedBinary: string
  stagedManifest: string
  outputBinary: string
  outputManifest: string
  transactionDirectory: string
  operations?: {
    rename?: typeof fs.rename
    rm?: typeof fs.rm
  }
}): Promise<void> {
  const rename = operations.rename ?? fs.rename
  const remove = operations.rm ?? fs.rm
  const nextBinary = path.join(
    transactionDirectory,
    path.basename(outputBinary),
  )
  const nextManifest = path.join(
    transactionDirectory,
    path.basename(outputManifest),
  )
  const backupBinary = path.join(
    transactionDirectory,
    `${path.basename(outputBinary)}.previous`,
  )
  const backupManifest = path.join(
    transactionDirectory,
    `${path.basename(outputManifest)}.previous`,
  )
  let backedUpBinary = false
  let backedUpManifest = false
  let installedBinary = false
  let installedManifest = false
  let committed = false
  let retainedBackups = false
  await fs.mkdir(transactionDirectory)
  try {
    await fs.copyFile(stagedBinary, nextBinary)
    await fs.copyFile(stagedManifest, nextManifest)
    await fs.chmod(nextBinary, (await fs.stat(stagedBinary)).mode & 0o7777)
    const exists = async (filename: string): Promise<boolean> => {
      try {
        await fs.lstat(filename)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return false
        }
        throw error
      }
    }
    const hadBinary = await exists(outputBinary)
    const hadManifest = await exists(outputManifest)
    if (hadBinary) {
      await rename(outputBinary, backupBinary)
      backedUpBinary = true
    }
    if (hadManifest) {
      await rename(outputManifest, backupManifest)
      backedUpManifest = true
    }
    await rename(nextBinary, outputBinary)
    installedBinary = true
    await rename(nextManifest, outputManifest)
    installedManifest = true
    committed = true
  } catch (error) {
    const rollbackErrors: unknown[] = []
    if (installedBinary) {
      try {
        await remove(outputBinary, { force: true })
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (installedManifest) {
      try {
        await remove(outputManifest, { force: true })
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (backedUpBinary) {
      try {
        await rename(backupBinary, outputBinary)
        backedUpBinary = false
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (backedUpManifest) {
      try {
        await rename(backupManifest, outputManifest)
        backedUpManifest = false
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length) {
      retainedBackups = backedUpBinary || backedUpManifest
      throw new AggregateError(
        [error, ...rollbackErrors],
        `SEA artifact publication failed and rollback was incomplete; recoverable backups remain in ${transactionDirectory}`,
      )
    }
    throw error
  } finally {
    await remove(nextBinary, { force: true }).catch(() => undefined)
    await remove(nextManifest, { force: true }).catch(() => undefined)
    if (committed) {
      let cleanupFailed = false
      try {
        await remove(backupBinary, { force: true })
      } catch {
        cleanupFailed = true
      }
      try {
        await remove(backupManifest, { force: true })
      } catch {
        cleanupFailed = true
      }
      retainedBackups = cleanupFailed
    }
    if (!retainedBackups) {
      await remove(transactionDirectory, {
        recursive: true,
        force: true,
      }).catch(() => undefined)
    }
  }
}
