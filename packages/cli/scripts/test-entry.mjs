/**
 * Simple test entry point for SEA bundling test.
 * Just outputs version to verify the binary works.
 */

console.log('Socket CLI SEA Test with Bundled Security Tools')
console.log('Version: test-v1.0.0')
console.log(`Platform: ${process.platform}-${process.arch}`)

// Check if running in SEA.
if (process.argv[1] === process.execPath) {
  // Running as SEA, check VFS assets.
  import('node:sea')
    .then(({ getAsset }) => {
      console.log('\nChecking VFS assets:')

      const tools = ['trivy', 'trufflehog', 'opengrep']
      for (const tool of tools) {
        try {
          const assetBuffer = getAsset(`security-tools/${tool}`)
          const sizeMB = (assetBuffer.byteLength / 1024 / 1024).toFixed(2)
          console.log(`  ✓ ${tool}: ${sizeMB} MB`)
        } catch (_e) {
          console.log(`  ✗ ${tool}: Not found`)
        }
      }
    })
    .catch(e => {
      console.log(`\nFailed to check VFS assets: ${e.message}`)
    })
} else {
  console.log('\nNot running in SEA mode (running as script)')
}
