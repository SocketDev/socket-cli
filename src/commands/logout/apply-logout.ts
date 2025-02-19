import { updateSetting } from '../../utils/settings'

export function applyLogout() {
  updateSetting('apiToken', null)
  updateSetting('apiBaseUrl', null)
  updateSetting('apiProxy', null)
  updateSetting('enforcedOrgs', null)
}
