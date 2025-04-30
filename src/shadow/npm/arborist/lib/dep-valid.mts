import { createRequire } from 'node:module'

import { getArboristDepValidPath } from '../../paths.mts'

import type { SafeNode } from './node.mts'

const require = createRequire(import.meta.url)

export const depValid: (
  child: SafeNode,
  requested: string,
  accept: string | undefined,
  requester: SafeNode
) => boolean = require(getArboristDepValidPath())
