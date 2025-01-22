import { SafeArborist } from './lib/arborist'
import { SafeEdge } from './lib/edge'
import { SafeNode } from './lib/node'
import { SafeOverrideSet } from './lib/override-set'
import {
  arboristClassPath,
  arboristEdgeClassPath,
  arboristNodeClassPath,
  arboristOverrideSetClassPath
} from '../npm-paths'

export function installSafeArborist() {
  // Override '@npmcli/arborist' module exports with patched variants based on
  // https://github.com/npm/cli/pull/7025.
  const cache: { [key: string]: any } = require.cache
  cache[arboristClassPath] = { exports: SafeArborist }
  cache[arboristEdgeClassPath] = { exports: SafeEdge }
  cache[arboristNodeClassPath] = { exports: SafeNode }
  cache[arboristOverrideSetClassPath] = { exports: SafeOverrideSet }
}
