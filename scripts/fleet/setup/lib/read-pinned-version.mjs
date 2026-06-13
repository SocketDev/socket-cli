/**
 * @file Print the pinned version of a Socket package to stdout, reading from
 *   (in order):
 *
 *   1. pnpm-workspace.yaml `catalog:` entries
 *   2. Root package.json `dependencies` / `devDependencies` (skipping "catalog:" /
 *      "workspace:" / "*" / "" placeholders) Prints the empty string if not
 *      pinned (caller decides what to do). Usage: node read-pinned-version.mjs
 *      <package-name> Used by the setup composite action's bootstrap step. Kept
 *      as a standalone .mjs file (rather than an inline `node -e "..."` blob in
 *      action.yml) so the YAML stays readable and the parsing logic is
 *      testable.
 */

import { existsSync, readFileSync } from 'node:fs'

import { argv, exit, stdout } from 'node:process'

const pkgName = argv[2]
if (!pkgName) {
  process.stderr.write('Usage: node read-pinned-version.mjs <package-name>\n') // socket-hook: allow logger -- composite action helper, raw stderr for usage
  exit(2)
}

function stripRange(v) {
  return v.replace(/^[\^~>=<]+/, '').trim()
}

// pnpm `npm:` alias form: `npm:@scope/realpkg@version`. The catalog
// can pin `@socketsecurity/lib-stable: npm:@socketsecurity/lib@5.28.0`
// to alias one name onto another's published tarball. Return the
// alias TARGET so the tarball URL points at a real published package
// (the alias name itself has no tarball on the registry). When the
// pinned value is an alias, the caller needs the resolved package
// name too, so emit `<pkg>\t<version>` (TAB-separated); plain
// versions emit `<version>` alone.
function aliasOf(v) {
  // Parse an `npm:<pkg>@<version>` alias spec: (1) the package (optionally
  // @scoped, no inner @), (2) the version after the final @.
  const m = v.match(/^npm:(@?[^@]+)@(.+)$/)
  if (!m) {
    return undefined
  }
  return { pkg: m[1], version: m[2] }
}

function fromCatalog(pkg) {
  if (!existsSync('pnpm-workspace.yaml')) {
    return undefined
  }
  const content = readFileSync('pnpm-workspace.yaml', 'utf8')
  const lines = content.split('\n')
  let inCatalog = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const rawLine = lines[i]
    const line = rawLine.replace(/\r$/, '')
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true
      continue
    }
    if (!inCatalog) {
      continue
    }
    // Leave the catalog block on the next top-level key (no leading
    // whitespace, ends with ':').
    if (/^\S.*:\s*$/.test(line)) {
      inCatalog = false
      continue
    }
    // Parse an indented `  "<name>": "<version>"` catalog/deps line: (1) the
    // package key (optionally quoted), (2) the value (optionally quoted).
    const m = line.match(
      /^\s+['"]?([@A-Za-z0-9_/-]+)['"]?\s*:\s*['"]?([^'"\s]+)['"]?\s*$/,
    )
    if (m && m[1] === pkg) {
      return stripRange(m[2])
    }
  }
  return undefined
}

function fromPackageJson(pkg) {
  if (!existsSync('package.json')) {
    return undefined
  }
  const json = JSON.parse(readFileSync('package.json', 'utf8'))
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterates a 2-element const tuple; cached-length form would obscure the literal pair.
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = json[field]
    if (deps && typeof deps[pkg] === 'string') {
      const v = deps[pkg]
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
  return undefined
}

const raw = fromCatalog(pkgName) ?? fromPackageJson(pkgName)
if (raw) {
  const alias = aliasOf(raw)
  if (alias) {
    stdout.write(`${alias.pkg}\t${alias.version}`)
  } else {
    stdout.write(raw)
  }
}
