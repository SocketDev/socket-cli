/**
 * Binary Signing Utilities.
 *
 * Provides utilities for code signing binaries on macOS.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

// The Socket Inc. Developer ID Application identity, used when neither the
// caller nor APPLE_DEVELOPER_ID_IDENTITY names one.
const DEFAULT_DEVELOPER_ID_IDENTITY =
  'Developer ID Application: Socket Inc. (PZRCDQ736X)'

// Mach-O magic numbers (big-endian and little-endian for 32/64-bit).
// 32-bit big-endian: FEEDFACE.
// 32-bit little-endian: CEFAEDFE.
// 64-bit big-endian: FEEDFACF.
// 64-bit little-endian: CFFAEDFE.
const MACH_O_MAGIC = Object.freeze({
  CEFAEDFE: true,
  CFFAEDFE: true,
  FEEDFACE: true,
  FEEDFACF: true,
  __proto__: null,
})

/**
 * Ad-hoc code sign a binary for macOS.
 *
 * Uses ad-hoc signing (no certificate required) to satisfy macOS code signing
 * requirements. This is necessary for binaries to execute on modern macOS,
 * especially ARM64 systems.
 *
 * Skips signing if binary is already validly signed (idempotent).
 * Uses --force to replace invalid signatures (e.g., after stripping).
 * Only signs Mach-O binaries (verified by magic number).
 *
 * @param {string} binaryPath - Absolute path to binary to sign.
 * @param {Function} [beforeSign] - Optional callback executed before signing
 *   (only on macOS when signing is needed)
 *
 * @returns {Promise<void>}
 */
export async function adHocSign(
  binaryPath: string,
  beforeSign?: (() => Promise<void> | void) | undefined,
): Promise<void> {
  if (process.platform !== 'darwin') {
    return
  }

  // Only sign actual Mach-O binaries (sniff magic number).
  // Skip non-binaries (.wasm, .js, .mts, etc.).
  if (!(await isMachOBinary(binaryPath))) {
    return
  }

  // Check if already signed (codesign --verify returns non-zero if not signed).
  try {
    await spawn('codesign', ['--verify', binaryPath], {
      stdio: 'ignore',
    })
    // Exit code 0 = already signed, skip.
    return
  } catch {
    // Exit code non-zero = not signed or invalid signature, continue to sign.
  }

  // Execute pre-signing callback (e.g., for logging).
  if (beforeSign) {
    await beforeSign()
  }

  // Sign the binary with --force so any invalid signature is replaced.
  try {
    logger.info(`Ad-hoc signing: ${path.basename(binaryPath)}`)
    await spawn('codesign', ['--sign', '-', '--force', binaryPath])
    logger.info('Binary signed successfully')
  } catch (e) {
    logger.fail(`Code signing failed: ${errorMessage(e)}`)
    throw e
  }
}

/**
 * Developer ID code sign a binary for macOS.
 *
 * Signs with a real Developer ID Application certificate (hardened runtime by
 * default) so the binary can be notarized. Falls back to ad-hoc signing, and
 * returns `false`, when the identity is not present in the keychain — the
 * expected state on a machine without the Developer ID certificate installed.
 *
 * @param {string} binaryPath - Absolute path to binary to sign.
 * @param {DeveloperIdSignOptions} [options] - Signing options.
 *
 * @returns {Promise<boolean>} True only when Developer ID signing succeeded.
 */
