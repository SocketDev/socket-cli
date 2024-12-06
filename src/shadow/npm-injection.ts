import { shadowBinPath } from '../constants'
import { installSafeArborist } from './arborist'
import { installLinks } from './link'

// shadow `npm` and `npx` to mitigate subshells
installLinks(shadowBinPath, 'npm')
installSafeArborist()
