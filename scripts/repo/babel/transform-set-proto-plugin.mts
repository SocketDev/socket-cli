/**
 * @file Babel plugin to transform **proto** assignments into
 *   Object.setPrototypeOf calls.
 */

import type {
  BabelApi,
  BabelExpressionStatement,
  BabelMemberExpression,
  BabelNode,
  BabelPath,
  BabelTypes,
} from './babel-plugin-types.mts'

/**
 * Check if node is a **proto** property access.
 */
function isProtoAccess(node: BabelNode, t: BabelTypes): boolean {
  return (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.property, { name: '__proto__' })
  )
}

// Unwraps A.__proto__ or A.prototype.__proto__.
function unwrapProto(
  node: BabelMemberExpression,
  t: BabelTypes,
): { isPrototype: boolean; object: BabelNode } {
  const { object } = node
  return {
    object,
    isPrototype:
      t.isMemberExpression(object) &&
      t.isIdentifier(object.property, { name: 'prototype' }),
  }
}

export default function ({ types: t }: BabelApi) {
  return {
    name: 'transform-set-proto',
    visitor: {
      ExpressionStatement(path: BabelPath<BabelExpressionStatement>) {
        const { expression: expr } = path.node
        // Handle: Xyz.prototype.__proto__ = foo
        if (t.isAssignmentExpression(expr) && isProtoAccess(expr.left, t)) {
          const { object } = unwrapProto(expr.left as BabelMemberExpression, t)
          const { right } = expr
          path.replaceWith(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier('Object'),
                  t.identifier('setPrototypeOf'),
                ),
                [object, right],
              ),
            ),
          )
        }
      },
    },
  }
}
