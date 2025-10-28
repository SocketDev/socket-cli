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

          // Map core module requires to their internal bootstrap equivalents.
          // Format: [pattern, replacement]
          // Handles both 'node:x' and plain 'x' variants.
          const requireMappings = new Map([
            ['child_process', 'internal/child_process'],
            ['fs', 'fs'], // fs is available at top level in bootstrap context.
            ['os', 'os'], // os is available at top level in bootstrap context.
            ['path', 'path'], // path is available at top level in bootstrap context.
            ['zlib', 'zlib'], // zlib is available at top level in bootstrap context.
          ])

          // Replace require("node:X") and require("X") with correct bootstrap path.
          for (const [moduleName, bootstrapPath] of requireMappings) {
            // Handle node:x variant.
            content = content.replace(
              new RegExp(`require\\(["']node:${moduleName}["']\\)`, 'g'),
              `require("${bootstrapPath}")`,
            )
            // Handle plain x variant (if different from bootstrap path).
            if (moduleName !== bootstrapPath) {
              content = content.replace(
                new RegExp(`require\\(["']${moduleName}["']\\)`, 'g'),
                `require("${bootstrapPath}")`,
              )
            }
          }

          // Update the output content.
          output.contents = Buffer.from(content, 'utf8')
        }
      })
    },
  }
}
