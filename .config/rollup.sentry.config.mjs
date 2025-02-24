import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import replacePlugin from '@rollup/plugin-replace'

import {
  isValidPackageName,
  readPackageJsonSync
} from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'

import baseConfig from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import {
  isBuiltin,
  getPackageName,
  normalizeId
} from '../scripts/utils/packages.js'

const {
  BABEL_RUNTIME,
  ROLLUP_EXTERNAL_SUFFIX,
  SOCKET_IS_PUBLISHED,
  SOCKET_WITH_SENTRY,
  rootPath,
  rootSrcPath
} = constants

export default () =>
  baseConfig({
    input: {
      'instrument-with-sentry': `${rootSrcPath}/instrument-with-sentry.ts`
    },
    output: [
      {
        dir: 'dist',
        entryFileNames: '[name].js',
        format: 'cjs',
        exports: 'auto',
        externalLiveBindings: false,
        freeze: false,
        sourcemap: true,
        sourcemapDebugIds: true
      }
    ],
    external(id_) {
      if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      const id = normalizeId(id_)
      const name = getPackageName(id)
      if (
        name === BABEL_RUNTIME ||
        id.startsWith(rootSrcPath) ||
        id.endsWith('.mjs') ||
        id.endsWith('.mts') ||
        isRelative(id) ||
        !isValidPackageName(name)
      ) {
        return false
      }
      return true
    },
    plugins: [
      // Inline process.env values.
      replacePlugin({
        delimiters: ['\\b', ''],
        preventAssignment: true,
        values: {
          "process.env['SOCKET_CLI_VERSION']"() {
            const { version } = readPackageJsonSync(rootPath)
            let gitHash = ''
            try {
              ;({ stdout: gitHash } = spawnSync(
                'git',
                ['rev-parse', '--short', 'HEAD'],
                'utf8'
              ))
            } catch {}
            // Make each build generate a unique version id, regardless
            // Mostly for development: confirms the build refreshed. For prod
            // builds the git hash should suffice to identify the build.
            return JSON.stringify(
              `${version}:${gitHash}:${randomUUID().split('-')[0]}${constants.ENV[SOCKET_IS_PUBLISHED] ? ':pub' : ''}`
            )
          },
          "process.env['SOCKET_IS_PUBLISHED']": JSON.stringify(
            !!constants.ENV[SOCKET_IS_PUBLISHED]
          ),
          "process.env['SOCKET_WITH_SENTRY']": JSON.stringify(
            !!constants.ENV[SOCKET_WITH_SENTRY]
          )
        }
      })
    ]
  })
