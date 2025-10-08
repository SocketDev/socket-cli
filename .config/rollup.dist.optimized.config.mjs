/** @fileoverview Optimized Rollup configuration that splits React/Ink into a separate chunk */

import baseConfig from './rollup.dist.config.mjs'

export default {
  ...baseConfig,

  output: {
    ...baseConfig.output,
    // Enable code splitting for dynamic imports
    preserveModules: false,
    // Create separate chunks for better caching
    manualChunks: (id) => {
      // Put React and Ink in a separate chunk
      if (id.includes('node_modules/react') ||
          id.includes('node_modules/react-dom') ||
          id.includes('node_modules/ink') ||
          id.includes('node_modules/ink-table') ||
          id.includes('node_modules/yoga-layout') ||
          id.includes('node_modules/@pppp606/ink-chart')) {
        return 'vendor-react-ink'
      }

      // Put Socket SDK in its own chunk
      if (id.includes('@socketsecurity/sdk')) {
        return 'vendor-socket-sdk'
      }

      // Put other large dependencies in vendor chunk
      if (id.includes('node_modules') &&
          !id.includes('@socketsecurity/registry')) {
        return 'vendor'
      }
    },

    // Optimize chunk loading
    chunkFileNames: 'chunks/[name]-[hash].js',

    // Enable optimizations
    compact: true,
    generatedCode: {
      constBindings: true,
      objectShorthand: true,
    },
  },

  // Optimize tree-shaking
  treeshake: {
    ...baseConfig.treeshake,
    // More aggressive tree-shaking for production
    moduleSideEffects: false,
    propertyReadSideEffects: false,

    // Remove unused React code
    preset: 'recommended',
  },
}