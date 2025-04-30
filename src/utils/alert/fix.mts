import { createEnum } from '../objects.mts'

export const ALERT_FIX_TYPE = createEnum({
  cve: 'cve',
  remove: 'remove',
  upgrade: 'upgrade'
})
