
// esbuild inject helper for import.meta compatibility
if (typeof __filename === 'undefined') {
  global.__filename = require('url').fileURLToPath(import.meta.url);
}
if (typeof __dirname === 'undefined') {
  global.__dirname = require('path').dirname(__filename);
}
