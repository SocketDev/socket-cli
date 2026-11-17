import { readFileSync } from 'node:fs'

export const NODE_VERSION = readFileSync(
  new URL('.node-version', import.meta.url),
  'utf8',
).trim()

if (!NODE_VERSION) {
  throw new Error('SEA Node version file is empty: src/sea/.node-version')
}
