/**
 * @fileoverview URL parsing and validation utilities.
 * Provides URL validation, normalization, and parsing helpers.
 */

const BooleanCtor = Boolean
const UrlCtor = URL

/**
 * Check if a value is a valid URL.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isUrl(value: string | URL | null | undefined): boolean {
  return (
    ((typeof value === 'string' && value !== '') ||
      (value !== null && typeof value === 'object')) &&
    !!parseUrl(value)
  )
}

/**
 * Parse a value as a URL.
 */
/*@__NO_SIDE_EFFECTS__*/
export function parseUrl(value: string | URL): URL | undefined {
  try {
    return new UrlCtor(value)
  } catch {}
  return undefined
}

/**
 * Convert a URL search parameter to an array.
 */
/*@__NO_SIDE_EFFECTS__*/
export function urlSearchParamAsArray(
  value: string | null | undefined,
): string[] {
  return typeof value === 'string'
    ? value
        .trim()
        .split(/, */)
        .map(v => v.trim())
        .filter(BooleanCtor)
    : []
}

export interface UrlSearchParamAsBooleanOptions {
  defaultValue?: boolean
}

/**
 * Convert a URL search parameter to a boolean.
 */
/*@__NO_SIDE_EFFECTS__*/
export function urlSearchParamAsBoolean(
  value: string | null | undefined,
  options?: UrlSearchParamAsBooleanOptions | undefined,
): boolean {
  const { defaultValue = false } = {
    __proto__: null,
    ...options,
  } as UrlSearchParamAsBooleanOptions
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '1' || trimmed.toLowerCase() === 'true'
  }
  if (value === null || value === undefined) {
    return !!defaultValue
  }
  return !!value
}

/**
 * Helper to get array from URLSearchParams.
 */
/*@__NO_SIDE_EFFECTS__*/
export function urlSearchParamsGetArray(
  params: URLSearchParams | null | undefined,
  key: string,
): string[] {
  if (params && typeof params.getAll === 'function') {
    const values = params.getAll(key)
    // If single value contains commas, split it
    const firstValue = values[0]
    if (values.length === 1 && firstValue && firstValue.includes(',')) {
      return urlSearchParamAsArray(firstValue)
    }
    return values
  }
  return []
}

export interface UrlSearchParamsGetBooleanOptions {
  defaultValue?: boolean
}

/**
 * Helper to get boolean from URLSearchParams.
 */
/*@__NO_SIDE_EFFECTS__*/
export function urlSearchParamsGetBoolean(
  params: URLSearchParams | null | undefined,
  key: string,
  options?: UrlSearchParamsGetBooleanOptions | undefined,
): boolean {
  const { defaultValue = false } = {
    __proto__: null,
    ...options,
  } as UrlSearchParamsGetBooleanOptions
  if (params && typeof params.get === 'function') {
    const value = params.get(key)
    return value !== null
      ? urlSearchParamAsBoolean(value, { defaultValue })
      : defaultValue
  }
  return defaultValue
}

export interface CreateRelativeUrlOptions {
  base?: string
}

/**
 * Create a relative URL for testing.
 */
/*@__NO_SIDE_EFFECTS__*/
export function createRelativeUrl(
  path: string,
  options?: CreateRelativeUrlOptions | undefined,
): string {
  const { base = '' } = {
    __proto__: null,
    ...options,
  } as CreateRelativeUrlOptions
  // Remove leading slash to make it relative.
  const relativePath = path.replace(/^\//, '')

  if (base) {
    let baseUrl = base
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/'
    }
    return baseUrl + relativePath
  }

  return relativePath
}

export interface UrlSearchParamAsStringOptions {
  defaultValue?: string
}

/**
 * Get string value from URLSearchParams with a default.
 */
/*@__NO_SIDE_EFFECTS__*/
export function urlSearchParamAsString(
  params: URLSearchParams | null | undefined,
  key: string,
  options?: UrlSearchParamAsStringOptions | undefined,
): string {
  const { defaultValue = '' } = {
    __proto__: null,
    ...options,
  } as UrlSearchParamAsStringOptions
  if (params && typeof params.get === 'function') {
    const value = params.get(key)
    return value !== null ? value : defaultValue
  }
  return defaultValue
}

export interface UrlSearchParamAsNumberOptions {
  defaultValue?: number
}

/**
 * Get number value from URLSearchParams with a default.
 */
/*@__NO_SIDE_EFFECTS__*/
export function urlSearchParamAsNumber(
  params: URLSearchParams | null | undefined,
  key: string,
  options?: UrlSearchParamAsNumberOptions | undefined,
): number {
  const { defaultValue = 0 } = {
    __proto__: null,
    ...options,
  } as UrlSearchParamAsNumberOptions
  if (params && typeof params.get === 'function') {
    const value = params.get(key)
    if (value !== null) {
      const num = Number(value)
      return !Number.isNaN(num) ? num : defaultValue
    }
  }
  return defaultValue
}
