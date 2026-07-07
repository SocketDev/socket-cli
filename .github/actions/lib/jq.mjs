/**
 * @file Minimal JSON reader for composite-action shells. Replaces jq for action
 *   steps that run before actions/setup-node, so this only relies on the system
 *   Node every GitHub-hosted runner image ships with. Also useful in
 *   node:*-alpine and distroless Docker base images where jq is not installed.
 *   Usage: node .github/actions/lib/jq.mjs <file|-> <key> [<key> ...] Pass `-`
 *   as the file argument to read JSON from stdin. Exits non-zero on
 *   missing/empty value.
 */

import { readFileSync } from 'node:fs'

const [, , file, ...keys] = process.argv

const raw = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8')

let v = JSON.parse(raw)
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