export async function developerIdSign(
  binaryPath: string,
  options?: DeveloperIdSignOptions | undefined,
): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }

  if (!(await isMachOBinary(binaryPath))) {
    return false
  }

  const resolvedOptions = {
    __proto__: null,
    ...options,
  } as DeveloperIdSignOptions
  const identity = resolveDeveloperIdIdentity(resolvedOptions.identity)

  if (!(await isIdentityInKeychain(identity))) {
    logger.info(
      `Developer ID identity signing unavailable ("${identity}" not found in keychain); falling back to ad-hoc signing.`,
    )
    await adHocSign(binaryPath)
    return false
  }

  try {
    logger.info(`Developer ID signing: ${path.basename(binaryPath)}`)
    await spawn('codesign', selectCodesignArgs(binaryPath, resolvedOptions))
    logger.info('Binary signed successfully with Developer ID identity')
    return true
  } catch (e) {
    throw new Error(
      [
        `What:  Developer ID code signing failed for ${path.basename(binaryPath)}.`,
        `Where: codesign ${selectCodesignArgs(binaryPath, resolvedOptions).join(' ')}`,
        `Saw:   ${errorMessage(e)} — wanted a clean exit (code 0).`,
        'Fix:   confirm the certificate is installed in the login keychain and its',
        '       common name matches APPLE_DEVELOPER_ID_IDENTITY, then re-run',
        '       codesign directly to inspect the failure.',
      ].join('\n'),
    )
  }
}

/**
 * Check whether a signing identity is present in the keychain.
 *
 * @param {string} identity - Identity string to look for.
 *
 * @returns {Promise<boolean>} True if `security find-identity` lists it.
 */
export async function isIdentityInKeychain(identity: string): Promise<boolean> {
  try {
    const { stdout } = await spawn('security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
    ])
    return stdout.includes(identity)
  } catch {
    return false
  }
}

/**
 * Check if file is a Mach-O binary by reading magic number.
 *
 * @param {string} filePath - Path to file to check.
 *
 * @returns {Promise<boolean>} - True if file is a Mach-O binary.
 */
export async function isMachOBinary(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) {
    return false
  }

  try {
    const buffer = Buffer.allocUnsafe(4)
    const fd = await fs.open(filePath, 'r')
    try {
      await fd.read(buffer, 0, 4, 0)
    } finally {
      await fd.close()
    }

    const magic = buffer.toString('hex').toUpperCase()
    return magic in MACH_O_MAGIC
  } catch {
    return false
  }
}

/**
 * Options for Developer ID identity signing.
 *
 * @property {string} [entitlementsPath] - Absolute path to an entitlements
 *   plist to embed with `--entitlements`.
 * @property {boolean} [hardenedRuntime] - Enable the hardened runtime via
 *   `--options runtime`. Defaults to enabled; pass `false` to disable.
 * @property {string} [identity] - Signing identity to pass to `--sign`.
 *   Defaults to `APPLE_DEVELOPER_ID_IDENTITY`, then the Socket Inc. identity.
 */
export interface DeveloperIdSignOptions {
  entitlementsPath?: string | undefined
  hardenedRuntime?: boolean | undefined
  identity?: string | undefined
}

/**
 * Resolve the Developer ID identity to sign with: an explicit identity wins,
 * then APPLE_DEVELOPER_ID_IDENTITY, then the Socket Inc. default.
 *
 * @param {string | undefined} identity - Caller-supplied identity, if any.
 *
 * @returns {string} Resolved signing identity.
 */
export function resolveDeveloperIdIdentity(
  identity: string | undefined,
): string {
  return (
    identity ||
    process.env['APPLE_DEVELOPER_ID_IDENTITY'] ||
    DEFAULT_DEVELOPER_ID_IDENTITY
  )
}

/**
 * Build the `codesign` argument list for Developer ID identity signing.
 *
 * Pure function — no filesystem or process access — so it is directly
 * unit-testable without spawning `codesign`.
 *
 * @param {string} binaryPath - Absolute path to the binary to sign.
 * @param {DeveloperIdSignOptions} config - Signing options.
 *
 * @returns {string[]} Arguments to pass to `codesign`.
 */
export function selectCodesignArgs(
  binaryPath: string,
  config: DeveloperIdSignOptions,
): string[] {
  const { entitlementsPath, hardenedRuntime, identity } = {
    __proto__: null,
    ...config,
  } as typeof config

  return [
    '--sign',
    resolveDeveloperIdIdentity(identity),
    '--force',
    '--timestamp',
    ...(hardenedRuntime !== false ? ['--options', 'runtime'] : []),
    ...(entitlementsPath ? ['--entitlements', entitlementsPath] : []),
    binaryPath,
  ]
}
