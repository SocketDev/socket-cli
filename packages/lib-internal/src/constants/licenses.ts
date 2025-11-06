/**
 * License identifiers and copy-left license sets.
 */

// License identifiers.
export const MIT = 'MIT'
export const UNLICENCED = 'UNLICENCED'
export const UNLICENSED = 'UNLICENSED'

// Copy-left licenses.
let _copyLeftLicenses: Set<string>
export function getCopyLeftLicenses(): Set<string> {
  if (_copyLeftLicenses === undefined) {
    _copyLeftLicenses = new Set([
      'AGPL-1.0',
      'AGPL-1.0-only',
      'AGPL-1.0-or-later',
      'AGPL-3.0',
      'AGPL-3.0-only',
      'AGPL-3.0-or-later',
      'CC-BY-SA-1.0',
      'CC-BY-SA-2.0',
      'CC-BY-SA-3.0',
      'CC-BY-SA-4.0',
      'EPL-1.0',
      'EPL-2.0',
      'EUPL-1.1',
      'EUPL-1.2',
      'GPL-1.0',
      'GPL-1.0-only',
      'GPL-1.0-or-later',
      'GPL-2.0',
      'GPL-2.0-only',
      'GPL-2.0-or-later',
      'GPL-3.0',
      'GPL-3.0-only',
      'GPL-3.0-or-later',
    ])
  }
  return _copyLeftLicenses
}
