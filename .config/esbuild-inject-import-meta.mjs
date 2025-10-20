/**
 * Polyfill for import.meta.url in CommonJS bundles.
 * This file is injected by esbuild's inject option.
 */

// Convert __filename to file:// URL format.
export const __importMetaUrl =
  typeof __filename !== 'undefined'
    ? `file://${__filename.replace(/\\/g, '/')}`
    : 'file:///unknown'
