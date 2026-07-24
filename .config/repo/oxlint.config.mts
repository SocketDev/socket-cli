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
    // no-unnecessary-type-conversion, restrict-template-expressions,
    // no-floating-promises and unbound-method are DONE (entries deleted).
    // One rule remains — no-unsafe-type-assertion, now NARROWED to the
    // residue globs below (527 findings, ~63% in *.test.mts vitest mocks);
    // everything else enforces it. Clean a glob's findings, delete its entry.
    // CAUTION for no-unnecessary-type-conversion-style autofixes: coercions
    // at the meow flag boundary can look redundant because number-typed flags
    // used to lie — garbage input arrives as the raw string (see
    // ValueOfFlagType in packages/cli/src/meow.mts).
    overrides: [
      {
        files: [
          // Test tree: vitest mock casts (the bulk of the residue).
          '**/packages/cli/test/**',
          // Command subsystems still carrying narrowing debt.
          '**/packages/cli/src/commands/fix/**',
          '**/packages/cli/src/commands/manifest/**',
          '**/packages/cli/src/commands/mcp/**',
          '**/packages/cli/src/commands/optimize/**',
          '**/packages/cli/src/commands/package/**',
          '**/packages/cli/src/commands/scan/**',
          // src-root singles.
          '**/packages/cli/src/cli-entry.mts',
          '**/packages/cli/src/constants/agents.mts',
          '**/packages/cli/src/env/checksum-utils.mts',
          '**/packages/cli/src/flags.mts',
          '**/packages/cli/src/instrument-with-sentry.mts',
          '**/packages/cli/src/meow.mts',
          // util subsystems still carrying narrowing debt.
          '**/packages/cli/src/util/basics/**',
          '**/packages/cli/src/util/cli/**',
          '**/packages/cli/src/util/command/**',
          '**/packages/cli/src/util/config.mts',
          '**/packages/cli/src/util/cve-to-ghsa.mts',
          '**/packages/cli/src/util/dlx/**',
          '**/packages/cli/src/util/dry-run/**',
          '**/packages/cli/src/util/ecosystem/**',
          '**/packages/cli/src/util/error/**',
          '**/packages/cli/src/util/fs/**',
          '**/packages/cli/src/util/sea/**',
          '**/packages/cli/src/util/semver.mts',
          '**/packages/cli/src/util/socket-yaml.mts',
          '**/packages/cli/src/util/socket/**',
          '**/packages/cli/src/util/spawn/**',
          '**/packages/cli/src/util/telemetry/**',
          '**/packages/cli/src/util/terminal/**',
          // Sibling packages + repo scripts.
          '**/packages/build-infra/**',
          '**/packages/cli/.config/**',
          '**/packages/cli/scripts/**',
          '**/packages/package-builder/**',
          '**/scripts/babel/**',
          '**/scripts/repo/**',
        ],
        rules: {
          'typescript/no-unsafe-type-assertion': 'off',
        },
      },
    ],
  }),
)
