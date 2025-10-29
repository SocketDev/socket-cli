/**
 * @fileoverview Shared esbuild plugin for Unicode property escape transformations.
 *
 * This plugin applies Unicode property escape transformations to esbuild output
 * for --with-intl=none compatibility. Used by both CLI and bootstrap builds.
 *
 * @example
 * import { unicodeTransformPlugin } from '@socketsecurity/build-infra/lib/esbuild-plugin-unicode-transform'
 *
 * export default {
 *   plugins: [unicodeTransformPlugin()],
 * }
 */

import { transformUnicodePropertyEscapes } from './unicode-property-escape-transform.mjs'

/**
 * Create esbuild plugin for Unicode property escape transformations.
 *
 * @returns {import('esbuild').Plugin} esbuild plugin
 */
export function unicodeTransformPlugin() {
  return {
    name: 'unicode-transform',
    setup(build) {
      build.onEnd((result) => {
        const outputs = result.outputFiles
        if (!outputs || outputs.length === 0) {
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
