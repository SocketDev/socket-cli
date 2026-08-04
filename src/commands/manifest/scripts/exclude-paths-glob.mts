// Single source of truth for --exclude-paths glob semantics against a JVM
// build root's subproject dirs: anchored, relative, case-sensitive; `*`
// within one path segment, `**` across zero or more segments, `?` within one
// segment, and `[...]` character classes with `[!..]`/`[^..]` negation.
// Entries are assumed pre-validated by assertValidExcludePaths (relative, no
// negation, no `..`, balanced brackets, comma-free). A malformed entry falls
// back to a literal match, never throws.
//
// Compiled HERE, once, and handed to every producer (the gradle/sbt/maven
// facts and workspaces scripts) pre-compiled, so there is exactly one
// implementation and one test suite instead of the same algorithm
// re-implemented per language.
//
// Portability contract: gradle/sbt/maven all run on the JVM and share the
// exact same regex engine (java.util.regex), so the same emitted subset
// (`.*`, `[^/]*`, `[^/]`, `[...]`, `[^...]`, backslash-escaped
// metacharacters) is authoritative for every producer - this compiler and JS
// RegExp agree on the identical subset. Class bodies escape `&` because Java
// classes support `&&` intersection (JS treats it literally). Each compiled
// pattern already means "this path OR its whole subtree", matching the
// documented --exclude-paths contract, so a producer never needs its own
// "self + /**" expansion. Patterns transport comma-joined: an input glob can
// never contain a comma, since --exclude-paths is comma-split before glob
// parsing reaches this module.

function literalSource(glob: string): string {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `^(?:${escaped})(?:/.*)?$`
}

// Strips a trailing `/**` (and trailing slashes) so `dir` and `dir/**` both
// compile to the same base pattern - the "self OR subtree" wrap below is
// what actually encodes matching the subtree, not the user's own suffix.
function stripTrailingGlobstar(glob: string): string {
  let g = glob
  while (g.endsWith('/')) {
    g = g.slice(0, -1)
  }
  while (g.endsWith('/**')) {
    g = g.slice(0, -3)
    while (g.endsWith('/')) {
      g = g.slice(0, -1)
    }
  }
  return g
}

// Translates one path segment's `*`/`?`/`[...]` - never crosses a `/`.
function translateSegment(segment: string): string {
  let sb = ''
  let i = 0
  const n = segment.length
  while (i < n) {
    const ch = segment.charAt(i)
    if (ch === '*') {
      sb += '[^/]*'
      i += 1
    } else if (ch === '?') {
      sb += '[^/]'
      i += 1
    } else if (ch === '[') {
      const j = segment.indexOf(']', i + 1)
      // Treat as a class only with a non-empty body; else a literal `[`.
      if (j <= i + 1) {
        sb += '\\['
        i += 1
      } else {
        let body = segment.slice(i + 1, j)
        const neg = body.startsWith('!') || body.startsWith('^')
        if (neg) {
          body = body.slice(1)
        }
        if (!body) {
          // `[!]`/`[^]` would emit `[^]`, which JS accepts but Java rejects;
          // signal the caller to fall back to a whole-glob literal match.
          throw new Error('empty-class')
        }
        // Only literal chars and `-` ranges are meaningful; neutralize
        // regex-class tricks (`&` guards Java's `&&` class intersection).
        body = body
          .replace(/\\/g, '\\\\')
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]')
          .replace(/&/g, '\\&')
        sb += `[${neg ? '^' : ''}${body}]`
        i = j + 1
      }
    } else if ('.\\^$|+(){}]'.includes(ch)) {
      sb += `\\${ch}`
      i += 1
    } else {
      sb += ch
      i += 1
    }
  }
  return sb
}

export function excludePathGlobToRegexSource(glob: string): string {
  const stripped = stripTrailingGlobstar(glob)
  if (!stripped) {
    // Defensive only: assertValidExcludePaths already rejects a pattern that
    // reduces to "match everything".
    return literalSource(glob)
  }
  try {
    const segments = stripped.split('/')
    let base = ''
    segments.forEach((segment, i) => {
      const isLast = i === segments.length - 1
      if (segment === '**') {
        // Zero or more whole segments: mid-pattern, each consumed segment
        // carries its own trailing slash; as the last segment, anything
        // (including nothing) for the rest of the path.
        base += isLast ? '.*' : '(?:[^/]+/)*'
      } else {
        base += translateSegment(segment)
        if (!isLast) {
          base += '/'
        }
      }
    })
    const source = `^(?:${base})(?:/.*)?$`
    // eslint-disable-next-line no-new
    new RegExp(source)
    return source
  } catch {
    return literalSource(glob)
  }
}

export function compileExcludePathPatterns(
  paths: readonly string[] | undefined,
): string[] {
  return (paths ?? []).map(excludePathGlobToRegexSource)
}

// Transport form handed to the build-tool scripts: comma-joined pattern
// sources. Empty string when there are no patterns.
export function serializeExcludePathPatterns(
  paths: readonly string[] | undefined,
): string {
  return compileExcludePathPatterns(paths).join(',')
}

export type ExcludePathFilter = (relPath: string) => boolean

export function createExcludePathFilter(
  paths: readonly string[] | undefined,
): ExcludePathFilter {
  const patterns = compileExcludePathPatterns(paths).map(s => new RegExp(s))
  return relPath => patterns.some(p => p.test(relPath))
}
