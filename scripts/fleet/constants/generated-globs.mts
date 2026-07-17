/*
 * @file Single source of truth for GENERATED / VENDORED paths — trees that are
 *   build output or someone else's source, never hand-written repo source.
 *
 *   One list, consumed by every ignore surface so they can't drift apart:
 *     - lint  — `.config/fleet/oxlint.config.mts` spreads GENERATED_GLOBS into
 *               ignorePatterns.
 *     - test  — `.config/repo/vitest.config.mts` spreads them into `exclude`
 *               (discovery), and `scripts/fleet/test.mts` filters the staged
 *               set through `isGeneratedPath()` before `vitest related` so a
 *               tracked multi-MB generated blob (e.g. a base64-embedded wasm)
 *               can't hang the pre-commit run by being transformed as a graph
 *               input.
 *     - format / git — `.config/fleet/.prettierignore` and `.gitignore` are
 *               static formats; `scripts/fleet/check/generated-globs-are-consistent.mts`
 *               asserts they cover every entry here rather than re-listing it.
 *
 *   Repo-specific generated dirs (e.g. a parser's `pkg-node/`) are added via the
 *   existing per-repo overlays (oxlint `opts.ignorePatterns`, the repo
 *   `.gitignore`), not here — this list is the fleet-general floor.
 */

/**
 * `**​/`-anchored globs for the config consumers (oxlint ignorePatterns, vitest
 * exclude). Anchored at any depth so they match in a monorepo's sub-packages.
 */
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export const GENERATED_GLOBS: readonly string[] = [
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/external/**',
  '**/out/**',
  '**/test/fixtures/**',
  '**/third_party/**',
  '**/upstream/**',
  '**/vendor/**',
]

/**
 * Path segments that mark a generated/vendored tree. Used by the segment-wise
 * matcher below (dependency-free — no glob library on the hot pre-commit path).
 */
const GENERATED_SEGMENTS: ReadonlySet<string> = new Set([
  'build',
  'coverage',
  'dist',
  'external',
  'out',
  'third_party',
  'upstream',
  'vendor',
])

/**
 * True when `filePath` lives inside a generated/vendored tree. Normalizes
 * backslashes first (Windows-safe), then checks path segments — so
 * `a/dist/b.js`, `dist/b.js`, and `pkg/upstream/x` all match, but a source file
 * merely NAMED `dist.ts` does not. Also matches the `test/fixtures/` pair and a
 * couple of always-generated file kinds.
 */
export function isGeneratedPath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (
    normalized.includes('/test/fixtures/') ||
    normalized.startsWith('test/fixtures/')
  ) {
    return true
  }
  if (normalized.endsWith('.wasm')) {
    return true
  }
  const segments = normalized.split('/')
  for (let i = 0, { length } = segments; i < length; i += 1) {
    if (GENERATED_SEGMENTS.has(segments[i]!)) {
      return true
    }
  }
  return false
}
