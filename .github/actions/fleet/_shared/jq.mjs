/**
 * @file Minimal JSON reader for composite-action shells. Replaces jq for action
 *   steps that run before actions/setup-node, so this only relies on the system
 *   Node every GitHub-hosted runner image ships with. Also useful in
 *   node:*-alpine and distroless Docker base images where jq is not installed.
 *   Usage: node .github/actions/fleet/_shared/jq.mjs <file|-> <key> [<key> ...]
 *   Pass `-` as the file argument to read JSON from stdin. Exits non-zero on
 *   missing/empty value. A file whose root carries an `extends` field (the
 *   external-tools.json chains in socket-btm / ultrathink) is resolved before
 *   the key walk: base files load first and each leaf `tools` entry replaces
 *   the base's wholesale — the same ESLint-style semantics as
 *   build-pipeline.mts's loadExternalToolsChain. Stdin input (`-`) cannot
 *   resolve relative `extends` paths and is walked as-is.
 *   Testability: the pure `resolveExtends` + `walkKeys` helpers are EXPORTED
 *   and the side-effectful CLI is guarded by isMainModule(), so unit tests can
 *   import them without triggering a process.exit. Every composite-action
 *   _shared helper follows this pattern (see
 *   check-fleet-shared-scripts-are-testable).
 */

import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Resolve an `extends` chain, string or array of relative paths, into a flat
// `tools` view. Fails LOUD (throws) on a circular chain or an unreadable base
// file — a silently half-resolved view surfaces later as a mysterious missing
// key. The CLI wrapper turns the throw into a loud process.exit. `visited` is
// the set of resolved paths already seen along the chain.
export function resolveExtends(data, resolvedPath, visited = new Set()) {
  if (data === null || typeof data !== 'object') {
    return data
  }
  const ext = data.extends
  const extendsList =
    typeof ext === 'string'
      ? [ext]
      : Array.isArray(ext)
        ? ext.filter(e => typeof e === 'string')
        : []
  if (extendsList.length === 0) {
    return data
  }
  if (visited.has(resolvedPath)) {
    throw new Error(
      `jq.mjs: circular extends chain — "${resolvedPath}" is referenced more than once along the inheritance path; break the cycle in the extends fields.`,
    )
  }
  visited.add(resolvedPath)
  const tools = {}
  for (let i = 0, { length } = extendsList; i < length; i += 1) {
    const basePath = path.resolve(path.dirname(resolvedPath), extendsList[i])
    let baseRaw = ''
    try {
      baseRaw = readFileSync(basePath, 'utf8')
    } catch {
      throw new Error(
        `jq.mjs: extends target unreadable — "${resolvedPath}" extends "${basePath}" but that file cannot be read; fix the extends path or restore the base file.`,
      )
    }
    const base = resolveExtends(JSON.parse(baseRaw), basePath, visited)
    Object.assign(tools, base?.tools || {})
  }
  Object.assign(tools, data.tools || {})
  return { ...data, tools }
}

// Walk a list of keys down a JSON value, returning the resolved value (or
// undefined when a key is absent / the walk hits a non-object). Pure.
export function walkKeys(value, keys) {
  let v = value
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const k = keys[i]
    if (v == null || typeof v !== 'object') {
      return undefined
    }
    v = v[k]
  }
  return v
}

function isMainModule() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    // realpath both sides before comparing. Node normalizes `..` in argv[1]
    // but leaves symlinks in place, while import.meta.url is fully resolved, so
    // a launch path under a symlinked prefix (macOS /tmp and /var/folders, a
    // symlinked checkout) compares unequal and the CLI silently does nothing
    // while exiting 0.
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (isMainModule()) {
  const [, , file, ...keys] = process.argv

  const raw =
    file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8')

  let v = JSON.parse(raw)
  if (file !== '-') {
    v = resolveExtends(v, path.resolve(file))
  }
  v = walkKeys(v, keys)

  if (v == null || v === '') {
    process.exit(1)
  }

  // composite-action helper runs on the raw runner before setup-node; the
  // action's stdout IS the contract, consumed via shell command substitution.
  // oxlint-disable-next-line socket/no-console-prefer-logger -- stdout contract
  console.log(typeof v === 'string' ? v : JSON.stringify(v))
}
