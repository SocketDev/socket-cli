import replacePlugin from '@rollup/plugin-replace'

import { isValidPackageName } from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'

import baseConfig, { INLINED_PACKAGES } from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import {
  isBuiltin,
  getPackageName,
  normalizeId
} from '../scripts/utils/packages.js'

const { INLINED_SOCKET_CLI_TEST_DIST_BUILD, ROLLUP_EXTERNAL_SUFFIX } = constants

export default () => {
  // Lazily access constants.rootSrcPath
  const { rootSrcPath } = constants
  return baseConfig({
    input: {
      'alert-rules': `${rootSrcPath}/utils/alert/rules.ts`,
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
    // Lazily access constants.SUPPORTS_SYNC_ESM
    ...(constants.SUPPORTS_SYNC_ESM
      ? {
          external(id_) {
            if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
              return true
            }
            const id = normalizeId(id_)
            const name = getPackageName(id)
            if (
              INLINED_PACKAGES.includes(name) ||
              id.startsWith(rootSrcPath) ||
              id.endsWith('.mjs') ||
              id.endsWith('.mts') ||
              isRelative(id) ||
              !isValidPackageName(name)
            ) {
              return false
            }
            return true
          }
        }
      : {}),
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
