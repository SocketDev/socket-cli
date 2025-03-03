import { updateSetting } from '../../utils/settings'

export function applyLogin(
  apiToken: string,
  enforcedOrgs: string[],
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined
) {
  updateSetting('enforcedOrgs', enforcedOrgs)
  updateSetting('apiToken', apiToken)
  updateSetting('apiBaseUrl', apiBaseUrl)
  updateSetting('apiProxy', apiProxy)
}
