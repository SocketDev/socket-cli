import { updateConfigValue } from '../../utils/config.mts'

export function applyLogout() {
  updateConfigValue('apiToken', null)
  updateConfigValue('apiBaseUrl', null)
  updateConfigValue('apiProxy', null)
  updateConfigValue('enforcedOrgs', null)
}
