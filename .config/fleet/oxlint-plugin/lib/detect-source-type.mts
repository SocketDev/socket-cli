/*
 * @file Detect whether the linted file is CommonJS or ES module syntax, so
 *   rules whose autofix is module-system-sensitive can opt out on the wrong
 *   side. Mirrors the upstream `@ultrathink/acorn` `detectSourceType` helper
 *   (see `lang/typescript/src/core/detect-source-type.ts` +
 *   `lang/rust/crates/core/src/detect_source_type.rs` +
 *   `lang/go/src/core/detect_source_type.go` +
 *   `lang/cpp/src/core/detect_source_type.hpp`). The implementation is
 *   duplicated here because the oxlint plugin must run with no cross-package
 *   imports — rules ship as standalone JS modules loaded by oxlint's JS-plugin
 *   interface. Drift watch: when the ultrathink helper changes, this copy must
 *   change in lock-step. Idea (modeled on standard-things/esm's compile-time
 *   hint pass — see `src/module/internal/compile.js` +
 *   `src/parse/find-indexes.js` in the esm@2d02f6df reference): _Don't_ parse
 *   the AST. Walk the source once with a small state machine that tracks string
 *   / template / comment / regex / brace nesting and inspects only DEPTH-0
 *   tokens. Function / class / block bodies are skipped via depth tracking — we
 *   never descend into them. Single linear pass, early exit on the first
 *   definitive ESM marker. Algorithm — same as Node's
 *   `--experimental-detect-module`:
 *
 *   1. Extension hint is authoritative for `.cjs` / `.cts` / `.mjs` / `.mts`.
 *   2. Package-type hint (`"module"` / `"commonjs"`) settles the `.js` / `.ts`
 *      ambiguous case.
 *   3. Top-level scan. ESM markers (`import`, `export`, `import.meta`, top-level
 *      `await`) take precedence over CJS markers (`require()`,
 *      `module.exports`, `exports.X`).
 *   4. Otherwise `'unknown'` — caller decides. Motivating incident: the
 *      `socket/export-top-level-functions` autofix rewrote internal helpers in
 *      `acorn-bindgen.cjs` (wasm-bindgen output) from `function getObject(idx)
 *      { … }` to `export function getObject(idx) { … }`. The file's public
 *      surface is `module.exports = …` (CJS), so the rewritten `export`
 *      keywords made the file syntactically ESM and the first `require()` of it
 *      threw `SyntaxError: Unexpected token 'export'`.
 */

export type SourceTypeKind = 'cjs' | 'esm' | 'unknown'

export interface DetectSourceTypeHint {
  extension?: string | undefined
  packageType?: 'module' | 'commonjs' | undefined
}

const CJS_EXTENSIONS = new Set(['.cjs', '.cts'])
const ESM_EXTENSIONS = new Set(['.mjs', '.mts'])

// Tier-1 fast-reject. V8 JITs this alternation to a SIMD-friendly
// DFA; a file with none of these substrings can't possibly contain
// module syntax and skips the per-byte state machine entirely.
// Needles sorted alphanumerically; order doesn't change correctness.
const FAST_REJECT_RE =
  /\b(?:__dirname|__filename|await|export|exports|import|module|require)\b/

const CHAR_TAB = 9
const CHAR_LF = 10
const CHAR_CR = 13
const CHAR_SPACE = 32
const CHAR_BANG = 33
const CHAR_DQUOTE = 34
const CHAR_HASH = 35
const CHAR_DOLLAR = 36
const CHAR_PERCENT = 37
const CHAR_AMP = 38
const CHAR_SQUOTE = 39
const CHAR_LPAREN = 40
const CHAR_RPAREN = 41
const CHAR_STAR = 42
const CHAR_PLUS = 43
const CHAR_COMMA = 44
const CHAR_MINUS = 45
const CHAR_DOT = 46
const CHAR_SLASH = 47
const CHAR_0 = 48
const CHAR_9 = 57
const CHAR_COLON = 58
const CHAR_SEMI = 59
const CHAR_LT = 60
const CHAR_EQ = 61
const CHAR_GT = 62
const CHAR_QUEST = 63
const CHAR_A = 65
const CHAR_Z = 90
const CHAR_LBRACKET = 91
const CHAR_BSLASH = 92
const CHAR_RBRACKET = 93
const CHAR_CARET = 94
const CHAR_UNDERSCORE = 95
const CHAR_BACKTICK = 96
const CHAR_a = 97
const CHAR_z = 122
const CHAR_LBRACE = 123
const CHAR_PIPE = 124
const CHAR_RBRACE = 125
const CHAR_TILDE = 126

