'use strict'

// Helper to check if something is a .__proto__ access.
function isProtoAccess(node, t) {
  return (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.property, { name: '__proto__' })
  )
}

// Unwraps A.__proto__ or A.prototype.__proto__.
function unwrapProto(node, t) {
  const { object } = node
  return {
    object,
    isPrototype:
      t.isMemberExpression(object) &&
      t.isIdentifier(object.property, { name: 'prototype' })
  }
}

module.exports = function ({ types: t }) {
  return {
    name: 'transform-set-proto',
    visitor: {
      ExpressionStatement(path) {
        const { expression: expr } = path.node
        // Handle: Xyz.prototype.__proto__ = foo
        if (t.isAssignmentExpression(expr) && isProtoAccess(expr.left, t)) {
          const { object } = unwrapProto(expr.left, t)
          const { right } = expr
          path.replaceWith(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier('Object'),
                  t.identifier('setPrototypeOf')
                ),
                [object, right]
              )
            )
          )
        }
      }
    }
  }
}
