/*
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
 *     author. When the file has no such markers, the rule REPORTS each bare
 *     `(...)` (it NEVER autofixes — the heuristic is file-local, so it can't see
 *     a capture read in another file, and an autofix would silently break it).
 *     The author converts it to `(?:...)` if unused, or to a named `(?<name>...)`
 *     capture if used. Allowed exceptions (skipped, no report):
 *   - Group already non-capturing: `(?:...)`, `(?=...)`, `(?!...)`,
 *     `(?<...>...)`.
 *   - Single-character groups holding a single alternation element only when the
 *     regex flags include `g`/`y`/`d`: those modes change capture semantics
 *     enough that we keep hands off.
 *   - The line carries `// socket-lint: allow capture` (or `# / /*` variants).
 *     This rule encodes a small but persistent cleanup the fleet keeps wanting:
 *     regex alternation groups written `(md|mdx)` when `(?:md|mdx)` was meant —
 *     no replacement, no `match[N]` indexing — wastes a capture allocation per
 *     match.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

interface CaptureGroup {
  start: number
  end: number
  inner: string
}

const SOCKET_LINT_MARKER_RE =
  /(?:#|\/\/|\/\*)\s*socket-lint:\s*allow(?:\s+(?<tag>[\w-]+))?/

// Markers that indicate at least one regex in the file uses captures.
// Conservative — any single hit disables autofix for the whole file
// (we can't tell which regex the user is referencing).
const CAPTURE_USAGE_RES: readonly RegExp[] = [
  // Replacement-string indexed captures: `'$1'`, `"$2"`, `` `$3` ``.
  /['"`][^'"`]*\$\d[^'"`]*['"`]/,
  // Indexed access with a NON-ZERO numeric index on any identifier —
  // accepts both direct (`m[1]`) and optional-chain (`m?.[1]`) forms.
  // `[0]` is the WHOLE match, not a capture group, so it must NOT count
  // as capture usage: a file that only reads `match[0]` (for a snippet/
  // length) was silencing this rule for EVERY regex in it, letting
  // reflexive unused `(…)` groups slip. Requiring index ≥ 1 closes that
  // blind spot. Numeric-index access on arbitrary identifiers is
  // uncommon outside regex / tuple contexts; false positives just keep
  // the rule silent (no false-flag).
  /\b[A-Za-z_$][\w$]*\s*\??\.?\s*\[\s*[1-9][0-9]*\s*\]/,
  // Destructured exec/match result: `const [, first] = re.exec(s)` /
  // `const [full, first] = s.match(re)`.
  /\[\s*[\w$,\s]+\]\s*=\s*[^;]+\.(?:exec|match|matchAll)\b/,
  // Legacy `RegExp.$1` accessors.
  /\bRegExp\.\$\d\b/,
  // `match.groups.name` / `m.groups.name` — named-capture usage means
  // the author knows their captures matter; stay out.
  /\b(?:m|match|res|result)\.groups\b/,
  // `.replace(re, '...$1...')` — even if the replacement isn't a
  // string literal we matched above, the call signature suggests
  // capture-aware usage.
  /\.replace\([^)]*\$\d/,
  // `.replace(re, (_, foo, ...) => ...)` — arrow callback with 2+ args
  // means the second/third/... positional args are the regex's capture
  // groups. Same for `StringPrototypeReplace(str, re, (_, foo) => ...)`.
  // Without this marker the rule would happily strip the captures,
  // leaving `foo` undefined and breaking the callback at runtime.
  // The `_` first arg is the full match; we only key off the SECOND
  // arg being present, because a single-arg callback (`c => ...`) is
  // fine to fix. The `\/[^,]*,` segment skips the regex literal +
  // its flags + the comma separating it from the callback so we don't
  // get tripped up by `)` chars inside the regex itself (e.g.
  // `.replace(/^([A-Z]):/i, (_, letter) => ...)`).
  /\.replace\s*\([^)]*\/[^,]*,\s*(?:\(|function\s*\()[^)]*,\s*[\w$]/,
  // `StringPrototypeReplace(str, re, callback)` variant — same shape,
  // callback in arg position 3, regex in position 2.
  /\bStringPrototypeReplace(?:All)?\s*\([^)]*,\s*[^,]*\/[^,]*,\s*(?:\(|function\s*\()[^)]*,\s*[\w$]/,
]

function isLineMarkered(line: string): boolean {
  const m = line.match(SOCKET_LINT_MARKER_RE)
  if (!m) {
    return false
  }
  const tag = m.groups?.['tag']
  return !tag || tag === 'capture'
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
      if (open?.capturing) {
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

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use `(?:...)` instead of `(...)` for regex groups whose capture value is not used. Per CLAUDE.md fleet regex rule.',
      category: 'Best Practices',
      recommended: true,
    },
    // Intentionally NOT fixable. The usage heuristic is file-local, so it can
    // never see a capture consumed in ANOTHER file (a regex exported from
    // regexes.mts and read via `match[1]` in index.mts). Auto-stripping the
    // group there silently breaks the consumer — a fleet-wide landmine. Report
    // only; the author chooses non-capturing vs named.
    messages: {
      captureGroup:
        'Numbered capturing group `({{inner}})` is not referenced in THIS file. If its capture is unused, make it non-capturing `(?:{{inner}})`. If it IS used — including via `match[N]` / `$N` in another file — convert it to a NAMED capture `(?<name>{{inner}})` (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Named_capturing_group) so the intent is explicit and later edits do not renumber it. Or append `// socket-lint: allow capture` on this line if the capture is intentional.',
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
      // Whole-pattern backreference guard: a `\1`–`\9` anywhere in the pattern
      // means SOME group is referenced by position. `innerIsAutofixSafe` only
      // catches a backref INSIDE a group's own text; it can't see that
      // `(["']?)(?:x)\1` references group 1 from outside. Converting any
      // capturing group then renumbers/breaks that backref. Too fiddly to
      // reason about per-group, so stay silent for the whole literal. (A `\0`
      // is a null-char escape, not a backref — the `[1-9]` class excludes it.)
      if (/\\[1-9]/.test(pattern)) {
        return
      }
      const groups = findBareCaptureGroups(pattern)
      if (groups.length === 0) {
        return
      }
      // Report each bare numbered capture — no autofix (see meta). The author
      // converts it to `(?:...)` when the capture is unused, or to a named
      // `(?<name>...)` capture when the value is read (possibly cross-file).
      for (let i = 0, { length } = groups; i < length; i += 1) {
        context.report({
          node,
          messageId: 'captureGroup',
          data: { inner: groups[i]!.inner },
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
