/**
 * @fileoverview ESM loader stub for CLI build scripts.
 *
 * This file is used with --import flag for Node.js module loading.
 * Previously handled local package aliasing, now isolated to use published packages only.
 *
 * Usage:
 *   node --import=./scripts/load.mjs script.mjs
 */

// Export a no-op resolve function for compatibility.
// Node.js --import expects this export to exist.
export function resolve(specifier, context, nextResolve) {
  // Pass through to default resolver - no custom aliasing.
  return nextResolve(specifier, context)
}
