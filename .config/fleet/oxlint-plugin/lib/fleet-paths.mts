/**
 * @file Shared path-suffix constants for fleet-canonical files that any plugin
 *   rule may need to recognize. Centralizing these out of individual rule files
 *   lets multiple rules share the same opt-in / opt-out list without
 *   duplicating the path string + its rationale comment. Examples of
 *   consumers:
 *
 *   - `no-file-scope-oxlint-disable` exempts `scripts/paths.mts` (deliberate
 *     flow-ordered exports, see PATHS_FILE constant below).
 *   - `socket/prefer-cached-for-loop` and `socket/no-cached-for-on-iterable`
 *     share `lib/iterable-kind.mts` for the binding-kind heuristic — sibling
 *     pattern. When a new rule needs to recognize one of these path patterns,
 *     add the import here and use the constant, not a re-spelled literal.
 */

/**
 * The fleet's "1 path, 1 reference" source-of-truth file. Each fleet repo has
 * one. Its exports are ordered by path-resolution flow (REPO_ROOT → primary
 * roots → build paths → helpers) — deliberately not alphabetical, and the order
 * is load-bearing for code review. Anything keyed on per-file behavior that
 * recognizes `paths.mts` should match by suffix.
 */
export const PATHS_FILE = 'scripts/fleet/paths.mts'

/**
 * Plugin-internal rule + test directories. Rule files often contain the banned
 * shape they ban as lookup-table data (e.g. `no-status-emoji.mts` literally
 * contains the emoji it bans). Same for the matching test files, which
 * intentionally exercise the banned shape.
 */
export const PLUGIN_RULE_DIR = '.config/fleet/oxlint-plugin/rules/'
export const PLUGIN_TEST_DIR = '.config/fleet/oxlint-plugin/test/'

/**
 * True when `filename` is inside the plugin's own rules / test directory.
 */
export function isPluginInternalPath(filename: string): boolean {
  return (
    filename.includes(PLUGIN_RULE_DIR) || filename.includes(PLUGIN_TEST_DIR)
  )
}

/**
 * True when `filename` points at the fleet-canonical `scripts/paths.mts`.
 */
export function isPathsModule(filename: string): boolean {
  return filename.endsWith(PATHS_FILE)
}

/**
 * Context-aware wrapper around `isPluginInternalPath`: true when the file
 * currently being linted is one of the plugin's own rule / test files. Rules
 * call this to exempt their own rule-data + fixtures (where the patterns they
 * detect appear as literal strings, not real violations). Takes the rule
 * `context` so call sites read as `isPluginSelfFile(context)`.
 */
export function isPluginSelfFile(context: {
  filename?: string | undefined
  getFilename?: (() => string) | undefined
}): boolean {
  const filename = context.filename ?? context.getFilename?.() ?? ''
  return isPluginInternalPath(filename)
}
