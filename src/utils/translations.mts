/** @fileoverview Socket alert definitions loader */

import translationsJson from '../../.config/socket-alerts.json' with { type: 'json' }

let _translations: typeof translationsJson | undefined

export function getTranslations() {
  if (_translations === undefined) {
    _translations = translationsJson
  }
  return _translations!
}
