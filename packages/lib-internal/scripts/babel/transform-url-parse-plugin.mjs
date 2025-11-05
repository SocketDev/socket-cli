export default function ({ types: t }) {
  return {
    name: 'transform-url-parse',
    visitor: {
      CallExpression(path) {
        const { node } = path
        // Match `url.parse(...)` calls with exactly one argument.
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.name === 'url' &&
          node.callee.property.name === 'parse' &&
          node.arguments.length === 1
        ) {
          const { parent } = path
          // Create an AST node for `new URL(<arg>)`.
          const newUrl = t.newExpression(t.identifier('URL'), [
            node.arguments[0],
          ])
          // Check if the result of `url.parse()` is immediately accessed, e.g.
          // `url.parse(x).protocol`.
          if (parent.type === 'MemberExpression' && parent.object === node) {
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
