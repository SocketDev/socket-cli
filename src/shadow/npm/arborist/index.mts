/** @fileoverview npm Arborist class installation and setup for Socket CLI. Provides safe Arborist wrappers that integrate security scanning into npm's dependency resolution process. */

import { createRequire } from 'node:module'

// @ts-expect-error
import UntypedEdge from '@npmcli/arborist/lib/edge.js'
// @ts-expect-error
import UntypedNode from '@npmcli/arborist/lib/node.js'
// @ts-expect-error
import UntypedOverrideSet from '@npmcli/arborist/lib/override-set.js'

import {
  getArboristClassPath,
  getArboristEdgeClassPath,
  getArboristNodeClassPath,
  getArboristOverrideSetClassPath,
} from '../paths.mts'
import { Arborist, SafeArborist } from './lib/arborist/index.mts'

import type { EdgeClass, NodeClass, OverrideSetClass } from './types.mts'

const require = createRequire(import.meta.url)

export { Arborist, SafeArborist }

export const Edge: EdgeClass = UntypedEdge

export const Node: NodeClass = UntypedNode

export const OverrideSet: OverrideSetClass = UntypedOverrideSet

export function installSafeArborist() {
  // Override '@npmcli/arborist' module exports with patched variants based on
  // https://github.com/npm/cli/pull/8089.
  const cache: { [key: string]: any } = require.cache
  cache[getArboristClassPath()] = { exports: SafeArborist }
  cache[getArboristEdgeClassPath()] = { exports: Edge }
  cache[getArboristNodeClassPath()] = { exports: Node }
  cache[getArboristOverrideSetClassPath()] = { exports: OverrideSet }
}
