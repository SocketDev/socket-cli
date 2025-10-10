/**
 * @fileoverview Ultra-fast Rollup configuration using SWC instead of Babel
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
// import swc from '@rollup/plugin-swc'

const rootPath = path.join(import.meta.dirname, '..')
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')
const cachePath = path.join(rootPath, '.cache', 'rollup')

// Generate build hash for cache busting
function getBuildHash() {
  const packageJson = readFileSync(path.join(rootPath, 'package.json'), 'utf8')
  return createHash('md5').update(packageJson).digest('hex').slice(0, 8)
}

export default {
  input: {
    cli: `${srcPath}/cli.mts`,
    'npm-cli': `${srcPath}/npm-cli.mts`,
    'npx-cli': `${srcPath}/npx-cli.mts`,
    'pnpm-cli': `${srcPath}/pnpm-cli.mts`,
    constants: `${srcPath}/constants.mts`,
    'shadow/npm/bin': `${srcPath}/shadow/npm/bin.mts`,
    'shadow/npm/inject': `${srcPath}/shadow/npm/inject.mts`,
    'shadow/npx/bin': `${srcPath}/shadow/npx/bin.mts`,
    'shadow/pnpm/bin': `${srcPath}/shadow/pnpm/bin.mts`,
    'external/ink-table': `${srcPath}/external/ink-table.mjs`,
    'external/yoga-layout': `${srcPath}/external/yoga-layout.mjs`,
  },

  output: {
    dir: distPath,
    format: 'cjs',
    exports: 'auto',
    compact: true,
    minifyInternalExports: true,
    generatedCode: {
      preset: 'es2015',
      arrowFunctions: true,
      constBindings: true,
      objectShorthand: true
    },
    experimentalMinChunkSize: 20000,
  },

  cache: {
    dir: cachePath,
    // Use build hash to invalidate cache when dependencies change
    key: getBuildHash()
  },

  // Maximum parallelization
  maxParallelFileOps: 10,

  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    preset: 'recommended'
  },

  external(id) {
    return (
      builtinModules.includes(id) ||
      builtinModules.includes(id.replace(/^node:/, '')) ||
      id.includes('@socketsecurity/registry') ||
      id.includes('@socketsecurity/sdk')
    )
  },

  plugins: [
    nodeResolve({
      exportConditions: ['node'],
      extensions: ['.mjs', '.mts', '.js', '.ts', '.tsx', '.json'],
      preferBuiltins: true,
      // Use cache
      moduleDirectories: ['node_modules'],
    }),

    // SWC - MUCH faster than Babel!
    // TODO: Enable when @rollup/plugin-swc is installed
    // swc({
    //   swc: {
    //     jsc: {
    //       parser: {
    //         syntax: 'typescript',
    //         tsx: true,
    //         decorators: false,
    //         dynamicImport: true,
    //       },
    //       target: 'es2018',
    //       transform: {
    //         react: {
    //           runtime: 'automatic',
    //           development: false,
    //         },
    //       },
    //       // Minification handled by SWC
    //       minify: {
    //         compress: {
    //           drop_console: false,
    //           drop_debugger: true,
    //           dead_code: true,
    //           unused: true,
    //         },
    //         mangle: false,
    //       },
    //     },
    //     // We'll handle this separately
    //     minify: false,
    //   },
    //   include: /\.(m?[jt]sx?)$/,
    //   exclude: /node_modules/,
    // }),

    jsonPlugin(),

    commonjsPlugin({
      defaultIsModuleExports: true,
      // Speed optimizations
      requireReturnsDefault: 'auto',
      esmExternals: true,
      // Cache transformation results
      transformMixedEsModules: true,
    }),

    replacePlugin({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
  ],

  onwarn(warning, warn) {
    // Suppress known warnings for speed
    if (
      warning.code === 'CIRCULAR_DEPENDENCY' ||
      warning.code === 'INVALID_ANNOTATION' ||
      warning.code === 'THIS_IS_UNDEFINED'
    ) {
      return
    }
    warn(warning)
  },
}