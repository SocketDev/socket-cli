/*
 * @file Canonical generic-name-token denylist + the "is this exported name a
 *   grep-noise magnet?" predicate. Single source of truth shared by the
 *   `socket/exported-name-has-domain-word` oxlint rule and the edit-time
 *   `generic-export-name-nudge` hook, so the two never drift.
 *
 *   Why it exists: coding agents navigate by grep, not a dependency graph, at
 *   ~10 tokens per line read. A generic single-token export like `create` is a
 *   grep-noise magnet — a real audit found `create` matched 1585 times across
 *   459 files, versus `createStripeClient` 43 times across 19. One-word names
 *   are ~61% unique; two-word ~88%; three-word ~96%. So an exported name that is
 *   a SINGLE generic token carries no domain signal and forces every future
 *   agent (and human) to read unrelated files to separate signal from noise.
 *   (modem.dev, "How coding agents read your code".)
 *
 *   Scope is deliberately conservative: flag ONLY a single-word export whose one
 *   word is in the denylist. Multi-word names carry a domain word by
 *   construction (`createStripeClient` → create+Stripe+Client) and are left
 *   alone; a genuine single domain word not on the denylist (`enrich`,
 *   `sanitize`) is left alone. Widening to all-generic multi-word names
 *   (`getData`, `handleItem`) is a later ratchet, not this pass.
 */

/**
 * Generic tokens that carry no domain signal. Lowercased; the predicate
 * lowercases the candidate before lookup. Verbs of pure mechanism plus the
 * classic filler nouns — the words that, standing alone as an export, tell a
 * reader (or a grepping agent) nothing about WHAT domain the symbol serves.
 */
export const GENERIC_NAME_TOKENS: ReadonlySet<string> = new Set([
  'add',
  'apply',
  'build',
  'calculate',
  'clear',
  'close',
  'compare',
  'compute',
  'connect',
  'convert',
  'create',
  'data',
  'delete',
  'diff',
  'emit',
  'exec',
  'execute',
  'fetch',
  'filter',
  'find',
  'format',
  'get',
  'handle',
  'helper',
  'init',
  'initialize',
  'item',
  'load',
  'make',
  'manager',
  'map',
  'merge',
  'obj',
  'open',
  'parse',
  'process',
  'read',
  'reduce',
  'remove',
  'render',
  'reset',
  'resolve',
  'result',
  'send',
  'set',
  'sort',
  'start',
  'stop',
  'temp',
  'thing',
  'tmp',
  'transform',
  'update',
  'util',
  'utils',
  'validate',
  'value',
  'write',
])

/**
 * Structural entry-point / contract names the fleet SANCTIONS — a reader (and a
 * grepping agent) recognizes these as the wiring, not domain logic, so they are
 * exempt even though they read as single generic tokens. `check` is the fleet
 * hook contract (the dispatcher calls the exported `check`); `main` is the CLI
 * entry (`isMainModule()` → `main`); `run` is the runner/skill-action idiom;
 * `handler` is the event-handler convention; the VS Code extension lifecycle
 * uses `activate`/`deactivate`; `setup`/`teardown`/`register`/`index` are
 * test/module wiring. Renaming any of these would break the contract that calls
 * them by name, so they are never flagged.
 */
export const SANCTIONED_CONVENTION_NAMES: ReadonlySet<string> = new Set([
  'activate',
  'check',
  'deactivate',
  'handler',
  'index',
  'main',
  'register',
  'run',
  'setup',
  'teardown',
])

/**
 * Split an identifier into its constituent words. Handles camelCase,
 * PascalCase, snake_case, SCREAMING_CASE, `$`/digit boundaries, and acronym
 * runs (`HTTPServer` → `HTTP`, `Server`; `parseURL` → `parse`, `URL`). Returns
 * the words verbatim (no case-folding — the caller folds for denylist lookup).
 */
export function splitNameWords(name: string): string[] {
  return (
    name
      // Boundary between a lowercase/digit and an uppercase: `parseUrl` → `parse Url`.
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // Boundary between an acronym run and a following word: `URLParser` → `URL Parser`.
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      // snake_case / SCREAMING_CASE / `$` / digit-group separators.
      .split(/[_$ ]|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/)
      .filter(Boolean)
  )
}

/**
 * True when `name` is a single-word export whose one word is a generic token —
 * the shape this pass flags. Multi-word names and single non-generic words
 * return false.
 */
export function isGenericExportName(name: string): boolean {
  const words = splitNameWords(name)
  if (words.length !== 1) {
    return false
  }
  const lower = words[0]!.toLowerCase()
  return (
    GENERIC_NAME_TOKENS.has(lower) && !SANCTIONED_CONVENTION_NAMES.has(lower)
  )
}
