/**
 * Inject __dirname and __filename for CommonJS builds.
 */

// These will be replaced by esbuild at build time.
// biome-ignore lint/correctness/noInvalidUseBeforeDeclaration: esbuild replaces these at build time
export const __dirname = __dirname
// biome-ignore lint/correctness/noInvalidUseBeforeDeclaration: esbuild replaces these at build time
export const __filename = __filename
