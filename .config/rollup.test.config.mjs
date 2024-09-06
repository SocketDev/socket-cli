import path from 'node:path'
import { fileURLToPath } from 'node:url'

import baseConfig from './rollup.base.config.mjs'

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
    ]
  })
