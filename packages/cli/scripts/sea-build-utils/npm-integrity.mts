/**
 * @file Integrity enforcement for the npm-sourced external tools pinned in
 *   bundle-tools.json.
 *   The `integrity` field is a `sha512-<base64>` SRI for the package tarball.
 *   Enforcing it has two links. npm's own installer (cacache/pacote, driven by
 *   Arborist) hashes the tarball it downloads and records the result in the
 *   hidden lockfile at `node_modules/.package-lock.json`; that covers
 *   bytes-on-the-wire against what the registry advertised. This module covers
 *   the second link — the recorded integrity against the value we pinned — so a
 *   registry-side substitution cannot pass as our pinned build.
 *   Both links are required. Neither alone ties the installed tree to the pin.
 */

import {
  equalHashes,
  isIntegrity,
  parseHash,
} from '@socketsecurity/lib-stable/integrity'

/**
 * An npm-sourced tool as declared in bundle-tools.json.
 */
export type NpmToolPin = {
  integrity: string | undefined
  name: string
  version: string
}

/**
 * The subset of npm's hidden lockfile (`node_modules/.package-lock.json`) this
 * module reads. Every installed package appears under its install path.
 */
export type HiddenLockfile = {
  packages?: Record<string, { integrity?: string | undefined }> | undefined
}

/**
 * Tools exempt from integrity enforcement, keyed by tool name with the reason.
 *
 * An exemption must be listed here to take effect. A tool that is simply
 * missing its `integrity` field is an error, never a silent pass — that is the
 * failure mode this module exists to remove.
 */
export const INTEGRITY_EXEMPT_NPM_TOOLS: Record<string, string> = {
  __proto__: null,
} as unknown as Record<string, string>

/**
 * Collect the npm-sourced tools from a parsed bundle-tools.json `tools` map.
 */
export function collectNpmToolPins(
  tools: Record<string, Record<string, unknown>>,
): NpmToolPin[] {
  const pins: NpmToolPin[] = []
  const entries = Object.entries(tools)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [name, config] = entries[i]!
    if (config['packageManager'] === 'npm') {
      pins.push({
        integrity: config['integrity'] as string | undefined,
        name,
        version: config['version'] as string,
      })
    }
  }
  return pins
}

/**
 * Validate a declared `integrity` value, returning the parsed hash.
 *
 * A missing or malformed declaration is a loud error. Returning `undefined` for
 * "not declared" would reintroduce the silent skip.
 */
export function parseDeclaredToolIntegrity(
  toolName: string,
  declared: string | undefined,
): ReturnType<typeof parseHash> {
  if (declared === undefined || declared === '') {
    throw new Error(
      `Missing integrity pin for npm tool "${toolName}".\n` +
        `  Where: packages/cli/bundle-tools.json → tools["${toolName}"].integrity\n` +
        `  Saw: no integrity field; wanted a "sha512-<base64>" SRI string.\n` +
        `  Fix: add the tarball integrity from \`npm view ${toolName}@<version> dist.integrity\`, ` +
        `or add an explicit entry to INTEGRITY_EXEMPT_NPM_TOOLS with a reason.`,
    )
  }
  if (!isIntegrity(declared)) {
    throw new Error(
      `Malformed integrity pin for npm tool "${toolName}".\n` +
        `  Where: packages/cli/bundle-tools.json → tools["${toolName}"].integrity\n` +
        `  Saw: ${declared}\n` +
        `  Wanted: an SRI string such as "sha512-<base64>".\n` +
        `  Fix: replace it with the value from \`npm view ${toolName}@<version> dist.integrity\`.`,
    )
  }
  return parseHash(declared)
}

/**
 * Read the integrity npm recorded for an installed package.
 *
 * An absent record means the install did not happen, or happened without the
 * hash npm normally records — either way the pin cannot be checked, so this is
 * an error rather than a pass.
 */
export function readInstalledPackageIntegrity(
  toolName: string,
  lockfile: HiddenLockfile,
  lockfilePath: string,
): string {
  const key = `node_modules/${toolName}`
  const recorded = lockfile.packages?.[key]?.integrity
  if (recorded === undefined || recorded === '') {
    throw new Error(
      `Cannot verify integrity for npm tool "${toolName}": npm recorded none.\n` +
        `  Where: ${lockfilePath} → packages["${key}"].integrity\n` +
        `  Saw: no integrity recorded for the installed package.\n` +
        `  Wanted: the SRI npm computes for the tarball it installed.\n` +
        `  Fix: reinstall from the registry so npm records a hash; a local ` +
        `link or file: install cannot be integrity-checked.`,
    )
  }
  return recorded
}

/**
 * Assert that the package npm installed is the one bundle-tools.json pins.
 *
 * Throws with What / Where / Saw-vs-wanted / Fix on any mismatch, on a missing
 * or malformed pin, and on a missing recorded hash.
 */
export function assertInstalledMatchesPin(
  pin: NpmToolPin,
  lockfile: HiddenLockfile,
  lockfilePath: string,
): void {
  const exemptReason = Object.hasOwn(INTEGRITY_EXEMPT_NPM_TOOLS, pin.name)
    ? INTEGRITY_EXEMPT_NPM_TOOLS[pin.name]
    : undefined
  if (exemptReason !== undefined) {
    return
  }
  const declared = parseDeclaredToolIntegrity(pin.name, pin.integrity)
  const recorded = readInstalledPackageIntegrity(
    pin.name,
    lockfile,
    lockfilePath,
  )
  if (!isIntegrity(recorded)) {
    throw new Error(
      `Integrity check failed for npm tool "${pin.name}": npm recorded an unparseable hash.\n` +
        `  Where: ${lockfilePath} → packages["node_modules/${pin.name}"].integrity\n` +
        `  Saw: ${recorded}\n` +
        `  Wanted: an SRI string such as "sha512-<base64>".\n` +
        `  Fix: clear the install directory and reinstall so npm rewrites the record.`,
    )
  }
  if (!equalHashes(declared.sri, recorded)) {
    throw new Error(
      `Integrity mismatch for npm tool "${pin.name}@${pin.version}".\n` +
        `  Where: ${lockfilePath} → packages["node_modules/${pin.name}"].integrity\n` +
        `  Saw: ${parseHash(recorded).sri}\n` +
        `  Wanted: ${declared.sri} (packages/cli/bundle-tools.json)\n` +
        `  Fix: the installed tarball is not the pinned one. Treat this as a ` +
        `supply-chain event until proven otherwise. If the version was ` +
        `intentionally bumped, update the pin from ` +
        `\`npm view ${pin.name}@${pin.version} dist.integrity\`.`,
    )
  }
}
