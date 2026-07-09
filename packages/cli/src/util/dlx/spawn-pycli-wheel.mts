/**
 * PyPI wheel resolution helpers for the Python CLI spawn utilities.
 *
 * Extracted from spawn-pycli.mts to keep that file under the 500-line soft
 * cap. Converts npm-style caret ranges to pip specifiers and downloads a
 * PyPI wheel with SHA-256 verification.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  downloadBinary,
  getDlxCachePath,
} from '@socketsecurity/lib-stable/dlx/binary'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'

import { getErrorCause, InputError } from '../error/errors.mts'
import { socketHttpRequest } from '../socket/api.mjs'

/**
 * Convert npm caret range (^2.2.15) to pip version specifier (>=2.2.15,<3.0.0).
 */
export function convertCaretToPipRange(caretRange: string): string {
  if (!caretRange) {
    return ''
  }

  if (!caretRange.startsWith('^')) {
    return `==${caretRange}`
  }

  const version = caretRange.slice(1) // Remove '^'.

  // Handle malformed caret range (just "^" with no version).
  if (!version) {
    return ''
  }

  const parts = version.split('.')
  const major = Number.parseInt(parts[0] || '0', 10)
  // Handle non-numeric major version (e.g., "^x.2.3").
  if (Number.isNaN(major)) {
    return `==${version}`
  }
  const nextMajor = major + 1

  return `>=${version},<${nextMajor}.0.0`
}

/**
 * Download a PyPI wheel with SHA-256 verification. Fetches the wheel URL from
 * PyPI JSON API and downloads with integrity check.
 *
 * @param packageName - PyPI package name (e.g., 'socketsecurity').
 * @param version - Exact version to download.
 * @param sha256 - Expected SHA-256 checksum (hex string).
 *
 * @returns Path to the downloaded wheel file, or null if download fails.
 */
export async function downloadPyPiWheel(
  packageName: string,
  version: string,
  sha256: string | undefined,
): Promise<string | undefined> {
  // Cache path: ~/.socket/_dlx/pypi/{package}/{version}/
  const cacheDir = path.join(getDlxCachePath(), 'pypi', packageName, version)
  const wheelFilename = `${packageName}-${version}-py3-none-any.whl`
  const wheelPath = path.join(cacheDir, wheelFilename)

  // Return cached wheel if already downloaded.
  if (existsSync(wheelPath)) {
    return wheelPath
  }

  await safeMkdir(cacheDir)

  // Fetch wheel URL from PyPI JSON API.
  const pypiUrl = `https://pypi.org/pypi/${packageName}/${version}/json`
  let wheelUrl: string | undefined = undefined

  try {
    const response = await socketHttpRequest(pypiUrl)
    if (!response.ok) {
      throw new Error(
        `PyPI returned HTTP ${response.status} for ${pypiUrl} (expected 200); check the package name and version, or retry if the registry is rate-limiting`,
      )
    }
    const data = response.json() as {
      urls?: Array<{ filename: string; url: string }> | undefined
    }

    // Find the wheel URL (prefer py3-none-any wheel).
    const wheelInfo = data.urls?.find(
      u =>
        u.filename.endsWith('-py3-none-any.whl') || u.filename.endsWith('.whl'),
    )
    if (wheelInfo) {
      wheelUrl = wheelInfo.url
    }
  } catch (e) {
    // If we can't fetch from API, construct URL directly (may not work for all packages).
    // This is a fallback; the API approach is more reliable.
    throw new InputError(
      `could not fetch PyPI metadata for ${packageName}==${version} from ${pypiUrl} (${getErrorCause(e)}); check your network or proxy settings, or try again if PyPI is rate-limiting`,
    )
  }

  if (!wheelUrl) {
    throw new InputError(
      `${packageName}==${version} has no py3-none-any wheel on PyPI (only sdist available); pin to a version that ships a wheel or install from source manually`,
    )
  }

  // Download wheel with SHA-256 verification.
  const result = await downloadBinary({
    name: wheelFilename,
    sha256,
    url: wheelUrl,
  })

  // Copy to our cache directory (downloadBinary uses its own cache).
  await fs.copyFile(result.binaryPath, wheelPath)

  return wheelPath
}
