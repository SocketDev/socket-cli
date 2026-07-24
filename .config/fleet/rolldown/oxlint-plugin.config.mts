/**
 * @file Rolldown build for the fleet oxlint plugin bundle. Bundles the plugin
 *   entry (`.config/fleet/oxlint-plugin/index.mts`) + every `socket/*` rule it
 *   imports into a single ESM `.config/fleet/oxlint-plugin.mjs`, so a member
 *   receives ONE loadable plugin artifact instead of the ~100 rule source dirs
 *   (each currently a workspace package). The rule SOURCE lives once in the
 *   wheelhouse (edited + tested there); members run the bundle via
 *   `jsPlugins: ["./oxlint-plugin.mjs"]`. Modeled on hook-bundle.config.mts.
 *   ESM output (not CJS): the plugin entry is native ESM (`export default`) and
 *   oxlint's jsPlugins loader resolves an ESM module's default export. Not
 *   minified (fleet hard rule — a lint plugin must stay auditable), no source
 *   maps. node: built-ins stay external. Input + output paths come from
 *   scripts/fleet/paths.mts (1 path, 1 reference — same as the hook config).
 */

import type { RolldownOptions } from 'rolldown'

import {
  OXLINT_PLUGIN_BUNDLE_PATH,
  OXLINT_PLUGIN_SOURCE_ENTRY,
} from '../../../scripts/fleet/paths.mts'

const config: RolldownOptions = {
  external: [/^node:/],
  input: OXLINT_PLUGIN_SOURCE_ENTRY,
  output: {
    codeSplitting: false,
    file: OXLINT_PLUGIN_BUNDLE_PATH,
    format: 'esm',
    // Fleet hard rule: never minify a lint plugin — it must stay readable so a
    // reviewer can audit what runs. Enforced by socket/no-minified-bundler-output.
    minify: false,
    sourcemap: false,
  },
  platform: 'node',
}

export default config