function isIdentStart(ch: number): boolean {
  return (
    (ch >= CHAR_a && ch <= CHAR_z) ||
    (ch >= CHAR_A && ch <= CHAR_Z) ||
    ch === CHAR_UNDERSCORE ||
    ch === CHAR_DOLLAR
  )
}

function isIdentPart(ch: number): boolean {
  return (
    (ch >= CHAR_a && ch <= CHAR_z) ||
    (ch >= CHAR_A && ch <= CHAR_Z) ||
    (ch >= CHAR_0 && ch <= CHAR_9) ||
    ch === CHAR_UNDERSCORE ||
    ch === CHAR_DOLLAR
  )
}

function startsRegex(prevMeaningful: number): boolean {
  if (prevMeaningful === 0) {
    return true
  }
  return (
    prevMeaningful === CHAR_LPAREN ||
    prevMeaningful === CHAR_COMMA ||
    prevMeaningful === CHAR_EQ ||
    prevMeaningful === CHAR_SEMI ||
    prevMeaningful === CHAR_LBRACE ||
    prevMeaningful === CHAR_RBRACE ||
    prevMeaningful === CHAR_COLON ||
    prevMeaningful === CHAR_LBRACKET ||
    prevMeaningful === CHAR_BANG ||
    prevMeaningful === CHAR_QUEST ||
    prevMeaningful === CHAR_AMP ||
    prevMeaningful === CHAR_PIPE ||
    prevMeaningful === CHAR_CARET ||
    prevMeaningful === CHAR_TILDE ||
    prevMeaningful === CHAR_LT ||
    prevMeaningful === CHAR_GT ||
    prevMeaningful === CHAR_PLUS ||
    prevMeaningful === CHAR_MINUS ||
    prevMeaningful === CHAR_STAR ||
    prevMeaningful === CHAR_PERCENT ||
    prevMeaningful === CHAR_SLASH
  )
}

function matchAt(
  source: string,
  start: number,
  end: number,
  keyword: string,
): boolean {
  const klen = keyword.length
  if (end - start !== klen) {
    return false
  }
  for (let i = 0; i < klen; i += 1) {
    if (source.charCodeAt(start + i) !== keyword.charCodeAt(i)) {
      return false
    }
  }
  return true
}

// Returns true if last is a byte that prevents Automatic Semicolon
// Insertion when followed by a newline. Mirrors the upstream
// detect-source-type.ts::continuesStatement.
function continuesStatement(last: number): boolean {
  return (
    last === CHAR_COMMA ||
    last === CHAR_LBRACE ||
    last === CHAR_LBRACKET ||
    last === CHAR_LPAREN ||
    last === CHAR_EQ ||
    last === CHAR_PLUS ||
    last === CHAR_MINUS ||
    last === CHAR_STAR ||
    last === CHAR_SLASH ||
    last === CHAR_PERCENT ||
    last === CHAR_LT ||
    last === CHAR_GT ||
    last === CHAR_AMP ||
    last === CHAR_PIPE ||
    last === CHAR_CARET ||
    last === CHAR_TILDE ||
    last === CHAR_QUEST ||
    last === CHAR_COLON ||
    last === CHAR_BANG ||
    last === CHAR_DOT
  )
}

function isWrapperName(source: string, start: number, end: number): boolean {
  return (
    matchAt(source, start, end, 'module') ||
    matchAt(source, start, end, 'exports') ||
    matchAt(source, start, end, 'require') ||
    matchAt(source, start, end, '__filename') ||
    matchAt(source, start, end, '__dirname')
  )
}

