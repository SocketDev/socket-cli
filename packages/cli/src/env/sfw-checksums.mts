/**
 * SFW SHA-256 checksums getter function.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 */

import process from 'node:process'

import type { SfwChecksums } from '../types.mjs'

import { parseChecksums, requireChecksum } from './checksum-utils.mjs'

const TOOL_NAME = 'SFW'

/**
 * Get SFW checksums from inlined environment variable.
 * Returns a map of asset filename to SHA-256 hex checksum.
 */
export function getSfwChecksums(): SfwChecksums {
  // MUST use direct process.env access for esbuild inlining.
  return parseChecksums(process.env['INLINED_SFW_CHECKSUMS'], TOOL_NAME)
}

/**
 * Lookup an SFW checksum by asset name.
 * In production builds, throws if asset is missing.
 * In dev mode, returns undefined to allow development.
 */
export function requireSfwChecksum(assetName: string): string | undefined {
  return requireChecksum(getSfwChecksums(), assetName, TOOL_NAME)
}
