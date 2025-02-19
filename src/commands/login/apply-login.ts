import { updateSetting } from '../../utils/settings.ts'

export function applyLogin(
  apiToken: string,
  enforcedOrgs: Array<string>,
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined
) {
  updateSetting('enforcedOrgs', enforcedOrgs)
  updateSetting('apiToken', apiToken)
  updateSetting('apiBaseUrl', apiBaseUrl)
  updateSetting('apiProxy', apiProxy)
}
