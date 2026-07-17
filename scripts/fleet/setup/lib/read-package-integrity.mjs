/**
 * @file Print the checked-in pnpm-lock.yaml integrity for an exact package
 *   version. This runs before pnpm / node_modules exist, so the parser is
 *   deliberately small and dependency-free. It only reads the `packages:`
 *   resolution entry pnpm writes for `<package-name>@<version>` and emits the
 *   SRI string consumed by install-tool.mjs. Usage: node
 *   read-package-integrity.mjs <package-name> <version>
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

function packageKey(line) {
  const match = /^  (?:'([^']+)'|"([^"]+)"|(\S.*)):\s*$/.exec(line)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

export function readPnpmLockIntegrity(content, pkgName, version) {
  const wanted = `${pkgName}@${version}`
  const lines = content.split(/\r?\n/)
  let inPackages = false
  let inWantedPackage = false

  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
    if (!inPackages) {
      if (line === 'packages:') {
        inPackages = true
      }
      continue
    }
    if (/^\S/.test(line)) {
      inPackages = line === 'packages:'
      inWantedPackage = false
      continue
    }

    const key = packageKey(line)
    if (key !== undefined) {
      inWantedPackage = key === wanted
      continue
    }
    if (!inWantedPackage) {
      continue
    }

    const match = /\bintegrity:\s*['"]?([^'",}\s]+)['"]?/.exec(line)
    if (match) {
      return match[1]
    }
  }
  return undefined
}

function main() {
  const pkgName = process.argv[2]
  const version = process.argv[3]
  if (!pkgName || !version) {
    process.stderr.write(
      'Usage: node read-package-integrity.mjs <package-name> <version>\n',
    )
    process.exitCode = 2
    return
  }

  const lockPath = path.resolve('pnpm-lock.yaml')
  if (!existsSync(lockPath)) {
    return
  }
  const integrity = readPnpmLockIntegrity(
    readFileSync(lockPath, 'utf8'),
    pkgName,
    version,
  )
  if (integrity) {
    process.stdout.write(integrity)
  }
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  main()
}
