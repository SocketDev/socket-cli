/** @fileoverview Rollup config for Ink React components (ESM). */

import path from 'node:path'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'

import constants from '../scripts/constants.mjs'

const { configPath } = constants

export default {
  input: {
    'analytics/AnalyticsApp': 'src/commands/analytics/AnalyticsApp.tsx',
    'analytics/cli': 'src/commands/analytics/analytics-app-cli.mts',
    'audit-log/AuditLogApp': 'src/commands/audit-log/AuditLogApp.tsx',
    'audit-log/cli': 'src/commands/audit-log/audit-log-app-cli.mts',
    'threat-feed/ThreatFeedApp': 'src/commands/threat-feed/ThreatFeedApp.tsx',
    'threat-feed/cli': 'src/commands/threat-feed/threat-feed-app-cli.mts',
  },
  output: {
    dir: 'external/ink',
    format: 'esm',
    exports: 'named',
    // Use preserveModules to avoid bundling everything into one file.
    preserveModules: false,
  },
  external: [
    'ink',
    'ink-table',
    'react',
    /^node:/,
    /^@socketsecurity\//,
    /^@socketregistry\//,
    // Externalize local utilities from src/
    /^\.\.\/\.\.\/utils\//,
    /^\.\.\/\.\.\/constants/,
  ],
  plugins: [
    nodeResolve({
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs'],
      preferBuiltins: true,
    }),
    commonjsPlugin({
      extensions: ['.js', '.jsx'],
    }),
    babelPlugin({
      babelHelpers: 'runtime',
      babelrc: false,
      configFile: path.join(configPath, 'babel.config.js'),
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs'],
      exclude: 'node_modules/**',
    }),
  ],
}
