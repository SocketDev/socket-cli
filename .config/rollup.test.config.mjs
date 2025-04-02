import replacePlugin from '@rollup/plugin-replace'

import { isValidPackageName } from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'

import baseConfig, {
  EXTERNAL_PACKAGES,
  INLINED_PACKAGES
} from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import {
  getPackageName,
  getPackageNameEnd,
  isBuiltin,
  normalizeId,
  resolveId
} from '../scripts/utils/packages.js'

const {
  INLINED_SOCKET_CLI_TEST_DIST_BUILD,
  ROLLUP_EXTERNAL_SUFFIX,
  SLASH_NODE_MODULES_SLASH
} = constants

function isAncestorsExternal(id) {
  let currNmIndex = id.indexOf(SLASH_NODE_MODULES_SLASH)
  while (currNmIndex !== -1) {
    const nextNmIndex = id.indexOf(SLASH_NODE_MODULES_SLASH, currNmIndex + 1)
    const nameStart = currNmIndex + SLASH_NODE_MODULES_SLASH.length
    const nameEnd = getPackageNameEnd(id, nameStart)
    const name = id.slice(nameStart, nameEnd)
    if (INLINED_PACKAGES.includes(name)) {
      return false
    }
    currNmIndex = nextNmIndex
  }
  return true
}

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
    // Lazily access constants.SUPPORTS_SYNC_ESM
    ...(constants.SUPPORTS_SYNC_ESM
      ? {
          external(id_, parentId_) {
            if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
              return true
            }
            const id = normalizeId(id_)
            const name = getPackageName(id)
            if (EXTERNAL_PACKAGES.includes(name)) {
              return true
            }
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
            const parentId = parentId_ ? resolveId(parentId_) : undefined
            if (parentId && !isAncestorsExternal(parentId)) {
              return false
            }
            const resolvedId = resolveId(id, parentId)
            if (!isAncestorsExternal(resolvedId)) {
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
