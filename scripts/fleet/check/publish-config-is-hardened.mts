/*
 * @file Pre-publish source gate: every publishable workspace `package.json`
 *   must declare `publishConfig.access: "public"` and
 *   `publishConfig.provenance: true`, and — if it pins `publishConfig.registry`
 *   — that registry must be npmjs. These are the source-config preconditions for
 *   a public, provenance-attested release under OIDC trusted publishing:
 *
 *     - `access: "public"`   — a scoped name defaults to `restricted`; without
 *                              this an accidental private publish (or a failed
 *                              one) is the silent failure mode.
 *     - `provenance: true`   — `npm publish` emits NO provenance attestation
 *                              without it, even when the upload authenticates
 *                              via a GitHub Actions OIDC trusted publisher.
 *     - `registry` (if set)  — a provenance-signed tarball must land on npm; a
 *                              stray registry pin publishes it elsewhere.
 *
 *   Beyond the required floor, the rest of the pnpm-documented publishConfig
 *   surface (pnpm.io/package_json#publishconfig) is ALLOWED and shape-checked:
 *
 *     - unknown keys fail    — pnpm silently ignores a key it doesn't document
 *                              (`executibleFiles`), so a typo ships a manifest
 *                              missing the intended override.
 *     - `types` completeness — a manifest that overrides an entry point at
 *                              publish time (main/module/exports/browser/bin)
 *                              while declaring top-level `types`/`typings` must
 *                              override `types` too, or the published manifest
 *                              keeps the dev-time types path.
 *     - `executableFiles`    — must be an array of non-empty strings.
 *     - `directory`          — must be a package-relative subdirectory (no
 *                              absolute path, no `..` escape).
 *     - `linkDirectory`      — must be a boolean, and only meaningful beside
 *                              `directory`.
 *
 *   The post-publish registry audit lives in `provenance-is-attested.mts` (and
 *   the `provenance-publish-nudge` Stop hook); this is the complementary
 *   pre-publish gate that runs before the tarball ever leaves the machine.
 *
 *   Usage: node scripts/fleet/check/publish-config-is-hardened.mts [--json]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { NPM_REGISTRY } from '../constants/npm-registry.mts'
import { REPO_ROOT } from '../paths.mts'
import { findWorkspacePackages } from './package-files-are-allowlisted.mts'

const logger = getDefaultLogger()

// Re-exported for back-compat with importers; the single source of truth is
// scripts/fleet/constants/npm-registry.mts.
export { NPM_REGISTRY }

/**
 * The manifest fields pnpm documents as overridable at publish time
 * (pnpm.io/package_json#publishconfig — "The following fields may be
 * overridden", `engines` since pnpm 10.22.0).
 */
export const PUBLISH_TIME_OVERRIDE_FIELDS: readonly string[] = [
  'bin',
  'browser',
  'cpu',
  'engines',
  'es2015',
  'esnext',
  'exports',
  'main',
  'module',
  'os',
  'types',
  'typesVersions',
  'typings',
  'umd:main',
  'unpkg',
]

/**
 * The publish-time override fields that move a package's ENTRY POINTS —
 * overriding any of these while top-level `types`/`typings` stays dev-pathed
 * publishes a manifest whose types field dangles.
 */
export const ENTRY_POINT_OVERRIDE_FIELDS: readonly string[] = [
  'bin',
  'browser',
  'exports',
  'main',
  'module',
]

/**
 * Every publishConfig key pnpm documents: the npm publish settings, the
 * pnpm-specific extras (`executableFiles`, `directory`, `linkDirectory`),
 * and the publish-time override fields above. Anything else is silently
 * ignored by pnpm — a typo'd key ships a manifest missing its override.
 */
export const KNOWN_PUBLISH_CONFIG_FIELDS: ReadonlySet<string> = new Set([
  'access',
  'directory',
  'executableFiles',
  'linkDirectory',
  'provenance',
  'registry',
  'tag',
  ...PUBLISH_TIME_OVERRIDE_FIELDS,
])

export interface PublishConfig {
  [key: string]: unknown
  access?: string | undefined
  directory?: unknown | undefined
  executableFiles?: unknown | undefined
  linkDirectory?: unknown | undefined
  provenance?: boolean | undefined
  registry?: string | undefined
  types?: unknown | undefined
  typings?: unknown | undefined
}

export interface PublishablePackageJson {
  name?: string | undefined
  private?: boolean | undefined
  publishConfig?: PublishConfig | undefined
  types?: string | undefined
  typings?: string | undefined
}

