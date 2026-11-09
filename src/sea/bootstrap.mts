/** Load the complete root Socket distribution relative to the SEA VFS main. */
// Node places the VFS main at its mount root. Expose that stable root before
// loading Socket so native payload adapters can read embedded files by path.
;(
  globalThis as typeof globalThis & { __socketSeaVfsRoot?: string }
).__socketSeaVfsRoot = __dirname
require('./dist/cli.js')
