/**
 * @file Fleet oxlint config as a composable factory. `oxlintrc.json` stays the
 *   canonical data (rules / overrides / ignorePatterns — managed by
 *   `sync-oxlint-rules.mts`, cascaded byte-identical). This module wraps that
 *   JSON in a `config(opts)` factory so a downstream repo can `import` it, call
 *   it, and augment the result IN JS — adding its own `jsPlugins` and `rules`.
 *   Why a factory instead of oxlint's `extends`: oxlint's `extends` does NOT
 *   merge `plugins` / `categories` / `ignorePatterns`, and it resolves
 *   `ignorePatterns` / `jsPlugins` / `overrides[].files` globs relative to the
 *   EXTENDING file's directory — so a `.config/repo/` overlay re-roots every
 *   fleet glob to the wrong base and silently drops the fleet's
 *   relax-overrides. A JS factory sidesteps all of that: the repo config
 *   imports `config()`, gets one fully-resolved object, and spreads its own
 *   additions on top. The merged config loads from the repo's
 *   `.config/repo/oxlint.config.mts`, so the fleet's repo-root-relative globs
 *   (`**∕scripts/**`, `**∕.config/**`, …) match from the working directory as
 *   written. The one resolution detail the factory MUST own: `jsPlugins` paths
 *   in the JSON are written relative to THIS file's directory
 *   (`./oxlint-plugin/...`). When a repo config imports this factory, oxlint
 *   would otherwise resolve those against the repo config's directory and fail
 *   to load. So the factory rewrites each relative `jsPlugins` entry to an
 *   absolute path anchored at `import.meta.url`. Repo-supplied `jsPlugins` are
 *   appended verbatim (they're relative to the repo config, which is where
 *   oxlint loads the final object). Usage (downstream
 *   `.config/repo/oxlint.config.mts`): import { config } from
 *   '../fleet/oxlint.config.mts' export default config({ jsPlugins:
 *   ['./oxlint-plugin/index.mts'], rules: { 'socket-repo/my-rule': 'error' },
 *   })
 */

import { fileURLToPath } from 'node:url'

import base from './oxlintrc.json' with { type: 'json' }

export interface OxlintConfigOptions {
  /**
   * Extra `jsPlugins` entries (repo-local oxlint plugins). Relative paths are
   * resolved by oxlint against the importing config's directory, so a repo
   * passing `./oxlint-plugin/index.mts` gets its own plugin. Merged AFTER the
   * fleet plugin, so both load.
   */
  jsPlugins?: readonly string[] | undefined
  /**
   * Extra rule activations merged over the fleet rules. Repo-specific rules
   * (e.g. a `socket-repo/*` rule) go here.
   */
  rules?: Record<string, unknown> | undefined
  /**
   * Extra `overrides` blocks appended after the fleet overrides. Globs are
   * matched relative to the working directory (repo root), same as the fleet
   * blocks.
   */
  overrides?: readonly unknown[] | undefined
  /**
   * Extra `ignorePatterns` appended to the fleet list.
   */
  ignorePatterns?: readonly string[] | undefined
}

const fleetConfigDir = fileURLToPath(new URL('.', import.meta.url))

/**
 * Build the fleet oxlint config object, optionally augmented for a repo.
 */
export function config(options?: OxlintConfigOptions): Record<string, unknown> {
  const opts = { __proto__: null, ...options } as OxlintConfigOptions
  const {
    jsPlugins: baseJsPlugins,
    overrides: baseOverrides,
    rules: baseRules,
    ignorePatterns: baseIgnorePatterns,
    ...rest
  } = base as Record<string, unknown>
  // `$schema` is JSON-editor metadata; oxlint ignores it on the object, so
  // it's harmless to leave on `rest`. (Destructuring it to a throwaway would
  // trip socket/no-underscore-identifier.)
  return {
    ...rest,
    jsPlugins: [
      ...((baseJsPlugins as string[] | undefined) ?? []).map(
        resolveFleetJsPlugin,
      ),
      ...(opts.jsPlugins ?? []),
    ],
    ignorePatterns: [
      ...((baseIgnorePatterns as string[] | undefined) ?? []),
      ...(opts.ignorePatterns ?? []),
    ],
    overrides: [
      ...((baseOverrides as unknown[] | undefined) ?? []),
      ...(opts.overrides ?? []),
    ],
    rules: {
      ...(baseRules as Record<string, unknown> | undefined),
      ...opts.rules,
    },
  }
}

/**
 * Rewrite a fleet `jsPlugins` entry to an absolute path. Relative entries
 * (`./oxlint-plugin/index.mts`) are anchored at this file's directory so they
 * resolve no matter which config imports the factory; non-relative entries
 * (bare specifiers) pass through unchanged.
 */
export function resolveFleetJsPlugin(entry: string): string {
  if (entry.startsWith('./')) {
    return `${fleetConfigDir}${entry.slice(2)}`
  }
  if (entry.startsWith('../')) {
    return fileURLToPath(new URL(entry, import.meta.url))
  }
  return entry
}

// oxlint-disable-next-line socket/no-default-export -- oxlint loads the config from this module's default export.
export default config()
