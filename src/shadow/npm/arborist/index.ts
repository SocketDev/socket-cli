import { SafeArborist } from './lib/arborist'
import { SafeEdge } from './lib/edge'
import { SafeNode } from './lib/node'
import { SafeOverrideSet } from './lib/override-set'
import {
  getArboristClassPath,
  getArboristEdgeClassPath,
  getArboristNodeClassPath,
  getArboristOverrideSetClassPath
} from '../paths'

export function installSafeArborist() {
  // Override '@npmcli/arborist' module exports with patched variants based on
  // https://github.com/npm/cli/pull/8089.
  const cache: { [key: string]: any } = require.cache
  cache[getArboristClassPath()] = { exports: SafeArborist }
  cache[getArboristEdgeClassPath()] = { exports: SafeEdge }
  cache[getArboristNodeClassPath()] = { exports: SafeNode }
  cache[getArboristOverrideSetClassPath()] = { exports: SafeOverrideSet }
}
