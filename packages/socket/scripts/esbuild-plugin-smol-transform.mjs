/**
 * esbuild plugin to transform node:* requires to internal/* requires.
 *
 * This makes the bootstrap compatible with Node.js internal bootstrap context
 * for smol builds.
 */

/**
 * Create smol transformation plugin.
 * @returns {import('esbuild').Plugin}
 */
export function smolTransformPlugin() {
  return {
    name: 'smol-transform',
    setup(build) {
      build.onEnd((result) => {
        // Get the output files.
        const outputs = result.outputFiles
        if (!outputs || outputs.length === 0) {
          return
        }

        // Transform each output file.
        for (const output of outputs) {
          let content = output.text

          // Map of node: module names to their internal equivalents.
          const nodeToInternal = {
            'node:child_process': 'internal/child_process',
            'node:fs': 'internal/fs/promises',
            'node:os': 'internal/os',
            'node:path': 'internal/path',
            'node:zlib': 'internal/zlib',
          }

          // Replace require("node:X") with require("internal/X").
          for (const [nodeModule, internalModule] of Object.entries(nodeToInternal)) {
            content = content.replace(
              new RegExp(`require\\(["']${nodeModule.replace(':', '\\:')}["']\\)`, 'g'),
              `require("${internalModule}")`,
            )
          }

          // Update the output content.
          output.contents = Buffer.from(content, 'utf8')
        }
      })
    },
  }
}
