/**
 * @file Pre-approve Socket full-scan gate. The shasum gate has already proven
 *   the staged bytes are identical to the local `pnpm pack`, so scanning the
 *   local artifact's extract IS scanning the staged upload. Each verified
 *   entry is packed, extracted to a temp dir, and run through
 *   `socket scan create --report` (report-level: error); a non-zero exit —
 *   policy-failing alerts, scan failure, or a missing/unauthenticated Socket
 *   CLI — fails the gate. Fail-closed by design: promotion includes a full
 *   scan unless `--no-scan` skips it explicitly.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger, rootPath, runCapture, runInherit } from '../shared.mts'
import { defaultPackTarball } from './staged.mts'

/**
 * Scan one staged entry's artifact. Packs the local tree (byte-identical to
 * the staged upload once the shasum gate has passed), extracts the tarball's
 * `package/` root into a temp dir, and gates on the Socket CLI's exit code.
 * The scan is marked `--tmp` (hidden from the dashboard scan list) — it's a
 * promotion gate, not a tracked branch scan.
 */
export async function scanStagedEntry(entry: {
  name: string
  version: string
}): Promise<boolean> {
  const { name, version } = entry
  const tarballPath = await defaultPackTarball(name, version)
  if (!tarballPath) {
    logger.fail(
      `Scan gate: could not pack ${name}@${version} locally; refusing to approve unscanned bytes.`,
    )
    return false
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-scan-gate-'))
  try {
    const untar = await runCapture(
      'tar',
      ['-xzf', tarballPath, '-C', tmpDir],
      rootPath,
    )
    if (untar.code !== 0) {
      logger.fail(
        `Scan gate: extracting ${tarballPath} failed (tar exited ${untar.code}).`,
      )
      return false
    }
    // npm tarballs root their contents at `package/`.
    const packageDir = path.join(tmpDir, 'package')
    logger.log(`Scan gate: socket scan create --report on ${name}@${version}…`)
    let code: number
    try {
      code = await runInherit(
        'socket',
        [
          'scan',
          'create',
          '--report',
          '--report-level',
          'error',
          '--no-interactive',
          '--tmp',
          '.',
        ],
        packageDir,
      )
    } catch (e) {
      logger.fail(
        `Scan gate: the Socket CLI could not run (${e instanceof Error ? e.message : String(e)}). ` +
          'Install/authenticate `socket`, or pass --no-scan to skip the gate explicitly.',
      )
      return false
    }
    if (code !== 0) {
      logger.fail(
        `Scan gate: socket scan exited ${code} for ${name}@${version}; not approving.`,
      )
      return false
    }
    return true
  } finally {
    await fs.rm(tmpDir, { force: true, recursive: true })
  }
}
