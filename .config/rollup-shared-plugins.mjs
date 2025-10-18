/**
 * Shared Rollup plugin configurations and utilities.
 */

import { builtinModules } from 'node:module'

import replacePlugin from '@rollup/plugin-replace'

import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.mjs'

// Map un-prefixed built-ins to node: prefixed forms.
export const builtinAliases = builtinModules.reduce((o, n) => {
  if (!n.startsWith('node:')) {
    o[n] = `node:${n}`
  }
  return o
}, {})

// Cache for tracking require variable names (for deduplication).
const requiredToVarName = new Map()

/**
 * Get the variable name for a require call to enable deduplication.
 */
export function getVarNameForRequireId(filename, id, lookbehindContent) {
  const key = `${filename}:${id}`
  let varName = requiredToVarName.get(key)
  if (varName) {
    return varName
  }
  const varNameRegExp = new RegExp(
    `(?<=var +)[$\\w]+(?=\\s*=\\s*require[$\\w]*\\(["']${escapeRegExp(id)}["']\\))`,
  )
  varName = varNameRegExp.exec(lookbehindContent)?.[0] ?? ''
  if (varName) {
    requiredToVarName.set(key, varName)
  }
  return varName
}

/**
 * Create plugins for cleaning up and optimizing require/import statements.
 */
export function createCleanupPlugins() {
  return [
    // Remove dangling require calls not associated with an import binding.
    socketModifyPlugin({
      find: /^\s*require[$\w]*\(["'].+?["']\);?\r?\n/gm,
      replace: '',
    }),
    // Replace require calls to ESM 'tiny-colors' with CJS 'yoctocolors-cjs'.
    socketModifyPlugin({
      find: /require[$\w]*\(["']tiny-colors["']\)/g,
      replace: "require('yoctocolors-cjs')",
    }),
    // Try to convert `require('u' + 'rl')` into deduplicated variable reference.
    socketModifyPlugin({
      find: /require[$\w]*\(["']u["']\s*\+\s*["']rl["']\)/g,
      replace(match, index) {
        const { fileName } = this.chunk
        const beforeMatch = this.input.slice(0, index)
        return (
          getVarNameForRequireId(fileName, 'node:url', beforeMatch) || match
        )
      },
    }),
    // Convert un-prefixed built-in imports into "node:" prefixed forms.
    replacePlugin({
      delimiters: ['(?<=(?:require[$\\w]*\\(|from\\s*)["\'])', '(?=["\'])'],
      preventAssignment: false,
      values: builtinAliases,
    }),
    // Reduce duplicate require('node:...') variable assignments.
    socketModifyPlugin({
      find: /var +([$\w]+)\s*=\s*require[$\w]*\(["'](node:.+?)["']\)/g,
      replace(match, currVarName, id, index) {
        const { fileName } = this.chunk
        const beforeMatch = this.input.slice(0, index)
        const prevVarName = getVarNameForRequireId(fileName, id, beforeMatch)
        return !prevVarName || currVarName === prevVarName
          ? match
          : `var ${currVarName} = ${prevVarName}`
      },
    }),
  ]
}

/**
 * Standard warning handler that suppresses common non-critical warnings.
 */
export function standardOnwarn(warning, warn) {
  if (
    warning.code === 'EVAL' ||
    warning.code === 'CIRCULAR_DEPENDENCY' ||
    warning.code === 'THIS_IS_UNDEFINED' ||
    warning.code === 'UNRESOLVED_IMPORT' ||
    warning.code === 'INVALID_ANNOTATION' ||
    warning.code === 'MISSING_EXPORT' ||
    warning.code === 'MIXED_EXPORTS'
  ) {
    return
  }
  warn(warning)
}