export interface PublishConfigFinding {
  field:
    | 'access'
    | 'directory'
    | 'executableFiles'
    | 'linkDirectory'
    | 'provenance'
    | 'registry'
    | 'types'
    | 'unknown-key'
  message: string
  pkgName: string
  relPath: string
}

/**
 * Format a config value for an error message: `unset` when absent, else its
 * JSON form so a string vs. boolean vs. wrong-string is unambiguous.
 */
export function formatValue(value: unknown): string {
  return value === undefined ? 'unset' : JSON.stringify(value)
}

/**
 * True when `pc` overrides at least one entry-point field at publish time.
 */
export function overridesEntryPoints(pc: PublishConfig): boolean {
  return ENTRY_POINT_OVERRIDE_FIELDS.some(f => pc[f] !== undefined)
}

// Windows drive-letter absolute prefix (`C:` / `c:`) — normalizePath keeps the
// drive segment, so an absolute Windows path still starts with it.
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/

/**
 * True when `value` is a legal `publishConfig.directory`: a non-empty,
 * package-relative subdirectory. An absolute path or a `..` segment escapes
 * the package root and publishes something other than this package's output.
 */
export function isLegalPublishDirectory(value: string): boolean {
  if (value === '') {
    return false
  }
  const normalized = normalizePath(value)
  if (normalized.startsWith('/') || WINDOWS_DRIVE_RE.test(normalized)) {
    return false
  }
  return !normalized.split('/').includes('..')
}

/**
 * The publishConfig keys pnpm does not document, sorted. pnpm ignores them
 * silently, so each is either a typo or a key that belongs in the manifest
 * proper.
 */
export function unknownPublishConfigKeys(pc: PublishConfig): string[] {
  return Object.keys(pc)
    .filter(k => !KNOWN_PUBLISH_CONFIG_FIELDS.has(k))
    .toSorted()
}

/**
 * Evaluate one parsed `package.json`. Returns a finding per violated
 * requirement — the required floor first (access, provenance, registry), then
 * the shape findings (types completeness, executableFiles, directory,
 * linkDirectory, unknown keys); an empty array means the package is hardened
 * (or is `private` and therefore never publishes). Pure + side-effect-free so
 * it is exercised directly in tests; `runCheck` handles discovery, IO, and
 * reporting.
 */
