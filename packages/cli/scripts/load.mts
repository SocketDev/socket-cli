/**
 * @file ESM loader stub for CLI build scripts. This file is used with --import
 *   flag for Node.js module loading. Previously handled local package aliasing,
 *   now isolated to use published packages only. Usage: node
 *   --import=./scripts/load.mts script.mts.
 */

// Node's module-hooks API requires a loader to export exactly `resolve`.
// oxlint-disable-next-line socket/exported-name-has-domain-word -- the export name is Node's module-hooks contract, not ours to qualify.
export function resolve(specifier, context, nextResolve) {
  // Pass through to default resolver - no custom aliasing.
  return nextResolve(specifier, context)
}
