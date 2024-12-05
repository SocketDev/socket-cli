import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isRelative } from '@socketsecurity/registry/lib/path'

import baseConfig from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import { normalizeId, isBuiltin } from '../scripts/utils/packages.js'

const { ROLLUP_EXTERNAL_SUFFIX, SUPPORTS_SYNC_ESM } = constants

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const rootPath = path.resolve(__dirname, '..')
const srcPath = path.join(rootPath, 'src')

export default () =>
  baseConfig({
    input: {
      misc: `${srcPath}/utils/misc.ts`,
      'path-resolve': `${srcPath}/utils/path-resolve.ts`
    },
    output: [
      {
        dir: 'test/dist',
        entryFileNames: '[name].js',
        format: 'cjs',
        exports: 'auto',
        externalLiveBindings: false,
        freeze: false
      }
    ],
    ...(SUPPORTS_SYNC_ESM
      ? {
          external(id_) {
            if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
              return true
            }
            const id = normalizeId(id_)
            return !(isRelative(id) || id.startsWith(srcPath))
          }
        }
      : {})
  })
