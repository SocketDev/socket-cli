#!/usr/bin/env node
/**
 * @file Install socket-token-minifier as a self-contained CLI at
 *   ~/.socket/_wheelhouse/socket-token-minifier/ with its own node_modules/.
 *   Writes a thin bin shim at ~/.socket/_wheelhouse/bin/socket-token-minifier
 *   that execs the installed entry-point. **Install model (post-rev)**: the
 *   source files (`.mts`) are COPIED to the install dest as top-level files —
 *   NOT installed under `node_modules/@socketsecurity/token-minifier/`. Reason:
 *   Node 22+ refuses to strip TS types from files under `node_modules/`
 *   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The fleet convention is
 *   `.mts` source everywhere, so the install model adapts: source lives at the
 *   dest root, only `dependencies/` end up under `node_modules/`. The proxy
 *   resolves its deps via the colocated `node_modules` — same module-resolution
 *   semantics as the wheelhouse repo itself. The install dir is a one-package
 *   pnpm workspace so the `@socketsecurity/lib-stable` alias resolves the same
 *   way it does inside the fleet (catalog maps `lib-stable` →
 *   `npm:@socketsecurity/lib@<v>`). Without the workspace yaml at the install
 *   dest, the alias name wouldn't resolve from outside the originating
 *   workspace. Source of the package: packages/socket-token-minifier/ in the
 *   wheelhouse checkout this script runs from. The script copies `bin/`,
 *   `src/`, and `package.json` into the dest, writes a minimal
 *   `pnpm-workspace.yaml` carrying the catalog aliases, then `pnpm install`s at
 *   the dest to materialize deps. Idempotent: re-running upgrades the install
 *   when the package version in package.json differs from the version recorded
 *   in the dest's package.json. Usage: pnpm run install-token-minifier pnpm run
 *   install-token-minifier -- --force # ignore cached install pnpm run
 *   install-token-minifier -- --quiet.
 */

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { safeMkdirSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { getSocketAppDir } from '@socketsecurity/lib-stable/paths/socket'
import { spawnSync } from '@socketsecurity/lib-stable/spawn/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Scripts live at <wheelhouse-root>/scripts/install-token-minifier.mts
// OR <wheelhouse-root>/template/scripts/install-token-minifier.mts.
// Walk up to find packages/socket-token-minifier — same logic either way.
const WHEELHOUSE_ROOT = (() => {
  let cur = path.dirname(__dirname)
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    if (
      existsSync(
        path.join(cur, 'packages', 'socket-token-minifier', 'package.json'),
      )
    ) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  throw new Error(
    'Could not locate packages/socket-token-minifier/ — script must run ' +
      'from inside the wheelhouse checkout.',
  )
})()

const PKG_SOURCE_DIR = path.join(
  WHEELHOUSE_ROOT,
  'packages',
  'socket-token-minifier',
)
const WHEELHOUSE_INSTALL_DIR = getSocketAppDir('wheelhouse')
const INSTALL_DIR = path.join(WHEELHOUSE_INSTALL_DIR, 'socket-token-minifier')
const BIN_DIR = path.join(WHEELHOUSE_INSTALL_DIR, 'bin')
const SHIM_PATH = path.join(BIN_DIR, 'socket-token-minifier')

interface CatalogYamlMap {
  readonly [key: string]: string
}

/**
 * Read the wheelhouse pnpm-workspace.yaml and extract just the catalog entries
 * the proxy package depends on. We need to mirror these into the install dest's
 * workspace yaml so the alias names (e.g. lib-stable) resolve correctly when
 * pnpm installs at the custom prefix.
 *
 * Parsed by hand instead of pulling in a yaml dep — the catalog block is
 * line-shaped (key: value) and we only need the @socketsecurity/* entries the
 * proxy actually references.
 */
export function readNeededCatalogEntries(): CatalogYamlMap {
  const yamlPath = path.join(WHEELHOUSE_ROOT, 'pnpm-workspace.yaml')
  const text = readFileSync(yamlPath, 'utf8')
  const lines = text.split('\n')
  let inCatalog = false
  const out: Record<string, string> = {}
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // Match the `catalog:` top-level key. Sub-catalogs (`catalogs.default:`)
    // are uncommon in the fleet — wheelhouse uses the top-level form.
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true
      continue
    }
    if (inCatalog) {
      // Catalog block ends when we hit a non-indented line.
      if (/^\S/.test(line)) {
        inCatalog = false
        continue
      }
      // Match `  '@socketsecurity/...': '...'` or unquoted variants.
      // Split on the first `:` after the key so the value is captured
      // raw — then trim surrounding quotes + whitespace ourselves
      // instead of trying to balance them in the regex.
      const m = /^\s+'?(@socketsecurity\/[^':]+)'?:\s*(.+?)\s*$/.exec(line)
      if (m) {
        let value = m[2] as string
        // Strip wrapping single or double quotes.
        if (
          (value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))
        ) {
          value = value.slice(1, -1)
        }
        out[m[1] as string] = value
      }
    }
  }
  return out
}

