/**
 * @fileoverview ESM loader that provides alias resolution.
 *
 * This is the actual loader used by Node.js with --loader flag.
 * For convenience, use scripts/load.js which wraps this automatically.
 *
 * Direct usage:
 *   node --loader=./scripts/load.mjs script.mjs
 *
 * Wrapper usage (recommended):
 *   node scripts/load script-name
 */

export { resolve } from './utils/alias-loader.mjs'
