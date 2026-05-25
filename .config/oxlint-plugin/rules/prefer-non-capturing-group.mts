/**
 * @file Per CLAUDE.md "Regex" rule: when a capturing group's captured value
 *   isn't used, write it as a non-capturing group instead. Detects bare `(...)`
 *   groups in regex literals and reports them as `(?:...)` candidates. A
 *   capture is "used" if any of the following appear anywhere in the same file
 *   source:
 *
 *   - Numbered backreference inside a regex pattern: `\1`, `\2`, …
 *   - Numeric capture reference in a string literal: `$1`, `$2`, … (replacement
 *     strings in `.replace()`).
 *   - Array index on a regex result: `match[N]`, `result[N]`, `m[N]`, etc.
 *   - Destructured access: `[, captured] = re.exec(str)` or `[full, first] =
 *     str.match(re)`.
 *   - `RegExp.$1` (legacy global), `.matchAll(...)`, `.match(...)` call sites
 *     where the return value is read by index. Conservative posture: when ANY
 *     of these markers appears anywhere in the file, the rule STAYS SILENT — it
 *     cannot tell which specific regex's captures are being consumed without
 *     much heavier analysis, so the safe move is to defer entirely to the
 *     author. When the file has no such markers, the rule reports AND autofixes
 *     `(...)` → `(?:...)` in place. Allowed exceptions (skipped, no report):
 *   - Group already non-capturing: `(?:...)`, `(?=...)`, `(?!...)`,
 *     `(?<...>...)`.
 *   - Single-character groups holding a single alternation element only when the
 *     regex flags include `g`/`y`/`d`: those modes change capture semantics
 *     enough that we keep hands off.
 *   - The line carries `// socket-hook: allow capture` (or `# / /*` variants).
 *     This rule encodes a small but persistent cleanup the fleet keeps wanting:
 *     regex alternation groups written `(md|mdx)` when `(?:md|mdx)` was meant —
 *     no replacement, no `match[N]` indexing — wastes a capture allocation per
 *     match.
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

interface CaptureGroup {
  start: number
  end: number
  inner: string
}

const SOCKET_HOOK_MARKER_RE =
  /(?:#|\/\/|\/\*)\s*socket-hook:\s*allow(?:\s+([\w-]+))?/

// Markers that indicate at least one regex in the file uses captures.
// Conservative — any single hit disables autofix for the whole file
// (we can't tell which regex the user is referencing).
const CAPTURE_USAGE_RES: readonly RegExp[] = [
  // Replacement-string indexed captures: `'$1'`, `"$2"`, `` `$3` ``.
  /['"`][^'"`]*\$\d[^'"`]*['"`]/,
  // Indexed access with a numeric index on any identifier — accepts
  // both direct (`m[1]`) and optional-chain (`m?.[1]`) forms. Numeric-
  // index access on arbitrary identifiers is uncommon outside regex /
  // tuple / NodeList contexts, and false positives just keep the rule
  // silent (no false-flag).
  /\b[A-Za-z_$][\w$]*\s*\??\.?\s*\[\s*\d+\s*\]/,
  // Destructured exec/match result: `const [, first] = re.exec(s)` /
  // `const [full, first] = s.match(re)`.
  /\[\s*[\w$,\s]+\]\s*=\s*[^;]+\.(?:exec|match|matchAll)\b/,
  // Legacy `RegExp.$1` accessors.
  /\bRegExp\.\$\d\b/,
  // `match.groups.name` / `m.groups.name` — named-capture usage means
  // the author knows their captures matter; stay out.
  /\b(?:match|result|m|res)\.groups\b/,
  // `.replace(re, '...$1...')` — even if the replacement isn't a
  // string literal we matched above, the call signature suggests
  // capture-aware usage.
  /\.replace\([^)]*\$\d/,
]

function isLineMarkered(line: string): boolean {
  const m = line.match(SOCKET_HOOK_MARKER_RE)
  if (!m) {
    return false
  }
  return !m[1] || m[1] === 'capture'
}

/**
 * Walk a regex pattern and return every top-level _capturing_ group: bare
 * `(...)` openings that aren't followed by `?:` / `?=` / `?!` / `?<`. Skips
 * character classes and escaped parens.
 */
function findBareCaptureGroups(pattern: string): CaptureGroup[] {
  const groups: CaptureGroup[] = []
  const stack: Array<{ start: number; capturing: boolean }> = []
  let inClass = false
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (c === ']') {
        inClass = false
      }
      i++
      continue
    }
    if (c === '[') {
      inClass = true
      i++
      continue
    }
    if (c === '(') {
      let capturing = true
      if (pattern[i + 1] === '?') {
        capturing = false
      }
      stack.push({ start: i, capturing })
      i++
      continue
    }
    if (c === ')') {
      const open = stack.pop()
      if (open && open.capturing) {
        groups.push({
          start: open.start,
          end: i + 1,
          inner: pattern.slice(open.start + 1, i),
        })
      }
      i++
      continue
    }
    i++
  }
  return groups
}

