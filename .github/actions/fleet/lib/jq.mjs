/**
 * @file Minimal JSON reader for composite-action shells. Replaces jq for action
 *   steps that run before actions/setup-node, so this only relies on the system
 *   Node every GitHub-hosted runner image ships with. Also useful in
 *   node:*-alpine and distroless Docker base images where jq is not installed.
 *   Usage: node .github/actions/fleet/lib/jq.mjs <file|-> <key> [<key> ...]
 *   Pass `-` as the file argument to read JSON from stdin. Exits non-zero on
 *   missing/empty value. A file whose root carries an `extends` field (the
 *   external-tools.json chains in socket-btm / ultrathink) is resolved before
 *   the key walk: base files load first and each leaf `tools` entry replaces
 *   the base's wholesale — the same ESLint-style semantics as
 *   build-pipeline.mts's loadExternalToolsChain. Stdin input (`-`) cannot
 *   resolve relative `extends` paths and is walked as-is.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Resolve an `extends` chain (string or array of relative paths) into a flat
// `tools` view. Fails LOUD on a circular chain or an unreadable base file —
// a silently half-resolved view surfaces later as a mysterious missing key.
function resolveExtends(data, resolvedPath, visited) {
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
    process.stderr.write(
      `jq.mjs: circular extends chain — "${resolvedPath}" is referenced more than once along the inheritance path; break the cycle in the extends fields.\n`,
    )
    process.exit(1)
  }
  visited.add(resolvedPath)
  const tools = {}
  for (let i = 0, { length } = extendsList; i < length; i += 1) {
    const basePath = path.resolve(path.dirname(resolvedPath), extendsList[i])
    let baseRaw = ''
    try {
      baseRaw = readFileSync(basePath, 'utf8')
    } catch {
      process.stderr.write(
        `jq.mjs: extends target unreadable — "${resolvedPath}" extends "${basePath}" but that file cannot be read; fix the extends path or restore the base file.\n`,
      )
      process.exit(1)
    }
    const base = resolveExtends(JSON.parse(baseRaw), basePath, visited)
    Object.assign(tools, base?.tools || {})
  }
  Object.assign(tools, data.tools || {})
  return { ...data, tools }
}

const [, , file, ...keys] = process.argv

const raw = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8')

let v = JSON.parse(raw)
if (file !== '-') {
  v = resolveExtends(v, path.resolve(file), new Set())
}
for (let i = 0, { length } = keys; i < length; i += 1) {
  const k = keys[i]
  if (v == null || typeof v !== 'object') {
    process.exit(1)
  }
  v = v[k]
}

if (v == null || v === '') {
  process.exit(1)
}

// oxlint-disable-next-line socket/no-console-prefer-logger -- composite-action helper runs on the raw runner before setup-node; the action's stdout IS the contract (consumed via shell command substitution).
console.log(typeof v === 'string' ? v : JSON.stringify(v))
