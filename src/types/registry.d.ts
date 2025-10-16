/**
 * @fileoverview Type declarations for @socketsecurity/registry when using local builds.
 * These declarations suppress module resolution errors during development.
 * At runtime, the Node.js loader resolves these imports correctly.
 */

// Declare the registry module and all its subpaths as valid modules
declare module '@socketsecurity/registry/constants/*'
declare module '@socketsecurity/registry/lib/*'
