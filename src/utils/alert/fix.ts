import { createEnum } from '../objects'

export const ALERT_FIX_TYPE = createEnum({
  cve: 'cve',
  remove: 'remove',
  upgrade: 'upgrade'
})
