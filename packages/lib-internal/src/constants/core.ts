/**
 * Core primitives and fundamental constants.
 * Goal: Minimize this module by finding proper semantic homes for all constants.
 */

// Internal implementation symbol.
export const kInternalsSymbol = Symbol('@socketregistry.constants.internals')

// Sentinel values.
export const LOOP_SENTINEL = 1_000_000

// Error and unknown values.
export const UNKNOWN_ERROR = 'Unknown error'
export const UNKNOWN_VALUE = '<unknown>'

// Empty values.
export const EMPTY_FILE = '/* empty */\n'
export const EMPTY_VALUE = '<value>'

// Undefined token.
export const UNDEFINED_TOKEN: undefined = undefined

// Miscellaneous.
export const V = 'v'
export const COLUMN_LIMIT = 80

// Environment variable name constants.
export const NODE_AUTH_TOKEN = 'NODE_AUTH_TOKEN'
export const NODE_ENV = 'NODE_ENV'
