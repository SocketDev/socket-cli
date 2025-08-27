import { isObject } from '@socketsecurity/registry/lib/objects'

export type FilterConfig = {
  [key: string]: boolean | string[]
}

export function toFilterConfig(obj: any): FilterConfig {
  const normalized = { __proto__: null } as unknown as FilterConfig
  const keys = isObject(obj) ? Object.keys(obj) : []
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'boolean' || Array.isArray(value)) {
      normalized[key] = value
    }
  }
  return normalized
}
