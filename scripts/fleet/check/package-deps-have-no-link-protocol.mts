#!/usr/bin/env node
/**
 * @file Commit-time gate: no `package.json` in the repo may declare a `link:`
 *   protocol dependency. `link:` symlinks a dependency to an arbitrary local
 *   path — non-portable, outside the lockfile's integrity guarantees, and a
 *   break of the fleet's zero-dep bundle contract. Use `workspace:` for in-repo
 *   packages or `catalog:` for centrally-pinned versions. Scans dependencies,
 *   devDependencies, optionalDependencies, and peerDependencies across every
 *   tracked package.json (skipping node_modules / dist / build / .git). Exits
 *   non-zero on any violation.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

interface PackageJson {
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
  optionalDependencies?: Record<string, string> | undefined
  peerDependencies?: Record<string, string> | undefined
}

export interface LinkViolation {
  field: string
  file: string
  package: string
  value: string
}

export async function checkPackageJson(
  filePath: string,
): Promise<LinkViolation[]> {
  const pkg = JSON.parse(await fs.readFile(filePath, 'utf8')) as PackageJson
  const violations: LinkViolation[] = []
  for (const field of DEP_FIELDS) {
    const deps = pkg[field]
    if (!deps) {
      continue
    }
    for (const [name, value] of Object.entries(deps)) {
      if (typeof value === 'string' && value.startsWith('link:')) {
        violations.push({ field, file: filePath, package: name, value })
      }
    }
  }
  return violations
}

export async function findPackageJsonFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (
      entry.name === '.git' ||
      entry.name === 'build' ||
      entry.name === 'dist' ||
      entry.name === 'node_modules'
    ) {
      continue
    }
    if (entry.isDirectory()) {
      files.push(...(await findPackageJsonFiles(fullPath)))
    } else if (entry.name === 'package.json') {
      files.push(fullPath)
    }
  }
  return files
}

async function main(): Promise<void> {
  const files = await findPackageJsonFiles(REPO_ROOT)
  const violations: LinkViolation[] = []
  for (const file of files) {
    violations.push(...(await checkPackageJson(file)))
  }
  if (violations.length === 0) {
    logger.success('No link: protocol dependencies found')
    return
  }
  logger.fail('Found link: protocol dependencies (prohibited)')
  logger.log('')
  logger.log(
    'Use workspace: for in-repo packages or catalog: for centrally-pinned versions.',
  )
  logger.log('')
  for (const violation of violations) {
    logger.log(`  ${path.relative(REPO_ROOT, violation.file)}`)
    logger.log(
      `    ${violation.field}.${violation.package}: "${violation.value}"`,
    )
  }
  process.exitCode = 1
}

main().catch((error: unknown) => {
  logger.fail('link-protocol check failed:', error)
  process.exitCode = 1
})
