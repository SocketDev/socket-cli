/**
 * @fileoverview Synchronous yoga-layout wrapper that avoids top-level await.
 *
 * yoga-layout 3.2.1 uses top-level await which doesn't work in CommonJS builds.
 * This wrapper loads the WASM binary synchronously following the pattern from:
 * https://github.com/facebook/yoga/blob/v2.0.1/javascript/src/entrypoint/wasm-sync-node.ts
 */

// @ts-ignore - untyped from Emscripten
// eslint-disable-next-line n/no-missing-import, import-x/no-unresolved
import loadYogaImpl from 'yoga-layout/dist/binaries/yoga-wasm-base64-esm.js'
// eslint-disable-next-line n/no-missing-import, import-x/no-unresolved
import wrapAssembly from 'yoga-layout/dist/src/wrapAssembly.js'

// Load synchronously by calling the function directly (no await)
const Yoga = wrapAssembly(loadYogaImpl())

export default Yoga
// eslint-disable-next-line n/no-missing-import, import-x/no-unresolved
export * from 'yoga-layout/dist/src/generated/YGEnums.js'
