import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { assertEmbeddedToolAvailable, runEmbeddedJsTool } from '../runtime.mts'

export interface OwnedPackageLock {
  path: string
  dev: string
  ino: string
  size: number
  sha256: string
}

interface SynpWorkerResult {
  dev: string
  ino: string
  size: number
  sha256: string
}

async function removeIfOwned(
  filename: string,
  identity: Pick<OwnedPackageLock, 'dev' | 'ino'>,
): Promise<void> {
  try {
    const stat = await fs.lstat(filename)
    if (
      String(stat.dev) === identity.dev &&
      String(stat.ino) === identity.ino
    ) {
      await fs.unlink(filename)
    }
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
  }
}

export async function removeOwnedPackageLock(
  owner: OwnedPackageLock | undefined,
): Promise<void> {
  if (!owner) {
    return
  }
  try {
    const [stat, contents] = await Promise.all([
      fs.lstat(owner.path),
      fs.readFile(owner.path),
    ])
    const digest = createHash('sha256').update(contents).digest('hex')
    if (
      String(stat.dev) === owner.dev &&
      String(stat.ino) === owner.ino &&
      stat.size === owner.size &&
      digest === owner.sha256
    ) {
      await fs.unlink(owner.path)
    }
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
  }
}

export async function convertYarnClassicToNpmLock(
  projectPath: string,
  signal?: AbortSignal,
): Promise<OwnedPackageLock> {
  assertEmbeddedToolAvailable('synp')
  const root = path.resolve(projectPath)
  const packageLockPath = path.join(root, 'package-lock.json')
  const temporaryPath = path.join(
    root,
    `.socket-cdxgen-lock-${randomUUID()}.tmp`,
  )
  const placeholder = await fs.open(temporaryPath, 'wx', 0o600)
  const placeholderStat = await placeholder.stat()
  await placeholder.close()
  const placeholderIdentity = {
    dev: String(placeholderStat.dev),
    ino: String(placeholderStat.ino),
  }
  let packageLockOwner: OwnedPackageLock | undefined

  try {
    const result = await runEmbeddedJsTool('synp', [], {
      cwd: root,
      inheritEnv: false,
      env: {},
      signal,
      stdio: 'pipe',
      ipc: {
        projectPath: root,
        outputPath: temporaryPath,
        tempDev: placeholderIdentity.dev,
        tempIno: placeholderIdentity.ino,
      },
    })
    if (result.code !== 0 || result.cancelled) {
      throw Object.assign(
        new Error(
          result.stderr?.trim() || 'Embedded Synp failed to convert yarn.lock.',
        ),
        { code: result.signal ?? undefined },
      )
    }

    let converted: SynpWorkerResult
    try {
      converted = JSON.parse(result.stdout ?? '') as SynpWorkerResult
    } catch {
      throw new Error('Embedded Synp returned invalid ownership metadata.')
    }
    if (
      converted.dev !== placeholderIdentity.dev ||
      converted.ino !== placeholderIdentity.ino ||
      !Number.isSafeInteger(converted.size) ||
      converted.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(converted.sha256)
    ) {
      throw new Error('Embedded Synp returned invalid ownership metadata.')
    }

    const [tempStat, tempContents] = await Promise.all([
      fs.lstat(temporaryPath),
      fs.readFile(temporaryPath),
    ])
    const tempDigest = createHash('sha256').update(tempContents).digest('hex')
    if (
      String(tempStat.dev) !== converted.dev ||
      String(tempStat.ino) !== converted.ino ||
      tempStat.size !== converted.size ||
      tempDigest !== converted.sha256 ||
      JSON.parse(tempContents.toString('utf8')).lockfileVersion !== 1
    ) {
      throw new Error(
        'Embedded Synp output failed ownership or format verification.',
      )
    }

    // link() creates the destination atomically and fails if another process
    // created package-lock.json after our initial absence check.
    await fs.link(temporaryPath, packageLockPath)
    packageLockOwner = {
      path: packageLockPath,
      dev: converted.dev,
      ino: converted.ino,
      size: converted.size,
      sha256: converted.sha256,
    }
    await fs.unlink(temporaryPath)
    return packageLockOwner
  } catch (error) {
    await removeOwnedPackageLock(packageLockOwner)
    throw error
  } finally {
    await removeIfOwned(temporaryPath, placeholderIdentity)
  }
}
