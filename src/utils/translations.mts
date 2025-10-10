/** @fileoverview Socket alert definitions loader */

import translationsJson from '../../data/alert-definitions.json' with { type: 'json' }

let _translations: typeof translationsJson | undefined

export function getTranslations() {
  if (_translations === undefined) {
    _translations = translationsJson
  }
  return _translations!
}
