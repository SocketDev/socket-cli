/** @fileoverview Alert fix type definitions. */

import { createEnum } from '../data/objects.mts'

export const ALERT_FIX_TYPE = createEnum({
  cve: 'cve',
  remove: 'remove',
  upgrade: 'upgrade',
})
