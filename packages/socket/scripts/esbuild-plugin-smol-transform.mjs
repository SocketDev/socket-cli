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
          // Based on Module.builtinModules from Node.js v24.10.0.
          // Format: [moduleName, bootstrapPath]
          // Handles both 'node:x' and plain 'x' variants (except prefix-only modules).
          const requireMappings = new Map([
            // Core modules with internal equivalents.
            ['child_process', 'internal/child_process'],
            ['fs', 'fs'],
            ['fs/promises', 'internal/fs/promises'],

            // Stream internals.
            ['stream', 'stream'],
            ['stream/promises', 'internal/streams/promises'],
            ['stream/web', 'internal/webstreams/readablestream'],

            // Path variants.
            ['path', 'path'],
            ['path/posix', 'path'],
            ['path/win32', 'path'],

            // Core modules available at top level.
            ['assert', 'assert'],
            ['assert/strict', 'internal/assert/strict'],
            ['async_hooks', 'async_hooks'],
            ['buffer', 'buffer'],
            ['cluster', 'cluster'],
            ['console', 'console'],
            ['constants', 'constants'],
            ['crypto', 'crypto'],
            ['dgram', 'dgram'],
            ['diagnostics_channel', 'diagnostics_channel'],
            ['dns', 'dns'],
            ['dns/promises', 'dns/promises'],
            ['domain', 'domain'],
            ['events', 'events'],
            ['http', 'http'],
            ['http2', 'http2'],
            ['https', 'https'],
            ['inspector', 'inspector'],
            ['inspector/promises', 'inspector/promises'],
            ['module', 'module'],
            ['net', 'net'],
            ['os', 'os'],
            ['perf_hooks', 'perf_hooks'],
            ['process', 'process'],
            ['punycode', 'punycode'],
            ['querystring', 'querystring'],
            ['readline', 'readline'],
            ['readline/promises', 'readline/promises'],
            ['repl', 'repl'],
            ['string_decoder', 'string_decoder'],
            ['sys', 'sys'],
            ['timers', 'timers'],
            ['timers/promises', 'timers/promises'],
            ['tls', 'tls'],
            ['trace_events', 'trace_events'],
            ['tty', 'tty'],
            ['url', 'url'],
            ['util', 'util'],
            ['util/types', 'internal/util/types'],
            ['v8', 'v8'],
            ['vm', 'vm'],
            ['wasi', 'wasi'],
            ['worker_threads', 'worker_threads'],
            ['zlib', 'zlib'],
          ])

          // Prefix-only modules that have no unprefixed form.
          // These ONLY support node:* syntax.
          const prefixOnlyModules = new Set([
            'node:sea',
            'node:sqlite',
            'node:test',
            'node:test/reporters',
          ])

          // Replace require("node:X") and require("X") with correct bootstrap path.
          for (const [moduleName, bootstrapPath] of requireMappings) {
            // Handle node:x variant.
            content = content.replace(
              new RegExp(`require\\(["']node:${moduleName}["']\\)`, 'g'),
              `require("${bootstrapPath}")`,
            )
            // Handle plain x variant (if different from bootstrap path).
            // Skip if this is a prefix-only module.
            if (moduleName !== bootstrapPath && !prefixOnlyModules.has(`node:${moduleName}`)) {
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