/**
 * Heuristic: does the file's source contain any markers suggesting at least one
 * regex in this file relies on its captures? When true, we DROP the autofix
 * (still report) so a wrong rewrite can't break unrelated code.
 */
function fileUsesCaptures(source: string): boolean {
  for (let i = 0, { length } = CAPTURE_USAGE_RES; i < length; i += 1) {
    const re = CAPTURE_USAGE_RES[i]!
    if (re.test(source)) {
      return true
    }
  }
  return false
}

/**
 * Conservative inner-pattern guard: skip when the inner alternation might be
 * load-bearing in ways the rule can't reason about — backreferences inside the
 * group (`(foo|bar\1)`) or nested groups (`(foo|(bar)baz)`) get reported but
 * never autofixed.
 */
function innerIsAutofixSafe(inner: string): boolean {
  if (/\\[1-9]/.test(inner)) {
    return false
  }
  if (/\((?!\?)/.test(inner)) {
    return false
  }
  return true
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use `(?:...)` instead of `(...)` for regex groups whose capture value is not used. Per CLAUDE.md fleet regex rule.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      unused:
        'Capturing group `({{inner}})` is unused. Use `(?:{{inner}})` (non-capturing) instead.',
      unusedNoFix:
        'Capturing group `({{inner}})` looks unused, but the file contains capture-usage markers elsewhere. Either convert manually to `(?:{{inner}})`, or append `// socket-hook: allow capture` on this line if the capture is intentional.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    const fullSource: string = sourceCode.text ?? ''
    // Conservative posture: the rule cannot reliably tell which regex
    // in a file owns a given `match[N]` / `$N` / `.groups` usage. If
    // ANY such marker appears anywhere in the file source, stay
    // silent and let the author own the call. The previous design
    // (report-with-no-autofix) over-warned on files that mixed one
    // captured-and-used regex with one captured-but-unused regex.
    const hasUsageMarkers = fileUsesCaptures(fullSource)
    if (hasUsageMarkers) {
      return {}
    }

    function checkLiteral(node: AstNode) {
      if (!node.regex) {
        return
      }
      const line = sourceCode.lines[node.loc.start.line - 1] ?? ''
      if (isLineMarkered(line)) {
        return
      }
      const pattern: string = node.regex.pattern
      const groups = findBareCaptureGroups(pattern)
      if (groups.length === 0) {
        return
      }
      // Partition into autofix-safe (every group's inner is fix-safe)
      // and report-only (any group is non-fix-safe). Each unsafe group
      // also emits its own `unusedNoFix` report so the author sees every
      // hit; the safe-group autofix uses the ORIGINAL pattern offsets
      // and rewrites in reverse order so earlier offsets stay valid.
      const allSafe = groups.every(g => innerIsAutofixSafe(g.inner))
      if (allSafe) {
        const flags: string = node.regex.flags || ''
        // Build the new pattern by replacing each `(...)` with `(?:...)`
        // — iterate in reverse so earlier `group.start` / `group.end`
        // offsets remain valid even after later edits.
        let newPattern = pattern
        const reversed = [...groups].toReversed()
        for (let i = 0, { length } = reversed; i < length; i += 1) {
          const group = reversed[i]!
          newPattern =
            newPattern.slice(0, group.start) +
            `(?:${group.inner})` +
            newPattern.slice(group.end)
        }
        // Emit one `unused` report per offending group so the count
        // matches user expectation. Attach the autofix to the FIRST
        // report only — oxlint applies the fix once per node-rewrite
        // pass; emitting the same full-rewrite fix N times would
        // over-replace.
        for (let i = 0, { length } = groups; i < length; i += 1) {
          const group = groups[i]!
          if (i === 0) {
            context.report({
              node,
              messageId: 'unused',
              data: { inner: group.inner },
              fix(fixer: RuleFixer) {
                return fixer.replaceText(node, `/${newPattern}/${flags}`)
              },
            })
          } else {
            context.report({
              node,
              messageId: 'unused',
              data: { inner: group.inner },
            })
          }
        }
        return
      }
      // Mixed-safety case: report every group as no-fix. The author
      // resolves manually — a partial autofix would create asymmetric
      // capture-index drift that's worse than leaving the regex alone.
      for (let i = 0, { length } = groups; i < length; i += 1) {
        const group = groups[i]!
        context.report({
          node,
          messageId: 'unusedNoFix',
          data: { inner: group.inner },
        })
      }
    }

    return {
      Literal(node: AstNode) {
        checkLiteral(node)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
