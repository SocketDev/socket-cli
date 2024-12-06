import { shadowBinPath } from '../constants'
import { installSafeArborist } from './arborist'
import { installLinks } from './link'

// Shadow `npm` and `npx` to mitigate subshells.
installLinks(shadowBinPath, 'npm')
installSafeArborist()
