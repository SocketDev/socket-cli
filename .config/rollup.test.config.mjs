import replacePlugin from '@rollup/plugin-replace'

import baseConfig from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'

const { INLINED_SOCKET_CLI_TEST_DIST_BUILD } = constants

export default () => {
  // Lazily access constants.rootSrcPath
  const { rootSrcPath } = constants
  return baseConfig({
    input: {
      errors: `${rootSrcPath}/utils/errors.ts`,
      'path-resolve': `${rootSrcPath}/utils/path-resolve.ts`
    },
    output: [
      {
        dir: 'test/dist',
        entryFileNames: '[name].js',
        format: 'cjs',
        exports: 'auto',
        externalLiveBindings: false,
        freeze: false,
        sourcemap: true,
        sourcemapDebugIds: true
      }
    ],
    plugins: [
      // Inline process.env values.
      replacePlugin({
        delimiters: ['(?<![\'"])\\b', '(?![\'"])'],
        preventAssignment: true,
        values: [[INLINED_SOCKET_CLI_TEST_DIST_BUILD, 'true']].reduce(
          (obj, { 0: name, 1: value }) => {
            obj[`process.env.${name}`] = value
            obj[`process.env['${name}']`] = value
            obj[`process.env[${name}]`] = value
            return obj
          },
          {}
        )
      })
    ]
  })
}
