import { createRequire } from 'node:module'

import {
  getArboristClassPath,
  getArboristEdgeClassPath,
  getArboristNodeClassPath,
  getArboristOverrideSetClassPath
} from '../paths.mts'
import { SafeArborist } from './lib/arborist/index.mts'
import { SafeEdge } from './lib/edge.mts'
import { SafeNode } from './lib/node.mts'
import { SafeOverrideSet } from './lib/override-set.mts'

const require = createRequire(import.meta.url)

export function installSafeArborist() {
  // Override '@npmcli/arborist' module exports with patched variants based on
  // https://github.com/npm/cli/pull/8089.
  const cache: { [key: string]: any } = require.cache
  cache[getArboristClassPath()] = { exports: SafeArborist }
  cache[getArboristEdgeClassPath()] = { exports: SafeEdge }
  cache[getArboristNodeClassPath()] = { exports: SafeNode }
  cache[getArboristOverrideSetClassPath()] = { exports: SafeOverrideSet }
}
