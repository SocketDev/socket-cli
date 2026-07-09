/**
 * @file Babel plugin to transform url.parse() calls into new URL() constructor.
 */

import type {
  BabelApi,
  BabelCallExpression,
  BabelPath,
} from './babel-plugin-types.mts'

export default function ({ types: t }: BabelApi) {
  return {
    name: 'transform-url-parse',
    visitor: {
      CallExpression(path: BabelPath<BabelCallExpression>) {
        const { node } = path
        // Match `url.parse(...)` calls with exactly one argument.
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.object) &&
          node.callee.object.name === 'url' &&
          t.isIdentifier(node.callee.property) &&
          node.callee.property.name === 'parse' &&
          node.arguments.length === 1
        ) {
          const { parent } = path
          // Create an AST node for `new URL(<arg>)`.
          const newUrl = t.newExpression(t.identifier('URL'), [
            node.arguments[0]!,
          ])
          // Check if the result of `url.parse()` is immediately accessed, e.g.
          // `url.parse(x).protocol`.
          if (t.isMemberExpression(parent) && parent.object === node) {
            // Replace the full `url.parse(x).protocol` with `(new URL(x)).protocol`.
            path.parentPath.replaceWith(
              t.memberExpression(
                newUrl,
                parent.property,
                // Handle dynamic props like `['protocol']`.
                parent.computed,
              ),
            )
          } else {
            // Otherwise, replace `url.parse(x)` with `new URL(x)`.
            path.replaceWith(newUrl)
          }
        }
      },
    },
  }
}
