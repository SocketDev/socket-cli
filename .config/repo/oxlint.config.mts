/**
 * @file Repo overlay over the fleet oxlint config. The type-aware rules the
 *   fleet lint runner's whole-tree gate enabled (`--type-aware` tsgolint lane,
 *   bundle v1.0.10) surfaced ~1,100 pre-existing findings across
 *   packages/cli — dominated by `as`-cast-heavy vitest mocks in test files
 *   and long-standing src narrowing debt. Staged OFF here per the fleet
 *   lint-modernization campaign's member recipe (same shape as
 *   socket-registry's overlay): burn the debt down rule-by-rule, deleting
 *   each entry as its findings reach zero. This is a REPO-SPECIFIC concern —
 *   it lives in `.config/repo/` (auto-discovered by the fleet lint runner,
 *   which prefers a repo overlay over the fleet canonical), NOT in the
 *   cascaded fleet config.
 */

import { defineConfig } from 'oxlint'

import { config } from '../fleet/oxlint.config.mts'

// oxlint-disable-next-line socket/no-default-export -- oxlint loads the config from this module's default export.
export default defineConfig(
  config({
    // Burn-down state (2026-07-24): await-thenable, no-base-to-string,
    // no-unnecessary-type-conversion and restrict-template-expressions are
    // DONE (entries deleted). 792 findings remain across the three rules
    // below — no-floating-promises (85) next, then the test-mock-heavy giants
    // unbound-method (135) and no-unsafe-type-assertion (572, ~57% in
    // *.test.mts vitest mocks). CAUTION for no-unnecessary-type-conversion-
    // style autofixes: coercions at the meow flag boundary can look redundant
    // because number-typed flags used to lie — garbage input arrives as the
    // raw string (see ValueOfFlagType in packages/cli/src/meow.mts).
    rules: {
      'typescript/no-floating-promises': 'off',
      'typescript/no-unsafe-type-assertion': 'off',
      'typescript/unbound-method': 'off',
    },
  }),
)
