import { execFileSync } from 'node:child_process'
/* eslint-disable no-await-in-loop -- Package staging shares a mutable VFS tree. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const CONFIG = path.join(ROOT, '.config/rollup.synp-sea.config.mjs')
const EXPECTED_PACKAGE = 'synp'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(filename)
      } else if (entry.isFile()) {
        files.push(filename)
      } else {
        throw new Error(`Unsupported Synp payload entry: ${filename}`)
      }
    }
  }
  await visit(directory)
  return files.sort()
}

async function normalizeDirectoryTimes(directory: string): Promise<void> {
  const fixedTime = new Date('1980-01-01T00:00:00.000Z')
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await normalizeDirectoryTimes(path.join(directory, entry.name))
    }
  }
  await fs.utimes(directory, fixedTime, fixedTime)
}

/** Stage the pinned Synp API, its bundled dependency closure, and licenses. */
export async function stageSynp(
  stageRoot: string,
  expectedVersion: string,
): Promise<{
  packageName: string
  version: string
  license: string
  integrity: string
  fileCount: number
  noticePackageCount: number
  obligationCount: number
  noticeInventorySha256: string
  noticeDocuments: Array<{ path: string; sha256: string }>
}> {
  const packageRoot = path.join(ROOT, 'node_modules/synp')
  const metadata = JSON.parse(
    await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  ) as { name?: string; version?: string; license?: string }
  if (
    metadata.name !== EXPECTED_PACKAGE ||
    metadata.version !== expectedVersion ||
    typeof metadata.license !== 'string'
  ) {
    throw new Error(
      `Installed Synp metadata does not match ${EXPECTED_PACKAGE}@${expectedVersion}`,
    )
  }
  const outputRoot = path.join(stageRoot, 'tools/synp')
  await fs.rm(outputRoot, { recursive: true, force: true })
  await fs.mkdir(outputRoot, { recursive: true })
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules/rollup/dist/bin/rollup'), '-c', CONFIG],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SEA_SYNP_INPUT: path.join(HERE, 'adapters/synp-worker.mjs'),
        SEA_SYNP_OUTPUT: outputRoot,
      },
      stdio: 'inherit',
    },
  )
  await Promise.all([
    fs.copyFile(
      path.join(packageRoot, 'LICENSE.md'),
      path.join(outputRoot, 'LICENSE'),
    ),
    fs.writeFile(
      path.join(outputRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: metadata.name,
          version: metadata.version,
          license: metadata.license,
          type: 'commonjs',
          main: 'bin/synp.js',
        },
        null,
        2,
      )}\n`,
    ),
  ])

  const workerPath = path.join(outputRoot, 'bin/synp.js')
  const workerStat = await fs.stat(workerPath).catch(() => undefined)
  if (!workerStat?.isFile() || workerStat.size === 0) {
    throw new Error(
      'Rollup did not produce the embedded Synp Worker entrypoint',
    )
  }

  const files = await listFiles(outputRoot)
  const entries: Array<{ path: string; sha256: string; size: number }> = []
  const fixedTime = new Date('1980-01-01T00:00:00.000Z')
  for (const filename of files) {
    const bytes = await fs.readFile(filename)
    await fs.utimes(filename, fixedTime, fixedTime)
    entries.push({
      path: path.relative(stageRoot, filename).split(path.sep).join('/'),
      sha256: sha256(bytes),
      size: bytes.length,
    })
  }
  await normalizeDirectoryTimes(outputRoot)
  const inventoryPath = path.join(outputRoot, 'THIRD-PARTY-NOTICES.json')
  const notice = JSON.parse(await fs.readFile(inventoryPath, 'utf8')) as {
    packages?: Array<{
      licenseFiles?: Array<{ path?: unknown; sha256?: unknown }>
      noticeFiles?: Array<{ path?: unknown; sha256?: unknown }>
    }>
    obligations?: unknown[]
  }
  const noticeDocuments = (notice.packages ?? [])
    .flatMap(record => [
      ...(record.licenseFiles ?? []),
      ...(record.noticeFiles ?? []),
    ])
    .filter(
      (record): record is { path: string; sha256: string } =>
        typeof record.path === 'string' && typeof record.sha256 === 'string',
    )
    .map(record => ({ path: record.path, sha256: record.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    packageName: metadata.name,
    version: metadata.version,
    license: metadata.license,
    integrity: sha256(Buffer.from(JSON.stringify(entries))),
    fileCount: entries.length,
    noticePackageCount: notice.packages?.length ?? 0,
    obligationCount: notice.obligations?.length ?? 0,
    noticeInventorySha256: await sha256(await fs.readFile(inventoryPath)),
    noticeDocuments,
  }
}
