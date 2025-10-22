/**
 * @fileoverview Deprecated - use register.mjs instead.
 *
 * This file is kept for backward compatibility but should not be used.
 * Use register.mjs with --import flag instead.
 *
 * New usage:
 *   node --import=./scripts/register.mjs script.mjs
 *
 * Wrapper usage (recommended):
 *   node scripts/load script-name
 */

export { resolve } from './utils/alias-loader.mjs'
