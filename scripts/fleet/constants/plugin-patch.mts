/**
 * @file Single source for the Claude Code plugin-cache patch filename grammar
 *   `<plugin>-<version>-<slug>.patch`. Consumed by BOTH the installer
 *   (`scripts/fleet/install-claude-plugins.mts`, which maps plugin + version to
 *   the cache dir `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`)
 *   and the edit-time guard (`.claude/hooks/fleet/plugin-patch-format-guard/`,
 *   which validates the shape + cross-checks the filename version against the
 *   `# @plugin-version:` header). Both parse via `parsePatchFileName`, so the
 *   grammar is defined once and CANNOT drift between the two — the reason this
 *   lives in a shared module rather than a copied regex with a "keep in sync"
 *   comment (DRY beats a drift-check).
 */

// <plugin>-<version>-<slug>.patch — version is dotted (e.g. 1.0.1); slug is
// freeform lowercase-kebab. Capture plugin + version to locate the cache dir;
// the `\d+\.\d+\.\d+` version anchor disambiguates a hyphenated plugin name
// (`socket-foo`) from the version that follows it.
export const PATCH_FILE_NAME =
  /^([a-z0-9-]+)-(\d+\.\d+\.\d+)-[a-z0-9-]+\.patch$/

/**
 * Parse a plugin-patch filename of the form `<plugin>-<version>-<slug>.patch`
 * into its `{ plugin, version }`. Returns `undefined` for any name that doesn't
 * match the shape (dotted semver version sandwiched between a plugin name and a
 * freeform slug).
 */
export function parsePatchFileName(
  fileName: string,
): { plugin: string; version: string } | undefined {
  const m = PATCH_FILE_NAME.exec(fileName)
  if (!m) {
    return undefined
  }
  return { plugin: m[1]!, version: m[2]! }
}
