/**
 * Tarball extraction through a trusted system `tar`.
 *
 * The archives unpacked here — downloaded tool releases and the
 * python-build-standalone tarball — land in the CLI's own cache, but the
 * process doing the unpacking runs with its working directory inside a
 * repository checkout the CLI did not author. Resolving `tar` by bare name in
 * that position lets the checkout supply the extractor, so the lookup is routed
 * through the trusted resolver and the child gets the sanitized PATH.
 *
 * Key Functions:
 *
 * - ExtractTarball: Resolve a trusted `tar` and unpack a gzipped archive into a
 *   destination directory.
 */

import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  buildSystemToolEnv,
  describeSystemToolFailure,
  findSystemTool,
} from '../spawn/system-tool.mts'
import { InputError } from '../error/errors.mts'

const TAR_INSTALL_HINT =
  'Install tar outside the repository (`apt install tar`, `brew install gnu-tar`) and put its directory on PATH, then re-run.'

/**
 * Unpack the gzipped `archivePath` into `destDir` with the system `tar`.
 *
 * @throws {InputError} When no trusted tar resolves outside the protected root.
 */
export async function extractTarball(
  archivePath: string,
  destDir: string,
): Promise<void> {
  const resolution = await findSystemTool('tar')
  if (!resolution) {
    throw new InputError(
      `tar is required to extract ${archivePath}. ` +
        (await describeSystemToolFailure('tar', {
          installHint: TAR_INSTALL_HINT,
        })),
    )
  }
  await spawn(resolution.executable, ['-xzf', archivePath, '-C', destDir], {
    env: buildSystemToolEnv(process.env, resolution.searchPath),
  })
}
