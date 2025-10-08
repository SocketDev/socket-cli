
// esbuild inject helper for import.meta compatibility
if (typeof __filename === 'undefined') {
  global.__filename = require('node:url').fileURLToPath(import.meta.url);
}
if (typeof __dirname === 'undefined') {
  global.__dirname = require('node:path').dirname(__filename);
}
