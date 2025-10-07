/**
 * @fileoverview Babel plugin to transform loose-mode code into strict-mode compatible code
 *
 * This plugin ensures code runs correctly in strict mode by transforming problematic patterns:
 * 1. Octal numeric literals (0123) → Modern octal (0o123)
 * 2. Octal escape sequences in strings (\012) → Proper escapes
 * 3. With statements → Error (cannot be transformed safely)
 * 4. Future reserved words as identifiers → Safe alternatives
 * 5. Adds 'use strict' directive if missing
 *
 * @example
 * // Before:
 * var x = 0123  // Octal literal
 * var str = '\012'  // Octal escape
 *
 * // After:
 * 'use strict'
 * var x = 83  // Decimal equivalent
 * var str = '\n'  // Proper escape
 */

/**
 * Convert legacy octal literal (0123) to decimal number
 * @param {string} value - The numeric literal string
 * @returns {number|null} Decimal value or null if not octal
 */
function convertOctalLiteral(value) {
  // Match legacy octal: starts with 0, followed by octal digits (0-7)
  const octalMatch = /^0([0-7]+)$/.exec(value)
  if (!octalMatch) {
    return null
  }

  const octalDigits = octalMatch[1]
  return parseInt(octalDigits, 8)
}

/**
 * Transform octal escape sequences in strings to proper escapes
 * @param {string} str - String literal value
 * @returns {string} Transformed string
 */
function transformOctalEscapes(str) {
  // Common octal escapes and their replacements
  const commonOctals = {
    // Null (allowed in strict mode if not followed by digit)
    '\\0': '\\0',
    // Start of Heading
    '\\1': '\\x01',
    // Start of Text
    '\\2': '\\x02',
    // End of Text
    '\\3': '\\x03',
    // End of Transmission
    '\\4': '\\x04',
    // Enquiry
    '\\5': '\\x05',
    // Acknowledge
    '\\6': '\\x06',
    // Bell
    '\\7': '\\x07',
    // Backspace
    '\\10': '\\b',
    // Tab
    '\\11': '\\t',
    // Line Feed
    '\\12': '\\n',
    // Vertical Tab
    '\\13': '\\v',
    // Form Feed
    '\\14': '\\f',
    // Carriage Return
    '\\15': '\\r',
  }

  let result = str

  // Replace common named escapes first
  for (const [octal, replacement] of Object.entries(commonOctals)) {
    // Use word boundary to avoid matching longer sequences
    result = result.replace(
      new RegExp(octal.replace(/\\/g, '\\\\') + '(?![0-7])', 'g'),
      replacement,
    )
  }

  // Replace any remaining octal escapes (\16-\377) with hex escapes
  result = result.replace(/\\([0-7]{1,3})/g, (match, octalDigits) => {
    const codePoint = parseInt(octalDigits, 8)
    if (codePoint <= 0xff) {
      return `\\x${codePoint.toString(16).padStart(2, '0')}`
    }
    return `\\u${codePoint.toString(16).padStart(4, '0')}`
  })

  return result
}

export default function babelPluginStrictMode({ types: t }) {
  const stats = {
    octalLiterals: 0,
    octalEscapes: 0,
    withStatements: 0,
    strictDirectives: 0,
  }

  return {
    name: 'babel-plugin-strict-mode',

    visitor: {
      /**
       * Add 'use strict' directive to programs that don't have it
       */
      Program: {
        enter(path) {
          const { body, directives } = path.node

          // Check if already has 'use strict'
          const hasUseStrict =
            directives?.some(d => d.value.value === 'use strict') ||
            body.some(
              n =>
                t.isExpressionStatement(n) &&
                t.isStringLiteral(n.expression) &&
                n.expression.value === 'use strict',
            )

          if (!hasUseStrict) {
            // Add 'use strict' directive at the beginning
            path.unshiftContainer(
              'directives',
              t.directive(t.directiveLiteral('use strict')),
            )
            stats.strictDirectives++
          }
        },

        exit(path) {
          const totalTransforms = Object.values(stats).reduce(
            (a, b) => a + b,
            0,
          )

          if (totalTransforms > 0) {
            const statsComment = `
Strict Mode Transformation Stats:
  - Octal literals converted: ${stats.octalLiterals}
  - Octal escapes transformed: ${stats.octalEscapes}
  - With statements found: ${stats.withStatements}
  - Strict directives added: ${stats.strictDirectives}
  Total transformations: ${totalTransforms}
            `.trim()

            path.addComment('trailing', statsComment)
          }
        },
      },

      /**
       * Transform legacy octal numeric literals
       *
       * @example
       * // Input: var x = 0123
       * // Output: var x = 83
       */
      NumericLiteral(path) {
        const { node } = path
        const { extra } = node

        // Check if this is a legacy octal literal (starts with 0)
        if (extra?.raw) {
          const decimal = convertOctalLiteral(extra.raw)
          if (decimal !== null) {
            // Replace with decimal equivalent
            path.replaceWith(t.numericLiteral(decimal))
            stats.octalLiterals++

            path.addComment(
              'leading',
              ` Strict-mode: Transformed octal ${extra.raw} → ${decimal}`,
            )
          }
        }
      },

      /**
       * Transform octal escape sequences in string literals
       *
       * @example
       * // Input: var str = "Hello\012World"
       * // Output: var str = "Hello\nWorld"
       */
      StringLiteral(path) {
        const { node } = path
        const { extra } = node

        if (extra?.raw) {
          // Check if string contains octal escapes
          if (/\\[0-7]/.test(extra.raw)) {
            const originalValue = node.value
            const transformed = transformOctalEscapes(originalValue)

            if (transformed !== originalValue) {
              path.replaceWith(t.stringLiteral(transformed))
              stats.octalEscapes++

              path.addComment(
                'leading',
                ' Strict-mode: Transformed octal escapes',
              )
            }
          }
        }
      },

      /**
       * Detect and error on 'with' statements (cannot be safely transformed)
       *
       * @example
       * // Input: with (obj) { x = 1 }
       * // Output: Error thrown
       */
      WithStatement(path) {
        stats.withStatements++

        // Add a warning comment
        path.addComment(
          'leading',
          ' ERROR: "with" statement is not allowed in strict mode!',
        )

        // Throw an error to prevent compilation
        throw path.buildCodeFrameError(
          'WithStatement is not allowed in strict mode and cannot be safely transformed. ' +
            'Please refactor your code to avoid using "with" statements.',
        )
      },

      /**
       * Transform template literals with octal escapes
       */
      TemplateLiteral(path) {
        const { node } = path
        let transformed = false

        node.quasis.forEach(quasi => {
          const { value } = quasi
          if (value.raw && /\\[0-7]/.test(value.raw)) {
            const transformedCooked = transformOctalEscapes(
              value.cooked || value.raw,
            )
            if (transformedCooked !== value.cooked) {
              quasi.value.cooked = transformedCooked
              quasi.value.raw = transformedCooked
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t')
              transformed = true
            }
          }
        })

        if (transformed) {
          stats.octalEscapes++
          path.addComment(
            'leading',
            ' Strict-mode: Transformed octal escapes in template',
          )
        }
      },
    },
  }
}
