/*
 * @file Flag path-string operations on un-normalized variables. Supersedes the
 *   dual-separator-only surface of `prefer-normalize-path` at the write-time
 *   AST layer: that rule catches explicit `replace(/[/\\]/…)` rewrites; this
 *   rule catches separator-regex `.test/.exec` where the path-like variable is
 *   the argument (not the receiver), AND string separator ops (`.split('/')` /
 *   `.startsWith('…/')` / `.includes('/')` / `.endsWith('/')`) on a path-like
 *   var that is NOT proven-normalized (i.e. not assigned from `normalizePath()`
 *   or `toUnixPath()` earlier in scope). Autofix wraps the subject in
 *   `normalizePath(…)` AND inserts the import when absent — package chosen
 *   from the file's own imports (`@socketsecurity/lib-stable` beats
 *   `@socketsecurity/lib`); a file importing neither gets a report with no
 *   fix, so the fixer can never strand an undefined reference. The normalize
 *   helper file itself (`paths/normalize`) is always skipped. Overlaps with
 *   `path-regex-normalize-nudge` Stop hook (that hook fires on save; this
 *   rule fires at lint time — both surfaces complement each other, neither is
 *   deleted).
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Variable names / identifier suffixes considered path-like.
// Matched case-sensitively against the local variable name.
// require-regex-comment: path-like variable name heuristics — suffix/prefix combos.
const PATH_VAR_RE =
  /(?:^|_)(?:abs|base|cwd|dest|dir|entry|file|input|output|path|rel|root|src|target)(?:_|$)|(?:P|p)ath$|(?:F|f)ile$|(?:D|d)ir$/

// Names of normalizing call targets — an assignment from one of these proves
// the variable is already normalized.
const NORMALIZE_CALLEE_NAMES: ReadonlySet<string> = new Set([
  'normalizePath',
  'toUnixPath',
])

// String method calls that indicate a path-separator-sensitive operation.
const PATH_STRING_METHODS: ReadonlySet<string> = new Set([
  'endsWith',
  'includes',
  'split',
  'startsWith',
])

// Regex method calls on the RECEIVER side (/re/.test(pathVar)) — the path is
// the argument. Only fires when the receiver regex is a separator pattern.
const RECEIVER_REGEX_METHODS: ReadonlySet<string> = new Set(['exec', 'test'])

// The three dual-separator regex patterns (matched against node.regex.pattern).
// require-regex-comment: dual-separator and lone-backslash patterns for path matching.
const SEPARATOR_PATTERNS: ReadonlySet<string> = new Set([
  '[/\\\\]',
  '[\\\\/]',
  '\\\\',
])

// require-regex-comment: separator-prefixed literal — '/', '/dist/',
// '/.gitmodules', or a backslash-led Windows form. A comparison against any
// separator-anchored string is separator-sensitive, not just the bare '/'.
const SEPARATOR_PREFIX_RE = /^[/\\]/

// Fleet tooling tiers where `@socketsecurity/lib-stable` is always resolvable
// (hooks + git-hooks declare it as a dependency; scripts run from the repo
// root where it is installed). A file in these trees with no socket import of
// its own still gets the autofix, defaulted to lib-stable — the never-strand
// invariant holds because the package is guaranteed present there.
// require-regex-comment: path prefixes of the fleet tooling tiers.
const LIB_STABLE_TIER_RE = /(?:^|\/)(?:\.claude\/hooks|\.git-hooks|scripts)\//

function isPathLikeName(name: string): boolean {
  return PATH_VAR_RE.test(name)
}

function isSeparatorStringLiteral(node: AstNode): boolean {
  if (!node || node.type !== 'Literal' || typeof node.value !== 'string') {
    return false
  }
  return SEPARATOR_PREFIX_RE.test(node.value)
}

function isSeparatorRegexLiteral(node: AstNode): boolean {
  if (!node || node.type !== 'Literal' || !node.regex) {
    return false
  }
  const pattern = node.regex.pattern ?? ''
  return SEPARATOR_PATTERNS.has(pattern) || pattern.includes('\\/')
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
    fixable: 'code',
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

    // Import-insertion state for the fixer. The wrap alone would strand an
    // undefined `normalizePath` reference (the incident that demoted this
    // rule to detection-only), so every fix carries the import with it:
    //   - `lastImportNode`     — insertion anchor (after the final import).
    //   - `hasNormalizeImport` — a `normalizePath` named import already lands.
    //   - `importPkg`          — which package family the FILE already uses;
    //     when it imports neither, the fix is withheld entirely rather than
    //     guessing a package the resolver might not find.
    //   - `importFixQueued`    — only the first fix in a pass inserts the
    //     import; later same-pass fixes just wrap (oxlint re-runs fix passes,
    //     and a second insert at the same anchor would duplicate the import).
    let lastImportNode: AstNode | undefined
    let hasNormalizeImport = false
    let importPkg: string | undefined
    let importFixQueued = false
    // Tier fallback ranks BELOW any observed socket import — a file's own
    // imports always pick its package family.
    const tierPkg = LIB_STABLE_TIER_RE.test(filename)
      ? '@socketsecurity/lib-stable'
      : undefined

    function trackImport(node: AstNode): void {
      lastImportNode = node
      const source: string = node.source?.value ?? ''
      if (source.startsWith('@socketsecurity/lib-stable/')) {
        importPkg = '@socketsecurity/lib-stable'
      } else if (
        source.startsWith('@socketsecurity/lib/') &&
        importPkg !== '@socketsecurity/lib-stable'
      ) {
        importPkg = '@socketsecurity/lib'
      }
      const specs: AstNode[] = node.specifiers ?? []
      for (let i = 0, { length } = specs; i < length; i += 1) {
        const spec = specs[i]!
        if (
          spec.type === 'ImportSpecifier' &&
          spec.local?.name === 'normalizePath'
        ) {
          hasNormalizeImport = true
        }
      }
    }

    // Build the fix for one finding: wrap `subject` (an Identifier node) in
    // `normalizePath(…)`, plus the import insertion when the file needs one.
    // Returns undefined when the file gives the fixer no safe import anchor
    // or package choice — the finding stays report-only there.
    function makeFix(
      subject: AstNode,
      name: string,
    ): ((fixer: RuleFixer) => unknown) | undefined {
      const pkg = importPkg ?? tierPkg
      if (!hasNormalizeImport && (!lastImportNode || !pkg)) {
        return undefined
      }
      return (fixer: RuleFixer) => {
        const wrap = fixer.replaceText(subject, `normalizePath(${name})`)
        if (hasNormalizeImport || importFixQueued) {
          return wrap
        }
        importFixQueued = true
        return [
          fixer.insertTextAfter(
            lastImportNode,
            `\nimport { normalizePath } from '${pkg}/paths/normalize'`,
          ),
          wrap,
        ]
      }
    }

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
      ImportDeclaration(node: AstNode) {
        trackImport(node)
      },

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
                fix: makeFix(arg0, argName),
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
                fix: makeFix(receiver, receiverName),
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
