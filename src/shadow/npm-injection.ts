import constants from '../constants'
import { installSafeArborist } from './arborist'
import { installLinks } from './link'

const { shadowBinPath } = constants

// Shadow `npm` and `npx` to mitigate subshells.
installLinks(shadowBinPath, 'npm')
installSafeArborist()
