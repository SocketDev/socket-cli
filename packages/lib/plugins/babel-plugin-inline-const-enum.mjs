/**
 * @fileoverview Babel plugin to inline TypeScript const enum member access.
 * Replaces enum member access with literal values when enum definition is available.
 *
 * Note: TypeScript normally handles this during compilation. This plugin is useful
 * for post-processing compiled code or handling external modules.
 */

/**
 * Babel plugin to inline const enum values.
 *
 * Transforms:
 *   MyEnum.Value → 42 (if MyEnum.Value = 42 in the enum definition)
 *
 * Usage:
 *   Pass enum definitions via options.enums:
 *   {
 *     enums: {
 *       MyEnum: { Value1: 0, Value2: 1 }
 *     }
 *   }
 *
 * Or let the plugin scan the code for enum declarations (limited support).
 *
 * @param {object} babel - Babel API object
 * @param {object} options - Plugin options
 * @param {Record<string, Record<string, any>>} [options.enums] - Enum definitions
 * @param {boolean} [options.scanDeclarations=false] - Auto-detect enum declarations
 * @returns {object} Babel plugin object
 */
export default function inlineConstEnum(babel, options = {}) {
  const { types: t } = babel
  const { enums = {}, scanDeclarations = false } = options

  // Map of enum name to member values.
  const enumMap = new Map(Object.entries(enums))

  return {
    name: 'inline-const-enum',

    visitor: {
      // Scan for enum declarations if enabled.
      // Note: This has limited support and may not catch all cases.
      VariableDeclaration(path) {
        if (!scanDeclarations) {
          return
        }

        // Look for: const MyEnum = { Value: 0, ... }
        const { declarations } = path.node

        for (const decl of declarations) {
          if (
            !t.isVariableDeclarator(decl) ||
            !t.isIdentifier(decl.id) ||
            !t.isObjectExpression(decl.init)
          ) {
            continue
          }

          const enumName = decl.id.name
          const enumValues = {}

          // Extract property values.
          for (const prop of decl.init.properties) {
            if (
              !t.isObjectProperty(prop) ||
              !t.isIdentifier(prop.key) ||
              !isLiteralValue(t, prop.value)
            ) {
              continue
            }

            enumValues[prop.key.name] = getLiteralValue(t, prop.value)
          }

          if (Object.keys(enumValues).length > 0) {
            enumMap.set(enumName, enumValues)
          }
        }
      },

      // Inline enum member access: MyEnum.Value
      MemberExpression(path) {
        const { object, property } = path.node

        // Match: EnumName.MemberName
        if (!t.isIdentifier(object) || !t.isIdentifier(property)) {
          return
        }

        const enumName = object.name
        const memberName = property.name

        // Check if we have this enum.
        const enumDef = enumMap.get(enumName)
        if (!enumDef || !(memberName in enumDef)) {
          return
        }

        const value = enumDef[memberName]

        // Replace with literal value.
        const replacement = valueToLiteral(t, value)
        path.replaceWith(replacement)
      },
    },
  }
}

/**
 * Check if a node is a literal value.
 */
function isLiteralValue(t, node) {
  return (
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node)
  )
}

/**
 * Get the value from a literal node.
 */
function getLiteralValue(t, node) {
  if (t.isNullLiteral(node)) {
    return null
  }
  return node.value
}

/**
 * Convert a value to a Babel AST literal node.
 */
function valueToLiteral(t, value) {
  if (value === null) {
    return t.nullLiteral()
  }
  if (value === undefined) {
    return t.identifier('undefined')
  }
  if (typeof value === 'string') {
    return t.stringLiteral(value)
  }
  if (typeof value === 'number') {
    return t.numericLiteral(value)
  }
  if (typeof value === 'boolean') {
    return t.booleanLiteral(value)
  }
  throw new Error(`Unsupported enum value type: ${typeof value}`)
}
