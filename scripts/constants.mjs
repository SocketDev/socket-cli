/** @fileoverview Legacy build constants export (re-exports from scripts/constants/). */

// Re-export everything from the new modular structure.
export * from './constants/index.mjs'

// Provide default export for backward compatibility.
import * as allConstants from './constants/index.mjs'
export default allConstants
