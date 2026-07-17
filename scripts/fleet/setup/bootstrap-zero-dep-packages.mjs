/**
 * @file Bootstrap declared foundation packages before pnpm install. The
 *   package tarball is checked by Socket Firewall, downloaded through the
 *   dependency-free install-tool.mjs, verified against pnpm-lock.yaml's
 *   checked-in SRI, validated as zero-runtime-dependency, and then moved from
 *   the npm tarball's `package/` wrapper into node_modules. This is the single
 *   local + CI implementation and intentionally imports only node: builtins.
 *   Usage: node bootstrap-zero-dep-packages.mjs [--repo-root <path>]
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap: the lib spawn wrapper is one of the packages this script provisions.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const LIB_DIR = path.join(SCRIPT_DIR, 'lib')

export const FOUNDATION_PACKAGES = Object.freeze([
  '@socketregistry/packageurl-js',
  '@socketregistry/packageurl-js-stable',
  '@sinclair/typebox',
  '@socketsecurity/lib',
  '@socketsecurity/lib-stable',
  '@socketsecurity/sdk',
  '@socketsecurity/sdk-stable',
])

function log(message) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- the logger package is not installed yet.
  console.log(message)
}

function fail(message) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- the logger package is not installed yet.
  console.error(message)
}

function parseRepoRoot(argv) {
  const index = argv.indexOf('--repo-root')
  if (index === -1) {
    return process.cwd()
  }
  const value = argv[index + 1]
  if (!value) {
    fail('× --repo-root requires a path')
    return undefined
  }
  return path.resolve(value)
}

function runNode(script, args, repoRoot, stdio = 'pipe') {
  return spawnSync(process.execPath, [path.join(LIB_DIR, script), ...args], {
    cwd: repoRoot,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    stdio,
  })
}

function nodeOutput(script, args, repoRoot) {
  const result = runNode(script, args, repoRoot)
  if (result.status !== 0) {
    return undefined
  }
  return typeof result.stdout === 'string' ? result.stdout.trim() : undefined
}

export function isDeclaredDependency(manifest, pkgName) {
  const fields = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]
  for (let i = 0, { length } = fields; i < length; i += 1) {
    if (typeof manifest[fields[i]]?.[pkgName] === 'string') {
      return true
    }
  }
  return false
}

export function validateZeroDepManifest(manifest, pkgName, version) {
  if (manifest.name !== pkgName) {
    return `tarball package name is ${String(manifest.name)}, expected ${pkgName}`
  }
  if (manifest.version !== version) {
    return `tarball package version is ${String(manifest.version)}, expected ${version}`
  }
  const dependencies = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]
  if (dependencies.length > 0) {
    return `${pkgName}@${version} is no longer zero-dependency (${dependencies.join(', ')})`
  }
  return undefined
}

function packageIsInstalled(repoRoot, pkgName) {
  return existsSync(
    path.join(repoRoot, 'node_modules', pkgName, 'package.json'),
  )
}

function installPackage(repoRoot, pkgName, fetchPkg, version, integrity) {
  const base = fetchPkg.includes('/')
    ? fetchPkg.slice(fetchPkg.lastIndexOf('/') + 1)
    : fetchPkg
  const tarballUrl = `https://registry.npmjs.org/${fetchPkg}/-/${base}-${version}.tgz`
  const nodeModulesDir = path.join(repoRoot, 'node_modules')
  mkdirSync(nodeModulesDir, { recursive: true })
  const stageDir = mkdtempSync(path.join(nodeModulesDir, '.socket-bootstrap-'))
  const dest = path.join(nodeModulesDir, pkgName)

  log(`Bootstrapping ${pkgName}@${version} from npm registry…`)
  const install = spawnSync(
    process.execPath,
    [path.join(LIB_DIR, 'install-tool.mjs'), tarballUrl, integrity, stageDir],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (install.status !== 0) {
    rmSync(stageDir, { recursive: true, force: true })
    fail(`× verified download failed for ${pkgName}@${version}`)
    return false
  }

  const packageDir = path.join(stageDir, 'package')
  const manifestPath = path.join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) {
    rmSync(stageDir, { recursive: true, force: true })
    fail(`× ${pkgName}@${version} tarball has no package/package.json`)
    return false
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    rmSync(stageDir, { recursive: true, force: true })
    fail(
      // oxlint-disable-next-line socket/prefer-error-message, socket/prefer-error-message-helper -- pre-pnpm bootstrap cannot import the lib error helper it is provisioning.
      `× ${pkgName}@${version} has an invalid package.json: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
  const invalid = validateZeroDepManifest(manifest, fetchPkg, version)
  if (invalid) {
    rmSync(stageDir, { recursive: true, force: true })
    fail(`× ${invalid}`)
    return false
  }

  mkdirSync(path.dirname(dest), { recursive: true })
  rmSync(dest, { recursive: true, force: true })
  renameSync(packageDir, dest)
  rmSync(stageDir, { recursive: true, force: true })
  log(`✓ ${pkgName}@${version} → node_modules/${pkgName}`)
  return true
}

export function bootstrapZeroDepPackages(repoRoot) {
  if (
    existsSync(path.join(repoRoot, 'scripts', 'bootstrap-from-registry.mts'))
  ) {
    log(
      'Repo has its own bootstrap-from-registry.mts; skipping zero-dep bootstrap.',
    )
    return true
  }

  const packageJsonPath = path.join(repoRoot, 'package.json')
  if (!existsSync(packageJsonPath)) {
    fail(`× no package.json found at ${packageJsonPath}`)
    return false
  }
  const rootManifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  for (let i = 0, { length } = FOUNDATION_PACKAGES; i < length; i += 1) {
    const pkgName = FOUNDATION_PACKAGES[i]
    if (!isDeclaredDependency(rootManifest, pkgName)) {
      continue
    }
    if (packageIsInstalled(repoRoot, pkgName)) {
      log(`${pkgName} already installed; skipping.`)
      continue
    }

    const pinned = nodeOutput('read-pinned-version.mjs', [pkgName], repoRoot)
    if (!pinned) {
      fail(`× ${pkgName} is declared but has no exact bootstrap pin`)
      return false
    }
    const tab = pinned.indexOf('\t')
    const fetchPkg = tab === -1 ? pkgName : pinned.slice(0, tab)
    const version = tab === -1 ? pinned : pinned.slice(tab + 1)
    const integrity = nodeOutput(
      'read-package-integrity.mjs',
      [fetchPkg, version],
      repoRoot,
    )
    if (!integrity) {
      fail(
        `× pnpm-lock.yaml has no integrity for ${fetchPkg}@${version}; refusing an unverified bootstrap`,
      )
      return false
    }

    const firewall = runNode(
      'check-firewall.mjs',
      [fetchPkg, version],
      repoRoot,
      'inherit',
    )
    if (firewall.status !== 0) {
      return false
    }
    if (!installPackage(repoRoot, pkgName, fetchPkg, version, integrity)) {
      return false
    }
  }
  return true
}

function main() {
  const repoRoot = parseRepoRoot(process.argv.slice(2))
  if (!repoRoot || !bootstrapZeroDepPackages(repoRoot)) {
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  main()
}
