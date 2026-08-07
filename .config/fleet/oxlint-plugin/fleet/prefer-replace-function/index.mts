/*
 * @file `String.prototype.replace` / `replaceAll` give `$` special meaning in a
 *   REPLACEMENT STRING: `$&` is the whole match, `$1` a group, `` $` `` and `$'`
 *   the surrounding text, `$$` a literal dollar. That is a feature when the
 *   author wrote the string, and a bug when the string is DATA.
 *
 *   The hazard is a runtime value used as the replacement:
 *
 *     text.replace(needle, userSuppliedValue)
 *
 *   If `userSuppliedValue` happens to contain `$&`, it is re-interpreted rather
 *   than inserted, so the output silently gains text nobody wrote. Nothing in
 *   the source shows a `$`, which is what makes it survive review. A replacer
 *   FUNCTION has no such parsing: whatever it returns is inserted verbatim.
 *
 *     text.replace(needle, () => userSuppliedValue)
 *
 *   SCOPE, and why this is not "ban `$` in replacements". A survey of the fleet
 *   found 89 sites passing a literal with `$` and 55 passing a runtime value.
 *   Nearly all of the 89 are the canonical regex-escape idiom,
 *   `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`, where `$&` is exactly what the
 *   author wants. Flagging those would be wrong 89 times. So the rule keys on
 *   the SHAPE of the replacement argument, not on its content:
 *
 *   - A string literal (or a template literal with no interpolation) is
 *     author-controlled and readable in review. Allowed.
 *   - A function, arrow or otherwise, is already safe. Allowed.
 *   - Anything else — an identifier, a member expression, a call result, a
 *     template literal WITH interpolation — carries a runtime value and is
 *     reported.
 *
 *   Not fixable. Wrapping in `() => value` is correct only when the replacement
 *   does not also need the match arguments, and rewriting `x` into `() => x`
 *   changes evaluation timing for a call expression. The author picks.
 */

interface AstNode {
  type: string
  [key: string]: unknown
}

interface RuleContext {
  filename?: string | undefined
  getFilename?: (() => string) | undefined
  report: (descriptor: {
    node: AstNode
    messageId: string
    data?: Record<string, string> | undefined
  }) => void
}

/**
 * The two methods whose second argument is a replacement.
 */
const REPLACE_METHODS: ReadonlySet<string> = new Set(['replace', 'replaceAll'])

/**
 * True when a node is a replacement the author can read at the call site: a
 * plain string, or a template literal with nothing interpolated into it.
 */
export function isLiteralReplacement(node: AstNode | undefined): boolean {
  if (!node) {
    return false
  }
  if (node.type === 'Literal') {
    return typeof node['value'] === 'string'
  }
  if (node.type === 'TemplateLiteral') {
    return hasNoInterpolation(node)
  }
  // `String.raw`\$&`` is the regex-escape idiom spelled without doubling the
  // backslashes. Nothing is interpolated, so it reads at the call site exactly
  // like the plain literal it replaces.
  if (node.type === 'TaggedTemplateExpression') {
    const tag = node['tag'] as AstNode | undefined
    const quasi = node['quasi'] as AstNode | undefined
    return isStringRawTag(tag) && hasNoInterpolation(quasi)
  }
  return false
}

/**
 * True when a template has no `${…}` slots, so its text is fixed at authoring
 * time. Exported so the tag and interpolation halves can be tested apart.
 */
export function hasNoInterpolation(node: AstNode | undefined): boolean {
  const expressions = node?.['expressions']
  return Array.isArray(expressions) && expressions.length === 0
}

/**
 * True when a tag is exactly `String.raw`, the only tag whose result is the
 * literal source text. Exported for tests.
 */
export function isStringRawTag(node: AstNode | undefined): boolean {
  if (!node || node.type !== 'MemberExpression') {
    return false
  }
  const object = node['object'] as AstNode | undefined
  const property = node['property'] as AstNode | undefined
  return (
    object?.type === 'Identifier' &&
    object['name'] === 'String' &&
    property?.type === 'Identifier' &&
    property['name'] === 'raw'
  )
}

/**
 * True when a node is already a replacer function, which needs no `$` parsing.
 */
export function isFunctionReplacement(node: AstNode | undefined): boolean {
  if (!node) {
    return false
  }
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression'
  )
}

/**
 * True when a replacement argument carries a runtime value, which is the shape
 * that silently re-parses `$` tokens living in that value.
 */
export function isDynamicReplacement(node: AstNode | undefined): boolean {
  if (!node) {
    return false
  }
  return !isLiteralReplacement(node) && !isFunctionReplacement(node)
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Pass a replacer function when the replacement is a runtime value, so `$` tokens inside that value are not re-interpreted.',
      category: 'Possible Errors',
      recommended: true,
    },
    // Intentionally NOT fixable. `() => x` is the right wrap only when the
    // replacement ignores the match arguments, and wrapping a call expression
    // defers its evaluation into the replace loop, which runs it once per
    // match instead of once. Both are author calls.
    messages: {
      dynamicReplacement:
        "The replacement passed to `.{{method}}()` is a runtime value, so any `$&`, `$1`, `` $` ``, `$'`, or `$$` inside it is re-interpreted instead of inserted. Wrap it in a replacer function — `.{{method}}(pattern, () => value)` — which returns its result verbatim. A string literal here is fine and stays allowed.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const callee = node['callee'] as AstNode | undefined
        if (!callee || callee.type !== 'MemberExpression') {
          return
        }
        const property = callee['property'] as AstNode | undefined
        if (
          !property ||
          property.type !== 'Identifier' ||
          typeof property['name'] !== 'string' ||
          !REPLACE_METHODS.has(property['name'])
        ) {
          return
        }
        const args = node['arguments']
        if (!Array.isArray(args) || args.length < 2) {
          return
        }
        const replacement = args[1] as AstNode | undefined
        if (!isDynamicReplacement(replacement)) {
          return
        }
        context.report({
          node,
          messageId: 'dynamicReplacement',
          data: { method: property['name'] },
        })
      },
    }
  },
}

// The oxlint plugin contract requires a default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- plugin contract
export default rule