// Walk a const|let|var declaration starting at after (the byte just
// past the binder keyword). Returns true if any binding identifier
// is a CJS wrapper name. Handles simple / comma-separated /
// destructured binding shapes. Stops at `;` (depth 0) or at a
// newline where the previous meaningful byte does NOT continue the
// expression (ASI insertion). See continuesStatement.
function declarationDeclaresWrapper(
  source: string,
  after: number,
  length: number,
): boolean {
  let i = after
  let depth = 0
  let inInitializer = false
  let last = 0
  while (i < length) {
    const ch = source.charCodeAt(i)
    if (ch === CHAR_SPACE || ch === CHAR_TAB || ch === CHAR_CR) {
      i += 1
      continue
    }
    if (ch === CHAR_LF) {
      if (depth === 0 && last !== 0 && !continuesStatement(last)) {
        return false
      }
      i += 1
      continue
    }
    if (ch === CHAR_SLASH && source.charCodeAt(i + 1) === CHAR_SLASH) {
      i += 2
      while (i < length && source.charCodeAt(i) !== CHAR_LF) {
        i += 1
      }
      continue
    }
    if (ch === CHAR_SLASH && source.charCodeAt(i + 1) === CHAR_STAR) {
      i += 2
      while (i < length) {
        if (
          source.charCodeAt(i) === CHAR_STAR &&
          source.charCodeAt(i + 1) === CHAR_SLASH
        ) {
          i += 2
          break
        }
        i += 1
      }
      continue
    }
    if (ch === CHAR_DQUOTE || ch === CHAR_SQUOTE) {
      const quote = ch
      i += 1
      while (i < length) {
        const c = source.charCodeAt(i)
        if (c === CHAR_BSLASH) {
          i += 2
          continue
        }
        if (c === quote) {
          i += 1
          break
        }
        if (c === CHAR_LF) {
          break
        }
        i += 1
      }
      last = quote
      continue
    }
    if (ch === CHAR_BACKTICK) {
      i += 1
      while (i < length) {
        const c = source.charCodeAt(i)
        if (c === CHAR_BSLASH) {
          i += 2
          continue
        }
        if (c === CHAR_BACKTICK) {
          i += 1
          break
        }
        i += 1
      }
      last = CHAR_BACKTICK
      continue
    }
    if (ch === CHAR_SEMI && depth === 0) {
      return false
    }
    if (ch === CHAR_EQ && depth === 0) {
      inInitializer = true
      last = ch
      i += 1
      continue
    }
    if (ch === CHAR_COMMA && depth === 0) {
      inInitializer = false
      last = ch
      i += 1
      continue
    }
    if (ch === CHAR_LBRACE || ch === CHAR_LBRACKET || ch === CHAR_LPAREN) {
      depth += 1
      last = ch
      i += 1
      continue
    }
    if (ch === CHAR_RBRACE || ch === CHAR_RBRACKET || ch === CHAR_RPAREN) {
      if (depth > 0) {
        depth -= 1
      }
      last = ch
      i += 1
      continue
    }
    if (isIdentStart(ch)) {
      const start = i
      i += 1
      while (i < length && isIdentPart(source.charCodeAt(i))) {
        i += 1
      }
      // Property-key vs binding-name disambiguation inside an
      // object pattern: `const { module: foo } = obj` — `module`
      // is the SOURCE KEY, `foo` is the binding. CJS-wrapped parse
      // succeeds; Node returns CJS. Discriminator: at depth > 0,
      // an identifier immediately followed by `:` is a property
      // key, not a binding.
      let isKey = false
      if (depth > 0) {
        const lookahead = skipWhitespace(source, i)
        if (lookahead < length && source.charCodeAt(lookahead) === CHAR_COLON) {
          isKey = true
        }
      }
      if (!inInitializer && !isKey && isWrapperName(source, start, i)) {
        return true
      }
      last = source.charCodeAt(i - 1)
      continue
    }
    last = ch
    i += 1
  }
  return false
}

function matchKeyword(source: string, pos: number, keyword: string): number {
  const { length } = source
  const klen = keyword.length
  if (pos + klen > length) {
    return -1
  }
  for (let i = 0; i < klen; i += 1) {
    if (source.charCodeAt(pos + i) !== keyword.charCodeAt(i)) {
      return -1
    }
  }
  const after = pos + klen
  if (after < length && isIdentPart(source.charCodeAt(after))) {
    return -1
  }
  return after
}

function skipWhitespace(source: string, pos: number): number {
  const { length } = source
  let i = pos
  while (i < length) {
    const c = source.charCodeAt(i)
    if (c === CHAR_SPACE || c === CHAR_TAB || c === CHAR_LF || c === CHAR_CR) {
      i += 1
      continue
    }
    break
  }
  return i
}

// Conservative remainder check used to short-circuit `cjs` after
// seeing a CJS marker. Returns true if `source.slice(pos)` MIGHT
// contain a new ESM marker. See upstream
// `lang/typescript/src/core/detect-source-type.ts` for rationale.
const ESM_ONLY_REMAINDER_RE_WH =
  /\b(?:__dirname|__filename|await|export|import)\b/g

