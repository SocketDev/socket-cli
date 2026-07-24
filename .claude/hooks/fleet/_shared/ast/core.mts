/**
 * @file AST parse primitives for fleet hooks — the lazy
 *   `@ultrathink/acorn.wasm` loader plus the narrow `tryParse` / `walkSimple`
 *   surface and the shared `AcornNode` / `ParseOptions` / `CallSite` types the
 *   sibling modules (`comments`, `calls`, `literals`) build on. Import the
 *   whole helper set from the specific `../ast/*.mts` module. No vendored wasm:
 *   the parser comes from the npm `@ultrathink/acorn.wasm` catalog dep,
 *   `require()`d LAZILY (first use, not module eval) so a V8 startup-snapshot
 *   build pass — which evaluates every module with no `WebAssembly` global —
 *   stays safe; instantiation happens at runtime.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export interface AcornNode {
  type: string
  start: number
  end: number
  // Index signature lets hooks read whatever the node type exposes.
  [key: string]: unknown
}

export interface ParseOptions {
  /**
   * ECMAScript version. Default 2026 — matches the fleet's Node 26 floor.
   */
  ecmaVersion?: number | undefined
  /**
   * `module` (default) or `script`. Hooks should leave this alone unless
   * inspecting CJS source where top-level `await` would surprise them.
   */
  sourceType?: 'module' | 'script' | undefined
  /**
   * Allow TypeScript syntax (type annotations, generics, satisfies, etc.).
   * Default `true` because every fleet hook file is `.ts` / `.mts` / `.cts`.
   * Set to `false` only when you genuinely need strict JS-only parsing.
   */
  typescript?: boolean | undefined
  /**
   * Allow JSX. Default `false` — hooks rarely parse JSX. Pure-JSX detectors set
   * this `true`.
   */
  jsx?: boolean | undefined
  /**
   * Collect comments. Default `false` — most hooks don't inspect comments and
   * pay zero scanner cost when this is off.
   *
   * When `true`, `walkComments(source, { comments: true })` returns the
   * populated `CommentSite[]`. Modeled on oxc-project's collection-on-demand
   * model.
   */
  comments?: boolean | undefined
}

export interface CallSite {
  /**
   * 1-based line number of the call.
   */
  line: number
  /**
   * 0-based column of the call.
   */
  column: number
  /**
   * Source snippet of the line containing the call (best-effort).
   */
  text: string
}

export const DEFAULT_PARSE_OPTIONS: Required<ParseOptions> = {
  comments: false,
  ecmaVersion: 2026,
  jsx: false,
  sourceType: 'module',
  typescript: true,
}

// The narrow slice of the wasm parser API the fleet helpers use: raw `parse`
// (AST, plus a `comments` array when `collectComments` is set) + the `simple`
// visitor walk. The full package exposes more (walk / findNode* / aqs_match);
// the fleet surface stays intentionally small.
interface AcornWasm {
  parse: (source: string, options: ParseOptions) => AcornNode
  simple: (
    source: string,
    visitors: Record<string, (node: unknown) => void>,
    options: ParseOptions,
  ) => void
}

let cachedWasm: AcornWasm | undefined

// Lazy so the WASM is never touched during a snapshot build pass (module eval);
// runtime-only, where `WebAssembly` is present.
function acornWasm(): AcornWasm {
  if (cachedWasm === undefined) {
    cachedWasm = require('@ultrathink/acorn.wasm') as AcornWasm
  }
  return cachedWasm
}

/**
 * Raw parse against the wasm parser. `comments`/`calls`/`literals` go through
 * the tolerant `tryParse` / `walkSimple`; `walkComments` uses this directly to
 * pass the parser-level `collectComments` option.
 */
export function parseWasm(source: string, config: ParseOptions): AcornNode {
  return acornWasm().parse(source, config)
}

/**
 * Parse a JS/TS source string into an acorn AST. Returns `undefined` on parse
 * failure — hooks see incomplete fragments (Edit's `new_string` is a snippet,
 * not a whole file) and shouldn't crash on syntax error.
 */
export function tryParse(
  source: string,
  options?: ParseOptions | undefined,
): AcornNode | undefined {
  try {
    return parseWasm(source, {
      __proto__: null,
      ...DEFAULT_PARSE_OPTIONS,
      ...options,
    } as unknown as ParseOptions)
  } catch {
    return undefined
  }
}

/**
 * Visit every node in `source` whose type matches a key in `visitors`. Errors
 * during parse are silently swallowed — see `tryParse` for the
 * fragment-tolerance rationale.
 */
export function walkSimple(
  source: string,
  visitors: Record<string, (node: AcornNode) => void>,
  options?: ParseOptions | undefined,
): void {
  try {
    acornWasm().simple(
      source,
      visitors as unknown as Record<string, (node: unknown) => void>,
      {
        __proto__: null,
        ...DEFAULT_PARSE_OPTIONS,
        ...options,
      } as unknown as ParseOptions,
    )
  } catch {
    // Parse failure — caller's hook should fail open.
  }
}

/**
 * Convert a byte offset into 1-based line + 0-based column. The wasm parser
 * doesn't emit `loc` data even with `locations: true`, but every node carries
 * `start` / `end` byte offsets — this function bridges the gap.
 *
 * Counts `\n`, `\r`, AND `\r\n` (treated as one newline) so the line number
 * agrees with `splitLines(source)[line - 1]` regardless of the source's newline
 * convention.
 */
export function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset && i < source.length; i += 1) {
    const code = source.charCodeAt(i)
    if (code === 13 /* \r */) {
      line += 1
      // `\r\n` counts as one newline — skip the `\n` if present.
      if (source.charCodeAt(i + 1) === 10) {
        i += 1
      }
      lineStart = i + 1
    } else if (code === 10 /* \n */) {
      line += 1
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart }
}

/**
 * Split source text into lines while normalizing the three legal newline
 * conventions: `\r\n` (Windows), `\n` (Unix), `\r` (legacy Mac). Hooks that
 * inspect source line-by-line should ALWAYS go through this helper — a raw
 * `source.split('\n')` over a CRLF file leaves a trailing `\r` on every line,
 * breaking line-snippet display and regex anchors.
 *
 * Returns one entry per logical line. A trailing newline produces an empty
 * trailing entry, matching `split('\n')` semantics.
 */
export function splitLines(source: string): string[] {
  // Single regex pass: collapse `\r\n` and bare `\r` to `\n`, then split.
  // socket-lint: allow uncommented-regex -- newline normalization, described above.
  return source.replace(/\r\n?/g, '\n').split('\n')
}