/**
 * Emit a minimal pnpm-workspace.yaml at the install dest that mirrors the
 * catalog aliases the package source declares. Keeps imports of
 * `@socketsecurity/lib-stable/...` resolvable from inside the install.
 */
export function writeInstallWorkspaceYaml(catalog: CatalogYamlMap): void {
  const lines = ['catalog:']
  for (const [k, v] of Object.entries(catalog)) {
    // Quote values that aren't bare versions (e.g. `npm:foo@1.0.0`).
    const needsQuotes = /^[^\d]/.test(v) || v.includes(':') || v.includes('@')
    lines.push(`  '${k}': ${needsQuotes ? `'${v}'` : v}`)
  }
  writeFileSync(
    path.join(INSTALL_DIR, 'pnpm-workspace.yaml'),
    lines.join('\n') + '\n',
    'utf8',
  )
}

/**
 * Copy the source package's `package.json` into the install dest, preserving
 * its `dependencies` block (which pnpm will materialize on install). Adds an
 * `x-source-version` field that mirrors `version` for idempotency tracking.
 * Stripping `bin`/`exports` keeps pnpm from trying to wire global binaries at
 * install time — we drop our own shim explicitly.
 */
export function writeInstallPackageJson(sourceVersion: string): void {
  const sourcePkg = JSON.parse(
    readFileSync(path.join(PKG_SOURCE_DIR, 'package.json'), 'utf8'),
  )
  const pkg = {
    name: sourcePkg.name ?? '@socketsecurity/token-minifier',
    version: sourcePkg.version ?? sourceVersion,
    private: true,
    type: sourcePkg.type ?? 'module',
    dependencies: sourcePkg.dependencies ?? {},
    'x-source-version': sourceVersion,
  }
  writeFileSync(
    path.join(INSTALL_DIR, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n',
    'utf8',
  )
}

/**
 * Mirror the source `bin/` and `src/` directories into the install dest. Keeps
 * file extensions intact (`.mts` source stays `.mts`) so Node 22+'s built-in
 * type-stripping handles them at runtime. Crucial: the source files land at the
 * dest's TOP LEVEL, NOT under `node_modules/` — Node refuses to strip types
 * under `node_modules/`.
 *
 * `fs.cp` with recursive + force is the cross-platform equivalent of `cp -r`.
 * Force overwrites stale files on reinstall.
 */
export function copySource(): void {
  // Use sync fs API for consistency with the rest of the script — this
  // is a one-shot install, not a hot path. `cpSync` exists since
  // Node 20; the recursive option is required for directories.
  for (const subdir of ['bin', 'src']) {
    cpSync(path.join(PKG_SOURCE_DIR, subdir), path.join(INSTALL_DIR, subdir), {
      recursive: true,
      force: true,
    })
  }
}

/**
 * Read the source package.json version to drive idempotency. We re- install
 * when the recorded x-source-version in the dest's package.json differs from
 * the source.
 */
export function readSourceVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(PKG_SOURCE_DIR, 'package.json'), 'utf8'),
  )
  return pkg.version ?? '0.0.0'
}

