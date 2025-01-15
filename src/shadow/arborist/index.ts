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
  const cache: { [key: string]: any } = require.cache
  cache[arboristClassPath] = { exports: SafeArborist }
  cache[arboristEdgeClassPath] = { exports: SafeEdge }
  cache[arboristNodeClassPath] = { exports: SafeNode }
  cache[arboristOverrideSetClassPath] = { exports: SafeOverrideSet }
}
