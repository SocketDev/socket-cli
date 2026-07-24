/**
 * @file Babel plugin to inline process.env values. Replaces process.env.X with
 *   literal values, enabling dead code elimination. After this plugin runs,
 *   Rollup's tree-shaking can eliminate unreachable branches: if
 *   (process.env.NODE_ENV === 'production') { prodCode() } else { devCode() }
 *   Becomes: if ('production' === 'production') { prodCode() } else { devCode()
 *   } Then Rollup removes the dead else branch, leaving just: prodCode()
 */

/**
 * Minimal Babel AST node shape — only the fields this plugin reads.
 */
export interface BabelNode {
  type: string
  [key: string]: unknown
}

export interface BabelIdentifierNode extends BabelNode {
  type: 'Identifier'
  name: string
}

export interface BabelMemberExpressionNode extends BabelNode {
  type: 'MemberExpression'
  object: BabelNode
  property: BabelNode
}

/**
 * Minimal Babel `types` (`t`) surface this plugin uses.
 */
export interface BabelTypes {
  booleanLiteral(value: boolean): BabelNode
  identifier(name: string): BabelNode
  isIdentifier(
    node: BabelNode | null | undefined,
    opts?: { name: string } | undefined,
  ): node is BabelIdentifierNode
  isMemberExpression(
    node: BabelNode | null | undefined,
  ): node is BabelMemberExpressionNode
  nullLiteral(): BabelNode
  numericLiteral(value: number): BabelNode
  stringLiteral(value: string): BabelNode
}

/**
 * Minimal Babel API object this plugin uses.
 */
export interface BabelApi {
  types: BabelTypes
}

export interface InlineProcessEnvOptions {
  env?: Record<string, string | undefined> | undefined
  exclude?: string[] | undefined
  include?: string[] | undefined
}

export interface MemberExpressionPath {
  node: BabelMemberExpressionNode
  replaceWith(node: BabelNode): void
}

export interface BabelPluginObject {
  name: string
  visitor: {
    MemberExpression(path: MemberExpressionPath): void
  }
}

/**
 * Babel plugin to inline process.env.
 *
 * Replaces process.env.VAR_NAME with the actual value from process.env. Use
 * options.env to provide custom environment values.
 *
 * @example
 *   // With options: { env: { NODE_ENV: 'production' } }
 *   process.env.NODE_ENV // → 'production'
 *   process.env.DEBUG // → unchanged (not in env)
 *
 * @param {object} babel - Babel API object.
 * @param {object} options - Plugin options.
 * @param {Record<string, string>} [options.env] - Environment variables to
 *   inline.
 * @param {string[]} [options.include] - Only inline these env vars (allowlist)
 * @param {string[]} [options.exclude] - Never inline these env vars (denylist)
 *
 * @returns {object} Babel plugin object
 */
export default function inlineProcessEnv(
  babel: BabelApi,
  options: InlineProcessEnvOptions = {},
): BabelPluginObject {
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

        // Check allowlist/denylist.
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
export function valueToLiteral(
  t: BabelTypes,
  value: string | null | undefined,
) {
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
