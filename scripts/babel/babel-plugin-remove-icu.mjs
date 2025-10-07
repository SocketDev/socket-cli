/**
 * @fileoverview Babel plugin to remove ICU dependencies from code
 *
 * This plugin transforms ICU-dependent JavaScript features into ICU-free alternatives,
 * allowing Node.js to be built with --without-intl to save ~8-10MB.
 *
 * Transformations:
 * 1. `.toLocaleString()` → Simple formatting with commas/basic date strings
 * 2. `Intl.*` APIs → Polyfills or basic implementations
 * 3. Unicode regex `\p{...}` → Character class alternatives
 * 4. `.localeCompare()` → Basic string comparison
 *
 * @example
 * // Before:
 * const formatted = count.toLocaleString()
 * const date = new Date().toLocaleDateString()
 *
 * // After:
 * const formatted = count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
 * const date = new Date().toISOString().split('T')[0]
 */

/**
 * Helper Functions (injected at runtime via Babel template.ast):
 *
 * __formatNumber(num) - Format with comma thousands separators
 * __formatDate(date) - Format in YYYY-MM-DD
 * __formatDateTime(date) - Format with time
 * __simpleCompare(a, b) - Basic string comparison
 */

export default function babelPluginRemoveICU({ template, types: t }) {
  const stats = {
    toLocaleString: 0,
    toLocaleDateString: 0,
    toLocaleTimeString: 0,
    localeCompare: 0,
    intlAPIs: 0,
    unicodeRegex: 0,
  }

  // Helper to create runtime helper import
  const helperImports = new WeakMap()
  function ensureHelper(path, helperName) {
    const program = path.findParent(p => p.isProgram())
    if (!program) {
      return
    }

    if (!helperImports.has(program.node)) {
      helperImports.set(program.node, new Set())
    }

    const imports = helperImports.get(program.node)
    if (imports.has(helperName)) {
      return
    }

    imports.add(helperName)

    // Add helper function at the top of the file using template.ast
    const helpers = {
      __formatNumber: () =>
        template.ast(`
        function __formatNumber(num) {
          return num.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
        }
      `),
      __formatDate: () =>
        template.ast(`
        function __formatDate(date) {
          return date.toISOString().split('T')[0];
        }
      `),
      __formatDateTime: () =>
        template.ast(`
        function __formatDateTime(date) {
          return date.toISOString().replace('T', ' ').replace(/\\.\\d+Z$/, ' UTC');
        }
      `),
      __simpleCompare: () =>
        template.ast(`
        function __simpleCompare(a, b) {
          return a < b ? -1 : a > b ? 1 : 0;
        }
      `),
    }

    program.node.body.unshift(helpers[helperName]())
  }

  return {
    name: 'babel-plugin-remove-icu',

    visitor: {
      /**
       * Transform number.toLocaleString() calls
       *
       * @example
       * // Input:
       * count.toLocaleString()
       * (1234567).toLocaleString()
       * num.toLocaleString('en-US', { minimumFractionDigits: 2 })
       *
       * // Output:
       * __formatNumber(count)
       * __formatNumber(1234567)
       * __formatNumber(num)
       */
      CallExpression(path) {
        const { node } = path

        // Handle toLocaleString() on numbers
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property, { name: 'toLocaleString' })
        ) {
          const objectType = path.get('callee.object')

          // Check if it's likely a number (numeric literal or number-type identifier)
          const isNumber =
            t.isNumericLiteral(objectType.node) ||
            (t.isIdentifier(objectType.node) &&
              [
                'count',
                'size',
                'length',
                'total',
                'num',
                'number',
                'amount',
                'bytes',
              ].some(n => objectType.node.name.toLowerCase().includes(n)))

          if (isNumber) {
            ensureHelper(path, '__formatNumber')
            path.replaceWith(
              t.callExpression(t.identifier('__formatNumber'), [
                node.callee.object,
              ]),
            )
            stats.toLocaleString++

            path.addComment(
              'leading',
              ' ICU-free: Transformed toLocaleString() → __formatNumber()',
            )
            return
          }

          // Handle Date.prototype.toLocaleString()
          if (
            t.isNewExpression(objectType.node) &&
            t.isIdentifier(objectType.node.callee, { name: 'Date' })
          ) {
            ensureHelper(path, '__formatDateTime')
            path.replaceWith(
              t.callExpression(t.identifier('__formatDateTime'), [
                node.callee.object,
              ]),
            )
            stats.toLocaleString++

            path.addComment(
              'leading',
              ' ICU-free: Transformed Date.toLocaleString() → __formatDateTime()',
            )
            return
          }
        }

        // Handle toLocaleDateString()
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property, { name: 'toLocaleDateString' })
        ) {
          ensureHelper(path, '__formatDate')
          path.replaceWith(
            t.callExpression(t.identifier('__formatDate'), [
              node.callee.object,
            ]),
          )
          stats.toLocaleDateString++

          path.addComment(
            'leading',
            ' ICU-free: Transformed toLocaleDateString() → __formatDate()',
          )
          return
        }

        // Handle toLocaleTimeString()
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property, { name: 'toLocaleTimeString' })
        ) {
          // Convert to ISO time format
          path.replaceWith(
            t.callExpression(
              t.memberExpression(
                t.callExpression(
                  t.memberExpression(
                    node.callee.object,
                    t.identifier('toISOString'),
                  ),
                  [],
                ),
                t.identifier('split'),
              ),
              [t.stringLiteral('T')],
            ),
          )
          path.replaceWith(
            t.memberExpression(path.node, t.numericLiteral(1), true),
          )
          stats.toLocaleTimeString++

          path.addComment(
            'leading',
            ' ICU-free: Transformed toLocaleTimeString() → ISO time',
          )
          return
        }

        // Handle localeCompare()
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property, { name: 'localeCompare' })
        ) {
          ensureHelper(path, '__simpleCompare')
          path.replaceWith(
            t.callExpression(t.identifier('__simpleCompare'), [
              node.callee.object,
              node.arguments[0],
            ]),
          )
          stats.localeCompare++

          path.addComment(
            'leading',
            ' ICU-free: Transformed localeCompare() → __simpleCompare()',
          )
          return
        }

        // Handle Intl.* API usage
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.object, { name: 'Intl' })
        ) {
          const apiName = node.callee.property.name

          // Intl.DateTimeFormat
          if (apiName === 'DateTimeFormat') {
            path.addComment(
              'leading',
              ' WARNING: Intl.DateTimeFormat removed - using basic date formatting',
            )

            // Replace with a simple wrapper that returns { format: (date) => formatDate(date) }
            path.replaceWith(
              t.objectExpression([
                t.objectMethod(
                  'method',
                  t.identifier('format'),
                  [t.identifier('date')],
                  t.blockStatement([
                    t.returnStatement(
                      t.callExpression(
                        t.memberExpression(
                          t.identifier('date'),
                          t.identifier('toISOString'),
                        ),
                        [],
                      ),
                    ),
                  ]),
                ),
              ]),
            )
            stats.intlAPIs++
            return
          }

          // Intl.NumberFormat
          if (apiName === 'NumberFormat') {
            ensureHelper(path, '__formatNumber')
            path.addComment(
              'leading',
              ' WARNING: Intl.NumberFormat removed - using basic number formatting',
            )

            // Replace with a simple wrapper
            path.replaceWith(
              t.objectExpression([
                t.objectMethod(
                  'method',
                  t.identifier('format'),
                  [t.identifier('num')],
                  t.blockStatement([
                    t.returnStatement(
                      t.callExpression(t.identifier('__formatNumber'), [
                        t.identifier('num'),
                      ]),
                    ),
                  ]),
                ),
              ]),
            )
            stats.intlAPIs++
            return
          }

          // Other Intl.* APIs - just warn
          path.addComment(
            'leading',
            ` WARNING: Intl.${apiName} is not available without ICU - this may break!`,
          )
          stats.intlAPIs++
        }
      },

      /**
       * Transform Unicode property escapes in regex
       *
       * @example
       * // Input:
       * /\p{Letter}/u
       * /\p{Number}/u
       * /\p{Script=Greek}/u
       *
       * // Output:
       * /[a-zA-Z]/
       * /[0-9]/
       * /[α-ω]/  // Basic Greek range (or warning)
       */
      RegExpLiteral(path) {
        const { node } = path

        // Check for unicode property escapes (\p{...})
        if (node.flags.includes('u') && node.pattern.includes('\\p{')) {
          const pattern = node.pattern
          let newPattern = pattern

          // Common transformations
          const transforms = {
            '\\p{Letter}': '[a-zA-Z]',
            '\\p{L}': '[a-zA-Z]',
            '\\p{Number}': '[0-9]',
            '\\p{N}': '[0-9]',
            '\\p{Digit}': '[0-9]',
            '\\p{Nd}': '[0-9]',
            '\\p{Space}': '\\s',
            '\\p{White_Space}': '\\s',
            '\\p{Alphabetic}': '[a-zA-Z]',
            '\\p{ASCII}': '[\\x00-\\x7F]',
          }

          let transformed = false
          for (const [unicode, basic] of Object.entries(transforms)) {
            if (newPattern.includes(unicode)) {
              newPattern = newPattern.replace(
                new RegExp(unicode.replace(/[\\{}]/g, '\\$&'), 'g'),
                basic,
              )
              transformed = true
            }
          }

          if (transformed) {
            // Remove 'u' flag since we're no longer using unicode escapes
            const newFlags = node.flags.replace('u', '')
            path.replaceWith(t.regExpLiteral(newPattern, newFlags))
            stats.unicodeRegex++

            path.addComment(
              'leading',
              ' ICU-free: Transformed unicode regex → character class',
            )
          } else if (pattern.includes('\\p{')) {
            // Can't transform - add warning
            path.addComment(
              'leading',
              ' WARNING: Complex unicode regex may not work without ICU!',
            )
            stats.unicodeRegex++
          }
        }
      },

      /**
       * Add stats comment at the end of the file
       */
      Program: {
        exit(path) {
          const totalTransforms = Object.values(stats).reduce(
            (a, b) => a + b,
            0,
          )

          if (totalTransforms > 0) {
            const statsComment = `
ICU Removal Stats:
  - toLocaleString() calls: ${stats.toLocaleString}
  - toLocaleDateString() calls: ${stats.toLocaleDateString}
  - toLocaleTimeString() calls: ${stats.toLocaleTimeString}
  - localeCompare() calls: ${stats.localeCompare}
  - Intl.* API usage: ${stats.intlAPIs}
  - Unicode regex patterns: ${stats.unicodeRegex}
  Total transformations: ${totalTransforms}
            `.trim()

            path.addComment('trailing', statsComment)
          }
        },
      },
    },
  }
}
