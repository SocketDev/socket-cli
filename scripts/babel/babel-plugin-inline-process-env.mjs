/**
 * @fileoverview Babel plugin to inline process.env values.
 * Replaces process.env.X with literal values, enabling dead code elimination.
 *
 * After this plugin runs, Rollup's tree-shaking can eliminate unreachable branches:
 *   if (process.env.NODE_ENV === 'production') { prodCode() }
 *   else { devCode() }
 *
 * Becomes:
 *   if ('production' === 'production') { prodCode() }
 *   else { devCode() }
 *
 * Then Rollup removes the dead else branch, leaving just: prodCode()
 */

/**
 * Babel plugin to inline process.env.
 *
 * Replaces process.env.VAR_NAME with the actual value from process.env.
 * Use options.env to provide custom environment values.
 *
 * @param {object} babel - Babel API object
 * @param {object} options - Plugin options
 * @param {Record<string, string>} [options.env] - Environment variables to inline
 * @param {string[]} [options.include] - Only inline these env vars (whitelist)
 * @param {string[]} [options.exclude] - Never inline these env vars (blacklist)
 * @returns {object} Babel plugin object
 *
 * @example
 * // With options: { env: { NODE_ENV: 'production' } }
 * process.env.NODE_ENV // → 'production'
 * process.env.DEBUG // → unchanged (not in env)
 */
export default function inlineProcessEnv(babel, options = {}) {
  const { types: t } = babel
  const { env = process.env, exclude = [], include = [] } = options

  const excludeSet = new Set(exclude)
  const includeSet = new Set(include)

  return {
    name: 'inline-process-env',

    visitor: {
      MemberExpression(path) {
        const { object, property } = path.node

        // Match: process.env.VAR_NAME
        if (
          !t.isMemberExpression(object) ||
          !t.isIdentifier(object.object, { name: 'process' }) ||
          !t.isIdentifier(object.property, { name: 'env' }) ||
          !t.isIdentifier(property)
        ) {
          return
        }

        const envKey = property.name

        // Check whitelist/blacklist.
        if (includeSet.size > 0 && !includeSet.has(envKey)) {
          return
        }
        if (excludeSet.has(envKey)) {
          return
        }

        // Get the value from env.
        const value = env[envKey]

        // Only inline if value exists.
        if (value === undefined) {
          return
        }

        // Replace with literal value.
        const replacement = valueToLiteral(t, value)
        path.replaceWith(replacement)
      },
    },
  }
}

/**
 * Convert a value to a Babel AST literal node.
 */
function valueToLiteral(t, value) {
  // Handle common types.
  if (value === null) {
    return t.nullLiteral()
  }
  if (value === undefined) {
    return t.identifier('undefined')
  }
  if (value === 'true') {
    return t.booleanLiteral(true)
  }
  if (value === 'false') {
    return t.booleanLiteral(false)
  }

  // Check if it's a number.
  const num = Number(value)
  if (!Number.isNaN(num) && String(num) === value) {
    return t.numericLiteral(num)
  }

  // Default to string.
  return t.stringLiteral(value)
}
