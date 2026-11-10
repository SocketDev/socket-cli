/*
 * Adapted from @socketsecurity/registry 1.1.17, lib/env.js.
 * Copyright (c) 2024 Socket Inc. Licensed under the MIT License.
 */

const NumberCtor = Number
const { isFinite: NumberIsFinite, parseInt: NumberParseInt } = NumberCtor
const StringCtor = String

/**
 * Convert an environment variable value to a boolean.
 * @param value The value to convert.
 * @param defaultValue Default value when input is null/undefined.
 * @returns The boolean representation of the value.
 */
/*@__NO_SIDE_EFFECTS__*/
export function envAsBoolean(value: unknown, defaultValue = false): boolean {
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
 * Convert an environment variable value to a number.
 * @param value The value to convert.
 * @param defaultValue Default value when conversion fails.
 * @returns The numeric representation of the value.
 */
/*@__NO_SIDE_EFFECTS__*/
export function envAsNumber(value: unknown, defaultValue = 0): number {
  const numOrNaN = NumberParseInt(value as string, 10)
  const numMayBeNegZero = NumberIsFinite(numOrNaN)
    ? numOrNaN
    : NumberCtor(defaultValue)
  // Ensure -0 is treated as 0.
  return numMayBeNegZero || 0
}

/**
 * Convert an environment variable value to a trimmed string.
 * @param value The value to convert.
 * @param defaultValue Default value when input is null/undefined.
 * @returns The trimmed string representation of the value.
 */
/*@__NO_SIDE_EFFECTS__*/
export function envAsString(value: unknown, defaultValue = ''): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value === null || value === undefined) {
    return defaultValue === '' ? defaultValue : StringCtor(defaultValue).trim()
  }
  return StringCtor(value).trim()
}
