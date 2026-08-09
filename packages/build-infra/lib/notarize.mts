/**
 * MacOS Notarization Utilities.
 *
 * Submits a Mach-O binary to Apple's notary service (`xcrun notarytool`) so
 * Gatekeeper's online check passes when the binary is downloaded.
 *
 * A bare Mach-O binary CANNOT be stapled — `xcrun stapler` only attaches a
 * notarization ticket to an app bundle, disk image, or installer package.
 * Notarizing a bare Mach-O still registers its hash with Apple, so
 * Gatekeeper's online check (`spctl`/`assess`) passes on first run even
 * though no ticket is ever embedded in the file itself.
 */

import { chmodSync, mkdtempSync, promises as fs, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

/**
 * App Store Connect API credentials used to authenticate `notarytool`.
 *
 * @property {string} issuerId - App Store Connect API issuer ID.
 * @property {string} keyId - App Store Connect API key ID.
 * @property {string} keyPath - Absolute path to the decoded .p8 private key.
 */
export interface NotarizeCredentials {
  issuerId: string
  keyId: string
  keyPath: string
}

export interface NotarytoolSubmitResult {
  id?: string | undefined
  status?: string | undefined
}

export function isNotarytoolSubmitResult(
  value: unknown,
): value is NotarytoolSubmitResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('id' in value || 'status' in value)
  )
}

/**
 * Notarize a bare Mach-O binary with Apple's notary service.
 *
 * `notarytool` only accepts zips, app bundles, disk images, or installer
 * packages — a bare Mach-O is zipped with `ditto` first. Skips gracefully
 * (returns `false`) on non-macOS or when no credentials are available, so
 * this is safe to call from a build pipeline on a machine that has never
 * had the App Store Connect API key provisioned.
 *
 * @param {string} binaryPath - Absolute path to the Mach-O binary to
 *   notarize.
 * @param {NotarizeCredentials} [credentials] - App Store Connect API
 *   credentials. Read from the environment via
 *   {@link readNotarizeCredentialsFromEnv} when omitted.
 *
 * @returns {Promise<boolean>} True only when Apple accepted the submission.
 */
export async function notarizeMachO(
  binaryPath: string,
  credentials?: NotarizeCredentials | undefined,
): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }

  const ownsCredentials = credentials === undefined
  const resolvedCredentials = credentials ?? readNotarizeCredentialsFromEnv()

  if (!resolvedCredentials) {
    logger.info(
      'Notarization skipped: APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID, and APPLE_ASC_KEY_P8_B64 are not all set.',
    )
    return false
  }

  const zipDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notarize-zip-'))
  const zipPath = path.join(zipDir, `${path.basename(binaryPath)}.zip`)

  try {
    // A bare Mach-O cannot be submitted directly; notarytool requires a zip,
    // app bundle, disk image, or installer package.
    await spawn('ditto', ['-c', '-k', binaryPath, zipPath])

    const { stdout } = await spawn(
      'xcrun',
      selectNotarytoolArgs(zipPath, resolvedCredentials),
    )
    const parsed = JSON.parse(stdout) as unknown
    if (!isNotarytoolSubmitResult(parsed)) {
      throw new Error('Invalid notarytool response format')
    }
    const result = parsed

    if (result.status !== 'Accepted') {
      throw new Error(
        [
          `What:  Notarization was not accepted for ${path.basename(binaryPath)}.`,
          `Where: xcrun notarytool submit ${zipPath}`,
          `Saw:   submission ${result.id ?? '(unknown id)'} returned status "${result.status ?? '(missing)'}" — wanted "Accepted".`,
          `Fix:   run "xcrun notarytool log ${result.id ?? '<submission-id>'} --key <keyPath> --key-id <keyId> --issuer <issuerId>" to see the rejection reason, fix the binary, and resubmit.`,
        ].join('\n'),
      )
    }

    logger.info(
      `Notarization accepted for ${path.basename(binaryPath)} (submission ${result.id ?? '(unknown id)'})`,
    )
    return true
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('What:')) {
      throw e
    }
    throw new Error(
      [
        `What:  Notarization failed for ${path.basename(binaryPath)}.`,
        `Where: ditto/xcrun notarytool submit ${zipPath}`,
        `Saw:   ${errorMessage(e)} — wanted a successful submission.`,
        'Fix:   confirm ditto and xcrun are available and the App Store Connect',
        '       API key/issuer/key-id are valid, then re-run the command directly',
        '       to inspect the failure.',
      ].join('\n'),
    )
  } finally {
    await safeDelete(zipDir).catch(() => {})
    if (ownsCredentials) {
      await safeDelete(path.dirname(resolvedCredentials.keyPath)).catch(
        () => {},
      )
    }
  }
}

/**
 * Read notary credentials from the environment.
 *
 * `APPLE_ASC_KEY_P8_B64` carries the base64-encoded .p8 private key.
 * When all three variables are present, the key is decoded to a 0600 file
 * in a fresh temp directory and its path is returned. Any single missing
 * variable means notarization cannot run, so this returns `undefined`
 * rather than a partial credentials object. The key's path may be logged;
 * its contents never are.
 *
 * @returns {NotarizeCredentials | undefined} Credentials, or undefined when
 *   any of `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`, or
 *   `APPLE_ASC_KEY_P8_B64` is unset.
 */
export function readNotarizeCredentialsFromEnv():
  | NotarizeCredentials
  | undefined {
  const keyId = process.env['APPLE_ASC_KEY_ID']
  const issuerId = process.env['APPLE_ASC_ISSUER_ID']
  const keyB64 = process.env['APPLE_ASC_KEY_P8_B64']

  if (!keyId || !issuerId || !keyB64) {
    return undefined
  }

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'notarize-key-'))
  const keyPath = path.join(tmpDir, 'AuthKey.p8')
  writeFileSync(keyPath, Buffer.from(keyB64, 'base64'), { mode: 0o600 })
  // Explicit chmod: writeFileSync's mode option is subject to umask at
  // file creation, and this key must never be group- or world-readable.
  chmodSync(keyPath, 0o600)

  return { issuerId, keyId, keyPath }
}

/**
 * Build the `notarytool submit` argument list (spawned via `xcrun`).
 *
 * Pure function — no filesystem or process access — so it is directly
 * unit-testable without spawning `xcrun`.
 *
 * @param {string} zipPath - Path to the zip archive to submit.
 * @param {NotarizeCredentials} credentials - App Store Connect API
 *   credentials.
 *
 * @returns {string[]} Arguments to pass to `xcrun`.
 */
export function selectNotarytoolArgs(
  zipPath: string,
  credentials: NotarizeCredentials,
): string[] {
  const { issuerId, keyId, keyPath } = credentials

  return [
    'notarytool',
    'submit',
    zipPath,
    '--key',
    keyPath,
    '--key-id',
    keyId,
    '--issuer',
    issuerId,
    '--wait',
    '--output-format',
    'json',
  ]
}
