// AgentShield installer — scans Claude AI config for prompt injection /
// secrets. Downloaded as an npm package via dlx (pinned version, cached).
// Lives in its own file because installers.mts is at the 500-line soft cap.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PackageURL } from '@socketregistry/packageurl-js-stable'

import { downloadNpmPackage } from '@socketsecurity/lib-stable/dlx/package'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { AGENTSHIELD } from './tool-config.mts'

const logger = getDefaultLogger()

export async function runSetupAgentShield(): Promise<boolean> {
  logger.log('=== AgentShield ===')
  const purl = PackageURL.fromString(AGENTSHIELD.purl!)
  if (purl.type !== 'npm') {
    throw new Error(
      `Unsupported PURL type "${purl.type}" — only npm is supported`,
    )
  }
  const npmPackage = purl.namespace
    ? `${purl.namespace}/${purl.name}`
    : purl.name!
  const version = AGENTSHIELD.version ?? purl.version
  const packageSpec = version ? `${npmPackage}@${version}` : npmPackage

  logger.log(`Installing ${packageSpec} via dlx…`)
  const { binaryPath, installed } = await downloadNpmPackage({
    spec: packageSpec,
    binaryName: 'agentshield',
  })

  // Verify the installed package matches the pinned version.
  //
  // Don't trust the binary's --version self-report: ecc-agentshield's
  // compiled bundle has a hardcoded version string that has drifted
  // from the published package.json (e.g. binary reports "1.5.0"
  // while npm latest + published package.json both say "1.4.0").
  // That's an upstream packaging issue; the authoritative answer
  // is the dlx-cached package.json, which is what npm actually
  // delivered after integrity-hash verification.
  if (version) {
    const pkgJsonPath = path.join(
      path.dirname(binaryPath),
      '..',
      'ecc-agentshield',
      'package.json',
    )
    let installedVersion: string | undefined
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
        version?: unknown | undefined
      }
      if (typeof pkgJson.version === 'string') {
        installedVersion = pkgJson.version
      }
    } catch {
      // Fall through — treat as unverifiable rather than fail.
    }
    if (installedVersion && installedVersion !== version) {
      logger.warn(
        `Version mismatch: pinned ${version}, installed ${installedVersion}`,
      )
      return false
    }
    const reportedVersion = installedVersion ?? version
    logger.log(
      installed
        ? `Installed: ${binaryPath} (${reportedVersion})`
        : `Cached: ${binaryPath} (${reportedVersion})`,
    )
  } else {
    logger.log(installed ? `Installed: ${binaryPath}` : `Cached: ${binaryPath}`)
  }
  return true
}
