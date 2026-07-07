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

import { NPM_REGISTRY } from '../constants/npm-registry.mts'
import { findWorkspacePackages } from './package-files-are-allowlisted.mts'

const logger = getDefaultLogger()

// Re-exported for back-compat with importers; the single source of truth is
// scripts/fleet/constants/npm-registry.mts.
export { NPM_REGISTRY }

export interface PublishConfig {
  access?: string | undefined
  provenance?: boolean | undefined
  registry?: string | undefined
}

export interface PublishablePackageJson {
  name?: string | undefined
  private?: boolean | undefined
  publishConfig?: PublishConfig | undefined
}

export interface PublishConfigFinding {
  field: 'access' | 'provenance' | 'registry'
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
 * Evaluate one parsed `package.json`. Returns a finding per violated
 * requirement; an empty array means the package is hardened (or is `private`
 * and therefore never publishes). Pure + side-effect-free so it is exercised
 * directly in tests; `runCheck` handles discovery, IO, and reporting.
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
  const repoRoot = process.cwd()
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
