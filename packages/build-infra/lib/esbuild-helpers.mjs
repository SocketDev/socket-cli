/**
 * Shared esbuild configuration helpers.
 */

/**
 * Banner code to inject import.meta.url polyfill for CommonJS bundles.
 *
 * Usage:
 * ```javascript
 * import { IMPORT_META_URL_BANNER } from 'build-infra/lib/esbuild-helpers'
 *
 * export default {
 *   // ... other config
 *   banner: IMPORT_META_URL_BANNER,
 *   define: {
 *     'import.meta.url': '__importMetaUrl',
 *   },
 * }
 * ```
 *
 * This injects a simple const statement at the top of the bundle that converts
 * __filename to a proper file:// URL using Node.js pathToFileURL().
 * Handles all edge cases (spaces, special chars, proper URL encoding, Windows paths).
 */
export const IMPORT_META_URL_BANNER = {
  js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
}