export function readInstalledVersion(): string | undefined {
  const installedPkgPath = path.join(INSTALL_DIR, 'package.json')
  if (!existsSync(installedPkgPath)) {
    return undefined
  }
  try {
    const pkg = JSON.parse(readFileSync(installedPkgPath, 'utf8'))
    return pkg['x-source-version']
  } catch {
    return undefined
  }
}

export function pnpmInstallAtDest(quiet: boolean): void {
  const result = spawnSync(
    'pnpm',
    [
      'install',
      // No frozen lockfile — we generate fresh per install.
      '--no-frozen-lockfile',
      // Don't run lifecycle scripts of dependents — the proxy has none
      // and we're a leaf install.
      '--ignore-scripts',
    ],
    {
      cwd: INSTALL_DIR,
      stdio: quiet ? 'ignore' : 'inherit',
    },
  )
  if (result.status !== 0) {
    throw new Error('pnpm install at install dir failed; see output above')
  }
}

export function writeBinShim(): void {
  // Shim execs the proxy's top-level bin/ entry. Source lives at
  // INSTALL_DIR/bin/, NOT under node_modules/ — so Node 22+ can strip
  // types from the .mts file at runtime. `node` is on PATH on every
  // dev + CI machine the fleet runs on.
  const targetEntry = path.join(INSTALL_DIR, 'bin', 'socket-token-minifier.mts')
  const shim = [
    '#!/bin/bash',
    '# socket-token-minifier shim — auto-generated by install-token-minifier.mts.',
    '# Do not hand-edit; the contents are regenerated on every install.',
    `exec node ${JSON.stringify(targetEntry)} "$@"`,
    '',
  ].join('\n')
  safeMkdirSync(BIN_DIR)
  writeFileSync(SHIM_PATH, shim, { mode: 0o755 })
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    strict: false,
  })
  const quiet = Boolean(values['quiet'])
  const force = Boolean(values['force'])

  const sourceVersion = readSourceVersion()
  const installedVersion = readInstalledVersion()
  if (!force && installedVersion === sourceVersion && existsSync(SHIM_PATH)) {
    if (!quiet) {
      logger.log(
        `socket-token-minifier already installed at v${sourceVersion} ` +
          `(${INSTALL_DIR}). Use --force to reinstall.`,
      )
    }
    return
  }

  if (!quiet) {
    logger.log(
      `Installing socket-token-minifier v${sourceVersion} to ${INSTALL_DIR}…`,
    )
  }

  // Set up the install dir.
  safeMkdirSync(INSTALL_DIR)

  // Copy source files (.mts and friends) to the install dest.
  // Top-level (NOT under node_modules) — Node 22+ won't strip TS types
  // from files inside node_modules.
  copySource()

  // Write the install-dir workspace yaml (carries catalog aliases).
  const catalog = readNeededCatalogEntries()
  writeInstallWorkspaceYaml(catalog)

  // Write the install-dir package.json (copy source's deps + version).
  writeInstallPackageJson(sourceVersion)

  // Materialize the deps in a colocated node_modules.
  pnpmInstallAtDest(quiet)

  // Drop the bin shim.
  writeBinShim()

  if (!quiet) {
    logger.log(`Installed. Shim: ${SHIM_PATH}`)
    logger.log(
      'Start it manually: socket-token-minifier (with ' +
        `${BIN_DIR} on PATH), or wire the auto-start hook in your fleet repo.`,
    )
  }
}

try {
  await main()
} catch (e) {
  logger.fail(errorMessage(e))
  process.exit(1)
}
