import { realpathSync } from 'node:fs'
import path from 'node:path'

import { installLinks } from './link'
import { installSafeArborist } from './arborist'

const distPath = __dirname
const rootPath = path.resolve(distPath, '..')
const binPath = path.join(rootPath, 'bin')

// shadow `npm` and `npx` to mitigate subshells
installLinks(realpathSync(binPath), 'npm')
installSafeArborist()
