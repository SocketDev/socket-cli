/**
 * @file MacOS fsync barrier for a freshly-built `dist/` tree. Walks the
 *   directory and `fsync()`s every regular file so downstream steps (tests,
 *   packagers) read fully-durable bytes rather than page-cache state. esbuild /
 *   child-process builders can resolve their write promises before the bytes
 *   are durable on darwin CI runners; the symptom downstream is a truncated or
 *   missing file surfacing as a cryptic `Unexpected token` / `Cannot find
 *   module` at test time. No-op on Linux (`fs.writeFile` durability already
 *   suffices for our use) and Windows (cannot `open(dir, 'r')` for the
 *   directory-flush step — different file-handle semantics). Best-effort: a
 *   single failed `fsync` never fails the build — the bytes are on disk, just
 *   unflushable from userspace.
 */

import { promises as fsPromises } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export async function fsyncFile(filePath: string): Promise<void> {
  // Best-effort — a single failed fsync shouldn't tank the build. Macs
  // occasionally surface EPERM on system-restored files; the bytes are
  // already on disk, just unflushable from userspace.
  try {
    const fh = await fsPromises.open(filePath, 'r')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
  } catch {
    // ignore — best-effort barrier
  }
}

export async function fsyncDist(dir: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return
  }
  const entries = await fsPromises.readdir(dir, { withFileTypes: true })
  const filePromises: Array<Promise<void>> = []
  const subdirs: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      subdirs.push(entryPath)
    } else if (entry.isFile()) {
      filePromises.push(fsyncFile(entryPath))
    }
  }
  await Promise.all(filePromises)
  // Subdirs in parallel to keep the barrier cheap on wide trees.
  await Promise.all(subdirs.map(fsyncDist))
}
