import type { LocalConfig } from '../../util/config.mts'

export function configValueText(value: LocalConfig[keyof LocalConfig]): string {
  if (Array.isArray(value)) {
    return value.join(',')
  }
  if (value !== null && typeof value === 'object') {
    return '[object Object]'
  }
  return String(value)
}
