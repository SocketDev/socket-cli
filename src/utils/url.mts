/** Minimal URL helpers adapted from @socketsecurity/registry 1.1.17 lib/url.js (MIT). */

export function parseUrl(value: string | URL): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function isUrl(value: unknown): value is string | URL {
  return (
    ((typeof value === 'string' && value !== '') ||
      (value !== null && typeof value === 'object')) &&
    parseUrl(value as string | URL) !== null
  )
}
