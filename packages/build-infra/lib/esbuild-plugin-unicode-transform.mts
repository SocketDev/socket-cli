/**
 * @fileoverview Shared esbuild plugin for Unicode property escape transformations.
 *
 * This plugin applies Unicode property escape transformations to esbuild output
 * for --with-intl=none compatibility. Used by both CLI and bootstrap builds.
 *
 * @example
 * import { unicodeTransformPlugin } from 'build-infra/lib/esbuild-plugin-unicode-transform'
 *
 * export default {
 *   plugins: [unicodeTransformPlugin()],
 * }
 */

import type { PluginBuild, BuildResult } from 'esbuild'

import { transformUnicodePropertyEscapes } from './unicode-property-escape-transform.mts'

/**
 * Create esbuild plugin for Unicode property escape transformations.
 *
 * @returns {import('esbuild').Plugin} esbuild plugin
 */
export function unicodeTransformPlugin() {
  return {
    name: 'unicode-transform',
    setup(build: PluginBuild) {
      build.onEnd((result: BuildResult) => {
        const outputs = result.outputFiles
        if (!outputs || !outputs.length) {
          return
        }

        for (const output of outputs) {
          let content = output.text

          // Transform Unicode property escapes for --with-intl=none compatibility.
          content = transformUnicodePropertyEscapes(content)

          // Update the output content.
          output.contents = Buffer.from(content, 'utf8')
        }
      })
    },
  }
}