function couldHaveEsmMarkerAfter(source: string, pos: number): boolean {
  ESM_ONLY_REMAINDER_RE_WH.lastIndex = pos
  if (ESM_ONLY_REMAINDER_RE_WH.exec(source) !== null) {
    return true
  }
  const hasBinder =
    source.indexOf('const', pos) !== -1 ||
    source.indexOf('let', pos) !== -1 ||
    source.indexOf('var', pos) !== -1
  if (!hasBinder) {
    return false
  }
  return (
    source.indexOf('module', pos) !== -1 ||
    source.indexOf('exports', pos) !== -1 ||
    source.indexOf('require', pos) !== -1
  )
}

type ScanMarker = 'esm' | 'cjs' | 'none'

export function scanTopLevelMarker(source: string): ScanMarker {
  let i = 0
  const { length } = source
  let depth = 0
  let prevMeaningful = 0
  let sawCjs = false
  // Short-circuit after first CJS marker; see
  // couldHaveEsmMarkerAfter docs.
  let cjsShortCircuitChecked = false

  while (i < length) {
    const ch = source.charCodeAt(i)

    if (
      ch === CHAR_SPACE ||
      ch === CHAR_TAB ||
      ch === CHAR_LF ||
      ch === CHAR_CR
    ) {
      i += 1
      continue
    }

    // Line comment — jump to next LF via SIMD-backed indexOf.
    if (ch === CHAR_SLASH && source.charCodeAt(i + 1) === CHAR_SLASH) {
      const nl = source.indexOf('\n', i + 2)
      i = nl === -1 ? length : nl
      continue
    }

    // Block comment — jump to `*/`.
    if (ch === CHAR_SLASH && source.charCodeAt(i + 1) === CHAR_STAR) {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? length : end + 2
      continue
    }

    if (ch === CHAR_HASH && i === 0 && source.charCodeAt(i + 1) === CHAR_BANG) {
      const nl = source.indexOf('\n', 2)
      i = nl === -1 ? length : nl
      continue
    }

    // String literal — jump to next quote, count preceding
    // backslashes (odd → escaped, keep searching).
    if (ch === CHAR_DQUOTE || ch === CHAR_SQUOTE) {
      const quote = ch
      const quoteStr = quote === CHAR_DQUOTE ? '"' : "'"
      let pos = i + 1
      while (pos < length) {
        const next = source.indexOf(quoteStr, pos)
        if (next === -1) {
          pos = length
          break
        }
        let bs = 0
        let j = next - 1
        while (j >= i + 1 && source.charCodeAt(j) === CHAR_BSLASH) {
          bs += 1
          j -= 1
        }
        if ((bs & 1) === 0) {
          pos = next + 1
          break
        }
        pos = next + 1
      }
      i = pos
      prevMeaningful = quote
      continue
    }

    if (ch === CHAR_BACKTICK) {
      i += 1
      while (i < length) {
        const c = source.charCodeAt(i)
        if (c === CHAR_BSLASH) {
          i += 2
          continue
        }
        if (c === CHAR_BACKTICK) {
          i += 1
          break
        }
        if (c === CHAR_DOLLAR && source.charCodeAt(i + 1) === CHAR_LBRACE) {
          i += 2
          let tplDepth = 1
          while (i < length && tplDepth > 0) {
            const cc = source.charCodeAt(i)
            if (cc === CHAR_LBRACE) {
              tplDepth += 1
            } else if (cc === CHAR_RBRACE) {
              tplDepth -= 1
            } else if (cc === CHAR_DQUOTE || cc === CHAR_SQUOTE) {
              const innerQuote = cc
              i += 1
              while (i < length) {
                const ccc = source.charCodeAt(i)
                if (ccc === CHAR_BSLASH) {
                  i += 2
                  continue
                }
                if (ccc === innerQuote) {
                  i += 1
                  break
                }
                if (ccc === CHAR_LF) {
                  break
                }
                i += 1
              }
              continue
            }
            i += 1
          }
          continue
        }
        i += 1
      }
      prevMeaningful = CHAR_BACKTICK
      continue
    }

    if (ch === CHAR_SLASH && startsRegex(prevMeaningful)) {
      i += 1
      let inClass = false
      while (i < length) {
        const c = source.charCodeAt(i)
        if (c === CHAR_BSLASH) {
          i += 2
          continue
        }
        if (c === CHAR_LBRACKET) {
          inClass = true
        } else if (c === CHAR_RBRACKET) {
          inClass = false
        } else if (c === CHAR_SLASH && !inClass) {
          i += 1
          break
        } else if (c === CHAR_LF) {
          break
        }
        i += 1
      }
      while (i < length && isIdentPart(source.charCodeAt(i))) {
        i += 1
      }
      prevMeaningful = CHAR_SLASH
      continue
    }

    if (ch === CHAR_LBRACE || ch === CHAR_LPAREN || ch === CHAR_LBRACKET) {
      depth += 1
      prevMeaningful = ch
      i += 1
      continue
    }
    if (ch === CHAR_RBRACE || ch === CHAR_RPAREN || ch === CHAR_RBRACKET) {
      if (depth > 0) {
        depth -= 1
      }
      prevMeaningful = ch
      i += 1
      continue
    }

    if (isIdentStart(ch)) {
      const start = i
      i += 1
      while (i < length && isIdentPart(source.charCodeAt(i))) {
        i += 1
      }
      if (depth === 0) {
        const word = source.slice(start, i)
        if (word === 'import') {
          const after = skipWhitespace(source, i)
          if (after < length) {
            const c = source.charCodeAt(after)
            if (c === CHAR_LPAREN) {
              prevMeaningful = ch
              continue
            }
            if (c === CHAR_DOT) {
              const metaPos = skipWhitespace(source, after + 1)
              if (matchKeyword(source, metaPos, 'meta') !== -1) {
                return 'esm'
              }
              prevMeaningful = ch
              continue
            }
          }
          return 'esm'
        }
        if (word === 'export') {
          return 'esm'
        }
        if (word === 'await') {
          return 'esm'
        }
        if (word === 'const' || word === 'let' || word === 'var') {
          // Walk the full declaration for wrapper-name bindings in
          // any position (simple, destructured, or comma-separated).
          // See declarationDeclaresWrapper.
          if (declarationDeclaresWrapper(source, i, length)) {
            return 'esm'
          }
        }
        if (word === 'require') {
          const after = skipWhitespace(source, i)
          if (after < length && source.charCodeAt(after) === CHAR_LPAREN) {
            sawCjs = true
          }
        } else if (word === 'module') {
          const after = skipWhitespace(source, i)
          if (after < length && source.charCodeAt(after) === CHAR_DOT) {
            const propPos = skipWhitespace(source, after + 1)
            if (matchKeyword(source, propPos, 'exports') !== -1) {
              sawCjs = true
            }
          }
        } else if (word === 'exports') {
          if (prevMeaningful !== CHAR_DOT) {
            const after = skipWhitespace(source, i)
            if (after < length && source.charCodeAt(after) === CHAR_DOT) {
              sawCjs = true
            }
          }
        }
      }
      if (sawCjs && !cjsShortCircuitChecked) {
        cjsShortCircuitChecked = true
        if (!couldHaveEsmMarkerAfter(source, i)) {
          return 'cjs'
        }
      }
      prevMeaningful = ch
      continue
    }

    if (ch >= CHAR_0 && ch <= CHAR_9) {
      i += 1
      while (i < length) {
        const c = source.charCodeAt(i)
        if (
          (c >= CHAR_0 && c <= CHAR_9) ||
          c === CHAR_DOT ||
          (c >= CHAR_a && c <= CHAR_z) ||
          (c >= CHAR_A && c <= CHAR_Z) ||
          c === CHAR_UNDERSCORE
        ) {
          i += 1
          continue
        }
        break
      }
      prevMeaningful = ch
      continue
    }

    prevMeaningful = ch
    i += 1
  }

  return sawCjs ? 'cjs' : 'none'
}

export function detectSourceType(
  source: string,
  hint?: DetectSourceTypeHint | undefined,
): SourceTypeKind {
  if (hint?.extension) {
    const ext = hint.extension.toLowerCase()
    if (CJS_EXTENSIONS.has(ext)) {
      return 'cjs'
    }
    if (ESM_EXTENSIONS.has(ext)) {
      return 'esm'
    }
  }
  if (hint?.packageType === 'module') {
    return 'esm'
  }
  if (hint?.packageType === 'commonjs') {
    return 'cjs'
  }
  if (!source) {
    return 'unknown'
  }
  // Tier-1 fast reject (see FAST_REJECT_RE docs).
  if (!FAST_REJECT_RE.test(source)) {
    return 'unknown'
  }
  const marker = scanTopLevelMarker(source)
  if (marker === 'esm') {
    return 'esm'
  }
  if (marker === 'cjs') {
    return 'cjs'
  }
  return 'unknown'
}
