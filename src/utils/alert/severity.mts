import { createEnum } from '../objects.mts'

export const ALERT_SEVERITY = createEnum({
  critical: 'critical',
  high: 'high',
  middle: 'middle',
  low: 'low',
})
