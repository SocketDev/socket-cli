import { createRequire } from 'node:module'

import { getArboristDepValidPath } from '../../paths.mts'

import type { SafeNode } from './node.mts'

const require = createRequire(import.meta.url)

type DepValidFn = (
  child: SafeNode,
  requested: string,
  accept: string | undefined,
  requester: SafeNode
) => boolean

let _depValid: DepValidFn | undefined
export function depValid(
  child: SafeNode,
  requested: string,
  accept: string | undefined,
  requester: SafeNode
) {
  if (_depValid === undefined) {
    _depValid = require(getArboristDepValidPath()) as DepValidFn
  }
  return _depValid(child, requested, accept, requester)
}