export function checkPublishConfig(
  pkg: PublishablePackageJson,
  relPath: string,
): PublishConfigFinding[] {
  if (pkg.private === true) {
    return []
  }
  const name = pkg.name ?? '(unnamed)'
  const pc = pkg.publishConfig
  const findings: PublishConfigFinding[] = []
  if (pc?.access !== 'public') {
    findings.push({
      field: 'access',
      message: `${name}: publishConfig.access is ${formatValue(pc?.access)} at ${relPath} — a scoped package defaults to "restricted" and would publish privately or fail. Set publishConfig.access to "public".`,
      pkgName: name,
      relPath,
    })
  }
  if (pc?.provenance !== true) {
    findings.push({
      field: 'provenance',
      message: `${name}: publishConfig.provenance is ${formatValue(pc?.provenance)} at ${relPath} — npm publish emits no provenance attestation without it. Set publishConfig.provenance to true.`,
      pkgName: name,
      relPath,
    })
  }
  if (pc?.registry !== undefined && pc.registry !== NPM_REGISTRY) {
    findings.push({
      field: 'registry',
      message: `${name}: publishConfig.registry is ${formatValue(pc.registry)} at ${relPath} — a provenance-signed tarball must publish to npm. Set publishConfig.registry to "${NPM_REGISTRY}" or remove it (npm defaults to npmjs).`,
      pkgName: name,
      relPath,
    })
  }
  if (!pc) {
    return findings
  }
  const declaredTypes = pkg.types ?? pkg.typings
  if (
    declaredTypes !== undefined &&
    overridesEntryPoints(pc) &&
    pc.types === undefined &&
    pc.typings === undefined
  ) {
    findings.push({
      field: 'types',
      message: `${name}: publishConfig overrides entry points but not types at ${relPath} — the published manifest would keep the dev-time types path ${formatValue(declaredTypes)}. Set publishConfig.types to the built declaration entry.`,
      pkgName: name,
      relPath,
    })
  }
  if (pc.executableFiles !== undefined) {
    const ef = pc.executableFiles
    const legal =
      Array.isArray(ef) && ef.every(f => typeof f === 'string' && f !== '')
    if (!legal) {
      findings.push({
        field: 'executableFiles',
        message: `${name}: publishConfig.executableFiles is ${formatValue(ef)} at ${relPath} — pnpm expects an array of non-empty file paths to +x. Make it an array of package-relative path strings.`,
        pkgName: name,
        relPath,
      })
    }
  }
  if (pc.directory !== undefined) {
    const dir = pc.directory
    if (typeof dir !== 'string' || !isLegalPublishDirectory(dir)) {
      findings.push({
        field: 'directory',
        message: `${name}: publishConfig.directory is ${formatValue(dir)} at ${relPath} — pnpm publishes that directory INSTEAD of the package root, so it must be a package-relative subdirectory. Point it at a subdirectory (no absolute path, no "..").`,
        pkgName: name,
        relPath,
      })
    }
  }
  if (pc.linkDirectory !== undefined) {
    if (typeof pc.linkDirectory !== 'boolean') {
      findings.push({
        field: 'linkDirectory',
        message: `${name}: publishConfig.linkDirectory is ${formatValue(pc.linkDirectory)} at ${relPath} — pnpm expects a boolean. Set it to true or false.`,
        pkgName: name,
        relPath,
      })
    } else if (pc.linkDirectory === true && pc.directory === undefined) {
      findings.push({
        field: 'linkDirectory',
        message: `${name}: publishConfig.linkDirectory is true with no publishConfig.directory at ${relPath} — linkDirectory symlinks the publish directory during local development, so it does nothing alone. Add publishConfig.directory or drop linkDirectory.`,
        pkgName: name,
        relPath,
      })
    }
  }
  for (const key of unknownPublishConfigKeys(pc)) {
    findings.push({
      field: 'unknown-key',
      message: `${name}: publishConfig.${key} is not a pnpm-documented publishConfig field at ${relPath} — pnpm ignores unknown keys silently, so the intended override never ships. Fix the spelling (see pnpm.io/package_json#publishconfig) or move the field to the manifest proper.`,
      pkgName: name,
      relPath,
    })
  }
  return findings
}

/**
 * Read + parse a `package.json` with its `publishConfig` preserved. The sibling
 * `readPackageJson` types the result without `publishConfig`, so this check
 * reads its own. Returns `undefined` on missing file or parse error (a
 * malformed package.json is not this gate's concern).
 */
export function readPublishablePackageJson(
  pkgDir: string,
): PublishablePackageJson | undefined {
  const pkgPath = path.join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as PublishablePackageJson
  } catch {
    return undefined
  }
}

/**
 * Discover every workspace package, evaluate each publishable one, and return
 * all findings. Pure of process state so callers (CLI + tests) decide
 * reporting.
 */
export function collectFindings(repoRoot: string): PublishConfigFinding[] {
  const pkgDirs = findWorkspacePackages(repoRoot)
  const findings: PublishConfigFinding[] = []
  for (let i = 0, { length } = pkgDirs; i < length; i += 1) {
    const pkgDir = pkgDirs[i]!
    const pkg = readPublishablePackageJson(pkgDir)
    if (!pkg) {
      continue
    }
    const rel = path.relative(repoRoot, pkgDir)
    const relPath = `${rel === '' ? '.' : rel}/package.json`
    findings.push(...checkPublishConfig(pkg, relPath))
  }
  return findings
}

/**
 * CLI entry: discover, evaluate, report. Returns the intended exit code (1 when
 * any publishable package is under-hardened, else 0).
 */
export function runCheck(repoRoot: string): number {
  const findings = collectFindings(repoRoot)
  if (findings.length === 0) {
    return 0
  }
  logger.fail(
    `publish-config-is-hardened: ${findings.length} publishConfig issue(s)`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    logger.substep(findings[i]!.message)
  }
  return 1
}

function main(): void {
  const { values } = parseArgs({
    options: { json: { default: false, type: 'boolean' } },
    strict: false,
  })
  const repoRoot = REPO_ROOT
  if (values['json']) {
    const findings = collectFindings(repoRoot)
    logger.log(JSON.stringify({ findings, ok: findings.length === 0 }, null, 2))
    process.exitCode = findings.length === 0 ? 0 : 1
    return
  }
  process.exitCode = runCheck(repoRoot)
}

try {
  main()
} catch (e) {
  logger.error(e)
  process.exitCode = 1
}
