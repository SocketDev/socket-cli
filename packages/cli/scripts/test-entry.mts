/* oxlint-disable socket/no-status-emoji -- dev script output; emoji prefixes provide at-a-glance build/test status. */

/**
 * Simple test entry point for SEA bundling test.
 * Just outputs version to verify the binary works.
 */

logger.log('Socket CLI SEA Test with Bundled External Tools')
logger.log('Version: test-v1.0.0')
logger.log(`Platform: ${process.platform}-${process.arch}`)

// Check if running in SEA.
if (process.argv[1] === process.execPath) {
  // Running as SEA, check VFS assets.
  import('node:sea')
    .then(({ getAsset }) => {
      logger.log('\nChecking VFS assets:')

      const tools = ['trivy', 'trufflehog', 'opengrep']
      for (const tool of tools) {
        try {
          const assetBuffer = getAsset(`external-tools/${tool}`)
          const sizeMB = (assetBuffer.byteLength / 1024 / 1024).toFixed(2)
          logger.log(`  ✓ ${tool}: ${sizeMB} MB`)
        } catch (_e) {
          logger.log(`  ✗ ${tool}: Not found`)
        }
      }
    })
    .catch(e => {
      logger.log(`\nFailed to check VFS assets: ${e.message}`)
    })
} else {
  logger.log('\nNot running in SEA mode (running as script)')
}
