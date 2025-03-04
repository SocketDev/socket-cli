import { getArboristDepValidPath } from '../../paths'

import type { SafeNode } from './node'

export const depValid: (
  child: SafeNode,
  requested: string,
  accept: string | undefined,
  requester: SafeNode
) => boolean = require(getArboristDepValidPath())
