/**
 * @fileoverview Bootstrap zero-dep Socket packages from the npm
 * registry directly into node_modules/ before pnpm install runs.
 *
 * Why: setup.mts (and downstream tooling) imports `@socketsecurity/lib`
 * and other zero-dep Socket helpers at module-load time. On a fresh
 * clone, `pnpm install` itself runs scripts that import these — but
 * pnpm install hasn't completed yet, so the imports fail with
 * `ERR_MODULE_NOT_FOUND`. Bootstrap solves this by fetching the
 * pinned tarball directly from the npm registry and extracting it
 * into node_modules/<scope>/<name>/. Subsequent pnpm install will
 * see the directory and either keep it (if version matches) or
 * replace it with the workspace-resolved version.
 *
 * Pinned versions come from `pnpm-workspace.yaml`'s `catalog:` —
 * single source of truth.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'

import { tmpdir } from 'node:os'

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// Packages to bootstrap. Each entry must:
//   1. Be zero-dependency (or only depend on already-bootstrapped
//      packages) so we don't have to recurse into their dep graph.
//   2. Be imported by setup.mts or another script that runs BEFORE
//      pnpm install completes — otherwise normal install handles it.
const BOOTSTRAP_PACKAGES = ['@socketsecurity/lib']

const log = (msg: string): void => {
  process.stdout.write(`[bootstrap] ${msg}\n`)
}

const err = (msg: string): void => {
  process.stderr.write(`[bootstrap] ${msg}\n`)
}

/**
 * Read the pinned version of a package, checking (in order):
 *   1. `pnpm-workspace.yaml` `catalog:` entries
 *   2. Root `package.json` `dependencies` / `devDependencies` (skip
 *      "catalog:" / "workspace:" / "*" / "" — those need (1)).
 *
 * Avoids a dep on a YAML parser by hand-parsing the catalog block —
 * this script must itself be zero-dep so it can run before
 * `pnpm install` brings any tooling in.
 */

// Strip range prefixes (^, ~, >=, <=, etc.) so the registry tarball
// URL gets an exact semver. Applied to BOTH the catalog and the
// package.json paths so they can never disagree.
const stripRange = (v: string): string =>
  v.replace(/^[\^~>=<]+/, '').trim()

const readPinnedVersion = (pkgName: string): string => {
  // (1) pnpm-workspace.yaml catalog
  const wsPath = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  if (existsSync(wsPath)) {
    const content = readFileSync(wsPath, 'utf8')
    const lines = content.split('\n')
    let inCatalog = false
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '')
      if (/^catalog:\s*$/.test(line)) {
        inCatalog = true
        continue
      }
      if (inCatalog) {
        // Leave the catalog block on the next top-level key (no
        // leading whitespace, ends with ':').
        if (/^\S.*:\s*$/.test(line)) {
          inCatalog = false
          continue
        }
        const m = line.match(
          /^\s+['"]?([@A-Za-z0-9_/-]+)['"]?\s*:\s*['"]?([^'"\s]+)['"]?\s*$/,
        )
        if (m && m[1] === pkgName) {
          return stripRange(m[2]!)
        }
      }
    }
  }

  // (2) Root package.json dependencies / devDependencies
  const pkgJsonPath = path.join(REPO_ROOT, 'package.json')
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const deps = pkg[field]
      if (deps && typeof deps[pkgName] === 'string') {
        const v: string = deps[pkgName]
        if (
          v !== '' &&
          v !== '*' &&
          !v.startsWith('catalog:') &&
          !v.startsWith('workspace:')
        ) {
          return stripRange(v)
        }
      }
    }
  }

  throw new Error(
    `Pinned version not found for ${pkgName}. Add it to pnpm-workspace.yaml \`catalog:\` or root package.json dependencies.`,
  )
}

/**
 * Download a npm registry tarball for `<pkg>@<version>` and extract
 * it into `node_modules/<pkg>/`. Skips if the destination already
 * has a package.json with the matching version.
 */
const bootstrapPackage = (pkgName: string): void => {
  const version = readPinnedVersion(pkgName)
  const dest = path.join(REPO_ROOT, 'node_modules', pkgName)
  const destPkgJson = path.join(dest, 'package.json')

  if (existsSync(destPkgJson)) {
    try {
      const installed = JSON.parse(readFileSync(destPkgJson, 'utf8'))
      if (installed.version === version) {
        log(`${pkgName}@${version} already present, skipping`)
        return
      }
      log(
        `${pkgName} present at ${installed.version}, replacing with ${version}`,
      )
    } catch {
      // Malformed package.json — overwrite.
    }
  }

  // Build the registry tarball URL. The npm registry redirects
  // /<pkg>/-/<basename>-<version>.tgz, but for scoped packages the
  // basename is the unscoped portion.
  const unscoped = pkgName.startsWith('@')
    ? pkgName.split('/')[1]!
    : pkgName
  const tarballUrl = `https://registry.npmjs.org/${pkgName}/-/${unscoped}-${version}.tgz`

  log(`Fetching ${tarballUrl}`)
  const tarballPath = path.join(
    tmpdir(),
    `socket-bootstrap-${unscoped}-${version}.tgz`,
  )

  // Use curl — it's universally available and avoids a dep on a
  // node http client. Follow redirects with -L, fail loudly with -f.
  const curl = spawnSync(
    'curl',
    ['-fsSL', tarballUrl, '-o', tarballPath],
    { stdio: 'inherit' },
  )
  if (curl.status !== 0) {
    throw new Error(
      `Failed to download ${pkgName}@${version} from ${tarballUrl}.\nVerify the version exists on the npm registry, or check network access.`,
    )
  }

  // Ensure dest exists and is empty for clean extraction.
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  mkdirSync(dest, { recursive: true })

  // Extract: tarball top-level dir is `package/`, strip it.
  const tar = spawnSync(
    'tar',
    ['-xzf', tarballPath, '--strip-components=1', '-C', dest],
    { stdio: 'inherit' },
  )
  if (tar.status !== 0) {
    throw new Error(`Failed to extract ${tarballPath} into ${dest}.`)
  }

  rmSync(tarballPath, { force: true })
  log(`${pkgName}@${version} → node_modules/${pkgName}`)
}

const main = (): number => {
  log(`Bootstrapping ${BOOTSTRAP_PACKAGES.length} package(s) from npm registry...`)
  for (const pkg of BOOTSTRAP_PACKAGES) {
    try {
      bootstrapPackage(pkg)
    } catch (e) {
      err(`Failed to bootstrap ${pkg}: ${e instanceof Error ? e.message : String(e)}`)
      return 1
    }
  }
  log('Bootstrap complete.')
  return 0
}

process.exit(main())
