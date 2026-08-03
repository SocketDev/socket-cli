#!/usr/bin/env node
/*
 * @file `check --all` gate: npm dual-use declarations are complete and
 *   persistent — CODE IS LAW for https://docs.npmjs.com/policies/dual-use.
 *
 *   The member config (`.config/repo/socket-wheelhouse.json`) is the single
 *   source of which package roots carry the dual-use content class. For every
 *   root listed under `contentPolicy.packages`, this check requires:
 *     - `package.json` declares `contentPolicy.class: "dual-use"`;
 *     - a `DISCLOSURE` file exists at the package root and describes both the
 *       dual-use functionality and the intended legitimate use;
 *     - a publishable package (`private` not set) ships `DISCLOSURE` in its
 *       npm `files` allowlist when one is present.
 *
 *   The reverse direction holds too: a `package.json` that declares the
 *   dual-use class while the member config does not list its root is a
 *   violation — the config is how the fleet knows the declaration must
 *   persist across versions, so an undeclared-in-config package is drift.
 *
 *   Repos with no `contentPolicy` section and no declaring package pass
 *   untouched. Exit: 0 — complete; 1 — a declaration is missing or drifted.
 *
 *   Usage: node scripts/fleet/check/dual-use-declarations-are-complete.mts
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface DualUseViolation {
  fix: string
  where: string
}

interface PackageManifest {
  contentPolicy?: { class?: string | undefined } | undefined
  files?: string[] | undefined
  private?: boolean | undefined
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The package roots the member config declares as dual-use.
 */
export function declaredRoots(rootDir: string): string[] {
  const cfg = readJson(
    path.join(rootDir, '.config', 'repo', 'socket-wheelhouse.json'),
  ) as
    | { contentPolicy?: { packages?: string[] | undefined } | undefined }
    | undefined
  const packages = cfg?.contentPolicy?.packages
  return Array.isArray(packages) ? packages : []
}

/**
 * Every tracked package.json in the repo, for the reverse-direction sweep.
 */
export function trackedManifests(rootDir: string): string[] {
  const result = spawnSync(
    'git',
    ['ls-files', 'package.json', '*/package.json'],
    { cwd: rootDir, stdio: 'pipe', stdioString: true },
  )
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => Boolean(line) && !line.includes('node_modules'))
}

/**
 * Violations for one declared package root.
 */
export function checkRoot(
  rootDir: string,
  pkgRoot: string,
): DualUseViolation[] {
  const violations: DualUseViolation[] = []
  const absRoot = path.join(rootDir, pkgRoot)
  const manifestPath = path.join(absRoot, 'package.json')
  const manifest = readJson(manifestPath) as PackageManifest | undefined
  if (!manifest) {
    violations.push({
      fix: 'add the package.json or drop the root from contentPolicy.packages',
      where: `${pkgRoot}: package.json missing or unreadable`,
    })
    return violations
  }
  if (manifest.contentPolicy?.class !== 'dual-use') {
    violations.push({
      fix: 'add "contentPolicy": { "class": "dual-use" } to the package.json — the declaration must persist across versions',
      where: `${pkgRoot}/package.json: contentPolicy.class is not "dual-use"`,
    })
  }
  const disclosurePath = path.join(absRoot, 'DISCLOSURE')
  if (!existsSync(disclosurePath)) {
    violations.push({
      fix: 'add a DISCLOSURE file at the package root describing the dual-use functionality and its intended legitimate use',
      where: `${pkgRoot}/DISCLOSURE: missing`,
    })
  } else {
    const disclosure = readFileSync(disclosurePath, 'utf8').toLowerCase()
    if (
      disclosure.length < 200 ||
      !disclosure.includes('dual-use') ||
      !disclosure.includes('legitimate')
    ) {
      violations.push({
        fix: 'describe both the dual-use functionality and the intended legitimate use in DISCLOSURE',
        where: `${pkgRoot}/DISCLOSURE: too thin to satisfy the policy`,
      })
    }
  }
  if (
    !manifest.private &&
    Array.isArray(manifest.files) &&
    !manifest.files.includes('DISCLOSURE')
  ) {
    violations.push({
      fix: 'add "DISCLOSURE" to the package.json files allowlist so the disclosure ships in the npm tarball',
      where: `${pkgRoot}/package.json: files omits DISCLOSURE`,
    })
  }
  return violations
}

/**
 * All violations for the repo: declared roots checked forward, tracked
 * manifests swept in reverse.
 */
export function findViolations(rootDir: string): DualUseViolation[] {
  const roots = declaredRoots(rootDir)
  const violations: DualUseViolation[] = []
  for (let i = 0, { length } = roots; i < length; i += 1) {
    violations.push(...checkRoot(rootDir, roots[i] as string))
  }
  const normalized = new Set(
    roots.map(root =>
      path.normalize(root === '.' ? 'package.json' : `${root}/package.json`),
    ),
  )
  const manifests = trackedManifests(rootDir)
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    const rel = manifests[i] as string
    if (normalized.has(path.normalize(rel))) {
      continue
    }
    const manifest = readJson(path.join(rootDir, rel)) as
      | PackageManifest
      | undefined
    if (manifest?.contentPolicy?.class === 'dual-use') {
      violations.push({
        fix: 'list the package root under contentPolicy.packages in .config/repo/socket-wheelhouse.json so the declaration is tracked',
        where: `${rel}: declares dual-use but the member config does not list it`,
      })
    }
  }
  return violations
}

function main(): void {
  const violations = findViolations(REPO_ROOT)
  if (violations.length === 0) {
    logger.success('Dual-use declarations are complete')
    return
  }
  logger.fail('Dual-use declaration(s) incomplete per the npm dual-use policy')
  logger.log('')
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const violation = violations[i]
    if (!violation) {
      continue
    }
    logger.log(`  ${violation.where}`)
    logger.log(`    Fix: ${violation.fix}`)
  }
  logger.log('')
  logger.log('  Policy: https://docs.npmjs.com/policies/dual-use')
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
