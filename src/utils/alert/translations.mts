import { createRequire } from 'node:module'
import path from 'node:path'

import constants from '../../constants.mts'

const require = createRequire(import.meta.url)

let _translations:
  | Readonly<typeof import('../../../data/alert-translations.json')>
  | undefined

export function getTranslations() {
  if (_translations === undefined) {
    _translations = /*@__PURE__*/ require(
      path.join(constants.rootPath, 'data', 'alert-translations.json'),
    )
  }
  return _translations!
}
