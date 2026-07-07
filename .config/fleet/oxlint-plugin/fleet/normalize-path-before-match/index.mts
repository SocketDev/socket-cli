/*
 * @file Flag path-string operations on un-normalized variables. Supersedes the
 *   dual-separator-only surface of `prefer-normalize-path` at the write-time
 *   AST layer: that rule catches explicit `replace(/[/\\]/…)` rewrites; this
 *   rule catches separator-regex `.test/.exec` where the path-like variable is
 *   the argument (not the receiver), AND string separator ops (`.split('/')` /
 *   `.startsWith('…/')` / `.includes('/')` / `.endsWith('/')`) on a path-like
 *   var that is NOT proven-normalized (i.e. not assigned from `normalizePath()`
 *   or `toUnixPath()` earlier in scope). Autofix wraps the subject argument in
 *   `normalizePath(…)`. The normalize helper file itself (`paths/normalize`) is
 *   always skipped. Overlaps with `path-regex-normalize-nudge` Stop hook (that
 *   hook fires on save; this rule fires at lint time — both surfaces complement
 *   each other, neither is deleted).
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Variable names / identifier suffixes considered path-like.
// Matched case-sensitively against the local variable name.
// require-regex-comment: path-like variable name heuristics — suffix/prefix combos.
const PATH_VAR_RE =
  /(?:^|_)(?:path|file|dir|cwd|root|src|dest|target|base|entry|output|input|abs|rel)(?:_|$)|(?:P|p)ath$|(?:F|f)ile$|(?:D|d)ir$/

// Names of normalizing call targets — an assignment from one of these proves
// the variable is already normalized.
const NORMALIZE_CALLEE_NAMES: ReadonlySet<string> = new Set([
  'normalizePath',
  'toUnixPath',
])

// String method calls that indicate a path-separator-sensitive operation.
const PATH_STRING_METHODS: ReadonlySet<string> = new Set([
  'split',
  'startsWith',
  'endsWith',
  'includes',
])

// Regex method calls on the RECEIVER side (/re/.test(pathVar)) — the path is
// the argument. Only fires when the receiver regex is a separator pattern.
const RECEIVER_REGEX_METHODS: ReadonlySet<string> = new Set(['test', 'exec'])

// The three dual-separator regex patterns (matched against node.regex.pattern).
// require-regex-comment: dual-separator and lone-backslash patterns for path matching.
const SEPARATOR_PATTERNS: ReadonlySet<string> = new Set([
  '[/\\\\]',
  '[\\\\/]',
  '\\\\',
])

// require-regex-comment: separator char literal — forward slash or backslash.
const SEPARATOR_CHAR_RE = /^[/\\]$/

function isPathLikeName(name: string): boolean {
  return PATH_VAR_RE.test(name)
}

function isSeparatorStringLiteral(node: AstNode): boolean {
  if (!node || node.type !== 'Literal' || typeof node.value !== 'string') {
    return false
  }
  return SEPARATOR_CHAR_RE.test(node.value)
}

function isSeparatorRegexLiteral(node: AstNode): boolean {
  if (!node || node.type !== 'Literal' || !node.regex) {
    return false
  }
  return SEPARATOR_PATTERNS.has(node.regex.pattern ?? '')
}

function getIdentifierName(node: AstNode): string | undefined {
  if (!node) {
    return undefined
  }
  if (node.type === 'Identifier') {
    return node.name as string
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Normalize a path-like variable with `normalizePath` before matching, splitting, or testing it against separators.',
      category: 'Best Practices',
      recommended: true,
    },
    // Detection-only: NO autofix. Wrapping the arg in `normalizePath(…)` also
    // needs the import added — an auto-wrap without it leaves an
    // undefined-reference, and `pnpm run fix` would then break each matching
    // file fleet-wide. The message names the import so the manual fix is one
    // paste. (Autofix WITH import-insertion is a tracked follow-up.)
    messages: {
      normalizeBeforeRegexMatch:
        "Path-like variable '{{name}}' used in a separator-regex match without prior normalization. Wrap the argument in `normalizePath({{name}})` from `@socketsecurity/lib/paths/normalize`.",
      normalizeBeforeStringSep:
        "Path-like variable '{{name}}' used in a separator-string operation without prior normalization. Wrap the argument in `normalizePath({{name}})` from `@socketsecurity/lib/paths/normalize`.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = normalizePath(
      context.filename ?? context.getFilename?.() ?? '',
    )
    if (/\/paths\/normalize\.[mc]?[jt]s$/.test(filename)) {
      return {}
    }

    // Track variable names proven-normalized in scope (assigned from
    // normalizePath() or toUnixPath()).
    const normalizedVars: Set<string> = new Set()

    function isNormalizeCall(node: AstNode): boolean {
      if (!node || node.type !== 'CallExpression') {
        return false
      }
      const callee = node.callee
      if (callee?.type === 'Identifier') {
        return NORMALIZE_CALLEE_NAMES.has(callee.name as string)
      }
      if (callee?.type === 'MemberExpression') {
        return NORMALIZE_CALLEE_NAMES.has(callee.property?.name as string)
      }
      return false
    }

    function recordNormalizedBinding(node: AstNode): void {
      if (!node) {
        return
      }
      if (
        node.type === 'VariableDeclarator' &&
        node.id?.type === 'Identifier' &&
        isNormalizeCall(node.init)
      ) {
        normalizedVars.add(node.id.name as string)
        return
      }
      if (
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'Identifier' &&
        isNormalizeCall(node.right)
      ) {
        normalizedVars.add(node.left.name as string)
      }
    }

    return {
      VariableDeclarator(node: AstNode) {
        recordNormalizedBinding(node)
      },

      AssignmentExpression(node: AstNode) {
        recordNormalizedBinding(node)
      },

      CallExpression(node: AstNode) {
        const callee = node.callee
        if (callee?.type !== 'MemberExpression') {
          return
        }
        const method: string = callee.property?.name ?? ''
        const receiver = callee.object

        // --- /separator-regex/.test(pathVar) / .exec(pathVar) ----------------
        // The regex is the RECEIVER; the path-like variable is the ARGUMENT.
        // Only fires when the receiver IS a separator regex (avoids flagging
        // /foo/.test(filePath) which is unrelated to path separators).
        if (RECEIVER_REGEX_METHODS.has(method)) {
          if (isSeparatorRegexLiteral(receiver)) {
            const arg0 = node.arguments?.[0]
            const argName = getIdentifierName(arg0)
            if (
              argName &&
              isPathLikeName(argName) &&
              !normalizedVars.has(argName)
            ) {
              context.report({
                node,
                messageId: 'normalizeBeforeRegexMatch',
                data: { name: argName },
              })
            }
          }
          return
        }

        // --- String separator methods: .split('/') / .startsWith('/') etc. ---
        // The path-like variable is the RECEIVER.
        if (PATH_STRING_METHODS.has(method)) {
          const receiverName = getIdentifierName(receiver)
          if (
            receiverName &&
            isPathLikeName(receiverName) &&
            !normalizedVars.has(receiverName)
          ) {
            const arg0 = node.arguments?.[0]
            if (isSeparatorStringLiteral(arg0)) {
              context.report({
                node,
                messageId: 'normalizeBeforeStringSep',
                data: { name: receiverName },
              })
            }
          }
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
